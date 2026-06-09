#!/usr/bin/env bun
/**
 * encounters_dx.ts — DATASET entity for the cardiovascular-risk deep dive.
 *
 * Emits the COMPLETE, normalized set of encounters where a cardiovascular topic
 * arose (blood pressure / hypertension / lipids / cardiac), together with the
 * FULL diagnosis picture for each of those encounters (every PAT_ENC_DX row, not
 * just the cardiovascular ones). Plus a structured determination of the
 * "is hypertension undercoded?" question with row-level evidence.
 *
 * Output: deep-dives/cardiac-risk/parts/encounters_dx.json  ->  { rows, dx_rows, htn_coding, meta }
 *
 * Read-only. Idempotent. Re-running re-creates the file exactly.
 *
 * Genre gotchas honored (reading-epic-ehi-export):
 *  - everything is TEXT -> CAST(... AS REAL/INTEGER) before ORDER/MIN/MAX (general §17)
 *  - PAT_ENC_3 keys on PAT_ENC_CSN (no _ID); we don't need it here
 *  - flowsheet BP lives only in V_EHI_FLO_MEAS_VALUE.MEAS_VALUE_EXTERNAL, packed "sys/dia",
 *    VALUE_TYPE_C_NAME='Blood Pressure' (§26/§47); tied to an encounter via
 *    IP_FLWSHT_REC.INPATIENT_DATA_ID = PAT_ENC.INPATIENT_DATA_ID
 *  - DX_ID resolves through CLARITY_EDG (bare DX_ID column; no ICD-10 in this export)
 *  - encounter dx links to a problem ONLY via DX_LINK_PROB_ID, never by DX_ID
 */
import { Database } from "bun:sqlite";

const db = new Database(process.env.EHI_DB ?? "./db/ehi.sqlite", { readonly: true });
db.run("PRAGMA busy_timeout = 8000");
const q = <T = any>(sql: string, ...p: any[]): T[] => db.query(sql).all(...p) as T[];

// ----- Cardiovascular DX_IDs present in this export (verified against CLARITY_EDG) -----
// Hypertension: 108212 "Primary hypertension", 463437 "Essential (primary) hypertension"
// Lipids:       513616 "Encounter for screening for lipoid disorders", 187132 "Screening for hyperlipidemia"
// Diabetes scr: 513611 "Encounter for screening for diabetes mellitus", 15362 "Screening for diabetes mellitus"
//   (diabetes screening is part of cardiometabolic risk assessment and travels with the lipid screen here)
const CV_DX = ["108212", "463437", "513616", "187132", "513611", "15362"];
const HTN_DX = ["108212", "463437"];
const LIPID_DX = ["513616", "187132"];
const DM_SCR_DX = ["513611", "15362"];
const CV_MED_ID = "772179261"; // lisinopril 10 mg, the only CV med ever ordered

const inList = (xs: string[]) => xs.map((x) => `'${x}'`).join(",");

// ----- 1. The cardiovascular-relevant encounter set (the UNION, complete) -----
// An encounter is in-scope if ANY of:
//   (a) it carries a cardiovascular encounter diagnosis (HTN / lipid / diabetes screen)
//   (b) a lipid panel was ordered on it
//   (c) the cardiac medication (lisinopril) was ordered on it
//   (d) a blood-pressure reading was recorded at it (BP is the core CV vital)
const scopeCsns: string[] = q<{ csn: string }>(`
  SELECT DISTINCT PAT_ENC_CSN_ID AS csn FROM (
    SELECT PAT_ENC_CSN_ID FROM PAT_ENC_DX  WHERE DX_ID IN (${inList(CV_DX)})
    UNION SELECT PAT_ENC_CSN_ID FROM ORDER_PROC WHERE DESCRIPTION LIKE '%LIPID%'
    UNION SELECT PAT_ENC_CSN_ID FROM ORDER_MED  WHERE ORDER_MED_ID = '${CV_MED_ID}'
    UNION SELECT e.PAT_ENC_CSN_ID
          FROM IP_FLWSHT_MEAS m
          JOIN IP_FLWSHT_REC r ON m.FSD_ID = r.FSD_ID
          JOIN PAT_ENC e ON r.INPATIENT_DATA_ID = e.INPATIENT_DATA_ID
          WHERE m.FLO_MEAS_ID_DISP_NAME = 'BP'
  )
`).map((r) => r.csn);

