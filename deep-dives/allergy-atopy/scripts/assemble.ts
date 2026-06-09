#!/usr/bin/env bun
/**
 * assemble.ts — merge the hand-written narrative+evidence (parts/narrative.json)
 * and the projected structured slots (parts/slots.json) into the one
 * deep-dives/allergy-atopy/viewmodel.json the app imports.
 *
 * Also validates: every narrative `cites` id resolves to an evidence key, and every
 * slot `evidenceId` resolves too. Fails loudly on a dangling reference.
 *
 *   bun deep-dives/allergy-atopy/scripts/project.ts && bun deep-dives/allergy-atopy/scripts/assemble.ts
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const DIR = resolve(import.meta.dir, "..");
const narrative = JSON.parse(readFileSync(resolve(DIR, "parts/narrative.json"), "utf8"));
const slots = JSON.parse(readFileSync(resolve(DIR, "parts/slots.json"), "utf8"));

const vm = {
  meta: {
    patient: "MANDEL, JOSHUA C (Z7004242)",
    topic: "allergy-atopy",
    view: "An allergist understanding this atopic profile — what component-resolved IgE testing added over a plain allergy list.",
    source: "Projected from the verified substrate + db/ehi.sqlite; IgE/SPT values are from the allergist's overview notes (no structured IgE result rows exist).",
  },
  summary: narrative.summary,
  sections: narrative.sections,
  evidence: narrative.evidence,
  // structured, display-ready slots
  allergies: slots.allergies,
  peanutGenesis: slots.peanutGenesis,
  igeComponents: slots.igeComponents,
  problems: slots.problems,
  meds: slots.meds,
  spt: slots.spt,
  referral: slots.referral,
  timeline: slots.timeline,
};

// ---- validate references ----
const evKeys = new Set(Object.keys(vm.evidence));
const errors: string[] = [];

for (const s of vm.sections) {
  for (const n of s.narrative) {
    for (const c of n.cites ?? []) {
      if (!evKeys.has(c)) errors.push(`section ${s.id}: cite "${c}" not in evidence`);
    }
  }
}
// slot evidenceIds (single + nested)
const checkEv = (id: string | undefined, where: string) => {
  if (id && !evKeys.has(id)) errors.push(`${where}: evidenceId "${id}" not in evidence`);
};
checkEv(vm.igeComponents.evidenceId, "igeComponents");
checkEv(vm.spt.evidenceId, "spt");
checkEv(vm.referral.evidenceId, "referral");
for (const p of vm.problems) checkEv(p.evidenceId, `problem ${p.diagnosis}`);
for (const m of vm.meds) checkEv(m.evidenceId, `med ${m.name}`);
for (const t of vm.timeline) checkEv(t.evidenceId, `timeline ${t.date}`);

if (errors.length) {
  console.error("VALIDATION FAILED:");
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}

writeFileSync(resolve(DIR, "viewmodel.json"), JSON.stringify(vm, null, 2));
console.log("wrote viewmodel.json");
console.log("  sections:", vm.sections.length);
console.log("  evidence:", evKeys.size);
console.log("  slots:", Object.keys(vm).filter((k) => !["meta", "summary", "sections", "evidence"].includes(k)).join(", "));
