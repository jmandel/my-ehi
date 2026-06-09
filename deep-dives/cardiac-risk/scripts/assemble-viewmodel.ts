/**
 * assemble-viewmodel.ts — merge the hand-abstracted + projected part files in
 * deep-dives/cardiac-risk/parts/*.json into the ONE view model the deep-dive app reads:
 *
 *   deep-dives/cardiac-risk/viewmodel.json = { summary, sections, evidence, bp, metabolic, lipids, ascvd, family, htn, acute }
 *
 * The app imports ONLY this file, so every value in it must already be display-clean (dates
 * "Aug 29, 2022", drugs "lisinopril 10 mg", plain words for status/flags, no raw column names,
 * no locator ids, no enc_csn/date_real/src as content). This script does NOT invent content —
 * it only splices the parts together, drops the editorial `_meta` blocks, and unifies the two
 * evidence maps (evidence.json + evidence-ascvd.json) into one `evidence` object keyed by id.
 *
 * Run:  bun deep-dives/cardiac-risk/scripts/assemble-viewmodel.ts
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";

const ROOT = join(import.meta.dir, "..");                 // deep-dives/cardiac-risk
const PARTS = join(ROOT, "parts");
const OUT = join(ROOT, "viewmodel.json");

function load(name: string): any {
  return JSON.parse(readFileSync(join(PARTS, name), "utf8"));
}
// strip the editorial `_meta` / `meta` description blocks that document the part but are not view content
function stripMeta(o: any): any {
  if (!o || typeof o !== "object" || Array.isArray(o)) return o;
  const { _meta, ...rest } = o;
  return rest;
}

// ---- prose spine (summary + sections) ----
const sections = load("sections.json");

// ---- evidence map: unify the two evidence files into one id -> entry object ----
const evMain = stripMeta(load("evidence.json"));
const evAscvd = stripMeta(load("evidence-ascvd.json"));
const evidence: Record<string, any> = { ...evMain, ...evAscvd };

// ---- structured slots ----
const bp = load("bp.json");                  // { readings, meanSys, n, nStage1Plus }
const metabolic = load("metabolic.json");    // { weight, a1c, cgm }
const lipids = stripMeta(load("lipids.json"));// { panels, trend }
const ascvd = stripMeta(load("ascvd.json"));  // { low, high, bands, inputs, trajectory, sensitivities, cross_check, caveats, interpretation, ... }
const familyRaw = load("family.json");        // { members, conditions, meta }
const htn = stripMeta(load("htn.json"));      // { coding, scorecard, timeline, boilerplateVsVitals }
const acute = load("acute.json");             // [ event, event ] (array)

// family: keep members + conditions + the figures from meta the view uses, drop provenance plumbing
const family = {
  members: familyRaw.members,
  conditions: familyRaw.conditions,
  generations: familyRaw.meta?.generations,
  totalFacts: familyRaw.meta?.total_family_facts,
  totalCvFacts: familyRaw.meta?.total_cv_facts,
  bilateral: familyRaw.meta?.bilateral,
  onsetCaveat: familyRaw.meta?.onset_caveat,
};

const viewmodel = {
  summary: sections.summary,
  sections: sections.sections,
  evidence,
  bp,
  metabolic,
  lipids,
  ascvd,
  family,
  htn,
  acute,
};

// ---- sanity: every evidenceId referenced by the slots must resolve in `evidence` ----
const referenced = new Set<string>();
const collect = (o: any) => {
  if (!o || typeof o !== "object") return;
  if (Array.isArray(o)) { o.forEach(collect); return; }
  for (const [k, v] of Object.entries(o)) {
    if ((k === "cites") && Array.isArray(v)) v.forEach((id) => referenced.add(String(id)));
    else if ((k === "evidenceId" || k === "readEvidenceId" || k === "unreconciledEvidenceId" || k === "pcpSilentEvidenceId") && typeof v === "string") referenced.add(v);
    else collect(v);
  }
};
collect(sections.sections);
collect(bp); collect(lipids); collect(ascvd); collect(htn); collect(acute);
const missing = [...referenced].filter((id) => !(id in evidence));

writeFileSync(OUT, JSON.stringify(viewmodel, null, 2) + "\n");

console.log("wrote", OUT);
console.log("  summary:", viewmodel.summary.length, "chars");
console.log("  sections:", viewmodel.sections.length);
console.log("  evidence ids:", Object.keys(evidence).length, "(", Object.keys(evMain).length, "main +", Object.keys(evAscvd).length, "ascvd )");
console.log("  bp.readings:", bp.readings.length, "| lipids.panels:", lipids.panels.length, "| ascvd.inputs:", ascvd.inputs.length,
  "| family.members:", family.members.length, "| htn.timeline:", htn.timeline.length, "| acute events:", acute.length,
  "| metabolic.weight:", metabolic.weight.length);
console.log("  referenced evidenceIds:", referenced.size, "| unresolved:", missing.length, missing.length ? missing : "(all resolve)");
if (missing.length) process.exit(1);
