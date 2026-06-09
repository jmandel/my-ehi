#!/usr/bin/env bun
/**
 * acute_event.ts — DATASET LAYER for the cardiovascular deep dive.
 *
 * The acute external workup(s) a cardiologist must explain, as a COMPLETE,
 * fully-resolved, normalized table — one row per encounter / order / med-admin /
 * narrative-read, with every Epic key preserved so the app can drill from any
 * claim to its source row. This is the dataset layer: NOT curated. Every relevant
 * row in the source tables is emitted; clinical judgment lives in the analysis.
 *
 * WHAT THIS EVENT ACTUALLY IS (resolved from the data, not assumed):
 *   Two imported EXTERNAL emergency contacts at University of Wisconsin - Madison,
 *   both flagged with the GENERIC EXTERNAL DATA PROVIDER (SER 8800099) and
 *   GENERIC EXTERNAL DATA DEPARTMENT (DEP 8) sentinels (general-patterns §44):
 *
 *   1) 5/14/2024 cluster — CSN 1076628498 (PAT_ENC contact-dated 7/2/2024, but its
 *      orders are dated 5/14/2024 — the external import carries a different contact
 *      date than the orders). Chest pain after THC use (per the chest-XR read):
 *        - XR CHEST 2 VIEWS .............. radiology read (64 narrative lines)
 *        - COMPREHENSIVE METABOLIC PANEL . 'Final result', ABNORMAL_YN=Y, 0 structured rows
 *        - CBC WITH DIFFERENTIAL ......... 'Final result', 0 structured rows
 *        - TROPONIN ...................... 'Final result', ABNORMAL_YN=N, 0 structured rows
 *      The TROPONIN is the cardiac biomarker the analysis must address; its numeric
 *      value did not survive into the structured export (labs-guide gotcha #4) — only
 *      the order header (ABNORMAL_YN='N' = negative) and the resulting time exist.
 *
 *   2) 7/30/2024 cluster — CSNs 1081584507 + 1081584508 (same day; .01/.02 contacts).
 *      Suspected vertebral artery dissection of the left neck:
 *        - CT ANGIOGRAPHY NECK W WO CONTRAST . radiology read (160 narrative lines) —
 *          the clinical heart of the event; impression: no dissection, <50% NASCET
 *          carotid stenosis bilaterally, no significant atherosclerosis.
 *        - BASIC METABOLIC PANEL ............. 'Final result', 0 structured rows
 *        - CBC WITH DIFFERENTIAL ............. 'Final result', 0 structured rows
 *        - SODIUM CHLORIDE 0.9% IV SOLN ...... 8 ORDER_MED rows = ONE IV-fluid event
 *          split 4+4 across the two same-day CSNs (meds-guide gotcha #4 / §12), NOT 8
 *          medications. Discontinued same day (DISCON_TIME 8:33 PM by "EPIC, USER").
 *
 * Source-table gotchas honored:
 *   - §17 CAST(... AS INTEGER/REAL) before ordering ids / LINE / *_DATE_REAL.
 *   - §11 ORDER_NARRATIVE is line-chunked free text; reassemble in CAST(LINE AS INT)
 *     order. It is the SOLE home of imaging reads (no ORDER_RESULTS rows exist).
 *   - labs-guide #4: 'Final result' labs here carry ZERO ORDER_RESULTS rows — the
 *     numeric values are absent from the structured export; we record the gap, not a
 *     fabricated value.
 *   - §44 external-origin sentinels: provider 8800099 / department 8.
 *   - notes: HNO_INFO has NO rows tied to these three external CSNs (verified) —
 *     there is no clinical note body for this imported episode.
 *
 * Read-only, idempotent. Writes deep-dives/cardiac-risk/parts/acute_event.json.
 */
import { Database } from "bun:sqlite";

const db = new Database(process.env.EHI_DB ?? "./db/ehi.sqlite", { readonly: true });
db.run("PRAGMA busy_timeout = 8000");

// The three external contacts that make up the acute workup(s).
// Troponin lives on 1076628498; the CT-neck cluster is 1081584507/508.
const CSNS = ["1076628498", "1081584507", "1081584508"];
const csnList = CSNS.map((c) => `'${c}'`).join(",");

const clean = (s: string | null | undefined) =>
  s == null ? null : String(s).replace(" 12:00:00 AM", "").trim() || null;

// ---------------------------------------------------------------------------
// Reassemble an order's narrative read (imaging report) from ORDER_NARRATIVE.
// Line-chunked free text (§11): concat in CAST(LINE AS INT) order, drop the
// blank layout lines, keep paragraph structure.
// ---------------------------------------------------------------------------
const narrativeRows = db
  .query<{ ORDER_PROC_ID: string; LINE: string; NARRATIVE: string }, [string]>(
    `SELECT ORDER_PROC_ID, LINE, NARRATIVE FROM ORDER_NARRATIVE
     WHERE ORDER_PROC_ID = ? ORDER BY CAST(LINE AS INT)`,
  );
