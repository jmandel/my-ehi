#!/usr/bin/env bun
/**
 * assemble.ts — merge the per-entity dataset parts into one keyed dataset.json.
 *
 *   bun deep-dives/cardiac-risk/scripts/assemble.ts
 *
 * Reads deep-dives/cardiac-risk/parts/<entity>.json (each {rows|... , meta}) and writes
 * deep-dives/cardiac-risk/dataset.json as a single object keyed by entity:
 *   { vitals:[...], labs:[...], medications:[...], risk_factors:[...],
 *     encounters_dx:[...], acute_event:[...], meta:{...} }
 *
 * Every row and its `src` is preserved verbatim — curation lives in analysis.json, never here.
 * A few parts carry side tables beyond `rows` (encounters_dx.dx_rows / .htn_coding); those are
 * preserved under meta.entity_extras so nothing is thrown away.
 */
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

const HERE = dirname(new URL(import.meta.url).pathname);
const TOPIC_DIR = join(HERE, "..");
const PARTS = join(TOPIC_DIR, "parts");

const ENTITIES = [
  "vitals",
  "labs",
  "medications",
  "risk_factors",
  "encounters_dx",
  "acute_event",
] as const;

const out: Record<string, any> = {};
const partMeta: Record<string, any> = {};
const entityExtras: Record<string, any> = {};
const rowCounts: Record<string, number> = {};

for (const e of ENTITIES) {
  const part = JSON.parse(readFileSync(join(PARTS, `${e}.json`), "utf8"));
  // The canonical row array for every part is `rows`.
  const rows = Array.isArray(part.rows) ? part.rows : [];
  out[e] = rows;
  rowCounts[e] = rows.length;
  if (part.meta) partMeta[e] = part.meta;
  // Preserve any non-`rows`/non-`meta` top-level keys (e.g. encounters_dx.dx_rows, .htn_coding)
  // so the complete part is recoverable from dataset.json alone.
  const extras: Record<string, any> = {};
  for (const [k, v] of Object.entries(part)) {
    if (k === "rows" || k === "meta") continue;
    extras[k] = v;
  }
  if (Object.keys(extras).length) entityExtras[e] = extras;
}

out.meta = {
  topic: "cardiac-risk",
  patient: { name: "MANDEL, JOSHUA C", sex: "Male", dob: "1982-10-26", pat_id: "Z7004242" },
  generated: new Date().toISOString(),
  assembled_by: "deep-dives/cardiac-risk/scripts/assemble.ts",
  export_ref_date: "2026-06-07",
  layer: "DATASET — complete & traceable. Every row carries `src`. Curation lives in analysis.json.",
  entities: ENTITIES,
  row_counts: rowCounts,
  total_rows: Object.values(rowCounts).reduce((a, b) => a + b, 0),
  // The full per-entity meta from each part (source tables, gotchas, completeness evidence).
  entity_meta: partMeta,
  // Side tables a part emitted beyond `rows` (kept so the part is fully recoverable).
  entity_extras: entityExtras,
};

const DEST = join(TOPIC_DIR, "dataset.json");
writeFileSync(DEST, JSON.stringify(out, null, 2));
console.log(`wrote ${DEST}`);
console.log(`row counts: ${JSON.stringify(rowCounts)} (total ${out.meta.total_rows})`);
console.log(`entity_extras keys: ${JSON.stringify(Object.fromEntries(Object.entries(entityExtras).map(([k, v]) => [k, Object.keys(v as object)])))}`);