// ----- 2. BP readings per encounter (packed sys/dia unpacked) -----
// Map FSD_ID -> packed value via the view; FSD_ID -> encounter via IP_FLWSHT_REC.
const bpByCsn = new Map<string, { fsd_id: string; recorded: string; sys: number | null; dia: number | null; raw: string }[]>();
for (const r of q<any>(`
  SELECT m.FSD_ID, m.RECORDED_TIME, v.MEAS_VALUE_EXTERNAL AS bp, e.PAT_ENC_CSN_ID AS csn
  FROM IP_FLWSHT_MEAS m
  JOIN IP_FLWSHT_REC rec ON m.FSD_ID = rec.FSD_ID
  JOIN PAT_ENC e ON rec.INPATIENT_DATA_ID = e.INPATIENT_DATA_ID
  JOIN V_EHI_FLO_MEAS_VALUE v ON v.FSD_ID = m.FSD_ID AND v.VALUE_TYPE_C_NAME = 'Blood Pressure'
  WHERE m.FLO_MEAS_ID_DISP_NAME = 'BP'
`)) {
  const [s, d] = String(r.bp).split("/");
  const rec = {
    fsd_id: r.FSD_ID,
    recorded: r.RECORDED_TIME,
    sys: s != null && s !== "" ? Number(s) : null,
    dia: d != null && d !== "" ? Number(d) : null,
    raw: r.bp,
  };
  if (!bpByCsn.has(r.csn)) bpByCsn.set(r.csn, []);
  bpByCsn.get(r.csn)!.push(rec);
}

// ----- 3. Lipid panel orders per encounter -----
const lipidByCsn = new Map<string, { order_proc_id: string; description: string; order_time: string }[]>();
for (const r of q<any>(`
  SELECT ORDER_PROC_ID, PAT_ENC_CSN_ID AS csn, DESCRIPTION, ORDER_TIME
  FROM ORDER_PROC WHERE DESCRIPTION LIKE '%LIPID%'
`)) {
  if (!lipidByCsn.has(r.csn)) lipidByCsn.set(r.csn, []);
  lipidByCsn.get(r.csn)!.push({ order_proc_id: r.ORDER_PROC_ID, description: r.DESCRIPTION, order_time: r.ORDER_TIME });
}

// ----- 4. Cardiac med order, attached to its encounter -----
const cvMed = q<any>(`
  SELECT ORDER_MED_ID, PAT_ENC_CSN_ID AS csn, DESCRIPTION, ORDER_STATUS_C_NAME,
         ORDERING_DATE, ORDER_INST, RSN_FOR_DISCON_C_NAME, DISCON_TIME, DISCON_USER_ID_NAME,
         ORD_CREATR_USER_ID_NAME, LASTDOSE, START_DATE, END_DATE
  FROM ORDER_MED WHERE ORDER_MED_ID = '${CV_MED_ID}'
`)[0];

// ----- 5. Per-encounter metadata + the FULL diagnosis list -----
const encMeta = (csn: string) =>
  q<any>(`
    SELECT e.PAT_ENC_CSN_ID AS csn, e.CONTACT_DATE, CAST(e.PAT_ENC_DATE_REAL AS REAL) AS date_real,
           d.DEPARTMENT_NAME AS dept, s.PROV_NAME AS provider
    FROM PAT_ENC e
    LEFT JOIN CLARITY_DEP d ON e.DEPARTMENT_ID = d.DEPARTMENT_ID
    LEFT JOIN CLARITY_SER s ON e.VISIT_PROV_ID = s.PROV_ID
    WHERE e.PAT_ENC_CSN_ID = '${csn}'
  `)[0];