function narrativeFor(orderProcId: string): { text: string; n_lines: number } | null {
  const rows = narrativeRows.all(orderProcId);
  if (rows.length === 0) return null;
  const text = rows
    .map((r) => (r.NARRATIVE ?? "").replace(/\s+$/g, ""))
    .filter((l) => l.trim() !== "")
    .join("\n");
  return { text, n_lines: rows.length };
}

const rows: any[] = [];

// ---------------------------------------------------------------------------
// 1. ENCOUNTER rows — the GENERIC EXTERNAL origin tying the orders together.
// ---------------------------------------------------------------------------
const encs = db
  .query<any, []>(
    `SELECT e.PAT_ENC_CSN_ID AS csn,
            e.CONTACT_DATE, CAST(e.PAT_ENC_DATE_REAL AS REAL) AS date_real,
            e.DEPARTMENT_ID AS dept_id, d.DEPARTMENT_NAME AS dept,
            e.VISIT_PROV_ID AS prov_id, s.PROV_NAME AS prov_name,
            e.APPT_STATUS_C_NAME AS appt_status
     FROM PAT_ENC e
     LEFT JOIN CLARITY_DEP d ON e.DEPARTMENT_ID = d.DEPARTMENT_ID
     LEFT JOIN CLARITY_SER s ON e.VISIT_PROV_ID = s.PROV_ID
     WHERE e.PAT_ENC_CSN_ID IN (${csnList})
     ORDER BY CAST(e.PAT_ENC_DATE_REAL AS REAL)`,
  )
  .all();

for (const e of encs) {
  rows.push({
    kind: "encounter",
    name: `External contact ${clean(e.CONTACT_DATE)} (${e.dept})`,
    value: null,
    impression: null,
    date: clean(e.CONTACT_DATE),
    date_real: e.date_real,
    order_id: null,
    enc_csn: e.csn,
    dept: e.dept,
    dept_id: e.dept_id,
    provider: e.prov_name,
    provider_id: e.prov_id,
    external_origin:
      e.dept_id === "8" && e.prov_id === "8800099"
        ? "GENERIC EXTERNAL DATA DEPARTMENT + GENERIC EXTERNAL DATA PROVIDER (imported, §44)"
        : null,
    status: clean(e.appt_status),
    src: `PAT_ENC:PAT_ENC_CSN_ID=${e.csn}`,
  });
}

// ---------------------------------------------------------------------------
// 2. ORDER (procedure/lab/imaging) rows — the 7 ORDER_PROC orders.
//    Each carries: its reassembled narrative read (CT, XR) as `impression`/
//    `narrative`; for labs with no structured value, the gap is recorded
//    explicitly with the order-level ABNORMAL_YN rollup (the only signal that
//    survived the import).
// ---------------------------------------------------------------------------
const procs = db
  .query<any, []>(
    `SELECT op.ORDER_PROC_ID AS order_id, op.DESCRIPTION AS name,
            op.ORDER_TYPE_C_NAME AS type, op.PROC_ID AS proc_id,
            op.LAB_STATUS_C_NAME AS lab_status,
            op.RADIOLOGY_STATUS_C_NAME AS rad_status,
            op.ABNORMAL_YN AS abnormal_yn,
            op.ORDERING_DATE, op.ORDER_TIME, op.RESULT_TIME,
            op.PAT_ENC_CSN_ID AS csn,
            op.AUTHRZING_PROV_ID AS prov_id, s.PROV_NAME AS prov_name,
            (SELECT COUNT(*) FROM ORDER_RESULTS r WHERE r.ORDER_PROC_ID = op.ORDER_PROC_ID) AS n_results
     FROM ORDER_PROC op
     LEFT JOIN CLARITY_SER s ON op.AUTHRZING_PROV_ID = s.PROV_ID
     WHERE op.PAT_ENC_CSN_ID IN (${csnList})
     ORDER BY op.PAT_ENC_CSN_ID, CAST(op.ORDER_PROC_ID AS INTEGER)`,
  )
  .all();

const encDeptByCsn = new Map(encs.map((e) => [e.csn, e.dept]));
const encDateRealByCsn = new Map(encs.map((e) => [e.csn, e.date_real]));

