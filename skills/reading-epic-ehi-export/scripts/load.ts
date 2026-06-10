#!/usr/bin/env bun
/**
 * load.ts — THE one command to build a complete EHI SQLite database.
 *
 * A complete DB is BOTH halves run against the same file:
 *   1. load-ehi-sqlite.ts  — the TSV data tables + the `_tables` catalog.
 *   2. load-schema-docs.ts — Epic's `EHITables Schema/*.htm` → `_schema_table` / `_schema_column`.
 *
 * The two are separate scripts because they read different source folders and are each
 * independently useful, but running only the first yields a DB that LOOKS healthy (all 590
 * data tables query fine) while silently lacking the schema-doc catalog — so any later
 * `JOIN _schema_table` fails with "no such table". This wrapper makes that half-build
 * impossible: it is the documented entrypoint, and build-site.ts calls it too, so there is
 * exactly one definition of "a complete build".
 *
 * Usage:
 *   bun load.ts <rawDir> [outDb]
 *     rawDir : folder containing "EHITables" + "EHITables Schema" (default: ./raw)
 *     outDb  : output sqlite path                                  (default: ./db/ehi.sqlite)
 */
import { join } from "path";

const here = new URL(".", import.meta.url).pathname;
const rawDir = process.argv[2] ?? "./raw";
const outDb = process.argv[3] ?? "./db/ehi.sqlite";

for (const script of ["load-ehi-sqlite.ts", "load-schema-docs.ts"]) {
  const r = Bun.spawnSync({ cmd: ["bun", join(here, script), rawDir, outDb], stdout: "inherit", stderr: "inherit" });
  if (r.exitCode !== 0) {
    console.error(`\n${script} failed (exit ${r.exitCode}); DB is incomplete. Aborting.`);
    process.exit(r.exitCode || 1);
  }
}
console.log(`\nComplete DB at ${outDb} (data + _tables + _schema_table + _schema_column).`);