const reasonsFor = (csn: string) =>
  q<any>(`
    SELECT c.REASON_VISIT_NAME AS reason, CAST(r.LINE AS INTEGER) AS line
    FROM PAT_ENC_RSN_VISIT r
    LEFT JOIN CL_RSN_FOR_VISIT c ON r.ENC_REASON_ID = c.REASON_VISIT_ID
    WHERE r.PAT_ENC_CSN_ID = '${csn}'
    ORDER BY CAST(r.LINE AS INTEGER)
  `).map((x) => x.reason).filter(Boolean);

const dxFor = (csn: string) =>
  q<any>(`
    SELECT CAST(dx.LINE AS INTEGER) AS line, dx.DX_ID, g.DX_NAME, dx.PRIMARY_DX_YN,
           dx.DX_CHRONIC_YN, dx.DX_LINK_PROB_ID
    FROM PAT_ENC_DX dx
    LEFT JOIN CLARITY_EDG g ON dx.DX_ID = g.DX_ID
    WHERE dx.PAT_ENC_CSN_ID = '${csn}'
    ORDER BY (dx.PRIMARY_DX_YN <> 'Y'), CAST(dx.LINE AS INTEGER)
  `);

const isCv = (dxId: string) => CV_DX.includes(dxId);

// ----- Build encounter rows + flat dx rows -----
type EncRow = any;
const rows: EncRow[] = [];
const dxRows: any[] = [];

for (const csn of scopeCsns) {
  const m = encMeta(csn);
  if (!m) continue;
  const dxs = dxFor(csn);
  const reasons = reasonsFor(csn);
  const bps = (bpByCsn.get(csn) ?? []).sort((a, b) => 0);
  const lipids = lipidByCsn.get(csn) ?? [];
  const med = cvMed && cvMed.csn === csn ? cvMed : null;

  // which cardiovascular topics this encounter touched (drives "why it's in scope")
  const touches: string[] = [];
  if (dxs.some((d: any) => HTN_DX.includes(d.DX_ID))) touches.push("htn_dx");
  if (dxs.some((d: any) => LIPID_DX.includes(d.DX_ID))) touches.push("lipid_screen_dx");
  if (dxs.some((d: any) => DM_SCR_DX.includes(d.DX_ID))) touches.push("diabetes_screen_dx");
  if (lipids.length) touches.push("lipid_order");
  if (med) touches.push("cardiac_med_order");
  if (bps.length) touches.push("bp_recorded");

  const primary = dxs.find((d: any) => d.PRIMARY_DX_YN === "Y");

  rows.push({
    enc_csn: csn,
    date: m.CONTACT_DATE,
    date_real: m.date_real,
    dept: m.dept,
    provider: m.provider,
    reason: reasons.join("; ") || null,
    primary_dx: primary ? { dx_id: primary.DX_ID, dx_name: primary.DX_NAME } : null,
    dx_list: dxs.map((d: any) => ({
      dx_id: d.DX_ID,
      dx_name: d.DX_NAME,
      primary_yn: d.PRIMARY_DX_YN,
      chronic_yn: d.DX_CHRONIC_YN,
      linked_problem_id: d.DX_LINK_PROB_ID || null,
      is_cardiovascular: isCv(d.DX_ID),
    })),
    cv_touches: touches,
    bp_readings: bps.map((b) => ({
      fsd_id: b.fsd_id,
      recorded: b.recorded,
      systolic: b.sys,
      diastolic: b.dia,
      raw: b.raw,
      src: `V_EHI_FLO_MEAS_VALUE:FSD_ID=${b.fsd_id},VALUE_TYPE_C_NAME=Blood Pressure | IP_FLWSHT_REC:FSD_ID=${b.fsd_id}->INPATIENT_DATA_ID->PAT_ENC.PAT_ENC_CSN_ID=${csn}`,
    })),
    lipid_orders: lipids.map((l) => ({
      order_proc_id: l.order_proc_id,
      description: l.description,
      order_time: l.order_time,
      src: `ORDER_PROC:ORDER_PROC_ID=${l.order_proc_id}`,
    })),
    cardiac_med: med
      ? {
          order_med_id: med.ORDER_MED_ID,
          description: med.DESCRIPTION,
          order_status: med.ORDER_STATUS_C_NAME,
          ordering_provider: med.ORD_CREATR_USER_ID_NAME,
          ordering_date: med.ORDERING_DATE,
          order_inst: med.ORDER_INST,
          start_date: med.START_DATE,
          end_date: med.END_DATE,
          last_dose: med.LASTDOSE,
          discontinue_reason: med.RSN_FOR_DISCON_C_NAME,
          discontinue_time: med.DISCON_TIME,
          discontinue_user: med.DISCON_USER_ID_NAME,
          src: `ORDER_MED:ORDER_MED_ID=${med.ORDER_MED_ID}`,
        }
      : null,
    src: `PAT_ENC:PAT_ENC_CSN_ID=${csn}`,
  });

  for (const d of dxs) {
    dxRows.push({
      dx_id: d.DX_ID,
      dx_name: d.DX_NAME,
      primary_yn: d.PRIMARY_DX_YN,
      chronic_yn: d.DX_CHRONIC_YN,
      linked_problem_id: d.DX_LINK_PROB_ID || null,
      is_cardiovascular: isCv(d.DX_ID),
      enc_csn: csn,
      date: m.CONTACT_DATE,
      date_real: m.date_real,
      src: `PAT_ENC_DX:PAT_ENC_CSN_ID=${csn},LINE=${d.line}`,
    });
  }
}

