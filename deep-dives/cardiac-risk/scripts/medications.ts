#!/usr/bin/env bun
/**
 * medications.ts — COMPLETE normalized medication dataset for the cardiac-risk deep dive.
 *
 * Patient: MANDEL, JOSHUA C (Z7004242).
 *
 * Scope decision (per ehi-abstraction-pass: the DATASET layer is COMPLETE, not curated):
 *   We emit ONE ROW PER medication order in ORDER_MED — every order, not just the CV ones.
 *   The cardiologist needs the antihypertensive thread (lisinopril, offered then declined) AND
 *   the full med context to see what is *absent* (no statin / no other lipid agent / no
 *   beta-blocker / no aspirin anywhere in the record). Curation ("which of these matter for CV
 *   risk") is the ANALYSIS layer's job; here we keep everything and TAG cv-relevance so the app
 *   can filter without us having dropped rows.
 *
 * Source spine: ORDER_MED (20 rows). Enriched (all joins verified in the meds field guide):
 *   - CLARITY_MEDICATION         generic name via MEDICATION_ID (NOT ORDER_MED_ID)
 *   - ORDER_MED_SIG              patient sig text, keyed ORDER_ID = ORDER_MED_ID
 *   - ORDER_DX_MED + CLARITY_EDG indication diagnosis (LINE 1)
 *   - DISCONTINUED_MEDS          the contact a med was discontinued on (MEDS_DISCONTINUED = ORDER_MED_ID)
 *   - ORDER_RPTD_SIG_HX          reconciliation event log (Initial Prescription / Not Taking / Taking ...)
 *   - MEDS_REV_HX_LIST           per-review TAKING_YN audit (MEDICATION_ORDER_ID = ORDER_MED_ID)
 *
 * Two-ID-space caveats honored (meds field guide):
 *   - drug catalog reached ONLY through MEDICATION_ID (ORDER_MED_ID does NOT join CLARITY_MEDICATION)
 *   - shared ORDER_ID space: ORDER_MED_SIG / ORDER_RPTD_SIG_HX name their key ORDER_ID but hold
 *     ORDER_MED_ID values; we filter to med orders. (No non-med rows leak because we left-join
 *     from ORDER_MED.)
 *   - status & dates read from ORDER_MED only, never ORDER_STATUS (which is a different contact table).
 *   - DISPLAY_NAME is NULL on reordered/historical rows → name via COALESCE(DISPLAY_NAME, DESCRIPTION).
 *   - reorder chain: CHNG_ORDER_MED_ID points at the predecessor this row replaced; a row that is
 *     NOT pointed at by any CHNG_ORDER_MED_ID is the HEAD (current) of its therapy chain.
 *
 * Read-only. Idempotent. Writes deep-dives/cardiac-risk/parts/medications.json.
 */
import { Database } from "bun:sqlite";

const DB = process.env.EHI_DB ?? "./db/ehi.sqlite";
const db = new Database(DB, { readonly: true });
db.run("PRAGMA busy_timeout = 8000");

const all = <T = Record<string, unknown>>(sql: string, ...p: unknown[]) =>
  db.query(sql).all(...(p as [])) as T[];

// --- CV relevance classification --------------------------------------------
// Tag, do not drop. The analysis decides importance; we only label so the app can filter.
//   "antihypertensive" — the lisinopril thread (offered/declined): the core CV finding.
//   "metabolic-monitor" — FreeStyle Libre CGM (glycemic surveillance; CV-risk-adjacent, no drug).
//   "anaphylaxis"       — epinephrine auto-injector (CV-active rescue drug; documents allergy risk).
//   "none"              — no direct CV bearing (nortriptyline, cyclobenzaprine, NaCl IV, Paxlovid, loratadine).
// NOTE the absence the analysis will call out: NO statin / fibrate / ezetimibe / PCSK9, NO
// beta-blocker / CCB / ARB / thiazide / other antihypertensive, NO aspirin/antiplatelet, NO
// anticoagulant anywhere in ORDER_MED.
function cvRelevance(genericOrDesc: string): { cv_relevance: string; cv_note: string } {
  const s = genericOrDesc.toLowerCase();
  if (s.includes("lisinopril"))
    return { cv_relevance: "antihypertensive", cv_note: "ACE inhibitor for primary hypertension" };
  if (s.includes("continuous glucose") || s.includes("libre"))
    return { cv_relevance: "metabolic-monitor", cv_note: "CGM sensor/reader — glycemic surveillance, CV-risk-adjacent" };
  if (s.includes("epinephrine"))
    return { cv_relevance: "anaphylaxis", cv_note: "Epinephrine auto-injector — CV-active rescue med" };
  return { cv_relevance: "none", cv_note: "" };
}

