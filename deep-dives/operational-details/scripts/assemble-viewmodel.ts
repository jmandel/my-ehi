#!/usr/bin/env bun
import { Database } from "bun:sqlite";

const db = new Database(process.env.EHI_DB ?? "./db/ehi.sqlite", { readonly: true });

type Row = Record<string, any>;
const q = (sql: string) => db.query(sql).all() as Row[];

function parseEpicDateTime(s?: string | null): Date | null {
  if (!s) return null;
  const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s+([AP]M)$/);
  if (!m) return null;
  let h = Number(m[4]);
  if (m[7] === "PM" && h !== 12) h += 12;
  if (m[7] === "AM" && h === 12) h = 0;
  return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]), h, Number(m[5]), Number(m[6]));
}

function dateOnly(s?: string | null) {
  const d = parseEpicDateTime(s);
  return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
}

function timeOnly(s?: string | null) {
  const d = parseEpicDateTime(s);
  return d ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : null;
}

function isoDate(s?: string | null) {
  const d = parseEpicDateTime(s);
  return d ? d.toISOString().slice(0, 10) : null;
}

function minutesBetween(a?: string | null, b?: string | null) {
  const da = parseEpicDateTime(a);
  const db = parseEpicDateTime(b);
  if (!da || !db) return null;
  return Math.round((db.getTime() - da.getTime()) / 60000);
}

function hourOf(s?: string | null) {
  return parseEpicDateTime(s)?.getHours() ?? null;
}

function isAfterHours(s?: string | null) {
  const h = hourOf(s);
  return h != null && (h < 7 || h >= 18);
}

function isWeekend(s?: string | null) {
  const d = parseEpicDateTime(s);
  return d ? d.getDay() === 0 || d.getDay() === 6 : false;
}