for (const o of procs) {
  const narr = narrativeFor(o.order_id);
  const isImaging = o.type === "Imaging";
  // For labs: no structured ORDER_RESULTS rows survived the import (gotcha #4);
  // ABNORMAL_YN is the only result signal that came through. Encode value/gap.
  let value: string | null = null;
  let valueNote: string | null = null;
  if (!isImaging) {
    if (o.n_results === 0) {
      value =
        o.abnormal_yn === "Y"
          ? "Abnormal (ABNORMAL_YN=Y); discrete component values not in structured export"
          : o.abnormal_yn === "N"
            ? "Not flagged abnormal (ABNORMAL_YN=N); discrete component values not in structured export"
            : "Resulted ('Final result'); discrete component values not in structured export";
      valueNote =
        "labs-guide gotcha #4: 'Final result' order with ZERO ORDER_RESULTS rows — numeric value absent from the structured export, available only as the order header.";
    }
  }
  rows.push({
    kind: "order",
    name: o.name,
    order_type: o.type,
    value, // for labs: the surviving order-level result signal (or null)
    value_note: valueNote,
    impression: isImaging && narr ? narr.text : null, // imaging read = the impression text
    narrative_lines: narr ? narr.n_lines : 0,
    abnormal_yn: o.abnormal_yn || null,
    lab_status: o.lab_status || null,
    radiology_status: o.rad_status || null,
    n_structured_results: Number(o.n_results),
    date: clean(o.ORDERING_DATE),
    date_real: encDateRealByCsn.get(o.csn) ?? null,
    order_time: o.ORDER_TIME || null,
    result_time: o.RESULT_TIME || null,
    proc_id: o.proc_id,
    order_id: o.order_id,
    enc_csn: o.csn,
    dept: encDeptByCsn.get(o.csn) ?? null,
    provider: o.prov_name,
    provider_id: o.prov_id,
    external_origin:
      o.prov_id === "8800099" ? "GENERIC EXTERNAL DATA PROVIDER (imported, §44)" : null,
    src:
      `ORDER_PROC:ORDER_PROC_ID=${o.order_id}` +
      (narr ? ` + ORDER_NARRATIVE:ORDER_PROC_ID=${o.order_id} (${narr.n_lines} lines)` : ""),
  });
}

// ---------------------------------------------------------------------------
// 3. MED_ADMIN rows — the 8 SODIUM CHLORIDE 0.9% IV SOLN ORDER_MED rows.
//    Emitted individually (complete dataset, one row per source row); the
//    analysis collapses the 4+4 split into ONE IV-fluid event (§12).
// ---------------------------------------------------------------------------
const meds = db
  .query<any, []>(
    `SELECT om.ORDER_MED_ID AS order_id,
            COALESCE(om.DISPLAY_NAME, om.DESCRIPTION) AS name,
            om.DESCRIPTION AS description,
            om.ORDER_STATUS_C_NAME AS status,
            om.ORDER_CLASS_C_NAME AS class,
            om.ORDERING_MODE_C_NAME AS mode,
            om.ORDERING_DATE, om.ORDER_INST, om.START_DATE, om.END_DATE,
            om.DISCON_TIME, om.DISCON_USER_ID_NAME AS discon_user,
            om.RSN_FOR_DISCON_C_NAME AS discon_reason,
            om.MEDICATION_ID AS medication_id, cm.GENERIC_NAME AS generic_name,
            om.PAT_ENC_CSN_ID AS csn, CAST(om.PAT_ENC_DATE_REAL AS REAL) AS date_real
     FROM ORDER_MED om
     LEFT JOIN CLARITY_MEDICATION cm ON om.MEDICATION_ID = cm.MEDICATION_ID
     WHERE om.PAT_ENC_CSN_ID IN (${csnList})
     ORDER BY om.PAT_ENC_CSN_ID, CAST(om.ORDER_MED_ID AS INTEGER)`,
  )
  .all();

for (const m of meds) {
  rows.push({
    kind: "med_admin",
    name: m.name,
    description: m.description,
    generic_name: m.generic_name,
    value: `${m.status}${m.mode ? ` / ${m.mode}` : ""}`,
    impression: null,
    status: m.status,
    order_class: m.class,
    ordering_mode: m.mode,
    date: clean(m.ORDERING_DATE),
    date_real: m.date_real,
    order_inst: m.ORDER_INST || null,
    start_date: clean(m.START_DATE),
    end_date: clean(m.END_DATE),
    discon_time: m.DISCON_TIME || null,
    discon_user: m.discon_user || null,
    discon_reason: m.discon_reason || null,
    medication_id: m.medication_id,
    order_id: m.order_id,
    enc_csn: m.csn,
    dept: encDeptByCsn.get(m.csn) ?? null,
    src: `ORDER_MED:ORDER_MED_ID=${m.order_id}`,
  });
}

