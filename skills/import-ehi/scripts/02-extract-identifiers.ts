#!/usr/bin/env bun
//
// 02-extract-identifiers.ts — build the DETERMINISTIC half of the redaction inventory from the loaded DB.
//
// Pulls the actual identifier VALUES out of the curated set of personal/family/guarantor/subscriber
// identifier columns (Epic puts them in known places — PATIENT, PAT_RELATIONSHIPS/PAT_REL_*, PAT_ADDRESS,
// ACCOUNT/ACCT_*, V_EHI_COVERAGE_SUBS). It does NOT touch org/payor/provider phones (those are public
// business numbers, not PHI). Output → redact/identifiers.json (gitignored). Prints COUNTS ONLY, never values.
//
//   bun skills/import-ehi/scripts/02-extract-identifiers.ts            # DB at ./db/ehi.sqlite
//
import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";

const db = new Database(process.env.EHI_DB ?? "./db/ehi.sqlite", { readonly: true });
db.run("PRAGMA busy_timeout=8000");

// table.column → identifier type + whose it is. Patient NAME is extracted but defaults to KEEP (public).
type Scope = "patient" | "family" | "guarantor" | "subscriber";
const COLS: { t: string; c: string; type: string; scope: Scope }[] = [
  { t: "PATIENT", c: "SSN", type: "ssn", scope: "patient" },
  { t: "PATIENT", c: "BIRTH_DATE", type: "dob", scope: "patient" },
  { t: "PATIENT", c: "PAT_NAME", type: "name", scope: "patient" },
  { t: "PATIENT", c: "PAT_FIRST_NAME", type: "name", scope: "patient" },
  { t: "PATIENT", c: "PAT_LAST_NAME", type: "name", scope: "patient" },
  { t: "PATIENT", c: "PAT_MIDDLE_NAME", type: "name", scope: "patient" },
  { t: "PATIENT", c: "HOME_PHONE", type: "phone", scope: "patient" },
  { t: "PATIENT", c: "WORK_PHONE", type: "phone", scope: "patient" },
  { t: "PATIENT", c: "TMP_HOME_PHONE", type: "phone", scope: "patient" },
  { t: "PATIENT", c: "EMAIL_ADDRESS", type: "email", scope: "patient" },
  { t: "PATIENT", c: "PAT_MRN_ID", type: "mrn", scope: "patient" },
  { t: "PATIENT", c: "CITY", type: "geo", scope: "patient" },
  { t: "PATIENT", c: "ZIP", type: "geo", scope: "patient" },
  { t: "PATIENT", c: "GUARDIAN_NAME", type: "name", scope: "family" },
  // NB: EMPLOYER_ID_EMPLOYER_NAME holds a CATEGORY ("OTHER"), not a name — excluded (the real employer, if
  // sensitive, comes from the agentic pass). Category/_C_NAME columns never make good redaction sources.
  { t: "PATIENT_2", c: "OTH_PHONE", type: "phone", scope: "patient" },
  { t: "PATIENT_2", c: "OTH_EMAIL", type: "email", scope: "patient" },
  { t: "PAT_EMAILADDRESS", c: "EMAIL_ADDRESS", type: "email", scope: "patient" },
  { t: "PAT_ADDRESS", c: "ADDRESS", type: "address", scope: "patient" },
  { t: "PAT_RELATIONSHIPS", c: "PAT_REL_NAME", type: "name", scope: "family" },
  { t: "PAT_RELATIONSHIPS", c: "PAT_REL_HOME_PHONE", type: "phone", scope: "family" },
  { t: "PAT_RELATIONSHIPS", c: "PAT_REL_WORK_PHONE", type: "phone", scope: "family" },
  { t: "PAT_RELATIONSHIPS", c: "PAT_REL_EMAIL", type: "email", scope: "family" },
  { t: "PAT_RELATIONSHIP_LIST", c: "NAME", type: "name", scope: "family" },
  { t: "PAT_RELATIONSHIP_ADDR", c: "ADDRESS", type: "address", scope: "family" },
  { t: "PAT_REL_PHONE_NUM", c: "PHONE_NUM", type: "phone", scope: "family" },
  { t: "PAT_REL_EMAIL_ADDR", c: "EMAIL_ADDRESS", type: "email", scope: "family" },
  { t: "ACCOUNT", c: "ACCOUNT_NAME", type: "name", scope: "guarantor" },
  { t: "ACCOUNT", c: "HOME_PHONE", type: "phone", scope: "guarantor" },
  { t: "ACCOUNT", c: "WORK_PHONE", type: "phone", scope: "guarantor" },
  { t: "ACCOUNT_2", c: "MOBILE_PHONE", type: "phone", scope: "guarantor" },
  { t: "ACCOUNT_2", c: "EMAIL_ADDRESS", type: "email", scope: "guarantor" },
  { t: "ACCT_ADDR", c: "ADDRESS", type: "address", scope: "guarantor" },
  { t: "ACCT_HOME_PHONE_HX", c: "PHONE_NUMBER", type: "phone", scope: "guarantor" },
  { t: "V_EHI_COVERAGE_SUBS", c: "SUBSCRIBER_NAME", type: "name", scope: "subscriber" },
  { t: "V_EHI_COVERAGE_SUBS", c: "SUBSCRIBER_PREFERRED_NAME", type: "name", scope: "subscriber" },
  { t: "V_EHI_COVERAGE_SUBS", c: "SUBSCRIBER_PHONE", type: "phone", scope: "subscriber" },
];

