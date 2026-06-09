#!/usr/bin/env bun
//
// 04-redact.ts — DESTRUCTIVE: build raw/ from raw.unredacted/ by fuzzy-redacting every approved term and
// OMITTING media. Run only AFTER reviewing .redaction-terms.json.
//
//   bun skills/import-ehi/scripts/04-redact.ts [--src raw.unredacted --out raw]
//
// Matching: the fuzzy regex (adopted from the prior project) — strip whitespace from the term, then allow a
// short run of punctuation/space between each character, so "012 33 4456" also catches "012-33-4456" /
// "01233-4456". Gap is capped and restricted to punctuation/space (won't jump across letters/digits), which
// is safer than matching across arbitrary chars. Each distinct value maps to a STABLE typed placeholder
// ([REDACTED-PHONE-1], …) so the same value reads the same everywhere (referential integrity preserved).
//
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync } from "node:fs";
import { join, relative, dirname, extname } from "node:path";
import { matcherFor } from "./redact-lib.ts";

const args = process.argv.slice(2);
const SRC = (args[args.indexOf("--src") + 1] && args.includes("--src")) ? args[args.indexOf("--src") + 1] : "raw.unredacted";
const OUT = (args[args.indexOf("--out") + 1] && args.includes("--out")) ? args[args.indexOf("--out") + 1] : "raw";

// ALLOWLIST: emit ONLY the text types we know how to check AND do check (05-verify scans this same set).
// Everything else is omitted; an UNKNOWN (non-media) type is omitted *and warned* so a new export's
// unscannable file type can't silently reach the committable raw/.
const ALLOW = new Set([".tsv", ".htm", ".html", ".rtf", ".css"]);
const MEDIA = new Set([".pdf", ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".gif"]);

const terms = JSON.parse(readFileSync(".redaction-terms.json", "utf8"));
const redact: { value: string; type: string; match?: string[] }[] = terms.redact ?? [];
if (!redact.length) { console.error("no redact terms in .redaction-terms.json — run 02/03 first"); process.exit(1); }

// Every match-VARIANT of a term gets a fuzzy regex but maps to the SAME stable token (one token per
// identifier → referential integrity). Match longest patterns first (full name before standalone first name).
const counters: Record<string, number> = {};
const compiled: { re: RegExp; token: string; type: string }[] = [];
for (const r of redact) {
  const ty = (r.type || "x").toUpperCase();
  counters[ty] = (counters[ty] ?? 0) + 1;
  const token = `[REDACTED-${ty}-${counters[ty]}]`;
  for (const m of (r.match?.length ? r.match : [r.value])) {
    if (String(m).replace(/\s+/g, "").length < 3) continue;
    compiled.push({ re: matcherFor(m, r.type), token, type: r.type });
  }
}
compiled.sort((a, b) => b.re.source.length - a.re.source.length);

const hits: Record<string, number> = {};
function redactText(s: string): string {
  for (const { re, token, type } of compiled) {
    s = s.replace(re, () => { hits[type] = (hits[type] ?? 0) + 1; return token; });
  }
  return s;
}

let textFiles = 0, mediaOmitted = 0;
const omitted: string[] = [];
const unknownTypes = new Map<string, number>();
function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    const ext = extname(name).toLowerCase();
    const rel = relative(SRC, p);
    if (ALLOW.has(ext)) {                                                      // emit only known-checkable types
      const dest = join(OUT, rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, redactText(readFileSync(p, "utf8")));                // redact + copy
      textFiles++;
    } else if (MEDIA.has(ext)) { mediaOmitted++; omitted.push(rel); }          // expected omit
    else { unknownTypes.set(ext, (unknownTypes.get(ext) ?? 0) + 1); omitted.push(rel + " (UNKNOWN TYPE — no checker)"); }
  }
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
walk(SRC);
mkdirSync(join(OUT, "_redaction"), { recursive: true });
writeFileSync(join(OUT, "_redaction", "omitted-files.txt"), omitted.sort().join("\n") + "\n");

console.log(`redacted ${SRC}/ → ${OUT}/   (allowlist: ${[...ALLOW].join(" ")})`);
console.log(`  text files redacted: ${textFiles}`);
console.log(`  media omitted: ${mediaOmitted}   (listed in ${OUT}/_redaction/omitted-files.txt)`);
console.log(`  redaction terms applied: ${compiled.length}`);
console.log(`  replacements by type: ${JSON.stringify(hits)}`);
if (unknownTypes.size) {
  console.log(`\n  ⚠ OMITTED ${[...unknownTypes.values()].reduce((a, b) => a + b, 0)} files of UNKNOWN type(s) ${[...unknownTypes.keys()].join(", ")}`);
  console.log(`    — there is no checker for these, so they were dropped. Confirm nothing important, or add a checker before relying on this.`);
}
console.log(`\n  → now PROVE it: bun skills/import-ehi/scripts/05-verify.ts`);
