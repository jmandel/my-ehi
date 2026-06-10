#!/usr/bin/env bun
/**
 * q.ts — tiny read-only SQL helper for the loaded EHI database.
 *
 *   bun lib/q.ts "SELECT * FROM PAT_ENC LIMIT 3"          # JSON rows
 *   bun lib/q.ts --table "SELECT ... "                     # aligned table
 *   bun lib/q.ts "SELECT ..." | jq ...                     # pipe-friendly
 *
 * DB path: $EHI_DB or ./db/ehi.sqlite. Read-only; never mutates the specimen.
 */
import { Database } from "bun:sqlite";
const args = process.argv.slice(2);
const asTable = args[0] === "--table";
const sql = (asTable ? args.slice(1) : args).join(" ");
if (!sql.trim()) { console.error('usage: bun lib/q.ts "<SQL>"'); process.exit(1); }
const db = new Database(process.env.EHI_DB ?? "./db/ehi.sqlite", { readonly: true });
db.run("PRAGMA busy_timeout = 8000"); // ride out transient WAL locks instead of throwing SQLITE_BUSY
// Half-build guard: a data-only load (load-ehi-sqlite.ts without load-schema-docs.ts) leaves the
// schema catalog absent, so any JOIN _schema_table/_schema_column fails. Warn once, don't block.
if (!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='_schema_table'").get()) {
  console.error("warning: _schema_table missing — DB built without schema docs. Run: bun .../scripts/load.ts <raw> <db>");
}
// PHI guard: shout if this DB was loaded from an unredacted source (provenance stamp from load-ehi-sqlite).
if (db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='_provenance'").get() &&
    db.query("SELECT 1 FROM _provenance WHERE looks_unredacted=1").get()) {
  console.error("*** PHI WARNING: this DB was loaded from an UNREDACTED source — full PHI. Do not publish or build viewmodels from it. ***");
}
const rows = db.query(sql).all() as Record<string, unknown>[];
if (!asTable) { console.log(JSON.stringify(rows, null, 2)); process.exit(0); }
if (rows.length === 0) { console.log("(0 rows)"); process.exit(0); }
const cols = Object.keys(rows[0]);
const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)));
const line = (cells: string[]) => cells.map((s, i) => s.padEnd(w[i])).join("  ");
console.log(line(cols));
console.log(w.map((n) => "-".repeat(n)).join("  "));
for (const r of rows) console.log(line(cols.map((c) => String(r[c] ?? ""))));
console.log(`(${rows.length} rows)`);
