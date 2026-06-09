#!/usr/bin/env bun
/**
 * clean-prose.ts — UPSTREAM projection fix for the human-readable prose the deep dive renders.
 *
 * The synthesize step wrote the analysis (and one dataset meta determination) for an internal reader:
 * the prose carried raw Clarity column names (AGE_OF_ONSET, FAMILY_HX, DX_ID, PROBLEM_LIST,
 * ORDER_NARRATIVE, ORDER_RESULTS), internal finding/section cross-refs (F1, F10, F16, synthesis.ascvd),
 * and skill-internal refs (labs-guide gotcha #N). The app renders this prose VERBATIM, so those tokens
 * were reaching the screen — a projection gap. Per the deep-dives rule we fix the DATA, not the view:
 * this rewrites the rendered prose fields in place so they read like a clinician's note, then the app
 * can drop its humanizeProse() scrubber.
 *
 * Idempotent: the replacements are no-ops once applied. Run: bun scripts/clean-prose.ts
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const DIR = join(import.meta.dir, "..");
const A_PATH = join(DIR, "analysis.json");
const D_PATH = join(DIR, "dataset.json");

// Each rule turns one raw token into the human concept it denotes — meaning preserved, plumbing dropped.
function humanize(s: string): string {
  return String(s)
    // Clarity column / table names -> the concept they encode
    .replace(/\bAGE_OF_ONSET is NULL for every FAMILY_HX row\b/g, "the age of onset is not recorded for any family-history entry")
    .replace(/\bAGE_OF_ONSET is null in FAMILY_HX\b/g, "the age of onset is blank for every family-history entry")
    .replace(/\bAGE_OF_ONSET is NULL\b/g, "the age of onset is not recorded")
    .replace(/—\s*AGE_OF_ONSET is NULL for every family-history row\b/g, "— the age of onset is not recorded for any of them")
    .replace(/\bFAMILY_HX\b/g, "family-history")
    .replace(/,\s*DX_ID\s+\d+\b/g, "")
    .replace(/\s*\(DX_ID\s+\d+\)\s*/g, " ")
    .replace(/\bfor HTN DX_IDs?\b/gi, "for hypertension")
    .replace(/\bDX_LINK_PROB_ID\b/g, "link to a problem-list entry")
    .replace(/\bthe structured PROBLEM_LIST\b/g, "the structured problem list")
    .replace(/\bPROBLEM_LIST_HX\b/g, "problem-list history")
    .replace(/\bPROBLEM_LIST\b/g, "problem list")
    .replace(/\bORDER_NARRATIVE\b/g, "the radiology narrative")
    .replace(/\bORDER_RESULTS\b/g, "discrete-result")
    .replace(/\bSOCIAL_HX\b/g, "social-history")
    .replace(/\(COMPONENT_COMMENT\s+('[^']*')\)/g, "lab comment: $1")
    .replace(/\bCOMPONENT_COMMENT\b/g, "lab comment")
    // internal section pointer -> plain phrase
    .replace(/,\s*synthesis\.ascvd\)/g, ")")
    .replace(/\s*\(synthesis\.ascvd(?:\.caveats)?(?:,\s*F\d+)?\)/g, "")
    .replace(/\band stated in synthesis\.ascvd\.caveats\b/g, "and stated in the caveats below")
    .replace(/\bThe full input\/estimate\/caveat object is in synthesis\.ascvd\./g, "Every input, the estimate, and the caveats are shown in the ASCVD section.")
    // internal finding cross-refs -> drop the tag, keep the sentence
    .replace(/\s*\(F1,\s*HTN off the problem list\)/g, " (hypertension off the problem list)")
    .replace(/\bthe undercoding \(F1\) is the mechanism\b/g, "the undercoding is the mechanism")
    .replace(/quantified in F16\b/g, "quantified in the fasting-redraw scenario")
    .replace(/lands him ~1\.5-2\.0% \(F16\)/g, "lands him ~1.5-2.0%")
    .replace(/'upper 130s' \(F11\/F14\)/g, "'upper 130s'")
    .replace(/\bthe 'Age of Onset' column is blank in every annual note \(F18\)\b/g, "the age of onset is blank in every annual note")
    .replace(/\s*\(F18\)/g, "")
    .replace(/\s*,\s*F10\)/g, ")")
    .replace(/\bcomputed \(synthesis\.ascvd, F10\)\b/g, "computed")
    // skill-internal refs
    .replace(/\s*\(labs-guide gotcha #?\d+\)/gi, "")
    .replace(/\s*\(gotcha #?\d+\)/gi, "")
    .replace(/,\s*gotcha #?\d+\)/gi, ")")
    .replace(/\s*gotcha #?\d+\b/gi, "")
    .replace(/\bZERO ([A-Za-z-]+) rows\b/g, "no $1 rows")
    .replace(/\bZERO\b/g, "no")
    // tidy artifacts left by the removals
    .replace(/\s*\(CSN\s+\d+\)/g, "")
    .replace(/\band its lab contact \(\d+\)/g, "and its same-day lab contact")
    .replace(/\?\s+([a-z])/g, (_m, c) => "? " + c.toUpperCase())   // re-capitalize after a question we split a clause from
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;)])/g, "$1")
    .replace(/\(\s+/g, "(")
    .trim();
}

// also handle the dataset meta determination (rendered in the HTN visibility panel)
function humanizeDet(s: string): string {
  return humanize(
    String(s)
      .replace(/\(0 rows in problem list and problem-list history for HTN DX_IDs\)/g, "(absent from the problem list and its history)")
      .replace(/\(0 rows in PROBLEM_LIST and PROBLEM_LIST_HX for HTN DX_IDs\)/g, "(absent from the problem list and its history)")
      .replace(/neither encounter-dx row carries a DX_LINK_PROB_ID/g, "neither encounter-diagnosis row is linked to a problem-list entry")
  );
}

// ---- analysis.json -------------------------------------------------------------------------------
const a = JSON.parse(readFileSync(A_PATH, "utf8"));
a.argument = humanize(a.argument);
a.open_questions = a.open_questions.map(humanize);
a.limits = a.limits.map(humanize);
for (const f of a.findings ?? []) if (f.significance) f.significance = humanize(f.significance);
if (a.synthesis?.ascvd?.caveats) a.synthesis.ascvd.caveats = a.synthesis.ascvd.caveats.map(humanize);
writeFileSync(A_PATH, JSON.stringify(a, null, 2) + "\n");

// ---- dataset.json (one rendered meta field) ------------------------------------------------------
const d = JSON.parse(readFileSync(D_PATH, "utf8"));
const coding = d?.meta?.entity_extras?.encounters_dx?.htn_coding;
if (coding?.determination) coding.determination = humanizeDet(coding.determination);
writeFileSync(D_PATH, JSON.stringify(d, null, 2) + "\n");

// ---- verify no known raw tokens remain in the rendered fields ------------------------------------
// Generic Clarity-column shape (UPPER_SNAKE) + the specific internal cross-refs and skill refs.
const RAW = /\b[A-Z]{2,}_[A-Z_]{2,}\b|synthesis\.ascvd|\bgotcha\b|labs-guide|\bZERO\b|\(F\d+|\b\d{1,2}:\d{2}:\d{2}\s*[AP]M\b/;
const checks: [string, string][] = [
  ["argument", a.argument],
  ...a.open_questions.map((q: string, i: number) => [`open_q[${i}]`, q] as [string, string]),
  ...a.limits.map((l: string, i: number) => [`limit[${i}]`, l] as [string, string]),
  ...(a.findings ?? []).map((f: any) => [`finding ${f.id}`, f.significance ?? ""] as [string, string]),
  ...((a.synthesis?.ascvd?.caveats ?? []).map((c: string, i: number) => [`caveat[${i}]`, c] as [string, string])),
  ["htn determination", coding?.determination ?? ""],
];
let bad = 0;
for (const [name, text] of checks) {
  const m = String(text).match(RAW);
  if (m) { console.log(`STILL RAW [${name}]: ${m[0]} -> …${String(text).slice(Math.max(0, (m.index ?? 0) - 30), (m.index ?? 0) + 40)}…`); bad++; }
}
console.log(bad === 0 ? "clean: no known raw tokens remain in rendered prose" : `${bad} field(s) still carry a raw token`);
