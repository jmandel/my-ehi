#!/usr/bin/env bun
/**
 * validate-extract.ts — check an abstraction artifact for clean projection + traceability + PHI hygiene.
 *
 * Run it before you publish a deep dive — on the built VIEW MODEL especially:
 *   bun lib/validate-extract.ts deep-dives/<topic>/viewmodel.json
 *
 * Modes (auto-detected):
 *   VIEW MODEL — `deep-dives/<topic>/viewmodel.json` (has `sections` + `evidence`): the app's clean data.
 *               Checks: no RAW-CLARITY TELLS in display content (raw `12:00:00 AM` timestamps, `*_C_NAME`
 *               category columns, `(BRAND,BRAND)` alias dumps, `TABLE:COL=id` locators surfaced as values);
 *               every narrative cite resolves in `evidence`; no direct PHI.
 *   DATASET    — `parts/<entity>.json` / dataset.json (entity arrays): every row carries a `src`; counts.
 *   ANALYSIS   — findings[] / narrative[] + sources/cites: cites resolve; counts.
 * Raw-tell + PHI scans run in EVERY mode. Pass a dataset.json as arg 2 when an analysis cites dataset locators.
 */
const path = process.argv[2];
if (!path) { console.error("usage: bun lib/validate-extract.ts <viewmodel.json|artifact.json> [dataset.json]"); process.exit(2); }
const art = JSON.parse(await Bun.file(path).text());
const ds = process.argv[3] ? JSON.parse(await Bun.file(process.argv[3]).text()) : null;

const problems: string[] = [];
const warn: string[] = [];

// --- PHI scan (direct patient identifiers; the opaque Epic PAT_ID surrogate Z####### is NOT one) ---
function phiScan(obj: any) {
  const blob = JSON.stringify(obj);
  const phi: [RegExp, string][] = [
    [/\b\d{3}-\d{2}-\d{4}\b/, "SSN"],
    [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, "email"],
    [/\b\d{3}-\d{3}-\d{4}\b/, "phone"],
    [/\bAPL\d{6}\b/, "MRN (APL…)"],
  ];
  for (const [re, label] of phi) if (re.test(blob)) problems.push(`possible ${label} present`);
  if (/\b\d{1,5}\s+[A-Z][a-z]+\s+(St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Ct|Way)\b/.test(blob))
    warn.push("a street address appears — confirm it's a facility (lab/clinic), not the patient's");
}

// --- raw-tell scan (clean projection): did raw Clarity leak into a DISPLAY value? ---------------------
// Skips provenance/side-fields, where raw tokens legitimately live (src, locators, ids, table names, _meta).
const SIDE_FIELD = /^(src|locator|locators|sourcetable|sourcetables|sourceids|table|tables|provenance|basis|note|generatedby|generated_by|built_by|computed_by|_meta|meta|key|id)$|(_id|ids|_real)$/i;
const RAW_TELLS: [RegExp, string][] = [
  [/\b\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2}\s*[AP]M\b/, "raw Epic timestamp (M/D/YYYY h:mm:ss AM)"],
  [/\b\d{1,2}:\d{2}:\d{2}\s*[AP]M\b/, "raw clock time (e.g. 12:00:00 AM midnight)"],
  [/\b[A-Z][A-Z0-9]*_C_NAME\b/, "raw _C_NAME category column surfaced as a value"],
  [/\([A-Z][A-Z]{2,}\s*,\s*[A-Z]/, "raw brand-alias dump, e.g. (PRINIVIL,ZESTRIL)"],
  [/\b[A-Z_]{3,}:[A-Za-z_]+=\d/, "raw SQL locator string (TABLE:COL=id)"],
  [/\b[A-Z][A-Z0-9]{2,}_(YN|CSN|DATE_REAL)\b/, "raw column-name token surfaced as a value"],
];
const tells = new Map<string, { count: number; sample: string; where: string }>();
function rawTellScan(obj: any, p = "") {
  if (obj == null) return;
  if (typeof obj === "string") {
    for (const [re, label] of RAW_TELLS) if (re.test(obj)) {
      const e = tells.get(label) ?? { count: 0, sample: obj.slice(0, 60), where: p || "(root)" };
      e.count++; tells.set(label, e); break;
    }
    return;
  }
  if (Array.isArray(obj)) { obj.forEach((v, i) => rawTellScan(v, `${p}[${i}]`)); return; }
  if (typeof obj === "object") for (const [k, v] of Object.entries(obj)) {
    if (SIDE_FIELD.test(k)) continue;            // provenance/side-field — raw tokens allowed here
    rawTellScan(v, p ? `${p}.${k}` : k);
  }
}