// KEEP by default: the patient's own name (public author), DOB (kept in the deep dives too), and coarse
// geo (city/ZIP). Everything else (incl. all family/guarantor identifiers) defaults to redact.
const keepByDefault = (type: string, scope: Scope) =>
  (type === "name" && scope === "patient") || type === "geo" || (type === "dob" && scope === "patient");

type Item = { value: string; type: string; scope: Scope; from: string; action: "redact" | "keep" };
const seen = new Map<string, Item>();
let scanned = 0, skipped = 0;

for (const { t, c, type, scope } of COLS) {
  let rows: any[];
  try { rows = db.query(`SELECT DISTINCT "${c}" v FROM "${t}" WHERE "${c}" IS NOT NULL AND TRIM("${c}")<>''`).all() as any[]; }
  catch { skipped++; continue; }
  for (const { v } of rows) {
    const value = String(v).trim();
    if (value.length < 3) continue;                       // skip trivially short tokens
    scanned++;
    const key = `${type}::${value.toLowerCase()}`;
    if (!seen.has(key)) seen.set(key, { value, type, scope, from: `${t}.${c}`, action: keepByDefault(type, scope) ? "keep" : "redact" });
  }
}

const items = [...seen.values()];
mkdirSync("redact", { recursive: true });
writeFileSync("redact/identifiers.json", JSON.stringify(items, null, 2));

// ---- report: COUNTS ONLY (never print a value) ----
const tally = (pred: (i: Item) => boolean) => items.filter(pred).length;
const types = [...new Set(items.map((i) => i.type))].sort();
console.log(`structured identifier inventory → redact/identifiers.json  (${items.length} distinct values; ${skipped} columns absent)`);
console.log("  by type × default action (counts only):");
for (const ty of types) {
  const r = tally((i) => i.type === ty && i.action === "redact");
  const k = tally((i) => i.type === ty && i.action === "keep");
  console.log(`    ${ty.padEnd(9)} redact:${r}  keep:${k}`);
}
console.log("  by whose identifier:");
for (const sc of ["patient", "family", "guarantor", "subscriber"] as Scope[])
  console.log(`    ${sc.padEnd(11)} ${tally((i) => i.scope === sc)}`);
console.log(`  DEFAULT: ${tally((i) => i.action === "redact")} values queued to REDACT, ${tally((i) => i.action === "keep")} to KEEP (patient name + city/ZIP).`);
