#!/usr/bin/env bun
/**
 * assemble-viewmodel.ts — merge the hand-abstracted + projected part files in
 * deep-dives/coverage-billing/parts/*.json into the ONE view model the app reads:
 *
 *   deep-dives/coverage-billing/viewmodel.json =
 *     { summary, sections, evidence, coverage, moneyflow, claims, carc, denial, hb, correspondence }
 *
 * The app imports ONLY this file, so every value must already be display-clean (formatted dates,
 * clean service labels, plain CARC words, no raw column names / locator ids / midnight timestamps;
 * ids/src only as side fields). This script splices the parts, drops the editorial `_meta` blocks,
 * and validates that every referenced evidenceId resolves in `evidence`.
 *
 * Run:  bun deep-dives/coverage-billing/scripts/assemble-viewmodel.ts
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const PARTS = join(ROOT, "parts");
const OUT = join(ROOT, "viewmodel.json");

const load = (name: string): any => JSON.parse(readFileSync(join(PARTS, name), "utf8"));
const stripMeta = (o: any): any => {
  if (!o || typeof o !== "object" || Array.isArray(o)) return o;
  const { _meta, ...rest } = o;
  return rest;
};

// ---- prose spine ----
const sections = load("sections.json");

// ---- evidence map ----
const evidence = stripMeta(load("evidence.json"));

// ---- structured slots ----
const coverage = stripMeta(load("coverage.json"));
const moneyflow = stripMeta(load("moneyflow.json"));
const claims = stripMeta(load("claims.json"));
const carc = stripMeta(load("carc.json"));
const denial = stripMeta(load("denial.json"));
const hb = stripMeta(load("hb.json"));
const correspondence = stripMeta(load("correspondence.json"));

const viewmodel = {
  summary: sections.summary,
  sections: sections.sections,
  evidence,
  coverage,
  moneyflow,
  claims,
  carc,
  denial,
  hb,
  correspondence,
};

// ---- sanity: every referenced evidenceId resolves ----
const referenced = new Set<string>();
const collect = (o: any) => {
  if (!o || typeof o !== "object") return;
  if (Array.isArray(o)) { o.forEach(collect); return; }
  for (const [k, v] of Object.entries(o)) {
    if (k === "cites" && Array.isArray(v)) v.forEach((id) => referenced.add(String(id)));
    else if ((k === "evidenceId" || k === "readEvidenceId") && typeof v === "string") referenced.add(v);
    else collect(v);
  }
};
collect(viewmodel.sections);
collect(moneyflow); collect(claims); collect(carc); collect(denial); collect(hb); collect(coverage); collect(correspondence);
const missing = [...referenced].filter((id) => !(id in evidence));
const unused = Object.keys(evidence).filter((id) => !referenced.has(id));

writeFileSync(OUT, JSON.stringify(viewmodel, null, 2) + "\n");

console.log("wrote", OUT);
console.log("  summary:", viewmodel.summary.length, "chars");
console.log("  sections:", viewmodel.sections.length);
console.log("  evidence ids:", Object.keys(evidence).length);
console.log("  claims:", claims.rows.length, "| carc reasons:", carc.writeoff.rows.length + carc.patient.rows.length, "| denial steps:", denial.steps.length,
  "| hb charges:", hb.charges.length, "| correspondence events:", correspondence.events.length);
console.log("  referenced evidenceIds:", referenced.size, "| unresolved:", missing.length, missing.length ? missing : "(all resolve)");
if (unused.length) console.log("  unused evidence:", unused);
if (missing.length) process.exit(1);
