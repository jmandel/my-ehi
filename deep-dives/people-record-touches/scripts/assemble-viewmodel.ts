#!/usr/bin/env bun
/**
 * Build the people/record-touch view model from the raw EHI SQLite database.
 *
 * The output is display-clean. The app imports only ../viewmodel.json.
 */
import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type Row = Record<string, any>;

type Event = {
  id: string;
  dateIso: string | null;
  dateLabel: string;
  year: number | null;
  actorKey: string;
  actorName: string;
  actorKind: "Human" | "System / placeholder" | "External source";
  idSpace: "Provider master" | "User/login master" | "Free text";
  sourceId: string;
  domain: string;
  taskGroup: string;
  task: string;
  role: string;
  department: string;
  departmentId: string | null;
  record: string;
  sourceTable: string;
};

const db = new Database(process.env.EHI_DB ?? "./db/ehi.sqlite", { readonly: true });
db.run("PRAGMA busy_timeout = 8000");

function all(sql: string): Row[] {
  return db.query(sql).all() as Row[];
}

const providerRows = all("SELECT PROV_ID, PROV_NAME, EXTERNAL_NAME FROM CLARITY_SER");
const userRows = all("SELECT USER_ID, NAME FROM CLARITY_EMP");
const deptRows = all(`
  SELECT d.DEPARTMENT_ID, d.DEPARTMENT_NAME, d.EXTERNAL_NAME, d4.DEP_TYPE_C_NAME
  FROM CLARITY_DEP d LEFT JOIN CLARITY_DEP_4 d4 USING(DEPARTMENT_ID)
`);

const providers = new Map(providerRows.map((r) => [String(r.PROV_ID), r]));
const users = new Map(userRows.map((r) => [String(r.USER_ID), r]));
const departments = new Map(deptRows.map((r) => [String(r.DEPARTMENT_ID), r]));

