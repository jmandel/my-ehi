#!/usr/bin/env bun
//
// 05-verify.ts — the POSITIVE PROOF BY CONSTRUCTION. Re-scan the redacted raw/ for every redact term; the
// proof is 0 residual. RTF files are DECODED to plain text first, so a value that survived being split
// across RTF control words (and thus dodged the byte-level redactor) is still caught here. Also confirms the
// KEEP terms (patient's public name) survived. Exits 1 if anything leaked. Reports residuals by TERM INDEX +
// file, never the value.
//
//   bun skills/import-ehi/scripts/05-verify.ts [--out raw]
//
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { rtfToText } from "../../../lib/rtf2txt.ts";
import { matcherFor } from "./redact-lib.ts";

const args = process.argv.slice(2);
const OUT = (args.includes("--out")) ? args[args.indexOf("--out") + 1] : "raw";
const terms = JSON.parse(readFileSync(".redaction-terms.json", "utf8"));
const redact: { value: string; type: string; match?: string[] }[] = terms.redact ?? [];
const keep: string[] = terms.keep ?? [];

// one regex per match-VARIANT, tagged with its term index (so a leak is reported by term, not by value).
const compiled: { i: number; type: string; re: RegExp }[] = [];
redact.forEach((r, i) => {
  for (const m of (r.match?.length ? r.match : [r.value]))
    if (String(m).replace(/\s+/g, "").length >= 3) compiled.push({ i, type: r.type, re: matcherFor(m, r.type) });
});
const keepRe = keep.filter((k) => k.length >= 3).map((k) => ({ k, re: matcherFor(k, "name") }));

const ALLOW = new Set([".tsv", ".htm", ".html", ".rtf", ".css"]);   // same allowlist 04-redact emits
const leaks: { term: number; type: string; file: string; n: number }[] = [];
const keepSeen = new Set<string>();
let scanned = 0, rtfDecoded = 0;

function scanText(text: string, file: string) {
  for (const { i, type, re } of compiled) {
    const m = text.match(re);
    if (m) leaks.push({ term: i, type, file, n: m.length });
  }
  for (const { k, re } of keepRe) if (re.test(text)) keepSeen.add(k);
}
function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!ALLOW.has(extname(name).toLowerCase())) continue;
    let text = readFileSync(p, "utf8");
    if (extname(name).toLowerCase() === ".rtf") { text = rtfToText(text); rtfDecoded++; }  // decode RTF → catch split survivors
    scanText(text, relative(OUT, p));
    scanned++;
  }
}
walk(OUT);

console.log(`verify ${OUT}/  —  ${scanned} text files scanned (${rtfDecoded} RTF decoded), ${compiled.length} redact terms`);
const keepMissing = keep.filter((k) => k.length >= 3 && !keepSeen.has(k));
if (keepMissing.length) console.log(`  ⚠ ${keepMissing.length} keep-terms not found anywhere — possible over-redaction (review): ${keepMissing.join(", ")}`);
else console.log(`  keep-terms present ✓ (patient's public name survived)`);

if (leaks.length === 0) {
  console.log(`\n  ✅ PROOF: 0 residual — every redact term is absent from every text + decoded-RTF file.`);
  process.exit(0);
} else {
  console.log(`\n  ❌ ${leaks.length} RESIDUAL LEAKS (redact term survived — fix and re-run 04/05):`);
  for (const l of leaks.slice(0, 40)) console.log(`   ! term #${l.term} (${l.type}) ×${l.n} in ${l.file}`);
  process.exit(1);
}