function monthKey(s?: string | null) {
  const d = parseEpicDateTime(s);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` : "unknown";
}

function monthLabel(key: string) {
  if (key === "unknown") return "Unknown";
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

const appts = q(`
  SELECT e.PAT_ENC_CSN_ID AS csn,
         CAST(e.PAT_ENC_DATE_REAL AS REAL) AS date_real,
         e.CONTACT_DATE AS contact_date,
         a.PROV_START_TIME AS slot_time,
         e.APPT_STATUS_C_NAME AS status,
         d.DEPARTMENT_NAME AS department,
         s.PROV_NAME AS provider,
         e.CHECKIN_USER_ID_NAME AS checkin_user,
         e3.CHKOUT_USER_ID_NAME AS checkout_user,
         e.AVS_PRINT_TM AS avs_print_time,
         e4.ECHKIN_STATUS_C_NAME AS echeckin_status,
         h.ADT_PAT_CLASS_C_NAME AS hsp_class,
         h.ADT_ARRIVAL_TIME AS adt_arrival_time,
         h.HOSP_ADMSN_TIME AS hosp_admission_time,
         h.HOSP_DISCH_TIME AS hosp_discharge_time,
         e.EFFECTIVE_DATE_DTTM AS effective_start
  FROM PAT_ENC e
  JOIN PAT_ENC_APPT a ON e.PAT_ENC_CSN_ID = a.PAT_ENC_CSN_ID
  LEFT JOIN PAT_ENC_3 e3 ON e.PAT_ENC_CSN_ID = e3.PAT_ENC_CSN
  LEFT JOIN PAT_ENC_4 e4 ON e.PAT_ENC_CSN_ID = e4.PAT_ENC_CSN_ID
  LEFT JOIN PAT_ENC_HSP h ON e.PAT_ENC_CSN_ID = h.PAT_ENC_CSN_ID
  LEFT JOIN CLARITY_DEP d ON e.DEPARTMENT_ID = d.DEPARTMENT_ID
  LEFT JOIN CLARITY_SER s ON e.VISIT_PROV_ID = s.PROV_ID
  WHERE e.APPT_STATUS_C_NAME IS NOT NULL
  ORDER BY CAST(e.PAT_ENC_DATE_REAL AS REAL)
`);

const flowRows = q(`
  SELECT e.PAT_ENC_CSN_ID AS csn,
         m.RECORDED_TIME AS recorded_time,
         m.ENTRY_TIME AS entry_time,
         m.TAKEN_USER_ID_NAME AS taken_user,
         m.ENTRY_USER_ID_NAME AS entry_user,
         m.FLO_MEAS_ID AS measure_id,
         m.FLO_MEAS_ID_DISP_NAME AS measure,
         v.MEAS_VALUE_EXTERNAL AS value,
         v.UNITS AS units
  FROM PAT_ENC e
  JOIN IP_FLWSHT_REC r ON e.INPATIENT_DATA_ID = r.INPATIENT_DATA_ID
  JOIN IP_FLWSHT_MEAS m ON r.FSD_ID = m.FSD_ID
  JOIN V_EHI_FLO_MEAS_VALUE v ON m.FSD_ID = v.FSD_ID AND m.LINE = v.LINE
  WHERE e.APPT_STATUS_C_NAME IS NOT NULL
  ORDER BY e.PAT_ENC_CSN_ID, m.RECORDED_TIME
`);

const flowByCsn = new Map<string, Row[]>();
for (const r of flowRows) {
  const list = flowByCsn.get(r.csn) ?? [];
  list.push(r);
  flowByCsn.set(r.csn, list);
}

const coreMeasureIds = new Set(["5", "8", "10", "11", "14", "5445"]);
const appointmentRows = appts.map((a) => {
  const flows = (flowByCsn.get(a.csn) ?? []).slice().sort((x, y) =>
    (parseEpicDateTime(x.recorded_time)?.getTime() ?? 0) - (parseEpicDateTime(y.recorded_time)?.getTime() ?? 0)
  );
  const core = flows.filter((f) => coreMeasureIds.has(String(f.measure_id)));
  const firstCore = core[0] ?? null;
  const firstAny = flows[0] ?? null;
  const lastAny = flows[flows.length - 1] ?? null;
  const delta = firstCore ? minutesBetween(a.slot_time, firstCore.recorded_time) : null;
  const kind =
    a.status === "Canceled" ? "canceled" :
    a.status === "Scheduled" ? "future" :
    /LABORATORY/.test(a.department ?? "") ? "lab" :
    /RADIOLOGY/.test(a.department ?? "") ? "radiology" :
    /OT NEURO/.test(a.department ?? "") ? "therapy" :
    "clinic";
  return {
    csn: a.csn,
    date: dateOnly(a.contact_date),
    date_iso: isoDate(a.contact_date),
    date_real: a.date_real,
    slot: timeOnly(a.slot_time),
    status: a.status,
    kind,
    department: a.department ?? "No department",
    provider: a.provider ?? "No provider",
    checkin_user: a.checkin_user,
    checkout_user: a.checkout_user,
    echeckin_status: a.echeckin_status,
    avs_time: timeOnly(a.avs_print_time),
    first_flowsheet_time: timeOnly(firstAny?.recorded_time),
    last_flowsheet_time: timeOnly(lastAny?.recorded_time),
    first_core_vital_time: timeOnly(firstCore?.recorded_time),
    first_core_vital_label: firstCore ? `${firstCore.measure}: ${firstCore.value}${firstCore.units ? ` ${firstCore.units}` : ""}` : null,
    first_core_delta_min: delta,
    flow_measure_count: flows.length,
    hsp_class: a.hsp_class,
    effective_start: timeOnly(a.effective_start),
    note: delta == null ? "No rooming/vitals timing proxy in the exported rows." :
      delta < 0 ? `${Math.abs(delta)} min before slot` :
      delta === 0 ? "at slot time" :
      `${delta} min after slot`,
  };
});

const statusCounts = q(`
  SELECT e.APPT_STATUS_C_NAME AS status,
         COUNT(*) AS n,
         SUM(CASE WHEN e.CHECKIN_USER_ID IS NOT NULL THEN 1 ELSE 0 END) AS checkin,
         SUM(CASE WHEN e3.CHKOUT_USER_ID IS NOT NULL THEN 1 ELSE 0 END) AS checkout,
         SUM(CASE WHEN e4.ECHKIN_STATUS_C_NAME IS NOT NULL THEN 1 ELSE 0 END) AS echeckin,
         SUM(CASE WHEN e.AVS_PRINT_TM IS NOT NULL THEN 1 ELSE 0 END) AS avs
  FROM PAT_ENC e
  LEFT JOIN PAT_ENC_3 e3 ON e.PAT_ENC_CSN_ID = e3.PAT_ENC_CSN
  LEFT JOIN PAT_ENC_4 e4 ON e.PAT_ENC_CSN_ID = e4.PAT_ENC_CSN_ID
  WHERE e.APPT_STATUS_C_NAME IS NOT NULL
  GROUP BY 1
  ORDER BY n DESC
`);

const skeleton = q(`
  SELECT COUNT(*) AS rows,
         SUM(CASE WHEN e.APPT_STATUS_C_NAME IS NOT NULL THEN 1 ELSE 0 END) AS real_appts,
         SUM(CASE WHEN a.PROV_START_TIME IS NOT NULL THEN 1 ELSE 0 END) AS with_slot_time
  FROM PAT_ENC_APPT a
  JOIN PAT_ENC e ON a.PAT_ENC_CSN_ID = e.PAT_ENC_CSN_ID
`)[0];

const echeckinSummary = q(`
  SELECT e4.ECHKIN_STATUS_C_NAME AS status,
         COUNT(DISTINCT e.PAT_ENC_CSN_ID) AS appts,
         COUNT(s.LINE) AS step_rows
  FROM PAT_ENC e
  JOIN PAT_ENC_4 e4 ON e.PAT_ENC_CSN_ID = e4.PAT_ENC_CSN_ID
  LEFT JOIN ECHKIN_STEP_INFO s ON e.PAT_ENC_CSN_ID = s.PAT_ENC_CSN_ID
  WHERE e.APPT_STATUS_C_NAME IS NOT NULL
    AND e4.ECHKIN_STATUS_C_NAME IS NOT NULL
  GROUP BY 1
  ORDER BY appts DESC
`);

const stepRows = q(`
  SELECT INCLUDED_STEP_C_NAME AS step,
         ECHKIN_STEP_STAT_C_NAME AS status,
         STEP_ACTION_C_NAME AS action,
         COUNT(*) AS n,
         COUNT(DISTINCT PAT_ENC_CSN_ID) AS appts
  FROM ECHKIN_STEP_INFO
  GROUP BY 1,2,3
  ORDER BY 1, n DESC
`);

const stepMap = new Map<string, any>();
for (const r of stepRows) {
  const s = stepMap.get(r.step) ?? { step: r.step, completed: 0, not_started: 0, filtered_or_not_offered: 0, not_needed: 0, appts: new Set<string>() };
  const status = String(r.status ?? "");
  if (status === "Completed" || r.action === "Completed" || r.action === "Verified" || r.action === "Updated") s.completed += Number(r.n);
  else if (status === "Not Started" || status === "In Progress") s.not_started += Number(r.n);
  else if (status === "Filtered" || status === "Not Offered") s.filtered_or_not_offered += Number(r.n);
  else if (status === "Not Needed") s.not_needed += Number(r.n);
  s.total = (s.total ?? 0) + Number(r.n);
  stepMap.set(r.step, s);
}
const echeckinSteps = [...stepMap.values()]
  .map((s) => ({ ...s, appts: undefined }))
  .sort((a, b) => b.total - a.total);

const adtRowsRaw = q(`
  SELECT c.PAT_ENC_CSN_ID AS csn,
         c.EVENT_TYPE_C_NAME AS event_type,
         c.PAT_CLASS_C_NAME AS patient_class,
         d.DEPARTMENT_NAME AS department,
         c.EFFECTIVE_TIME AS effective_time,
         c.EVENT_TIME AS event_time,
         c.USER_ID_NAME AS user_name,
         c.NEXT_OUT_EVENT_ID AS next_out,
         c.LAST_IN_EVENT_ID AS last_in
  FROM CLARITY_ADT c
  LEFT JOIN CLARITY_DEP d ON c.DEPARTMENT_ID = d.DEPARTMENT_ID
  ORDER BY c.PAT_ENC_CSN_ID, c.EFFECTIVE_TIME
`);
const adtRows = adtRowsRaw.map((r) => ({
  csn: r.csn,
  event: r.event_type,
  patient_class: r.patient_class,
  department: r.department,
  effective: `${dateOnly(r.effective_time)} ${timeOnly(r.effective_time)}`,
  recorded: `${dateOnly(r.event_time)} ${timeOnly(r.event_time)}`,
  user: r.user_name,
}));

const adtByCsn = new Map<string, Row[]>();
for (const r of adtRowsRaw) {
  const list = adtByCsn.get(r.csn) ?? [];
  list.push(r);
  adtByCsn.set(r.csn, list);
}
const adtEpisodes = [...adtByCsn.entries()].map(([csn, rows]) => {
  const inRow = rows.find((r) => r.event_type === "Hospital Outpatient");
  const outRow = rows.find((r) => r.event_type === "Discharge");
  return {
    csn,
    date: dateOnly(inRow?.effective_time ?? outRow?.effective_time),
    department: inRow?.department ?? outRow?.department,
    patient_class: inRow?.patient_class ?? outRow?.patient_class,
    in_effective: timeOnly(inRow?.effective_time),
    out_effective: timeOnly(outRow?.effective_time),
    discharge_recorded: `${dateOnly(outRow?.event_time)} ${timeOnly(outRow?.event_time)}`,
    administrative_duration_min: minutesBetween(inRow?.effective_time, outRow?.effective_time),
    discharge_user: outRow?.user_name,
  };
});

const edEventGroups = q(`
  SELECT EVENT_ID AS event_id,
         COUNT(*) AS lines,
         MIN(EVENT_TIME) AS first_time,
         MAX(EVENT_TIME) AS last_time,
         GROUP_CONCAT(DISTINCT EVENT_USER_ID_NAME) AS users
  FROM ED_IEV_EVENT_INFO
  GROUP BY EVENT_ID
  ORDER BY first_time
`);

const auditRaw = q(`
  SELECT 'Patient record' AS source,
         AUDIT_INSTANT_LOCAL_DTTM AS audit_time,
         CHANGED_ITEM_NAME AS item,
         CHANGED_PAT_ENC_CSN_ID AS csn,
         USER_ID_NAME AS user_name
  FROM V_EHI_REG_ITEM_AUDIT_EPT
  UNION ALL
  SELECT 'Hospital account' AS source,
         AUDIT_INSTANT_LOCAL_DTTM AS audit_time,
         CHANGED_ITEM_NAME AS item,
         NULL AS csn,
         USER_ID_NAME AS user_name
  FROM V_EHI_REG_ITEM_AUDIT_HAR
`);

const auditMonthsMap = new Map<string, any>();
for (const r of auditRaw) {
  const key = monthKey(r.audit_time);
  const row = auditMonthsMap.get(key) ?? { month: key, label: monthLabel(key), patient_record: 0, hospital_account: 0, total: 0 };
  if (r.source === "Patient record") row.patient_record += 1;
  else row.hospital_account += 1;
  row.total += 1;
  auditMonthsMap.set(key, row);
}
const auditMonths = [...auditMonthsMap.values()]
  .filter((r) => r.month !== "unknown")
  .sort((a, b) => a.month.localeCompare(b.month));

const auditItemRows = q(`
  SELECT 'Patient record' AS source,
         CHANGED_ITEM_NAME AS item,
         COUNT(*) AS n,
         COUNT(DISTINCT USER_ID_NAME) AS users,
         COUNT(DISTINCT CHANGED_PAT_ENC_CSN_ID) AS encounters
  FROM V_EHI_REG_ITEM_AUDIT_EPT
  GROUP BY 1,2
  UNION ALL
  SELECT 'Hospital account' AS source,
         CHANGED_ITEM_NAME AS item,
         COUNT(*) AS n,
         COUNT(DISTINCT USER_ID_NAME) AS users,
         NULL AS encounters
  FROM V_EHI_REG_ITEM_AUDIT_HAR
  GROUP BY 1,2
  ORDER BY n DESC
`).map((r) => ({
  source: r.source,
  item: r.item,
  n: Number(r.n),
  users: Number(r.users),
  encounters: r.encounters == null ? null : Number(r.encounters),
}));

const qanswerSummary = q(`
  SELECT COUNT(*) AS rows,
         SUM(CASE WHEN WORKFLOW_DURATION IS NOT NULL THEN 1 ELSE 0 END) AS with_duration,
         MIN(CAST(WORKFLOW_DURATION AS REAL)) AS min_sec,
         MAX(CAST(WORKFLOW_DURATION AS REAL)) AS max_sec,
         ROUND(AVG(CAST(WORKFLOW_DURATION AS REAL)), 1) AS avg_sec
  FROM CL_QANSWER
`)[0];

const questionnaireRows = q(`
  SELECT MYC_APPT_QUESR_ID_FORM_NAME AS form,
         PAT_APPT_QNR_STAT_C_NAME AS status,
         COUNT(*) AS n
  FROM MYC_APPT_QNR_DATA
  GROUP BY 1,2
  ORDER BY n DESC, form
`).map((r) => ({ form: r.form, status: r.status, n: Number(r.n) }));

const kioskRows = q(`
  SELECT KIOSK_QUEST_ID_FORM_NAME AS form,
         COUNT(*) AS n
  FROM KIOSK_QUESTIONNAIR
  GROUP BY 1
  ORDER BY n DESC, form
`).map((r) => ({ form: r.form, n: Number(r.n) }));

const patientReview = q(`
  SELECT COUNT(*) AS rows,
         SUM(CASE WHEN PAT_ALG_RVW_INFO_C_NAME IS NOT NULL OR PAT_MED_RVW_INFO_C_NAME IS NOT NULL OR PAT_PROB_RVW_INFO_C_NAME IS NOT NULL THEN 1 ELSE 0 END) AS with_review_signal
  FROM PAT_REVIEW_DATA
`)[0];

const appointmentLetterSummary = q(`
  SELECT COUNT(*) AS rows,
         SUM(CASE WHEN SHOULD_RECEIVE_LETTERS_YN = 'Y' THEN 1 ELSE 0 END) AS should_receive,
         SUM(CASE WHEN SHOULD_ATTEND_VISIT_YN = 'Y' THEN 1 ELSE 0 END) AS should_attend,
         SUM(CASE WHEN DID_ATTEND_VISIT_YN = 'Y' THEN 1 ELSE 0 END) AS did_attend
  FROM APPT_LETTER_RECIPIENTS
`)[0];

const paymentWorkflow = q(`
  SELECT 'Professional transactions' AS source,
         COUNT(*) AS rows,
         SUM(CASE WHEN PAT_PMT_COLL_WKFL_C_NAME IS NOT NULL THEN 1 ELSE 0 END) AS workflow_rows,
         GROUP_CONCAT(DISTINCT PAT_PMT_COLL_WKFL_C_NAME) AS workflows
  FROM ARPB_TRANSACTIONS3
  UNION ALL
  SELECT 'Hospital transactions' AS source,
         COUNT(*) AS rows,
         SUM(CASE WHEN PAT_PMT_COLL_WKFL_C_NAME IS NOT NULL OR IS_PRE_SERVICE_PMT_YN IS NOT NULL OR IS_PRE_SERVICE_PLAN_PMT_YN IS NOT NULL THEN 1 ELSE 0 END) AS workflow_rows,
         GROUP_CONCAT(DISTINCT COALESCE(PAT_PMT_COLL_WKFL_C_NAME, IS_PRE_SERVICE_PMT_YN, IS_PRE_SERVICE_PLAN_PMT_YN)) AS workflows
  FROM HSP_TRANSACTIONS_3
`).map((r) => ({ source: r.source, rows: Number(r.rows), workflow_rows: Number(r.workflow_rows), workflows: r.workflows }));

const orderTimingRows = q(`
  SELECT ORDER_TYPE_C_NAME AS type,
         DISPLAY_NAME AS display,
         ORDER_STATUS_C_NAME AS status,
         ORDER_TIME AS order_time,
         PROC_BGN_TIME AS proc_begin,
         PROC_START_TIME AS proc_start,
         PROC_ENDING_TIME AS proc_end,
         RESULT_TIME AS result_time,
         CHRG_DROPPED_TIME AS charge_time
  FROM ORDER_PROC
  WHERE ORDER_TIME IS NOT NULL
    AND (PROC_BGN_TIME IS NOT NULL OR PROC_START_TIME IS NOT NULL OR PROC_ENDING_TIME IS NOT NULL OR RESULT_TIME IS NOT NULL OR CHRG_DROPPED_TIME IS NOT NULL)
  ORDER BY ORDER_TIME
`).map((r) => {
  const offsets = {
    proc_begin: minutesBetween(r.order_time, r.proc_begin),
    proc_start: minutesBetween(r.order_time, r.proc_start),
    proc_end: minutesBetween(r.order_time, r.proc_end),
    result: minutesBetween(r.order_time, r.result_time),
    charge: minutesBetween(r.order_time, r.charge_time),
  };
  const usefulOffsets = Object.values(offsets).filter((v): v is number => v != null && Math.abs(v) <= 240);
  return {
    type: r.type,
    display: r.display,
    status: r.status,
    date: dateOnly(r.order_time),
    order: timeOnly(r.order_time),
    offsets,
    useful: usefulOffsets.length > 0,
  };
}).filter((r) => r.useful && (r.type === "Lab" || r.type === "Imaging" || r.type === "Microbiology"))
  .slice(0, 18);

const orderTimingSummary = q(`
  SELECT ORDER_TYPE_C_NAME AS type,
         ORDER_STATUS_C_NAME AS status,
         COUNT(*) AS n,
         SUM(CASE WHEN ORDER_TIME IS NOT NULL THEN 1 ELSE 0 END) AS order_time,
         SUM(CASE WHEN PROC_BGN_TIME IS NOT NULL OR PROC_START_TIME IS NOT NULL OR PROC_ENDING_TIME IS NOT NULL THEN 1 ELSE 0 END) AS procedure_times,
         SUM(CASE WHEN RESULT_TIME IS NOT NULL THEN 1 ELSE 0 END) AS result_time,
         COUNT(DISTINCT ORD_CREATR_USER_ID_NAME) AS creators
  FROM ORDER_PROC
  GROUP BY 1,2
  ORDER BY n DESC
`).map((r) => ({
  type: r.type,
  status: r.status,
  n: Number(r.n),
  order_time: Number(r.order_time),
  procedure_times: Number(r.procedure_times),
  result_time: Number(r.result_time),
  creators: Number(r.creators),
}));

const hspTimingSummary = q(`
  SELECT COUNT(*) AS rows,
         SUM(CASE WHEN HOSP_ADMSN_TIME IS NOT NULL THEN 1 ELSE 0 END) AS admission,
         SUM(CASE WHEN HOSP_DISCH_TIME IS NOT NULL THEN 1 ELSE 0 END) AS discharge,
         SUM(CASE WHEN ADT_ARRIVAL_TIME IS NOT NULL THEN 1 ELSE 0 END) AS arrival,
         SUM(CASE WHEN TRIAGE_DATETIME IS NOT NULL THEN 1 ELSE 0 END) AS triage,
         SUM(CASE WHEN ED_DEPARTURE_TIME IS NOT NULL THEN 1 ELSE 0 END) AS ed_departure,
         SUM(CASE WHEN ROOM_ID IS NOT NULL OR TYPE_OF_ROOM_C_NAME IS NOT NULL OR TYPE_OF_BED_C_NAME IS NOT NULL THEN 1 ELSE 0 END) AS room_bed
  FROM PAT_ENC_HSP
`)[0];

const noteRowsRaw = q(`
  SELECT h.NOTE_ID AS note_id,
         COALESCE(n.NOTE_TYPE_C_NAME, h.NOTE_TYPE_NOADD_C_NAME, h.IP_NOTE_TYPE_C_NAME, h.NOTE_DESC, 'Other note') AS note_type,
         n.NOTE_STATUS_C_NAME AS status,
         h.CRT_INST_LOCAL_DTTM AS create_local,
         n.ENT_INST_LOCAL_DTTM AS entry_local,
         n.NOT_FILETM_LOC_DTTM AS file_local,
         n.UPD_AUT_LOCAL_DTTM AS update_author_local
  FROM HNO_INFO h
  LEFT JOIN NOTE_ENC_INFO n ON h.NOTE_ID = n.NOTE_ID
  WHERE n.NOTE_STATUS_C_NAME IS NOT NULL
     OR n.ENT_INST_LOCAL_DTTM IS NOT NULL
     OR n.NOT_FILETM_LOC_DTTM IS NOT NULL
     OR h.CRT_INST_LOCAL_DTTM IS NOT NULL
`);

const clinicalNoteRows = noteRowsRaw.filter((r) =>
  /Progress|Telephone|Consults|Patient Instructions|Miscellaneous/i.test(String(r.note_type ?? "")) || r.status
);

const noteHourRows = Array.from({ length: 24 }, (_, hour) => {
  const entry = clinicalNoteRows.filter((r) => hourOf(r.entry_local) === hour).length;
  const filed = clinicalNoteRows.filter((r) => hourOf(r.file_local) === hour).length;
  const updated = clinicalNoteRows.filter((r) => hourOf(r.update_author_local) === hour).length;
  return { hour, label: `${hour}:00`, entry, filed, updated };
});

const noteTypeMap = new Map<string, any>();
for (const r of clinicalNoteRows) {
  const key = `${r.note_type}|${r.status ?? ""}`;
  const row = noteTypeMap.get(key) ?? { type: r.note_type, status: r.status ?? "", n: 0, filed: 0, after_hours_filed: 0, weekend_filed: 0 };
  row.n += 1;
  if (r.file_local) row.filed += 1;
  if (isAfterHours(r.file_local)) row.after_hours_filed += 1;
  if (isWeekend(r.file_local)) row.weekend_filed += 1;
  noteTypeMap.set(key, row);
}

const noteTypeRows = [...noteTypeMap.values()].sort((a, b) => b.n - a.n).slice(0, 8);
const noteTimingSummary = {
  clinical_notes: clinicalNoteRows.length,
  entry_local_rows: clinicalNoteRows.filter((r) => r.entry_local).length,
  filed_local_rows: clinicalNoteRows.filter((r) => r.file_local).length,
  update_author_local_rows: clinicalNoteRows.filter((r) => r.update_author_local).length,
  created_after_hours: clinicalNoteRows.filter((r) => isAfterHours(r.create_local)).length,
  entry_after_hours: clinicalNoteRows.filter((r) => isAfterHours(r.entry_local)).length,
  filed_after_hours: clinicalNoteRows.filter((r) => isAfterHours(r.file_local)).length,
  update_after_hours: clinicalNoteRows.filter((r) => isAfterHours(r.update_author_local)).length,
  filed_weekend: clinicalNoteRows.filter((r) => isWeekend(r.file_local)).length,
};

const noteSlotRaw = q(`
  WITH appt AS (
    SELECT PAT_ENC_CSN_ID, MIN(PROV_START_TIME) AS slot_time
    FROM PAT_ENC_APPT
    WHERE PROV_START_TIME IS NOT NULL
    GROUP BY PAT_ENC_CSN_ID
  )
  SELECT h.NOTE_ID AS note_id,
         COALESCE(n.NOTE_TYPE_C_NAME, h.NOTE_TYPE_NOADD_C_NAME, h.IP_NOTE_TYPE_C_NAME, h.NOTE_DESC, 'Other note') AS note_type,
         n.NOTE_STATUS_C_NAME AS status,
         n.NOT_FILETM_LOC_DTTM AS file_local,
         n.ENT_INST_LOCAL_DTTM AS entry_local,
         n.UPD_AUT_LOCAL_DTTM AS update_author_local,
         a.slot_time AS slot_time,
         d.DEPARTMENT_NAME AS department
  FROM HNO_INFO h
  LEFT JOIN NOTE_ENC_INFO n ON h.NOTE_ID = n.NOTE_ID
  LEFT JOIN PAT_ENC e ON h.PAT_ENC_CSN_ID = e.PAT_ENC_CSN_ID
  LEFT JOIN appt a ON h.PAT_ENC_CSN_ID = a.PAT_ENC_CSN_ID
  LEFT JOIN CLARITY_DEP d ON e.DEPARTMENT_ID = d.DEPARTMENT_ID
  WHERE n.NOT_FILETM_LOC_DTTM IS NOT NULL
`);
const noteById = new Map<string, Row>();
for (const r of noteSlotRaw) if (!noteById.has(String(r.note_id))) noteById.set(String(r.note_id), r);
const noteSlotClinical = [...noteById.values()].filter((r) =>
  /Progress|Telephone|Consults|Patient Instructions|Miscellaneous/i.test(String(r.note_type ?? "")) || r.status
);
const noteAfterHoursRows = noteSlotClinical
  .filter((r) => isAfterHours(r.file_local))
  .map((r) => {
    const slotHour = hourOf(r.slot_time);
    const fileHour = hourOf(r.file_local);
    return {
      type: r.note_type,
      department: r.department,
      slot: timeOnly(r.slot_time),
      file: timeOnly(r.file_local),
      slot_bucket: slotHour == null ? "No slot" : slotHour >= 16 ? "Late slot" : slotHour >= 12 ? "Afternoon slot" : "Morning slot",
      minutes_after_slot: minutesBetween(r.slot_time, r.file_local),
      same_day: parseEpicDateTime(r.slot_time)?.toDateString() === parseEpicDateTime(r.file_local)?.toDateString(),
      file_hour: fileHour,
    };
  });
const noteSlotContext = {
  after_hours_filed: noteAfterHoursRows.length,
  same_day: noteAfterHoursRows.filter((r) => r.same_day).length,
  morning_slot: noteAfterHoursRows.filter((r) => r.slot_bucket === "Morning slot").length,
  afternoon_slot: noteAfterHoursRows.filter((r) => r.slot_bucket === "Afternoon slot").length,
  late_slot: noteAfterHoursRows.filter((r) => r.slot_bucket === "Late slot").length,
  no_slot: noteAfterHoursRows.filter((r) => r.slot_bucket === "No slot").length,
};

const negativeFindings = [
  {
    label: "Office room-in / room-out",
    present: 0,
    total: appointmentRows.filter((r) => r.kind === "clinic").length,
    note: "No ordinary exam-room stopwatch pair found."
  },
  {
    label: "Hospital ED arrival / triage / departure",
    present: Number(hspTimingSummary.arrival) + Number(hspTimingSummary.triage) + Number(hspTimingSummary.ed_departure),
    total: Number(hspTimingSummary.rows) * 3,
    note: "Hospital rows have admission/discharge, but not ED flow timing here."
  },
  {
    label: "Room or bed values",
    present: Number(hspTimingSummary.room_bed),
    total: Number(hspTimingSummary.rows) + Number(q(`SELECT COUNT(*) AS n FROM CLARITY_ADT`)[0].n),
    note: "Room/bed schema hooks are present; values are blank in this specimen."
  },
  {
    label: "OR/procedure presence billing times",
    present: Number(q(`SELECT SUM(CASE WHEN SPARCS_START_DATETIME IS NOT NULL OR SPARCS_END_DATETIME IS NOT NULL THEN 1 ELSE 0 END) AS n FROM CLAIM_INFO3`)[0].n ?? 0) +
      Number(q(`SELECT SUM(CASE WHEN NYS_PROC_STRT_DTTM IS NOT NULL OR NYS_PROC_END_DTTM IS NOT NULL THEN 1 ELSE 0 END) AS n FROM HSP_ACCOUNT_3`)[0].n ?? 0),
    total: Number(q(`SELECT COUNT(*) AS n FROM CLAIM_INFO3`)[0].n) + Number(q(`SELECT COUNT(*) AS n FROM HSP_ACCOUNT_3`)[0].n),
    note: "The columns exist but are not populated."
  },
];

const surfaceRows = [
  {
    label: "Appointment slot",
    raw: "PAT_ENC_APPT.PROV_START_TIME",
    rows: Number(skeleton.real_appts),
    present: Number(skeleton.with_slot_time),
    interpretation: "Booked wall-clock appointment time. This is often absent from standard clinical exports."
  },
  {
    label: "Check-in actor",
    raw: "PAT_ENC.CHECKIN_USER_ID_NAME",
    rows: appts.length,
    present: appointmentRows.filter((r) => r.checkin_user).length,
    interpretation: "The staff or MyChart account that checked the appointment in."
  },
  {
    label: "Check-out actor",
    raw: "PAT_ENC_3.CHKOUT_USER_ID_NAME",
    rows: appts.length,
    present: appointmentRows.filter((r) => r.checkout_user).length,
    interpretation: "Checkout exists mostly for office visits; labs/radiology often have no checkout row."
  },
  {
    label: "eCheck-in workflow",
    raw: "PAT_ENC_4 + ECHKIN_STEP_INFO",
    rows: appts.length,
    present: appointmentRows.filter((r) => r.echeckin_status).length,
    interpretation: "Rollup status plus per-step rows for insurance, questionnaires, travel history, payments, and more."
  },
  {
    label: "Flowsheet timing",
    raw: "IP_FLWSHT_MEAS.RECORDED_TIME",
    rows: appts.length,
    present: appointmentRows.filter((r) => r.first_flowsheet_time).length,
    interpretation: "A timestamped proxy for rooming/vitals when vitals or screening rows were charted."
  },
  {
    label: "Room or bed assignment",
    raw: "CLARITY_ADT.ROOM_ID / PAT_ENC_HSP.ROOM_ID",
    rows: Number(q(`SELECT COUNT(*) AS n FROM CLARITY_ADT`)[0].n) + Number(q(`SELECT COUNT(*) AS n FROM PAT_ENC_HSP`)[0].n),
    present: Number(q(`SELECT SUM(CASE WHEN ROOM_ID IS NOT NULL OR ROOM_CSN_ID IS NOT NULL OR BED_ID IS NOT NULL THEN 1 ELSE 0 END) AS n FROM CLARITY_ADT`)[0].n ?? 0) +
      Number(q(`SELECT SUM(CASE WHEN ROOM_ID IS NOT NULL OR TYPE_OF_ROOM_C_NAME IS NOT NULL OR TYPE_OF_BED_C_NAME IS NOT NULL THEN 1 ELSE 0 END) AS n FROM PAT_ENC_HSP`)[0].n ?? 0),
    interpretation: "The columns exist, but this outpatient-heavy specimen does not carry room/bed values."
  },
  {
    label: "ADT in/out events",
    raw: "CLARITY_ADT",
    rows: Number(q(`SELECT COUNT(*) AS n FROM CLARITY_ADT`)[0].n),
    present: Number(q(`SELECT COUNT(*) AS n FROM CLARITY_ADT WHERE EVENT_TYPE_C_NAME IS NOT NULL`)[0].n),
    interpretation: "Four events reconstruct two outpatient therapy-series contacts: in events by a user, discharge events by a batch job."
  },
  {
    label: "Video visit sidecar",
    raw: "PATIENT_ENC_VIDEO_VISIT",
    rows: Number(q(`SELECT COUNT(*) AS n FROM PATIENT_ENC_VIDEO_VISIT`)[0].n),
    present: Number(q(`SELECT COUNT(*) AS n FROM PATIENT_ENC_VIDEO_VISIT WHERE PAT_ENC_LVL_VIDEO_VISIT_ID IS NOT NULL OR TH_MODE_VV_CHG_USER_ID IS NOT NULL`)[0].n),
    interpretation: "The table is populated as a 1:1 sidecar, but video-visit values are empty here."
  },
];

const clinicDeltas = appointmentRows
  .filter((r) => r.kind === "clinic" && r.first_core_delta_min != null)
  .map((r) => r.first_core_delta_min as number)
  .sort((a, b) => a - b);
const median = (xs: number[]) => xs.length ? xs[Math.floor(xs.length / 2)] : null;

const previsitTiles = [
  {
    label: "eCheck-in step rows",
    value: stepRows.reduce((acc, r) => acc + Number(r.n), 0),
    detail: `${echeckinSummary.reduce((acc, r) => acc + Number(r.appts), 0)} appointments with eCheck-in rollups`
  },
  {
    label: "MyChart questionnaires",
    value: questionnaireRows.reduce((acc, r) => acc + r.n, 0),
    detail: `${new Set(questionnaireRows.map((r) => r.form)).size} form names, statuses include completed/assigned/started`
  },
  {
    label: "Kiosk questionnaires",
    value: kioskRows.reduce((acc, r) => acc + r.n, 0),
    detail: `${new Set(kioskRows.map((r) => r.form)).size} form names mirrored in kiosk linkage`
  },
  {
    label: "Questionnaire seconds",
    value: Number(qanswerSummary.with_duration),
    detail: `${qanswerSummary.min_sec}-${qanswerSummary.max_sec} sec range; ${qanswerSummary.avg_sec} sec average`
  },
  {
    label: "Patient review signals",
    value: Number(patientReview.with_review_signal),
    detail: `${patientReview.rows} review sidecar rows, mostly blank in this specimen`
  },
  {
    label: "Appointment letter recipients",
    value: Number(appointmentLetterSummary.rows),
    detail: `${appointmentLetterSummary.should_attend} marked should-attend`
  },
  {
    label: "Payment workflow rows",
    value: paymentWorkflow.reduce((acc, r) => acc + r.workflow_rows, 0),
    detail: paymentWorkflow.map((r) => `${r.source}: ${r.workflow_rows}/${r.rows}`).join("; ")
  },
];

const vm = {
  meta: {
    title: "Operational details in an Epic EHI export",
    subtitle: "The scheduling, rooming-adjacent, and workflow exhaust most clinical exports leave behind.",
    counts: {
      appointment_skeleton_rows: Number(skeleton.rows),
      real_appointments: Number(skeleton.real_appts),
      completed_appointments: appointmentRows.filter((r) => r.status === "Completed").length,
      echeckin_step_rows: stepRows.reduce((acc, r) => acc + Number(r.n), 0),
      audit_rows: auditRaw.length,
      audit_items: new Set(auditRaw.map((r) => `${r.source}:${r.item}`)).size,
      adt_events: adtRows.length,
      ed_event_lines: edEventGroups.reduce((acc, r) => acc + Number(r.lines), 0),
      room_assignments_present: surfaceRows.find((r) => r.label === "Room or bed assignment")?.present ?? 0,
      order_rows: orderTimingSummary.reduce((acc, r) => acc + r.n, 0),
      note_file_rows: noteTimingSummary.filed_local_rows,
      note_file_after_hours: noteTimingSummary.filed_after_hours,
      clinic_vital_delta_median_min: median(clinicDeltas),
    },
  },
  summary: [
    "This export does not expose a clean exam-room timer for ordinary office visits. It does expose the visit choreography: scheduled slots, check-in/check-out actors, first vitals timestamps, AVS print times, eCheck-in steps, questionnaire attempts, order timing, and audit events.",
    "The strongest finding is the audit/workflow layer. There are thousands of timestamped record-change events and multiple patient-facing workflow ledgers, which is far beyond a normal clinical summary export."
  ],
  statusCounts,
  surfaceRows,
  appointmentRows,
  auditMonths,
  auditItemRows,
  previsitTiles,
  questionnaireRows,
  kioskRows,
  orderTimingRows,
  orderTimingSummary,
  noteTimingSummary,
  noteHourRows,
  noteTypeRows,
  noteSlotContext,
  noteAfterHoursRows,
  negativeFindings,
  echeckinSummary,
  echeckinSteps,
  adtRows,
  adtEpisodes,
  edEventGroups: edEventGroups.map((r) => ({
    event_id: String(r.event_id),
    lines: Number(r.lines),
    first: `${dateOnly(r.first_time)} ${timeOnly(r.first_time)}`,
    last: `${dateOnly(r.last_time)} ${timeOnly(r.last_time)}`,
    users: String(r.users ?? "").split(",").filter(Boolean),
  })),
  sections: [
    {
      id: "not-a-room-timer",
      title: "Not a room timer, but close enough to see workflow",
      narrative: [
        { text: "The ordinary office-visit rows do not contain a clean 'roomed at' and 'left exam room at' pair. Instead, the strongest rooming proxy is the first same-visit flowsheet timestamp, usually vitals or screening, compared with the scheduled slot time.", cites: ["e_slot_vitals_proxy"] },
        { text: "For clinic visits with such a proxy, the first core vital can land before the slot, at the slot, or later; that variability is itself useful because it shows why an EHI export should be read as operational evidence, not a stopwatch.", cites: ["e_no_exam_room_timer"] }
      ]
    },
    {
      id: "audit",
      title: "The record has an audit trail",
      narrative: [
        { text: "The largest operational layer is not a visit table at all. Patient-record and hospital-account audit views expose timestamped changes, changed-item labels, and users. This dive uses counts and item categories, not raw old/new values.", cites: ["e_audit_trail"] }
      ]
    },
    {
      id: "front-desk",
      title: "The front desk is in the record",
      narrative: [
        { text: "A standard clinical export would usually say the visit happened. This EHI export says when it was scheduled, whether it was completed or canceled, who checked it in, whether it was checked out, and whether an AVS was printed.", cites: ["e_appt_status_counts"] },
        { text: "The appointment skeleton also has false positives: many encounters have appointment sidecar rows, but the real scheduled appointments are the rows with status and slot time.", cites: ["e_skeleton_filter"] }
      ]
    },
    {
      id: "echeckin",
      title: "Patient work before the visit is structured",
      narrative: [
        { text: "The eCheck-in and questionnaire layer breaks patient-facing previsit work into step rows, form assignments, attempt statuses, and even seconds spent in questionnaire workflow. It is not a note; it is a workflow ledger.", cites: ["e_echeckin_steps", "e_questionnaire_workflow"] }
      ]
    },
    {
      id: "orders",
      title: "Orders have operational timestamps too",
      narrative: [
        { text: "Orders carry more than clinical intent. Labs and imaging include order time, procedure begin/start/end fields, result time, and occasionally charge-drop time. The sidecar table named for first/last scheduling exists here, but its timestamps are blank.", cites: ["e_order_timing"] }
      ]
    },
    {
      id: "notes",
      title: "Note work has a clock",
      narrative: [
        { text: "The note lifecycle tables expose local entry, file, and update-by-author times. In this specimen, true local filing is mostly business-hours work, with a smaller after-hours tail and no weekend filing signal.", cites: ["e_note_timing"] }
      ]
    },
    {
      id: "adt",
      title: "ADT machinery appears even in outpatient therapy",
      narrative: [
        { text: "The ADT event trail is present for two therapy-series contacts. It records an outpatient in event by a named user and a discharge event filed later by a Prelude batch job. That is operationally rich, but not the same thing as time spent with a clinician.", cites: ["e_adt_therapy"] }
      ]
    }
  ],
  evidence: {
    e_slot_vitals_proxy: {
      kind: "fact",
      text: `Real scheduled appointments are identified by PAT_ENC.APPT_STATUS_C_NAME / PAT_ENC_APPT.PROV_START_TIME. Flowsheet RECORDED_TIME gives a rooming-adjacent proxy on ${appointmentRows.filter((r) => r.first_flowsheet_time).length} of ${appointmentRows.length} status-bearing appointments.`
    },
    e_no_exam_room_timer: {
      kind: "fact",
      text: "A schema search found room/arrival/departure columns in CLARITY_ADT and PAT_ENC_HSP, but ordinary internal-medicine appointments in this specimen have no exported room-in/room-out timestamp pair."
    },
    e_appt_status_counts: {
      kind: "fact",
      text: `Status-bearing appointments total ${Number(skeleton.real_appts)}: ${statusCounts.map((r) => `${r.n} ${r.status}`).join(", ")}. Completed appointments all have check-in users; checkout appears on ${statusCounts.reduce((a, r) => a + Number(r.checkout), 0)} rows.`
    },
    e_skeleton_filter: {
      kind: "fact",
      text: `PAT_ENC_APPT has ${Number(skeleton.rows)} rows, but only ${Number(skeleton.real_appts)} carry appointment status and ${Number(skeleton.with_slot_time)} carry slot time. Use status or slot time to identify real scheduled appointments.`
    },
    e_echeckin_steps: {
      kind: "fact",
      text: `ECHKIN_STEP_INFO contains ${stepRows.reduce((acc, r) => acc + Number(r.n), 0)} step rows across appointment eCheck-in workflows, with rollup statuses in PAT_ENC_4.ECHKIN_STATUS_C_NAME.`
    },
    e_questionnaire_workflow: {
      kind: "fact",
      text: `Questionnaire-related tables add ${questionnaireRows.reduce((acc, r) => acc + r.n, 0)} MyChart appointment questionnaire rows, ${kioskRows.reduce((acc, r) => acc + r.n, 0)} kiosk questionnaire rows, and ${qanswerSummary.with_duration} CL_QANSWER rows with workflow duration values ranging from ${qanswerSummary.min_sec} to ${qanswerSummary.max_sec} seconds.`
    },
    e_audit_trail: {
      kind: "fact",
      text: `V_EHI_REG_ITEM_AUDIT_EPT has ${q(`SELECT COUNT(*) AS n FROM V_EHI_REG_ITEM_AUDIT_EPT`)[0].n} patient-record audit rows across ${new Set(auditRaw.filter((r) => r.source === "Patient record").map((r) => r.item)).size} changed-item labels. V_EHI_REG_ITEM_AUDIT_HAR adds ${q(`SELECT COUNT(*) AS n FROM V_EHI_REG_ITEM_AUDIT_HAR`)[0].n} hospital-account audit rows across ${new Set(auditRaw.filter((r) => r.source === "Hospital account").map((r) => r.item)).size} labels.`
    },
    e_order_timing: {
      kind: "fact",
      text: `ORDER_PROC has ${orderTimingSummary.reduce((acc, r) => acc + r.n, 0)} orders; all have ORDER_TIME, ${orderTimingSummary.reduce((acc, r) => acc + r.procedure_times, 0)} have procedure timing fields, and ${orderTimingSummary.reduce((acc, r) => acc + r.result_time, 0)} have RESULT_TIME. CL_ORD_FST_LST_SCH has 62 rows but no populated first/last scheduled timestamps.`
    },
    e_note_timing: {
      kind: "fact",
      text: `Clinical note lifecycle rows include ${noteTimingSummary.entry_local_rows} local entry instants, ${noteTimingSummary.filed_local_rows} local note-file instants, and ${noteTimingSummary.update_author_local_rows} local update-by-author instants. Local note-file times show ${noteTimingSummary.filed_after_hours} after-hours rows and ${noteTimingSummary.filed_weekend} weekend rows. All ${noteSlotContext.after_hours_filed} after-hours filed notes with slots were same-day: ${noteSlotContext.morning_slot} from morning slots, ${noteSlotContext.afternoon_slot} from afternoon slots, and ${noteSlotContext.late_slot} from late-day slots.`
    },
    e_adt_therapy: {
      kind: "fact",
      text: `CLARITY_ADT has four events for two MHM OT Neuro Central therapy-series contacts: Hospital Outpatient in-events by a named user and Discharge out-events filed by PRELUDE, BATCH JOB. PAT_ENC_HSP has ${hspTimingSummary.rows} therapy-series rows with admission/discharge times but no ED arrival, triage, ED departure, room, or bed values.`
    }
  }
};

await Bun.write(new URL("../parts/core.json", import.meta.url), JSON.stringify(vm, null, 2));
await Bun.write(new URL("../viewmodel.json", import.meta.url), JSON.stringify(vm, null, 2));
console.log(`wrote operational-details viewmodel with ${appointmentRows.length} appointments, ${auditRaw.length} audit rows`);