const isEntityArrays = (o: any) =>
  o && typeof o === "object" && !Array.isArray(o) &&
  Object.entries(o).some(([k, v]) => k !== "meta" && Array.isArray(v) && (v as any[]).length > 0 && typeof (v as any[])[0] === "object");
const looksLikeAnalysis = (o: any) => o && (Array.isArray(o.findings) || Array.isArray(o.narrative));
const looksLikeViewModel = (o: any) => o && Array.isArray(o.sections) && o.evidence && typeof o.evidence === "object";

if (looksLikeViewModel(art)) {
  // ---- VIEW-MODEL MODE: clean projection + cite resolution ----
  const evidence = new Set(Object.keys(art.evidence));
  let cited = 0, unresolved = 0;
  const walkCites = (o: any) => {
    if (Array.isArray(o)) o.forEach(walkCites);
    else if (o && typeof o === "object") {
      for (const [k, v] of Object.entries(o)) {
        if ((k === "cites" || k === "cite" || k === "ids" || k === "evidenceId") && (Array.isArray(v) || typeof v === "string"))
          for (const c of ([] as any[]).concat(v)) { cited++; if (!evidence.has(String(c))) { unresolved++; problems.push(`cite does not resolve in evidence: "${c}"`); } }
        else walkCites(v);
      }
    }
  };
  walkCites(art.sections);
  console.log(`${path}: VIEW MODEL — ${art.sections.length} sections, ${evidence.size} evidence ids, ${cited} cites (${unresolved} unresolved)`);
} else if (looksLikeAnalysis(art)) {
  // ---- ANALYSIS MODE ----
  const sourceKeys = new Set(Object.keys(art.sources ?? {}));
  const dsEntities = new Set(ds ? Object.keys(ds) : Object.keys((art.data && typeof art.data === "object") ? art.data : {}));
  const isInline = (s: string) => /[:/].*=/.test(s) || /^[A-Z_]+:/.test(s) || /^\w+\[/.test(s) || s.startsWith("note:") || s.startsWith("entity_extras.");
  const resolves = (id: string) => {
    const full = id.split("#")[0].split("[")[0].split(":")[0].split(".")[0];
    const lead = (id.match(/^[A-Za-z_]\w*/)?.[0]) ?? full;
    return sourceKeys.has(id) || sourceKeys.has(full) || dsEntities.has(full) || dsEntities.has(lead) || isInline(id);
  };
  [...(art.findings ?? []), ...(art.narrative ?? [])].forEach((it: any, i: number) => {
    const cs = it?.cites ?? it?.cite;
    if (Array.isArray(cs)) { if (!cs.length) warn.push(`item ${i} has empty cites`); for (const c of cs) if (!resolves(String(c))) problems.push(`item ${i} cite does not resolve: "${c}"`); }
    else warn.push(`item ${i} (${it?.id ?? "?"}) carries no cites array`);
  });
  console.log(`${path}: ANALYSIS — ${art.findings?.length ?? 0} findings, ${art.narrative?.length ?? 0} narrative, ${sourceKeys.size} sources`);
} else if (isEntityArrays(art)) {
  // ---- DATASET MODE ----
  let totalRows = 0, missingSrc = 0;
  const counts: Record<string, number> = {};
  for (const [entity, rows] of Object.entries(art)) {
    if (entity === "meta" || !Array.isArray(rows)) continue;
    counts[entity] = (rows as any[]).length;
    for (const r of rows as any[]) { totalRows++; if (r && typeof r === "object" && !("src" in r) && !(r.rows)) missingSrc++; }
  }
  if (missingSrc > 0) problems.push(`${missingSrc} rows missing a 'src' field`);
  console.log(`${path}: DATASET — ${Object.keys(counts).length} entities, ${totalRows} rows ${JSON.stringify(counts)}`);
} else {
  warn.push("artifact is neither a view model, dataset, nor analysis; scanning for tells + PHI only");
}

// raw-tell + PHI scans run in every mode. Raw tells are PROBLEMS (they fail the publish gate):
// the projection must be clean, so a Clarity string in display content is a build error, not a note.
rawTellScan(art);
phiScan(art);
for (const [label, e] of tells) problems.push(`raw tell ×${e.count} — ${label} (e.g. ${e.where}: "${e.sample}")`);

if (warn.length) { console.log(`  ${warn.length} warnings:`); warn.slice(0, 20).forEach((w) => console.log("   - " + w)); }
if (problems.length) { console.log(`  ${problems.length} PROBLEMS:`); problems.forEach((p) => console.log("   ! " + p)); process.exit(1); }
console.log("  OK — checks pass.");