// ---------------------------------------------------------------------------
// Completeness self-audit: raw source row counts vs what we emitted.
// ---------------------------------------------------------------------------
const c = (sql: string) => Number((db.query(sql).get() as any).n);
const srcCounts = {
  pat_enc: c(`SELECT COUNT(*) n FROM PAT_ENC WHERE PAT_ENC_CSN_ID IN (${csnList})`),
  order_proc: c(`SELECT COUNT(*) n FROM ORDER_PROC WHERE PAT_ENC_CSN_ID IN (${csnList})`),
  order_med: c(`SELECT COUNT(*) n FROM ORDER_MED WHERE PAT_ENC_CSN_ID IN (${csnList})`),
  order_results: c(`SELECT COUNT(*) n FROM ORDER_RESULTS WHERE PAT_ENC_CSN_ID IN (${csnList})`),
  order_narrative_lines: c(
    `SELECT COUNT(*) n FROM ORDER_NARRATIVE n JOIN ORDER_PROC op ON n.ORDER_PROC_ID=op.ORDER_PROC_ID WHERE op.PAT_ENC_CSN_ID IN (${csnList})`,
  ),
  hno_notes: c(`SELECT COUNT(*) n FROM HNO_INFO WHERE PAT_ENC_CSN_ID IN (${csnList})`),
};

const emitted = {
  encounter: rows.filter((r) => r.kind === "encounter").length,
  order: rows.filter((r) => r.kind === "order").length,
  med_admin: rows.filter((r) => r.kind === "med_admin").length,
};

const meta = {
  topic: "cardiac-risk / acute_event",
  patient: "MANDEL, JOSHUA C (DOB 1982-10-26)",
  description:
    "Two imported external emergency contacts (5/14/2024 chest-pain workup incl. TROPONIN; 7/30/2024 suspected-dissection workup incl. CT ANGIOGRAPHY NECK + IV 0.9% NaCl). One row per encounter/order/med-admin; imaging reads reassembled from ORDER_NARRATIVE. Complete dataset layer — not curated.",
  csns: CSNS,
  external_origin: "GENERIC EXTERNAL DATA PROVIDER (SER 8800099) / GENERIC EXTERNAL DATA DEPARTMENT (DEP 8) — general-patterns §44",
  source_row_counts: srcCounts,
  emitted_row_counts: { ...emitted, total: rows.length },
  completeness_check: {
    encounters: `${emitted.encounter} emitted vs ${srcCounts.pat_enc} PAT_ENC rows`,
    orders: `${emitted.order} emitted vs ${srcCounts.order_proc} ORDER_PROC rows`,
    med_admins: `${emitted.med_admin} emitted vs ${srcCounts.order_med} ORDER_MED rows`,
    structured_results: `${srcCounts.order_results} ORDER_RESULTS rows exist (labs resulted as headers only — gotcha #4)`,
    narrative_lines_reassembled: `${srcCounts.order_narrative_lines} ORDER_NARRATIVE lines across 2 imaging reads (XR CHEST + CT ANGIO NECK)`,
    notes: `${srcCounts.hno_notes} HNO_INFO note bodies tied to these external CSNs`,
  },
  notes: [
    "Troponin order 1025926285 (5/14/2024) is the only TROPONIN order in the export; ABNORMAL_YN='N' (negative). No discrete value survived the import.",
    "The 8 SODIUM CHLORIDE 0.9% IV SOLN rows are ONE IV-fluid event split 4 (CSN 1081584507) + 4 (CSN 1081584508) across two same-day external contacts (§12), all Discontinued 7/30/2024 8:33 PM by 'EPIC, USER'. The analysis must collapse them.",
    "CSN 1076628498 PAT_ENC.CONTACT_DATE renders 7/2/2024 but its orders are dated 5/14/2024 — the external import's contact date differs from the order dates; trust ORDERING_DATE/RESULT_TIME for the clinical event.",
    "No ORDER_DX_PROC indication rows exist for any of these orders; the CT indication ('assess for vascular dissection left neck — Vertebral artery dissection suspected') and the XR indication ('Chest pain since yesterday after consuming THC') live INSIDE the narrative reads.",
  ],
};

const out = { rows, meta };
await Bun.write("deep-dives/cardiac-risk/parts/acute_event.json", JSON.stringify(out, null, 2));

// Console summary (omit the long narrative bodies).
console.log(
  JSON.stringify(
    {
      total_rows: rows.length,
      by_kind: emitted,
      source_row_counts: srcCounts,
      completeness: meta.completeness_check,
      rows_preview: rows.map((r) => ({
        kind: r.kind,
        name: r.name,
        order_id: r.order_id,
        enc_csn: r.enc_csn,
        date: r.date,
        value: r.value,
        narrative_lines: r.narrative_lines ?? undefined,
      })),
    },
    null,
    2,
  ),
);