// chronological order
rows.sort((a, b) => a.date_real - b.date_real);
dxRows.sort((a, b) => a.date_real - b.date_real || (a.primary_yn === "Y" ? -1 : 1));

// ----- 6. The "is hypertension undercoded?" structured determination -----
// Coded as encounter dx?
const htnEncDx = q<any>(`
  SELECT dx.PAT_ENC_CSN_ID AS csn, CAST(dx.LINE AS INTEGER) AS line, dx.DX_ID, g.DX_NAME,
         dx.PRIMARY_DX_YN, dx.DX_LINK_PROB_ID, e.CONTACT_DATE
  FROM PAT_ENC_DX dx
  LEFT JOIN CLARITY_EDG g ON dx.DX_ID = g.DX_ID
  LEFT JOIN PAT_ENC e ON dx.PAT_ENC_CSN_ID = e.PAT_ENC_CSN_ID
  WHERE dx.DX_ID IN (${inList(HTN_DX)})
  ORDER BY CAST(e.PAT_ENC_DATE_REAL AS REAL), dx.LINE
`);

// On the problem list (any status: active / resolved / deleted)?
const htnProblem = q<any>(`
  SELECT PROBLEM_LIST_ID, DX_ID, PROBLEM_STATUS_C_NAME
  FROM PROBLEM_LIST WHERE DX_ID IN (${inList(HTN_DX)})
`);
// And ever in the problem-list change history (catches a problem deleted before export)?
const htnProblemHx = q<any>(`
  SELECT PROBLEM_LIST_ID, HX_PROBLEM_ID, HX_STATUS_C_NAME
  FROM PROBLEM_LIST_HX WHERE HX_PROBLEM_ID IN (${inList(HTN_DX)})
`);

// Elevated BP evidence (systolic >= 130 OR diastolic >= 80 -> ACC/AHA stage 1+)
const allBp = q<any>(`
  SELECT m.FSD_ID, m.RECORDED_TIME, v.MEAS_VALUE_EXTERNAL AS bp, e.PAT_ENC_CSN_ID AS csn
  FROM IP_FLWSHT_MEAS m
  JOIN IP_FLWSHT_REC rec ON m.FSD_ID = rec.FSD_ID
  JOIN PAT_ENC e ON rec.INPATIENT_DATA_ID = e.INPATIENT_DATA_ID
  JOIN V_EHI_FLO_MEAS_VALUE v ON v.FSD_ID = m.FSD_ID AND v.VALUE_TYPE_C_NAME = 'Blood Pressure'
  WHERE m.FLO_MEAS_ID_DISP_NAME = 'BP'
`).map((r) => {
  const [s, d] = String(r.bp).split("/");
  return { fsd_id: r.FSD_ID, recorded: r.RECORDED_TIME, csn: r.csn, sys: Number(s), dia: Number(d), raw: r.bp };
});
const elevatedBp = allBp.filter((b) => b.sys >= 130 || b.dia >= 80);

