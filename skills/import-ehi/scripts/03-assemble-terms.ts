#!/usr/bin/env bun
//
// 03-assemble-terms.ts — merge structured + agentic findings into ONE reviewable redaction-term list,
// with HYGIENE (drop generic/category values like "OTHER") and VARIANT EXPANSION (a name → first-last /
// last-first / components; a date → every common format). Each term carries the `match` strings that will
// actually be redacted, so the review is concrete.
//
// Output: .redaction-terms.json (gitignored) = { keep:[…], redact:[{value,type,relation,source,match:[…]}] }.
// HUMAN REVIEW CHECKPOINT — open it, curate keep-vs-redact, then run 04-redact.ts. Prints COUNTS ONLY.
//
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { junkReason, expandTerm } from "./redact-lib.ts";

const load = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : []);
const structured: any[] = load("redact/identifiers.json");
const agentic: any[] = load("redact/agentic-findings.json");

// KEEP-LIST = the patient's own name (public author), derived per-specimen (no hard-coded PHI in the skill).
const keep = new Set<string>();
for (const it of structured)
  if (it.type === "name" && it.scope === "patient" && it.action === "keep") {
    keep.add(it.value);
    for (const tok of String(it.value).split(/[\s,]+/)) if (tok.length >= 3) keep.add(tok);
  }
const isKeep = (v: string) => [...keep].some((k) => k.toLowerCase() === v.toLowerCase());
const isEmployerKeep = (relation: string) => /employer/i.test(relation || ""); // employer kept per project decision

const dropped: Record<string, number> = {};
const drop = (why: string) => { dropped[why] = (dropped[why] ?? 0) + 1; };

const redactMap = new Map<string, any>();
function add(value: string, type: string, relation: string, source: string) {
  const v = String(value ?? "").trim();
  const j = junkReason(v);
  if (j) return drop(j);
  if (isKeep(v)) return drop("on keep-list (patient name)");
  if (isEmployerKeep(relation)) return drop("employer (kept by decision)");
  const key = `${v.toLowerCase()}`;
  if (redactMap.has(key)) return;
  const match = [...new Set(expandTerm(v, type).filter((m) => !junkReason(m) && !isKeep(m)))];
  redactMap.set(key, { value: v, type, relation, source, match });
}
for (const it of structured) if (it.action === "redact") add(it.value, it.type, it.scope, it.from);
for (const it of agentic) add(it.value, it.type ?? "other", it.relation ?? "?", it.source ?? "note");

const redact = [...redactMap.values()];
const out = {
  _README: "REVIEW before 04-redact.ts. `match` lists the exact strings that will be fuzzy-redacted for each "
    + "term (names expanded to first-last/last-first/components; dates to all formats). Move false-positives "
    + "from `redact` to `keep`, prune any `match` you don't want, add anything missed. Then redact.",
  keep: [...keep],
  redact,
};
writeFileSync(".redaction-terms.json", JSON.stringify(out, null, 2));

const byType: Record<string, number> = {};
for (const r of redact) byType[r.type] = (byType[r.type] ?? 0) + 1;
const matchTotal = redact.reduce((s, r) => s + r.match.length, 0);
console.log(`assembled → .redaction-terms.json   (REVIEW CHECKPOINT)`);
console.log(`  keep terms: ${out.keep.length}   redact terms: ${redact.length}  ${JSON.stringify(byType)}`);
console.log(`  match strings after variant-expansion: ${matchTotal} (names → name orders + components; dates → all formats)`);
console.log(`  dropped during hygiene: ${JSON.stringify(dropped)}`);
console.log(`\n  → review .redaction-terms.json, then: bun skills/import-ehi/scripts/04-redact.ts`);