function titleCaseName(name: string | null | undefined): string {
  if (!name) return "Unknown";
  const clean = String(name).replace(/\s+/g, " ").trim();
  if (!clean.includes(",")) return clean;
  const [last, rest] = clean.split(",", 2).map((s) => s.trim());
  const words = `${rest} ${last}`.split(" ").filter(Boolean);
  return words.map((w) => {
    if (/^[A-Z]{2,}$/.test(w) && w.length <= 3) return w;
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(" ");
}

function normalizeName(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

function actorKind(name: string, sourceId: string, idSpace: Event["idSpace"]): Event["actorKind"] {
  const n = `${name} ${sourceId}`.toUpperCase();
  if (sourceId === "8800099" || n.includes("GENERIC EXTERNAL DATA")) return "External source";
  if (
    ["199995", "E1011", "3724611", "1", "224", "801", "1001", "14060"].includes(sourceId) ||
    /(BATCH|PROCESSOR|INTERCONNECT|CLARITY|EDI|EPIC, USER|MYCHART|AUTO ACCEPT|SYSTEM|VENDOR|RTE|NOT IN SYSTEM|MAC LAB)/.test(n)
  ) {
    return "System / placeholder";
  }
  if (idSpace === "Free text" && /(BATCH|SYSTEM|AUTO|UNKNOWN)/.test(n)) return "System / placeholder";
  return "Human";
}

function resolveProvider(id: any): { name: string; key: string; kind: Event["actorKind"]; idSpace: Event["idSpace"]; sourceId: string } | null {
  if (id == null || String(id).trim() === "") return null;
  const sourceId = String(id);
  const row = providers.get(sourceId);
  const name = row ? (row.EXTERNAL_NAME || titleCaseName(row.PROV_NAME)) : `Provider ${sourceId}`;
  const kind = actorKind(name, sourceId, "Provider master");
  return { name, key: `${kind === "Human" ? "person" : "entity"}:${normalizeName(name)}`, kind, idSpace: "Provider master", sourceId };
}

function resolveUser(id: any, inlineName?: any): { name: string; key: string; kind: Event["actorKind"]; idSpace: Event["idSpace"]; sourceId: string } | null {
  if (id == null || String(id).trim() === "") return null;
  const sourceId = String(id);
  const row = users.get(sourceId);
  const raw = inlineName || row?.NAME || `User ${sourceId}`;
  const name = titleCaseName(raw);
  const kind = actorKind(name, sourceId, "User/login master");
  return { name, key: `${kind === "Human" ? "person" : "entity"}:${normalizeName(name)}`, kind, idSpace: "User/login master", sourceId };
}

function resolveFreeText(value: any): { name: string; key: string; kind: Event["actorKind"]; idSpace: Event["idSpace"]; sourceId: string } | null {
  if (value == null || String(value).trim() === "") return null;
  const name = titleCaseName(String(value));
  const kind = actorKind(name, name, "Free text");
  return { name, key: `${kind === "Human" ? "person" : "entity"}:${normalizeName(name)}`, kind, idSpace: "Free text", sourceId: name };
}

function deptName(id: any): { id: string | null; name: string } {
  if (id == null || String(id).trim() === "") return { id: null, name: "No department on row" };
  const key = String(id);
  const row = departments.get(key);
  if (!row) return { id: key, name: `Department ${key}` };
  return { id: key, name: row.EXTERNAL_NAME || row.DEPARTMENT_NAME || `Department ${key}` };
}

function dateRealToIso(value: any): string | null {
  if (value == null || String(value).trim() === "") return null;
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return null;
  const epoch = Date.UTC(1840, 11, 31);
  return new Date(epoch + n * 86400000).toISOString().slice(0, 10);
}

function dateTextToIso(value: any): string | null {
  if (value == null || String(value).trim() === "") return null;
  const m = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) {
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function dateLabel(iso: string | null): string {
  if (!iso) return "Undated";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function yearOf(iso: string | null): number | null {
  return iso ? Number(iso.slice(0, 4)) : null;
}

const events: Event[] = [];
let seq = 0;

function add(
  actor: ReturnType<typeof resolveProvider> | ReturnType<typeof resolveUser> | ReturnType<typeof resolveFreeText>,
  attrs: Omit<Event, "id" | "actorKey" | "actorName" | "actorKind" | "idSpace" | "sourceId" | "dateLabel" | "year">
) {
  if (!actor) return;
  events.push({
    id: `touch_${String(++seq).padStart(4, "0")}`,
    ...attrs,
    dateLabel: dateLabel(attrs.dateIso),
    year: yearOf(attrs.dateIso),
    actorKey: actor.key,
    actorName: actor.name,
    actorKind: actor.kind,
    idSpace: actor.idSpace,
    sourceId: actor.sourceId,
  });
}

function addUser(row: Row, idCol: string, nameCol: string | null, attrs: Parameters<typeof add>[1]) {
  add(resolveUser(row[idCol], nameCol ? row[nameCol] : undefined), attrs);
}

function addProvider(row: Row, idCol: string, attrs: Parameters<typeof add>[1]) {
  add(resolveProvider(row[idCol]), attrs);
}

function addFree(row: Row, col: string, attrs: Parameters<typeof add>[1]) {
  add(resolveFreeText(row[col]), attrs);
}

// Encounters and appointment operations.
for (const r of all(`
  SELECT e.*, d.EXTERNAL_NAME AS DEPT_EXTERNAL
  FROM PAT_ENC e LEFT JOIN CLARITY_DEP d ON e.DEPARTMENT_ID=d.DEPARTMENT_ID
`)) {
  const d = deptName(r.DEPARTMENT_ID);
  const iso = dateRealToIso(r.PAT_ENC_DATE_REAL) ?? dateTextToIso(r.CONTACT_DATE);
  const record = [r.APPT_STATUS_C_NAME || r.CALCULATED_ENC_STAT_C_NAME, r.PAT_ENC_CSN_ID].filter(Boolean).join(" · ");
  addProvider(r, "VISIT_PROV_ID", { dateIso: iso, domain: "Encounters", taskGroup: "Care delivery", task: "Visit / rendering provider", role: r.VISIT_PROV_TITLE_NAME || "Visit provider", department: d.name, departmentId: d.id, record, sourceTable: "PAT_ENC" });
  addProvider(r, "PCP_PROV_ID", { dateIso: iso, domain: "Encounters", taskGroup: "Care relationship", task: "PCP attached to encounter", role: "PCP on contact", department: d.name, departmentId: d.id, record, sourceTable: "PAT_ENC" });
  addUser(r, "ENC_CREATE_USER_ID", "ENC_CREATE_USER_ID_NAME", { dateIso: iso, domain: "Encounters", taskGroup: "Access / scheduling", task: "Create encounter shell", role: "Encounter creator", department: d.name, departmentId: d.id, record, sourceTable: "PAT_ENC" });
  addUser(r, "CHECKIN_USER_ID", "CHECKIN_USER_ID_NAME", { dateIso: iso, domain: "Encounters", taskGroup: "Access / scheduling", task: "Check in patient", role: "Check-in user", department: d.name, departmentId: d.id, record, sourceTable: "PAT_ENC" });
  addUser(r, "APPT_CANC_USER_ID", "APPT_CANC_USER_ID_NAME", { dateIso: iso, domain: "Encounters", taskGroup: "Access / scheduling", task: "Cancel appointment", role: "Cancellation user", department: d.name, departmentId: d.id, record, sourceTable: "PAT_ENC" });
  addUser(r, "ENC_CLOSED_USER_ID", "ENC_CLOSED_USER_ID_NAME", { dateIso: iso, domain: "Encounters", taskGroup: "Documentation control", task: "Close encounter", role: "Encounter closer", department: d.name, departmentId: d.id, record, sourceTable: "PAT_ENC" });
  addUser(r, "AVS_FIRST_USER_ID", "AVS_FIRST_USER_ID_NAME", { dateIso: iso, domain: "Encounters", taskGroup: "Documentation control", task: "Release / print after-visit summary", role: "AVS user", department: d.name, departmentId: d.id, record, sourceTable: "PAT_ENC" });
  addFree(r, "DATA_ENTRY_PERSON", { dateIso: iso, domain: "Encounters", taskGroup: "Access / scheduling", task: "Data entry person", role: "Free-text data entry", department: d.name, departmentId: d.id, record, sourceTable: "PAT_ENC" });
}

for (const r of all(`SELECT e3.*, e.PAT_ENC_DATE_REAL, e.CONTACT_DATE, e.DEPARTMENT_ID FROM PAT_ENC_3 e3 JOIN PAT_ENC e ON e3.PAT_ENC_CSN=e.PAT_ENC_CSN_ID`)) {
  const d = deptName(r.DEPARTMENT_ID);
  const iso = dateRealToIso(r.PAT_ENC_DATE_REAL) ?? dateTextToIso(r.CONTACT_DATE);
  addUser(r, "CHKOUT_USER_ID", "CHKOUT_USER_ID_NAME", { dateIso: iso, domain: "Encounters", taskGroup: "Access / scheduling", task: "Check out patient", role: "Checkout user", department: d.name, departmentId: d.id, record: r.PAT_ENC_CSN, sourceTable: "PAT_ENC_3" });
  addUser(r, "SMK_CESS_USER_ID", "SMK_CESS_USER_ID_NAME", { dateIso: iso, domain: "Encounters", taskGroup: "Clinical documentation", task: "Smoking cessation documentation", role: "Counseling/documentation user", department: d.name, departmentId: d.id, record: r.PAT_ENC_CSN, sourceTable: "PAT_ENC_3" });
}

for (const r of all(`SELECT * FROM PAT_PCP`)) {
  const iso = dateTextToIso(r.EFF_DATE);
  addProvider(r, "PCP_PROV_ID", { dateIso: iso, domain: "Care team", taskGroup: "Care relationship", task: "Longitudinal PCP assignment", role: r.PCP_TYPE_C_NAME || r.SPECIALTY_C_NAME || "PCP", department: "Patient-level care team", departmentId: null, record: r.TERM_DATE ? `Ended ${r.TERM_DATE}` : "Current", sourceTable: "PAT_PCP" });
}

for (const r of all(`SELECT * FROM TREATMENT_TEAM`)) {
  const iso = dateTextToIso(r.CONTACT_DATE);
  addProvider(r, "TR_TEAM_ID", { dateIso: iso, domain: "Care team", taskGroup: "Care relationship", task: "Per-encounter treatment team", role: r.TR_TEAM_REL_C_NAME || r.TR_TEAM_SPEC_C_NAME || "Treatment team member", department: "Encounter treatment team", departmentId: null, record: r.PAT_ENC_CSN_ID, sourceTable: "TREATMENT_TEAM" });
}

// Orders and results.
for (const r of all(`SELECT om.*, e.DEPARTMENT_ID FROM ORDER_MED om LEFT JOIN PAT_ENC e USING(PAT_ENC_CSN_ID)`)) {
  const d = deptName(r.DEPARTMENT_ID);
  const iso = dateRealToIso(r.PAT_ENC_DATE_REAL) ?? dateTextToIso(r.ORDERING_DATE);
  const record = r.DISPLAY_NAME || r.DESCRIPTION || r.ORDER_MED_ID;
  addUser(r, "ORD_CREATR_USER_ID", "ORD_CREATR_USER_ID_NAME", { dateIso: iso, domain: "Medication orders", taskGroup: "Ordering", task: "Create medication order", role: "Order creator", department: d.name, departmentId: d.id, record, sourceTable: "ORDER_MED" });
  addProvider(r, "MED_PRESC_PROV_ID", { dateIso: iso, domain: "Medication orders", taskGroup: "Ordering", task: "Medication prescriber", role: r.PROVIDER_TYPE_C_NAME || "Prescribing provider", department: d.name, departmentId: d.id, record, sourceTable: "ORDER_MED" });
  addProvider(r, "AUTHRZING_PROV_ID", { dateIso: iso, domain: "Medication orders", taskGroup: "Ordering", task: "Authorize medication order", role: "Authorizing provider", department: d.name, departmentId: d.id, record, sourceTable: "ORDER_MED" });
  addProvider(r, "ORD_PROV_ID", { dateIso: iso, domain: "Medication orders", taskGroup: "Ordering", task: "Ordering provider", role: "Ordering provider", department: d.name, departmentId: d.id, record, sourceTable: "ORDER_MED" });
  addProvider(r, "MED_REFILL_PROV_ID", { dateIso: iso, domain: "Medication orders", taskGroup: "Ordering", task: "Medication refill provider", role: "Refill provider", department: d.name, departmentId: d.id, record, sourceTable: "ORDER_MED" });
  addUser(r, "DISCON_USER_ID", "DISCON_USER_ID_NAME", { dateIso: dateTextToIso(r.DISCON_TIME) ?? iso, domain: "Medication orders", taskGroup: "Medication lifecycle", task: "Discontinue medication", role: "Discontinuing user", department: d.name, departmentId: d.id, record, sourceTable: "ORDER_MED" });
  addUser(r, "PEND_APPR_USER_ID", "PEND_APPR_USER_ID_NAME", { dateIso: iso, domain: "Medication orders", taskGroup: "Medication lifecycle", task: "Pending medication approval", role: "Pending approver", department: d.name, departmentId: d.id, record, sourceTable: "ORDER_MED" });
}

for (const r of all(`SELECT op.*, e.DEPARTMENT_ID FROM ORDER_PROC op LEFT JOIN PAT_ENC e USING(PAT_ENC_CSN_ID)`)) {
  const d = deptName(r.DEPARTMENT_ID);
  const iso = dateRealToIso(r.PAT_ENC_DATE_REAL) ?? dateTextToIso(r.ORDERING_DATE);
  const record = r.DISPLAY_NAME || r.DESCRIPTION || r.ORDER_PROC_ID;
  addUser(r, "ORD_CREATR_USER_ID", "ORD_CREATR_USER_ID_NAME", { dateIso: iso, domain: "Procedure / lab / imaging orders", taskGroup: "Ordering", task: "Create procedure/lab/imaging order", role: "Order creator", department: d.name, departmentId: d.id, record, sourceTable: "ORDER_PROC" });
  addProvider(r, "AUTHRZING_PROV_ID", { dateIso: iso, domain: "Procedure / lab / imaging orders", taskGroup: "Ordering", task: "Authorize procedure/lab/imaging order", role: "Authorizing provider", department: d.name, departmentId: d.id, record, sourceTable: "ORDER_PROC" });
  addProvider(r, "BILLING_PROV_ID", { dateIso: iso, domain: "Procedure / lab / imaging orders", taskGroup: "Billing attribution", task: "Billing provider on order", role: "Billing provider", department: d.name, departmentId: d.id, record, sourceTable: "ORDER_PROC" });
  addProvider(r, "REFERRING_PROV_ID", { dateIso: iso, domain: "Procedure / lab / imaging orders", taskGroup: "Referral / authorization", task: "Referring provider on order", role: "Referring provider", department: d.name, departmentId: d.id, record, sourceTable: "ORDER_PROC" });
  addProvider(r, "DEPT_REF_PROV_ID", { dateIso: iso, domain: "Procedure / lab / imaging orders", taskGroup: "Referral / authorization", task: "Department referral provider", role: "Department referral provider", department: d.name, departmentId: d.id, record, sourceTable: "ORDER_PROC" });
  addUser(r, "TECHNOLOGIST_ID", "TECHNOLOGIST_ID_NAME", { dateIso: iso, domain: "Procedure / lab / imaging orders", taskGroup: "Result production", task: "Technologist on result/order", role: "Technologist", department: d.name, departmentId: d.id, record, sourceTable: "ORDER_PROC" });
  addUser(r, "INT_STUDY_USER_ID", "INT_STUDY_USER_ID_NAME", { dateIso: iso, domain: "Procedure / lab / imaging orders", taskGroup: "Result production", task: "Interpret study", role: "Interpreting user", department: d.name, departmentId: d.id, record, sourceTable: "ORDER_PROC" });
  addUser(r, "INSTNTOR_USER_ID", "INSTNTOR_USER_ID_NAME", { dateIso: iso, domain: "Procedure / lab / imaging orders", taskGroup: "Result production", task: "Instantiate standing/future order", role: "Instantiating user", department: d.name, departmentId: d.id, record, sourceTable: "ORDER_PROC" });
}

// Notes and messages.
for (const r of all(`SELECT h.*, e.DEPARTMENT_ID FROM HNO_INFO h LEFT JOIN PAT_ENC e USING(PAT_ENC_CSN_ID)`)) {
  const d = deptName(r.DEPARTMENT_ID);
  const iso = dateTextToIso(r.CREATE_INSTANT_DTTM) ?? dateRealToIso(r.ORIG_HP_DATE_REAL);
  const record = [r.NOTE_TYPE_NOADD_C_NAME || r.IP_NOTE_TYPE_C_NAME || "Note", r.NOTE_ID].join(" · ");
  addUser(r, "ENTRY_USER_ID", "ENTRY_USER_ID_NAME", { dateIso: iso, domain: "Notes", taskGroup: "Clinical documentation", task: "Enter note shell", role: "Note entry user", department: d.name, departmentId: d.id, record, sourceTable: "HNO_INFO" });
  addUser(r, "CURRENT_AUTHOR_ID", "CURRENT_AUTHOR_ID_NAME", { dateIso: iso, domain: "Notes", taskGroup: "Clinical documentation", task: "Current note author", role: "Current author", department: d.name, departmentId: d.id, record, sourceTable: "HNO_INFO" });
  addUser(r, "COMMENT_USER_ID", "COMMENT_USER_ID_NAME", { dateIso: dateTextToIso(r.COMMENT_EDIT_INST_DTTM) ?? iso, domain: "Notes", taskGroup: "Documentation control", task: "Edit note comment", role: "Comment editor", department: d.name, departmentId: d.id, record, sourceTable: "HNO_INFO" });
  addUser(r, "DELETE_USER_ID", "DELETE_USER_ID_NAME", { dateIso: dateTextToIso(r.DELETE_INSTANT_DTTM) ?? iso, domain: "Notes", taskGroup: "Documentation control", task: "Delete note", role: "Note deleter", department: d.name, departmentId: d.id, record, sourceTable: "HNO_INFO" });
}

for (const r of all(`SELECT * FROM NOTE_ENC_INFO`)) {
  const iso = dateTextToIso(r.ENTRY_INSTANT_DTTM) ?? dateRealToIso(r.CONTACT_DATE_REAL);
  const record = [r.NOTE_TYPE_C_NAME || r.DOCUMENT_NAME || "Note metadata", r.NOTE_ID].join(" · ");
  addProvider(r, "AUTH_LNKED_PROV_ID", { dateIso: iso, domain: "Notes", taskGroup: "Clinical documentation", task: "Linked authoring provider", role: r.AUTHOR_PRVD_TYPE_C_NAME || "Author-linked provider", department: r.AUTHOR_SERVICE_C_NAME || "Note author service", departmentId: null, record, sourceTable: "NOTE_ENC_INFO" });
  addUser(r, "AUTHOR_USER_ID", "AUTHOR_USER_ID_NAME", { dateIso: iso, domain: "Notes", taskGroup: "Clinical documentation", task: "Author note", role: "Author user", department: r.AUTHOR_SERVICE_C_NAME || "Note author service", departmentId: null, record, sourceTable: "NOTE_ENC_INFO" });
  addUser(r, "UPDATE_USER_ID", "UPDATE_USER_ID_NAME", { dateIso: dateTextToIso(r.UPD_AUTHOR_INS_DTTM) ?? iso, domain: "Notes", taskGroup: "Documentation control", task: "Update note", role: "Note updater", department: r.AUTHOR_SERVICE_C_NAME || "Note author service", departmentId: null, record, sourceTable: "NOTE_ENC_INFO" });
  addUser(r, "EDIT_USER_ID", "EDIT_USER_ID_NAME", { dateIso: dateTextToIso(r.ACTIVITY_DTTM) ?? iso, domain: "Notes", taskGroup: "Documentation control", task: "Edit note metadata", role: "Metadata editor", department: r.AUTHOR_SERVICE_C_NAME || "Note author service", departmentId: null, record, sourceTable: "NOTE_ENC_INFO" });
  addUser(r, "COSIGNUSER_ID", "COSIGNUSER_ID_NAME", { dateIso: dateTextToIso(r.COSIGN_INSTANT_DTTM) ?? iso, domain: "Notes", taskGroup: "Documentation control", task: "Cosign note", role: "Cosigner", department: r.AUTHOR_SERVICE_C_NAME || "Note author service", departmentId: null, record, sourceTable: "NOTE_ENC_INFO" });
  addUser(r, "CSGN_RECPNT_USER_ID", "CSGN_RECPNT_USER_ID_NAME", { dateIso: iso, domain: "Notes", taskGroup: "Documentation control", task: "Receive cosign request", role: "Cosign recipient", department: r.AUTHOR_SERVICE_C_NAME || "Note author service", departmentId: null, record, sourceTable: "NOTE_ENC_INFO" });
}

for (const r of all(`SELECT * FROM MYC_MESG`)) {
  const d = deptName(r.DEPARTMENT_ID);
  const iso = dateRealToIso(r.PAT_ENC_DATE_REAL) ?? dateTextToIso(r.CREATED_TIME);
  const record = r.SUBJECT || r.REQUEST_SUBJECT || r.MESSAGE_ID;
  addUser(r, "FROM_USER_ID", "FROM_USER_ID_NAME", { dateIso: iso, domain: "Messages", taskGroup: "Patient communication", task: "Send message", role: r.TOFROM_PAT_C_NAME === "To Patient" ? "Sender to patient" : "Message sender", department: d.name, departmentId: d.id, record, sourceTable: "MYC_MESG" });
  addUser(r, "TO_USER_ID", "TO_USER_ID_NAME", { dateIso: iso, domain: "Messages", taskGroup: "Patient communication", task: "Receive/routed message", role: r.TOFROM_PAT_C_NAME === "From Patient" ? "Recipient from patient" : "Message recipient", department: d.name, departmentId: d.id, record, sourceTable: "MYC_MESG" });
  addProvider(r, "PROV_ID", { dateIso: iso, domain: "Messages", taskGroup: "Patient communication", task: "Message provider of record", role: "Message provider", department: d.name, departmentId: d.id, record, sourceTable: "MYC_MESG" });
  addProvider(r, "HX_QUESR_PROV_ID", { dateIso: iso, domain: "Messages", taskGroup: "Patient-entered review", task: "Questionnaire provider context", role: "Questionnaire provider", department: d.name, departmentId: d.id, record, sourceTable: "MYC_MESG" });
  addProvider(r, "HX_QUESR_ENCPROV_ID", { dateIso: iso, domain: "Messages", taskGroup: "Patient-entered review", task: "Questionnaire encounter provider", role: "Questionnaire encounter provider", department: d.name, departmentId: d.id, record, sourceTable: "MYC_MESG" });
}

// Structured clinical facts.
for (const r of all(`SELECT m.*, rec.RECORD_DATE, rec.PAT_ID FROM IP_FLWSHT_MEAS m LEFT JOIN IP_FLWSHT_REC rec USING(FSD_ID)`)) {
  const iso = dateTextToIso(r.RECORDED_TIME) ?? dateTextToIso(r.RECORD_DATE);
  const record = `Flowsheet row ${r.FLO_MEAS_ID || ""}`.trim();
  addUser(r, "TAKEN_USER_ID", "TAKEN_USER_ID_NAME", { dateIso: iso, domain: "Vitals / flowsheets", taskGroup: "Result production", task: "Take flowsheet measurement", role: "Taken by", department: "Flowsheets", departmentId: null, record, sourceTable: "IP_FLWSHT_MEAS" });
  addUser(r, "ENTRY_USER_ID", "ENTRY_USER_ID_NAME", { dateIso: dateTextToIso(r.ENTRY_TIME) ?? iso, domain: "Vitals / flowsheets", taskGroup: "Result production", task: "Enter flowsheet measurement", role: "Entered by", department: "Flowsheets", departmentId: null, record, sourceTable: "IP_FLWSHT_MEAS" });
  addUser(r, "USER_PENDED_BY_ID", "USER_PENDED_BY_ID_NAME", { dateIso: iso, domain: "Vitals / flowsheets", taskGroup: "Result production", task: "Pend flowsheet measurement", role: "Pended by", department: "Flowsheets", departmentId: null, record, sourceTable: "IP_FLWSHT_MEAS" });
}

for (const r of all(`SELECT * FROM ALLERGY`)) {
  addUser(r, "ENTRY_USER_ID", "ENTRY_USER_ID_NAME", { dateIso: dateRealToIso(r.ALLERGY_DATE_REAL) ?? dateTextToIso(r.ENTRY_DATE), domain: "Allergies", taskGroup: "Problem/allergy list maintenance", task: "Enter allergy", role: "Allergy entry user", department: "Problem/allergy list", departmentId: null, record: r.DESCRIPTION || r.ALLERGY_ID, sourceTable: "ALLERGY" });
}

for (const r of all(`SELECT pl.*, edg.DX_NAME FROM PROBLEM_LIST pl LEFT JOIN CLARITY_EDG edg USING(DX_ID)`)) {
  addUser(r, "ENTRY_USER_ID", "ENTRY_USER_ID_NAME", { dateIso: dateTextToIso(r.DATE_OF_ENTRY), domain: "Problem list", taskGroup: "Problem/allergy list maintenance", task: "Enter problem", role: "Problem entry user", department: "Problem list", departmentId: null, record: r.DX_NAME || r.PROBLEM_LIST_ID, sourceTable: "PROBLEM_LIST" });
}

for (const r of all(`SELECT * FROM PROBLEM_LIST_HX`)) {
  addUser(r, "HX_ENTRY_USER_ID", "HX_ENTRY_USER_ID_NAME", { dateIso: dateTextToIso(r.HX_DATE_OF_ENTRY) ?? dateTextToIso(r.HX_ENTRY_INST), domain: "Problem list", taskGroup: "Problem/allergy list maintenance", task: "Historical problem-list entry", role: "History entry user", department: "Problem list history", departmentId: null, record: r.HX_DESCRIPTION || r.PROBLEM_LIST_ID, sourceTable: "PROBLEM_LIST_HX" });
}

for (const r of all(`SELECT * FROM IMMUNE`)) {
  const iso = dateTextToIso(r.IMMUNE_DATE) ?? dateTextToIso(r.ENTRY_DATE);
  const record = r.IMMUNZATN_ID_IMM_NAME || r.IMMUNIZATION_NAME || r.IMMUNZATN_ID || r.IMMUNE_ID;
  addUser(r, "GIVEN_BY_USER_ID", "GIVEN_BY_USER_ID_NAME", { dateIso: iso, domain: "Immunizations", taskGroup: "Immunization administration", task: "Administer immunization", role: "Given by", department: "Immunizations", departmentId: null, record, sourceTable: "IMMUNE" });
  addUser(r, "ENTRY_USER_ID", "ENTRY_USER_ID_NAME", { dateIso: dateTextToIso(r.ENTRY_DTTM) ?? iso, domain: "Immunizations", taskGroup: "Immunization administration", task: "Enter immunization", role: "Entry user", department: "Immunizations", departmentId: null, record, sourceTable: "IMMUNE" });
  addUser(r, "IMMNZTN_DUALSIGN_ID", "IMMNZTN_DUALSIGN_ID_NAME", { dateIso: dateTextToIso(r.IMM_DUALSIGNINSTANT_DTTM) ?? iso, domain: "Immunizations", taskGroup: "Immunization administration", task: "Dual-sign immunization", role: "Dual-sign user", department: "Immunizations", departmentId: null, record, sourceTable: "IMMUNE" });
}

// Referrals and billing.
for (const r of all(`SELECT * FROM REFERRAL`)) {
  const d = deptName(r.REFD_TO_DEPT_ID || r.REFD_BY_DEPT_ID);
  const iso = dateTextToIso(r.ENTRY_DATE);
  const record = r.RSN_FOR_RFL_C_NAME || r.REFERRAL_ID;
  addProvider(r, "PCP_PROV_ID", { dateIso: iso, domain: "Referrals", taskGroup: "Referral / authorization", task: "PCP on referral", role: "PCP provider", department: d.name, departmentId: d.id, record, sourceTable: "REFERRAL" });
  addProvider(r, "REFERRING_PROV_ID", { dateIso: iso, domain: "Referrals", taskGroup: "Referral / authorization", task: "Refer patient", role: "Referring provider", department: d.name, departmentId: d.id, record, sourceTable: "REFERRAL" });
  addProvider(r, "REFERRAL_PROV_ID", { dateIso: iso, domain: "Referrals", taskGroup: "Referral / authorization", task: "Referral provider", role: "Referral provider", department: d.name, departmentId: d.id, record, sourceTable: "REFERRAL" });
  addUser(r, "PREAUTH_CHG_EMP_ID", "PREAUTH_CHG_EMP_ID_NAME", { dateIso: dateTextToIso(r.PREAUTH_CHNGD_DTTM) ?? iso, domain: "Referrals", taskGroup: "Referral / authorization", task: "Change preauthorization", role: "Preauthorization changer", department: d.name, departmentId: d.id, record, sourceTable: "REFERRAL" });
}

for (const r of all(`SELECT * FROM REFERRAL_HIST`)) {
  addUser(r, "CHANGE_USER_ID", "CHANGE_USER_ID_NAME", { dateIso: dateTextToIso(r.CHANGE_DATE), domain: "Referrals", taskGroup: "Referral / authorization", task: "Change referral record", role: "Referral history changer", department: "Referral workqueue", departmentId: null, record: r.CHANGE_TYPE_C_NAME || r.REFERRAL_ID, sourceTable: "REFERRAL_HIST" });
}

for (const r of all(`SELECT * FROM ARPB_TRANSACTIONS`)) {
  const d = deptName(r.DEPARTMENT_ID);
  const iso = dateTextToIso(r.SERVICE_DATE) ?? dateTextToIso(r.POST_DATE);
  const record = [r.TX_TYPE_C_NAME, r.CPT_CODE, r.PROCEDURE_QUANTITY ? `qty ${r.PROCEDURE_QUANTITY}` : ""].filter(Boolean).join(" · ") || r.TX_ID;
  addProvider(r, "SERV_PROVIDER_ID", { dateIso: iso, domain: "Billing ledger", taskGroup: "Billing attribution", task: "Service provider on charge", role: "Service provider", department: d.name, departmentId: d.id, record, sourceTable: "ARPB_TRANSACTIONS" });
  addProvider(r, "BILLING_PROV_ID", { dateIso: iso, domain: "Billing ledger", taskGroup: "Billing attribution", task: "Billing provider on charge", role: "Billing provider", department: d.name, departmentId: d.id, record, sourceTable: "ARPB_TRANSACTIONS" });
  addUser(r, "USER_ID", "USER_ID_NAME", { dateIso: iso, domain: "Billing ledger", taskGroup: "Billing / coding operations", task: "Post billing transaction", role: "Transaction user", department: d.name, departmentId: d.id, record, sourceTable: "ARPB_TRANSACTIONS" });
}

for (const r of all(`SELECT a2.*, a.SERVICE_DATE, a.POST_DATE, a.DEPARTMENT_ID FROM ARPB_TRANSACTIONS2 a2 JOIN ARPB_TRANSACTIONS a USING(TX_ID)`)) {
  const d = deptName(r.POSTING_DEPARTMENT_ID || r.DEPARTMENT_ID);
  const iso = dateTextToIso(r.SERVICE_DATE) ?? dateTextToIso(r.POST_DATE);
  addUser(r, "SUSP_NRP_USER_ID", "SUSP_NRP_USER_ID_NAME", { dateIso: iso, domain: "Billing ledger", taskGroup: "Billing / coding operations", task: "Suspend no-response billing item", role: "Billing suspension user", department: d.name, departmentId: d.id, record: r.TX_ID, sourceTable: "ARPB_TRANSACTIONS2" });
  addUser(r, "RFL_OVRIDE_USER_ID", "RFL_OVRIDE_USER_ID_NAME", { dateIso: iso, domain: "Billing ledger", taskGroup: "Billing / coding operations", task: "Override referral on billing item", role: "Referral override user", department: d.name, departmentId: d.id, record: r.TX_ID, sourceTable: "ARPB_TRANSACTIONS2" });
}

for (const r of all(`SELECT * FROM ARPB_TX_ACTIONS`)) {
  const d = deptName(r.DEPARTMENT_ID);
  addUser(r, "ACTION_USER_ID", "ACTION_USER_ID_NAME", { dateIso: dateTextToIso(r.ACTION_DATE), domain: "Billing ledger", taskGroup: "Billing / coding operations", task: "Billing action", role: "Billing action user", department: d.name, departmentId: d.id, record: r.ACTION_C_NAME || r.TX_ID, sourceTable: "ARPB_TX_ACTIONS" });
}

const taskGroupOrder = [
  "Care delivery",
  "Care relationship",
  "Access / scheduling",
  "Clinical documentation",
  "Documentation control",
  "Ordering",
  "Medication lifecycle",
  "Result production",
  "Patient communication",
  "Patient-entered review",
  "Problem/allergy list maintenance",
  "Immunization administration",
  "Referral / authorization",
  "Billing attribution",
  "Billing / coding operations",
];

const taskGroupColors: Record<string, string> = {
  "Care delivery": "#126c5a",
  "Care relationship": "#4b6b2a",
  "Access / scheduling": "#7f5f01",
  "Clinical documentation": "#1d4e89",
  "Documentation control": "#5b5f6d",
  "Ordering": "#7a3e9d",
  "Medication lifecycle": "#9b3d73",
  "Result production": "#0f766e",
  "Patient communication": "#b45309",
  "Patient-entered review": "#8a5a2b",
  "Problem/allergy list maintenance": "#b42318",
  "Immunization administration": "#26734d",
  "Referral / authorization": "#5b47a0",
  "Billing attribution": "#475569",
  "Billing / coding operations": "#0f5b8c",
};

function rollup<T extends string>(rows: Event[], key: (e: Event) => T): { key: T; count: number }[] {
  const m = new Map<T, number>();
  for (const e of rows) m.set(key(e), (m.get(key(e)) || 0) + 1);
  return [...m].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
}

function nestedCount(rows: Event[], k1: (e: Event) => string, k2: (e: Event) => string) {
  const m = new Map<string, number>();
  for (const e of rows) {
    const key = `${k1(e)}\u0000${k2(e)}`;
    m.set(key, (m.get(key) || 0) + 1);
  }
  return [...m].map(([k, count]) => {
    const [source, target] = k.split("\u0000");
    return { source, target, count };
  }).sort((a, b) => b.count - a.count);
}

const humanEvents = events.filter((e) => e.actorKind === "Human");
const actorsByKey = new Map<string, Event[]>();
for (const e of events) {
  if (!actorsByKey.has(e.actorKey)) actorsByKey.set(e.actorKey, []);
  actorsByKey.get(e.actorKey)!.push(e);
}

const actors = [...actorsByKey.entries()].map(([key, rows]) => {
  const human = rows[0].actorKind === "Human";
  const idSpaces = [...new Set(rows.map((e) => e.idSpace))];
  const sourceIds = [...new Set(rows.map((e) => `${e.idSpace.replace(" master", "")}: ${e.sourceId}`))].slice(0, 8);
  const years = rows.map((e) => e.year).filter((y): y is number => y != null);
  const taskGroups = Object.fromEntries(taskGroupOrder.map((g) => [g, rows.filter((e) => e.taskGroup === g).length]).filter(([, c]) => Number(c) > 0));
  const domains = rollup(rows, (e) => e.domain).slice(0, 5);
  const departments = rollup(rows, (e) => e.department).slice(0, 5);
  const roles = rollup(rows, (e) => e.role).slice(0, 5);
  const samples = [...rows]
    .sort((a, b) => (b.dateIso || "").localeCompare(a.dateIso || ""))
    .slice(0, 4)
    .map((e) => ({ date: e.dateLabel, task: e.task, role: e.role, department: e.department, record: e.record, domain: e.domain }));
  return {
    key,
    name: rows[0].actorName,
    kind: rows[0].actorKind,
    isHuman: human,
    touches: rows.length,
    taskGroupCount: Object.keys(taskGroups).length,
    domainCount: new Set(rows.map((e) => e.domain)).size,
    departmentCount: new Set(rows.map((e) => e.department)).size,
    firstYear: years.length ? Math.min(...years) : null,
    lastYear: years.length ? Math.max(...years) : null,
    idSpaces,
    sourceIds,
    taskGroups,
    topDomains: domains,
    topDepartments: departments,
    topRoles: roles,
    samples,
  };
}).sort((a, b) => b.touches - a.touches || a.name.localeCompare(b.name));

const humans = actors.filter((a) => a.kind === "Human");
const systems = actors.filter((a) => a.kind !== "Human");
const humanProvidersAndUsers = humans.filter((a) => a.idSpaces.includes("Provider master") && a.idSpaces.includes("User/login master"));

const eventsByYear = rollup(events.filter((e) => e.year != null), (e) => String(e.year)).sort((a, b) => Number(a.key) - Number(b.key));
const years = eventsByYear.map((d) => Number(d.key));
const yearTaskGrid = years.flatMap((year) => taskGroupOrder.map((group) => ({
  year,
  taskGroup: group,
  count: events.filter((e) => e.year === year && e.taskGroup === group).length,
}))).filter((d) => d.count > 0);

const domainTaskLinks = nestedCount(events, (e) => e.domain, (e) => e.taskGroup);
const taskActorKindLinks = nestedCount(events, (e) => e.taskGroup, (e) => e.actorKind);
const deptTaskLinks = nestedCount(events.filter((e) => e.department !== "No department on row"), (e) => e.department, (e) => e.taskGroup);
const actorTaskLinks = nestedCount(events, (e) => e.actorName, (e) => e.taskGroup);

const sourceTables = rollup(events, (e) => e.sourceTable);
const taskGroups = taskGroupOrder.map((id) => ({
  id,
  label: id,
  color: taskGroupColors[id],
  touches: events.filter((e) => e.taskGroup === id).length,
  humans: new Set(events.filter((e) => e.taskGroup === id && e.actorKind === "Human").map((e) => e.actorKey)).size,
  systems: new Set(events.filter((e) => e.taskGroup === id && e.actorKind !== "Human").map((e) => e.actorKey)).size,
}));
const activeTaskGroups = taskGroups.filter((g) => g.touches > 0);
const activeTaskIds = activeTaskGroups.map((g) => g.id);
const taskCooccurrence = activeTaskIds.flatMap((source, i) => activeTaskIds.slice(i + 1).map((target) => {
  let weight = 0;
  let people = 0;
  for (const actor of humans) {
    const a = actor.taskGroups[source] || 0;
    const b = actor.taskGroups[target] || 0;
    if (a > 0 && b > 0) {
      people += 1;
      weight += Math.min(a, b);
    }
  }
  return { source, target, weight, people };
})).filter((d) => d.weight > 0).sort((a, b) => b.weight - a.weight);
const topBridgeActors = humans
  .filter((a) => a.taskGroupCount > 1)
  .map((a) => ({
    name: a.name,
    touches: a.touches,
    taskGroupCount: a.taskGroupCount,
    taskGroups: a.taskGroups,
    bridgeScore: a.taskGroupCount * Math.sqrt(a.touches),
    sourceIds: a.sourceIds,
  }))
  .sort((a, b) => b.bridgeScore - a.bridgeScore)
  .slice(0, 14);

const domainRollup = rollup(events, (e) => e.domain);
const deptRollup = rollup(events, (e) => e.department).filter((d) => d.key !== "No department on row");
const taskRollup = rollup(events, (e) => e.task);
const roleRollup = rollup(events, (e) => e.role);
const actorKindRollup = rollup(events, (e) => e.actorKind);

const minYear = Math.min(...years);
const maxYear = Math.max(...years);
const topHuman = humans[0];
const topDept = deptRollup[0];
const topTask = taskRollup[0];

const evidence = {
  e_scope: {
    kind: "fact",
    date: "Whole export",
    text: `This projection counted ${events.length.toLocaleString()} attributable record touches across ${sourceTables.length} raw table families. It includes provider-of-record fields, user/login action fields, and free-text data-entry fields where the exporting table carries one.`,
  },
  e_two_id_spaces: {
    kind: "fact",
    date: "Whole export",
    text: `${humanProvidersAndUsers.length} named humans appear in both the provider master and the user/login master. That means the same person can be counted as the clinical actor of record in one table and as the login that performed an action in another.`,
  },
  e_systems: {
    kind: "fact",
    date: "Whole export",
    text: `${systems.length} non-human or placeholder actors appear in the projection, including external data, batch processors, MyChart generic accounts, EDI feeds, and seeded placeholder providers. They are kept visible because they explain how imported and automated data enters the chart.`,
  },
  e_top_department: {
    kind: "fact",
    date: "Whole export",
    text: `${topDept?.key ?? "No department"} has the largest department-attributed touch count (${topDept?.count ?? 0}). Department rollups come only from rows that actually carry a department id or clear department context; note author-service-only rows are shown separately.`,
  },
  e_top_task: {
    kind: "fact",
    date: "Whole export",
    text: `${topTask?.key ?? "No task"} is the most frequent task in the selected vocabulary (${topTask?.count ?? 0} touches). The unit is an attributable field on a record row, not a chart-access audit log event.`,
  },
  e_not_a_breakglass_log: {
    kind: "fact",
    date: "Interpretation limit",
    text: "This is not an audit-log reconstruction of every chart open. It answers who is named on exported clinical, administrative, billing, and communication records as actor, author, creator, signer, changer, or provider of record.",
  },
};

const summary = [
  `The patient-facing record is not touched by a single care team. In this export, ${humans.length} named people and ${systems.length} system, placeholder, or external actors are attached to ${events.length.toLocaleString()} record-touch fields across care delivery, documentation, orders, results, messaging, referrals, immunizations, problem/allergy maintenance, and billing.`,
  `The most important modeling split is provider versus user. A provider id says who was the clinical actor of record; a user id says which login created, edited, closed, posted, routed, signed, or otherwise moved the record. ${humanProvidersAndUsers.length} named humans appear in both spaces, so a clinician can be both the person responsible for care and the login behind a documentation action.`,
  `The non-human actors are not noise. External-data placeholders, lab/radiology pseudo-providers, batch processors, MyChart generic users, EDI feeds, and billing processors mark the routes by which data enters without a local clinician personally typing it. The useful picture is therefore a mixed ecology: people, departments, and automation all leave fingerprints on the health record.`,
];

const viewModel = {
  meta: {
    title: "Who touched the record",
    subtitle: "People, departments, and system actors attached to this Epic EHI export",
    generatedAt: new Date().toISOString(),
    generatedBy: "deep-dives/people-record-touches/scripts/assemble-viewmodel.ts",
    dateSpan: years.length ? `${minYear}–${maxYear}` : "undated",
    counts: {
      touchEvents: events.length,
      namedHumans: humans.length,
      systemActors: systems.length,
      actorsTotal: actors.length,
      departments: deptRollup.length,
      taskGroups: activeTaskGroups.length,
      rawSourceTables: sourceTables.length,
      dualIdHumans: humanProvidersAndUsers.length,
    },
  },
  summary,
  sections: [
    {
      id: "map",
      title: "The record is a production network, not a list of doctors",
      narrative: [
        { text: "Every touch counted here is an attributable field on an exported record row: a provider of record, an author, a creator, a signer, a changer, a billing poster, a message sender or recipient, a vitals taker, or a named system actor. The projection intentionally keeps system accounts and external placeholders because they explain how data gets into the chart.", cites: ["e_scope", "e_systems"] },
      ],
    },
    {
      id: "people",
      title: "The same named person can occupy several record roles",
      narrative: [
        { text: "Epic separates providers from users. Provider ids resolve the clinical actor; user ids resolve the login that performed an action. The combined matrix below merges those spaces by normalized name so clinicians who both treat and edit are visible as one person.", cites: ["e_two_id_spaces"] },
      ],
    },
    {
      id: "departments",
      title: "Departments have different record fingerprints",
      narrative: [
        { text: "Department rollups show where the task mix lives: clinical departments carry visit, order, note, and result work; billing and support departments carry transaction and access work; note services and patient-level lists sit outside a single department row.", cites: ["e_top_department"] },
      ],
    },
    {
      id: "limits",
      title: "What this can and cannot prove",
      narrative: [
        { text: "This is not a chart-access audit log. It does not show everyone who opened the chart, only the people and systems named on exported record objects. That is still valuable: it shows who is responsible for data creation, attribution, routing, signing, posting, and maintenance across the record.", cites: ["e_not_a_breakglass_log"] },
      ],
    },
  ],
  taskGroups: activeTaskGroups,
  rollups: {
    domains: domainRollup,
    departments: deptRollup,
    tasks: taskRollup,
    roles: roleRollup,
    actorKinds: actorKindRollup,
    sourceTables,
    eventsByYear,
  },
  actors,
  topActors: actors.slice(0, 36),
  dualIdHumans: humanProvidersAndUsers.slice(0, 24),
  topDepartments: deptRollup.slice(0, 16),
  visualData: {
    domainTaskLinks,
    taskActorKindLinks,
    deptTaskLinks,
    actorTaskLinks: actorTaskLinks.slice(0, 250),
    taskCooccurrence,
    topBridgeActors,
    yearTaskGrid,
    topActorTaskMatrix: actors.slice(0, 30).flatMap((a) => taskGroupOrder.map((g) => ({
      actorKey: a.key,
      actorName: a.name,
      actorKind: a.kind,
      taskGroup: g,
      count: a.taskGroups[g] || 0,
    }))).filter((d) => d.count > 0),
  },
  events: events
    .sort((a, b) => (a.dateIso || "").localeCompare(b.dateIso || "") || a.actorName.localeCompare(b.actorName))
    .map((e) => ({
      dateIso: e.dateIso,
      date: e.dateLabel,
      actorName: e.actorName,
      actorKind: e.actorKind,
      idSpace: e.idSpace,
      domain: e.domain,
      taskGroup: e.taskGroup,
      task: e.task,
      role: e.role,
      department: e.department,
      record: e.record,
      sourceTable: e.sourceTable,
    })),
  evidence,
};

const out = join(import.meta.dir, "..", "viewmodel.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(viewModel, null, 2) + "\n");
console.log(`Wrote ${out}`);
console.log(`${events.length} touches · ${humans.length} named humans · ${systems.length} system/external actors · ${sourceTables.length} source tables`);