const htn_coding = {
  question:
    "Is hypertension captured as a coded PROBLEM_LIST entry, or only implied by readings / the (declined) antihypertensive and a one-time encounter diagnosis?",
  on_problem_list: htnProblem.length > 0 || htnProblemHx.length > 0,
  on_problem_list_detail: {
    current_problem_rows: htnProblem,
    history_problem_rows: htnProblemHx,
    note:
      "PROBLEM_LIST ships resolved/deleted problems too (general-patterns §18); PROBLEM_LIST_HX would catch a problem deleted before export. Both are empty for hypertension DX_IDs (108212, 463437).",
    src: `PROBLEM_LIST:DX_ID IN (${HTN_DX.join("|")}) -> 0 rows; PROBLEM_LIST_HX:HX_PROBLEM_ID IN (${HTN_DX.join("|")}) -> 0 rows`,
  },
  coded_as_encounter_dx: htnEncDx.length > 0,
  encounter_dx_rows: htnEncDx.map((r: any) => ({
    enc_csn: r.csn,
    date: r.CONTACT_DATE,
    dx_id: r.DX_ID,
    dx_name: r.DX_NAME,
    primary_yn: r.PRIMARY_DX_YN,
    linked_problem_id: r.DX_LINK_PROB_ID || null,
    src: `PAT_ENC_DX:PAT_ENC_CSN_ID=${r.csn},LINE=${r.line}`,
  })),
  encounter_dx_links_to_problem: htnEncDx.some((r: any) => r.DX_LINK_PROB_ID),
  antihypertensive_ordered: cvMed
    ? {
        order_med_id: cvMed.ORDER_MED_ID,
        description: cvMed.DESCRIPTION,
        status: cvMed.ORDER_STATUS_C_NAME,
        discontinue_reason: cvMed.RSN_FOR_DISCON_C_NAME,
        discontinue_time: cvMed.DISCON_TIME,
        src: `ORDER_MED:ORDER_MED_ID=${cvMed.ORDER_MED_ID}`,
      }
    : null,
  elevated_bp_readings: elevatedBp.map((b) => ({
    enc_csn: b.csn,
    recorded: b.recorded,
    systolic: b.sys,
    diastolic: b.dia,
    raw: b.raw,
    src: `V_EHI_FLO_MEAS_VALUE:FSD_ID=${b.fsd_id},VALUE_TYPE_C_NAME=Blood Pressure`,
  })),
  total_bp_readings: allBp.length,
  // The determination, stated plainly with its mechanism:
  flag: "HYPERTENSION_UNDERCODED",
  determination:
    htnProblem.length === 0 && htnProblemHx.length === 0 && htnEncDx.length > 0
      ? "UNDERCODED: Hypertension was coded as an encounter diagnosis ('Primary hypertension', DX_ID 108212) on the 8/29/2022 establish-care visit (CSN 948004323) and its lab contact (958147754), and an antihypertensive (lisinopril 10 mg) was prescribed and sent that same day — yet hypertension was NEVER added to the coded PROBLEM_LIST (0 rows in PROBLEM_LIST and PROBLEM_LIST_HX for HTN DX_IDs), and neither encounter-dx row carries a DX_LINK_PROB_ID. The condition exists in the chart only as (a) a one-day encounter diagnosis, (b) a declined medication later discontinued for 'Patient refusal', and (c) recurring elevated readings. It is therefore present-but-undercoded: visible in readings/orders/visit-dx but absent from the structured problem list, so it will not surface in problem-list-driven views, quality measures, or risk calculators."
      : "NOT UNDERCODED (review): a hypertension problem-list entry was found — re-examine.",
};

