#!/usr/bin/env bun
//
// 01-extract.ts — unzip the Epic EHI export into raw.unredacted/ (the full-PHI source, gitignored) and load
// it into a SQLite DB so the later steps can read structured columns. The redaction pipeline then builds the
// safe, committable raw/ FROM raw.unredacted/ (02 → 03 → 04 → 05).
//
//   bun skills/import-ehi/scripts/01-extract.ts "~/Downloads/Requested Record.zip" [raw.unredacted] [db/ehi.sqlite]
//
import { $ } from "bun";
import { existsSync } from "node:fs";

const zip = process.argv[2];
const out = process.argv[3] ?? "raw.unredacted";
// Distinct, self-labeling path: the import DB holds FULL PHI (loaded from raw.unredacted/). Keeping it
// off the analysis path db/ehi.sqlite means a deep-dive/publish can never silently read unredacted data.
const dbp = process.argv[4] ?? "db/ehi.unredacted.sqlite";
if (!zip) { console.error('usage: 01-extract.ts "<Requested Record.zip>" [raw.unredacted] [db/ehi.sqlite]'); process.exit(1); }
if (!existsSync(zip)) { console.error(`no such zip: ${zip}`); process.exit(1); }

await $`mkdir -p ${out}`;
await $`unzip -o -q ${zip} -d ${out}`;
// Reuse the reading skill's loaders (tables + schema docs).
await $`bun skills/reading-epic-ehi-export/scripts/load-ehi-sqlite.ts ${out} ${dbp}`;
await $`bun skills/reading-epic-ehi-export/scripts/load-schema-docs.ts ${out} ${dbp}`;
console.log(`\nextracted ${zip} → ${out}/  and loaded → ${dbp}`);
console.log(`next: bun skills/import-ehi/scripts/02-extract-identifiers.ts  (build the redaction inventory)`);
