#!/usr/bin/env bun
/**
 * load-ehi-sqlite.ts — Portable loader for an Epic "EHI Export".
 *
 * Loads every non-empty `*.tsv` under <rawDir>/EHITables into a SQLite database,
 * one SQLite table per TSV file. Every column is stored as TEXT (the export is
 * text end-to-end; the schema docs carry the real types). Empty strings are
 * stored as SQL NULL so `WHERE col IS NULL` and COUNT() behave intuitively.
 *
 * Epic's EHI TSV dialect (verified against this specimen, and documented at
 * https://open.epic.com/EHITables):
 *   - Tab-delimited, CRLF line terminators, no field quoting.
 *   - Free text never contains a raw newline or tab: long text is chunked into
 *     line-numbered child rows (a LINE column) instead. So row-per-physical-line
 *     parsing is safe. We still defensively check field counts and report drift.
 *
 * Usage:
 *   bun load-ehi-sqlite.ts <rawDir> [outDb]
 *     rawDir : folder containing "EHITables" (default: ./raw)
 *     outDb  : output sqlite path        (default: ./db/ehi.sqlite)
 *
 * Portable: no hard-coded table names, no specimen-specific assumptions.
 */
import { Database } from "bun:sqlite";
import { readdirSync, statSync, existsSync, mkdirSync } from "fs";
import { join, dirname, basename } from "path";

const rawDir = process.argv[2] ?? "./raw";
const outDb = process.argv[3] ?? "./db/ehi.sqlite";
const tablesDir = join(rawDir, "EHITables");

if (!existsSync(tablesDir)) {
  console.error(`No EHITables folder at ${tablesDir}. Pass the export's raw dir as arg 1.`);
  process.exit(1);
}
mkdirSync(dirname(outDb), { recursive: true });

// Fresh build every run so the DB is a pure function of the export.
if (existsSync(outDb)) {
  const fs = require("fs");
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.rmSync(outDb + suffix); } catch {}
  }
}

const db = new Database(outDb);
db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA synchronous = OFF");

const q = (id: string) => '"' + id.replace(/"/g, '""') + '"';

// Catalog of what we loaded, queryable as a normal table.
db.run(`CREATE TABLE _tables (
  table_name TEXT PRIMARY KEY,
  n_columns  INTEGER,
  n_rows     INTEGER,
  source_file TEXT
)`);

const files = readdirSync(tablesDir)
  .filter((f) => f.toLowerCase().endsWith(".tsv"))
  .sort();

let loaded = 0, skippedEmpty = 0, totalRows = 0;
const drift: string[] = [];

for (const file of files) {
  const path = join(tablesDir, file);
  const tableName = basename(file).replace(/\.tsv$/i, "");
  const raw = require("fs").readFileSync(path, "utf8") as string;
  // Split on LF, strip trailing CR. Drop a trailing empty line from CRLF EOF.
  const lines = raw.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  if (lines.length === 0) { skippedEmpty++; continue; }

  const header = lines[0].replace(/\r$/, "").split("\t");
  const dataLines = lines.slice(1);
  if (dataLines.length === 0) { skippedEmpty++; continue; } // header-only = no data

  const cols = header.map((c) => c.trim());
  db.run(`CREATE TABLE ${q(tableName)} (${cols.map((c) => q(c) + " TEXT").join(", ")})`);
  const placeholders = cols.map(() => "?").join(", ");
  const stmt = db.prepare(`INSERT INTO ${q(tableName)} VALUES (${placeholders})`);

  let n = 0;
  const insertAll = db.transaction((rows: string[]) => {
    for (const line of rows) {
      const fields = line.replace(/\r$/, "").split("\t");
      // Normalize field count to column count; record drift if it happens.
      if (fields.length !== cols.length) {
        drift.push(`${tableName}: expected ${cols.length} cols, got ${fields.length}`);
        while (fields.length < cols.length) fields.push("");
        fields.length = cols.length;
      }
      stmt.run(...fields.map((v) => (v === "" ? null : v)));
      n++;
    }
  });
  insertAll(dataLines);

  db.run(`INSERT INTO _tables VALUES (?, ?, ?, ?)`, [tableName, cols.length, n, file]);
  loaded++; totalRows += n;
}

db.run("PRAGMA wal_checkpoint(TRUNCATE)");
db.run("PRAGMA journal_mode = DELETE");   // finalize to a SINGLE file (drops the -wal/-shm WAL sidecars)
console.log(`Loaded ${loaded} tables (${totalRows.toLocaleString()} rows) into ${outDb}`);
console.log(`Skipped ${skippedEmpty} empty/header-only files of ${files.length} TSVs.`);
if (drift.length) {
  console.log(`\n${drift.length} field-count drift events (first 10):`);
  for (const d of drift.slice(0, 10)) console.log("  " + d);
}
db.close();