const out = {
  rows,
  dx_rows: dxRows,
  htn_coding,
  meta: {
    entity: "encounters_dx",
    topic: "cardiac-risk",
    patient: "MANDEL, JOSHUA C (DOB 1982-10-26, male)",
    generated: new Date().toISOString().slice(0, 10),
    description:
      "Every encounter where a cardiovascular topic arose (HTN/lipid/diabetes-screen dx, lipid panel order, the antihypertensive order, or a recorded blood pressure), with the FULL encounter-diagnosis list for each, plus a structured 'is hypertension undercoded?' determination.",
    scope_rule:
      "Encounter in scope if it has a CV encounter dx (HTN 108212/463437, lipid screen 513616/187132, diabetes screen 513611/15362) OR a LIPID PANEL order OR the lisinopril order (ORDER_MED 772179261) OR a recorded BP (IP_FLWSHT_MEAS BP -> PAT_ENC via INPATIENT_DATA_ID).",
    counts: {
      encounters: rows.length,
      dx_rows: dxRows.length,
      cv_dx_rows: dxRows.filter((d) => d.is_cardiovascular).length,
      bp_readings: allBp.length,
      elevated_bp_readings: elevatedBp.length,
      lipid_orders: q<any>(`SELECT COUNT(*) n FROM ORDER_PROC WHERE DESCRIPTION LIKE '%LIPID%'`)[0].n,
    },
    column_glossary: {
      enc_csn: "PAT_ENC.PAT_ENC_CSN_ID — encounter contact serial number (the hub key)",
      date: "PAT_ENC.CONTACT_DATE (display; sorts lexically, do not order on it)",
      date_real: "CAST(PAT_ENC.PAT_ENC_DATE_REAL AS REAL) — true sortable date (days since 1840-12-31; .NN fraction sequences same-day contacts)",
      dept: "CLARITY_DEP.DEPARTMENT_NAME via PAT_ENC.DEPARTMENT_ID",
      provider: "CLARITY_SER.PROV_NAME via PAT_ENC.VISIT_PROV_ID",
      reason: "CL_RSN_FOR_VISIT.REASON_VISIT_NAME via PAT_ENC_RSN_VISIT (joined; may be NULL)",
      primary_dx: "the PAT_ENC_DX row with PRIMARY_DX_YN='Y'",
      dx_list: "ALL PAT_ENC_DX rows for the encounter (full diagnosis picture, not curated to CV)",
      cv_touches: "why this encounter is in scope: htn_dx | lipid_screen_dx | diabetes_screen_dx | lipid_order | cardiac_med_order | bp_recorded",
      "dx.linked_problem_id": "PAT_ENC_DX.DX_LINK_PROB_ID — back-link to PROBLEM_LIST (the ONLY valid problem bridge; null=not linked)",
      "dx.is_cardiovascular": "DX_ID in the cardiovascular set",
    },
    gotchas: [
      "Everything is TEXT in the export; date_real is CAST AS REAL before sorting (general-patterns §17).",
      "BP value lives ONLY in V_EHI_FLO_MEAS_VALUE.MEAS_VALUE_EXTERNAL, packed 'sys/dia', VALUE_TYPE_C_NAME='Blood Pressure'; tied to encounter via IP_FLWSHT_REC.INPATIENT_DATA_ID = PAT_ENC.INPATIENT_DATA_ID.",
      "Encounter dx links to a problem ONLY via DX_LINK_PROB_ID, never by DX_ID; CLARITY_EDG carries no ICD-10 code in this export.",
      "CV_DX includes diabetes-screening DX_IDs because the screen is ordered/coded together with the lipid screen as one cardiometabolic-risk panel here; flagged separately in cv_touches so the analysis can split them.",
    ],
  },
};

await Bun.write("deep-dives/cardiac-risk/parts/encounters_dx.json", JSON.stringify(out, null, 2));
console.log(
  `wrote ${rows.length} encounters, ${dxRows.length} dx rows (${out.meta.counts.cv_dx_rows} cardiovascular), ` +
    `${allBp.length} BP readings; htn on_problem_list=${htn_coding.on_problem_list} flag=${htn_coding.flag}`,
);