// --- side tables (gather once, index by ORDER_MED_ID) ------------------------
const sig = new Map<string, string>();
for (const r of all<{ ORDER_ID: string; SIG_TEXT: string | null }>(
  `SELECT ORDER_ID, SIG_TEXT FROM ORDER_MED_SIG
   WHERE ORDER_ID IN (SELECT ORDER_MED_ID FROM ORDER_MED)`
)) if (r.SIG_TEXT != null) sig.set(r.ORDER_ID, r.SIG_TEXT);

const indication = new Map<string, { dx_id: string; dx_name: string }>();
for (const r of all<{ ORDER_MED_ID: string; DX_ID: string; DX_NAME: string }>(
  `SELECT dm.ORDER_MED_ID, dm.DX_ID, edg.DX_NAME
   FROM ORDER_DX_MED dm LEFT JOIN CLARITY_EDG edg ON edg.DX_ID = dm.DX_ID
   WHERE CAST(dm.LINE AS INTEGER) = 1`
)) indication.set(r.ORDER_MED_ID, { dx_id: r.DX_ID, dx_name: r.DX_NAME });

// discontinue contact (the encounter the med was stopped on)
const disconContact = new Map<string, { csn: string; date: string }>();
for (const r of all<{ MEDS_DISCONTINUED: string; PAT_ENC_CSN_ID: string; CONTACT_DATE: string }>(
  `SELECT MEDS_DISCONTINUED, PAT_ENC_CSN_ID, CONTACT_DATE FROM DISCONTINUED_MEDS`
)) disconContact.set(r.MEDS_DISCONTINUED, { csn: r.PAT_ENC_CSN_ID, date: r.CONTACT_DATE });

// reconciliation event log (ordered by entry instant)
const reconEvents = new Map<string, Array<{ entry_dttm: string; action: string; source: string; reason_comment: string | null }>>();
for (const r of all<{ ORDER_ID: string; ENTRY_DTTM: string; ACTION_C_NAME: string; SOURCE_C_NAME: string; REASON_COMMENT: string | null }>(
  `SELECT ORDER_ID, ENTRY_DTTM, ACTION_C_NAME, SOURCE_C_NAME, REASON_COMMENT
   FROM ORDER_RPTD_SIG_HX
   WHERE ORDER_ID IN (SELECT ORDER_MED_ID FROM ORDER_MED)
   ORDER BY CAST(ORDER_ID AS INTEGER), CAST(LINE AS INTEGER)`
)) {
  const a = reconEvents.get(r.ORDER_ID) ?? [];
  a.push({ entry_dttm: r.ENTRY_DTTM, action: r.ACTION_C_NAME, source: r.SOURCE_C_NAME, reason_comment: r.REASON_COMMENT });
  reconEvents.set(r.ORDER_ID, a);
}

// taking-status reviews: counts of TAKING_YN across med-rec reviews (Y / N / blank)
const takingHx = new Map<string, { Y: number; N: number; blank: number }>();
for (const r of all<{ MEDICATION_ORDER_ID: string; TAKING_YN: string | null }>(
  `SELECT MEDICATION_ORDER_ID, TAKING_YN FROM MEDS_REV_HX_LIST
   WHERE MEDICATION_ORDER_ID IN (SELECT ORDER_MED_ID FROM ORDER_MED)`
)) {
  const t = takingHx.get(r.MEDICATION_ORDER_ID) ?? { Y: 0, N: 0, blank: 0 };
  if (r.TAKING_YN === "Y") t.Y++;
  else if (r.TAKING_YN === "N") t.N++;
  else t.blank++;
  takingHx.set(r.MEDICATION_ORDER_ID, t);
}

// set of order ids that are pointed at as a predecessor (i.e. were superseded by a reorder)
const supersededBy = new Map<string, string>(); // predecessorId -> successorId
const chngPointer = new Map<string, string>();   // thisId -> predecessorId it replaced

// --- spine -------------------------------------------------------------------
type OrderRow = {
  ORDER_MED_ID: string;
  PAT_ID: string;
  PAT_ENC_CSN_ID: string;
  PAT_ENC_DATE_REAL: string;
  MEDICATION_ID: string | null;
  DISPLAY_NAME: string | null;
  DESCRIPTION: string | null;
  GENERIC_NAME: string | null;
  DOSAGE: string | null;
  QUANTITY: string | null;
  REFILLS: string | null;
  MED_ROUTE_C_NAME: string | null;
  ORDER_STATUS_C_NAME: string | null;
  ORDER_CLASS_C_NAME: string | null;
  ORDERING_MODE_C_NAME: string | null;
  PROVIDER_TYPE_C_NAME: string | null;
  ORDERING_DATE: string | null;
  START_DATE: string | null;
  END_DATE: string | null;
  RSN_FOR_DISCON_C_NAME: string | null;
  DISCON_TIME: string | null;
  DISCON_USER_ID_NAME: string | null;
  CHNG_ORDER_MED_ID: string | null;
  ord_prov: string | null;
  auth_prov: string | null;
};

const orders = all<OrderRow>(
  `SELECT om.ORDER_MED_ID, om.PAT_ID, om.PAT_ENC_CSN_ID, om.PAT_ENC_DATE_REAL,
          om.MEDICATION_ID, om.DISPLAY_NAME, om.DESCRIPTION, cm.GENERIC_NAME,
          om.DOSAGE, om.QUANTITY, om.REFILLS, om.MED_ROUTE_C_NAME,
          om.ORDER_STATUS_C_NAME, om.ORDER_CLASS_C_NAME, om.ORDERING_MODE_C_NAME,
          om.PROVIDER_TYPE_C_NAME,
          om.ORDERING_DATE, om.START_DATE, om.END_DATE,
          om.RSN_FOR_DISCON_C_NAME, om.DISCON_TIME, om.DISCON_USER_ID_NAME,
          om.CHNG_ORDER_MED_ID,
          sp.PROV_NAME AS ord_prov, sa.PROV_NAME AS auth_prov
   FROM ORDER_MED om
   LEFT JOIN CLARITY_MEDICATION cm ON om.MEDICATION_ID = cm.MEDICATION_ID
   LEFT JOIN CLARITY_SER sp ON sp.PROV_ID = om.ORD_PROV_ID
   LEFT JOIN CLARITY_SER sa ON sa.PROV_ID = om.AUTHRZING_PROV_ID
   ORDER BY CAST(om.PAT_ENC_DATE_REAL AS REAL)`
);

for (const o of orders) {
  if (o.CHNG_ORDER_MED_ID) {
    chngPointer.set(o.ORDER_MED_ID, o.CHNG_ORDER_MED_ID);
    supersededBy.set(o.CHNG_ORDER_MED_ID, o.ORDER_MED_ID);
  }
}

const rows = orders.map((o) => {
  const name = o.DISPLAY_NAME ?? o.DESCRIPTION ?? "";
  const generic = o.GENERIC_NAME ?? "";
  const { cv_relevance, cv_note } = cvRelevance(`${generic} ${name} ${o.DESCRIPTION ?? ""}`);
  const ind = indication.get(o.ORDER_MED_ID) ?? null;
  const dc = disconContact.get(o.ORDER_MED_ID) ?? null;
  const recon = reconEvents.get(o.ORDER_MED_ID) ?? [];
  const taking = takingHx.get(o.ORDER_MED_ID) ?? null;

  // Historical Med has blank status; surface that explicitly rather than emitting empty string.
  const status =
    o.ORDER_STATUS_C_NAME && o.ORDER_STATUS_C_NAME.trim() !== ""
      ? o.ORDER_STATUS_C_NAME
      : o.ORDER_CLASS_C_NAME === "Historical Med"
      ? "Historical Med (documented, not prescribed)"
      : null;

  // reorder-chain position
  const is_chain_head = !supersededBy.has(o.ORDER_MED_ID); // nothing supersedes it = current head
  const supersedes = chngPointer.get(o.ORDER_MED_ID) ?? null; // the order this one replaced
  const superseded_by = supersededBy.get(o.ORDER_MED_ID) ?? null;

  return {
    order_med_id: o.ORDER_MED_ID,
    name,
    generic,
    description: o.DESCRIPTION,
    medication_id: o.MEDICATION_ID,

    status,
    order_class: o.ORDER_CLASS_C_NAME,
    ordering_mode: o.ORDERING_MODE_C_NAME,
    provider_type: o.PROVIDER_TYPE_C_NAME, // 'Authorizing' = prescribed; 'Documenting' = historical

    dosage: o.DOSAGE || null,
    quantity: o.QUANTITY || null,
    refills: o.REFILLS || null,
    route: o.MED_ROUTE_C_NAME || null,
    sig: sig.get(o.ORDER_MED_ID) ?? null,

    indication_dx_id: ind?.dx_id ?? null,
    indication: ind?.dx_name ?? null,

    ordering_date: o.ORDERING_DATE,
    start_date: o.START_DATE || null,
    end_date: o.END_DATE || null,

    // discontinue / offered-declined detail
    discon_reason: o.RSN_FOR_DISCON_C_NAME || null,
    discon_time: o.DISCON_TIME || null,
    discon_user: o.DISCON_USER_ID_NAME || null,
    discon_contact_csn: dc?.csn ?? null,
    discon_contact_date: dc?.date ?? null,

    // taking-status history (med-rec audit) — how the patient/clinic reconciled the med over time
    taking_yn_history: taking, // {Y,N,blank} review counts; e.g. lisinopril N/N = never taking
    reconciliation_events: recon, // ordered event log (Initial Prescription, Not Taking, ...)

    // reorder chain
    reorder_supersedes: supersedes,   // the ORDER_MED_ID this row replaced (CHNG_ORDER_MED_ID)
    reorder_superseded_by: superseded_by, // the ORDER_MED_ID that later replaced this row
    is_chain_head: is_chain_head,     // true = current/latest order in its therapy chain

    enc_csn: o.PAT_ENC_CSN_ID,
    enc_date_real: o.PAT_ENC_DATE_REAL,
    ord_prov: o.ord_prov,
    auth_prov: o.auth_prov,

    cv_relevance,
    cv_note,

    src: {
      table: "ORDER_MED",
      key: { ORDER_MED_ID: o.ORDER_MED_ID },
      joined: [
        o.MEDICATION_ID ? `CLARITY_MEDICATION.MEDICATION_ID=${o.MEDICATION_ID}` : null,
        sig.has(o.ORDER_MED_ID) ? `ORDER_MED_SIG.ORDER_ID=${o.ORDER_MED_ID}` : null,
        ind ? `ORDER_DX_MED.ORDER_MED_ID=${o.ORDER_MED_ID}+CLARITY_EDG.DX_ID=${ind.dx_id}` : null,
        dc ? `DISCONTINUED_MEDS.MEDS_DISCONTINUED=${o.ORDER_MED_ID}` : null,
        recon.length ? `ORDER_RPTD_SIG_HX.ORDER_ID=${o.ORDER_MED_ID}` : null,
        taking ? `MEDS_REV_HX_LIST.MEDICATION_ORDER_ID=${o.ORDER_MED_ID}` : null,
      ].filter(Boolean),
    },
  };
});

// --- completeness check ------------------------------------------------------
const rawCount = (all<{ n: number }>(`SELECT COUNT(*) AS n FROM ORDER_MED`))[0].n;
if (rows.length !== rawCount) {
  throw new Error(`INCOMPLETE: emitted ${rows.length} rows but ORDER_MED has ${rawCount}`);
}

const out = {
  rows,
  meta: {
    entity: "medications",
    patient: { pat_id: "Z7004242", name: "MANDEL, JOSHUA C" },
    source_table: "ORDER_MED",
    raw_source_count: rawCount,
    emitted_count: rows.length,
    complete: rows.length === rawCount,
    generated_from: "deep-dives/cardiac-risk/scripts/medications.ts",
    cv_relevance_counts: rows.reduce<Record<string, number>>((m, r) => {
      m[r.cv_relevance] = (m[r.cv_relevance] ?? 0) + 1;
      return m;
    }, {}),
    notes: [
      "ONE ROW PER ORDER_MED order (complete, not curated). cv_relevance tags rather than filters.",
      "Antihypertensive thread = lisinopril 772179261: discon_reason '* Patient refusal', taking_yn_history N/N.",
      "ABSENT from the entire med record (analysis-relevant): no statin/fibrate/ezetimibe/PCSK9, " +
        "no beta-blocker/CCB/ARB/thiazide/other antihypertensive, no aspirin/antiplatelet, no anticoagulant.",
      "Nortriptyline is 4 order rows for ONE continuous therapy (reorder chain 772179266→772179269→945468373→1034471696).",
      "8 NaCl IV rows = one external inpatient event 7/30/2024 (ORDERING_MODE_C_NAME='Inpatient', GENERIC EXTERNAL DATA PROVIDER).",
      "Status/dates read from ORDER_MED only (never ORDER_STATUS). Generic via MEDICATION_ID (never ORDER_MED_ID).",
    ],
  },
};

const path = "deep-dives/cardiac-risk/parts/medications.json";
await Bun.write(path, JSON.stringify(out, null, 2));
console.log(`wrote ${path}: ${rows.length} rows (raw ORDER_MED = ${rawCount}, complete=${rows.length === rawCount})`);
console.log("cv_relevance:", JSON.stringify(out.meta.cv_relevance_counts));
