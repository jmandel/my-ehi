#!/usr/bin/env bun
/**
 * load-schema-docs.ts — Parse Epic EHI "EHITables Schema/*.htm" into queryable
 * metadata tables, so column documentation is searchable with plain SQL.
 *
 * Each schema HTML file documents one table: a description, the primary key
 * column list, and a column table (ordinal, name, type, discontinued?, and a
 * free-text description that often names the ZC_/lookup category behind a code).
 *
 * Produces two tables in the same SQLite DB:
 *   _schema_table(table_name, description)
 *   _schema_column(table_name, ordinal, column_name, data_type, discontinued, is_pk, description)
 *
 * Usage: bun load-schema-docs.ts <rawDir> [outDb]
 * Portable: works against any Epic EHI export's Schema folder.
 */
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join, basename } from "path";

const rawDir = process.argv[2] ?? "./raw";
const outDb = process.argv[3] ?? "./db/ehi.sqlite";
const schemaDir = join(rawDir, "EHITables Schema");

if (!existsSync(schemaDir)) {
  console.error(`No "EHITables Schema" folder at ${schemaDir}.`);
  process.exit(1);
}

const db = new Database(outDb);
db.run("DROP TABLE IF EXISTS _schema_table");
db.run("DROP TABLE IF EXISTS _schema_column");
db.run(`CREATE TABLE _schema_table (table_name TEXT PRIMARY KEY, description TEXT)`);
db.run(`CREATE TABLE _schema_column (
  table_name TEXT, ordinal INTEGER, column_name TEXT, data_type TEXT,
  discontinued TEXT, is_pk INTEGER, description TEXT
)`);

// Minimal HTML helpers — the schema files are machine-generated and regular.
const stripTags = (s: string) =>
  s.replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();

// Pull the inner HTML of the Nth <table class="..."> matching a class token.
function tablesByClass(html: string, klass: string): string[] {
  const out: string[] = [];
  const re = /<table\b[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/table>/gi;
  let m: RegExpExecArray | null;
  // Note: schema tables are not nested within each other at the same class, so
  // a non-greedy match to the next </table> is correct for these files.
  while ((m = re.exec(html))) {
    if (m[1].split(/\s+/).includes(klass)) out.push(m[2]);
  }
  return out;
}

function rows(tableInner: string): string[][] {
  const out: string[][] = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr: RegExpExecArray | null;
  while ((tr = trRe.exec(tableInner))) {
    const cells: string[] = [];
    const cellRe = /<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let c: RegExpExecArray | null;
    while ((c = cellRe.exec(tr[1]))) cells.push(stripTags(c[2]));
    if (cells.length) out.push(cells);
  }
  return out;
}

const files = readdirSync(schemaDir).filter((f) => f.toLowerCase().endsWith(".htm"));
const tStmt = db.prepare(`INSERT OR REPLACE INTO _schema_table VALUES (?, ?)`);
const cStmt = db.prepare(`INSERT INTO _schema_column VALUES (?, ?, ?, ?, ?, ?, ?)`);

let nTables = 0, nCols = 0;
const load = db.transaction(() => {
  for (const file of files) {
    const tableName = basename(file).replace(/\.htm$/i, "");
    const html = readFileSync(join(schemaDir, file), "utf8");

    // Description: first KeyValue table's value cell.
    let description = "";
    const kv = tablesByClass(html, "KeyValue")[0];
    if (kv) {
      const r = rows(kv);
      if (r[0] && r[0].length >= 2) description = r[0].slice(1).join(" ").trim();
    }
    tStmt.run(tableName, description || null);
    nTables++;

    // Primary key columns: the "List" table that follows the "Primary Key" header.
    const pk = new Set<string>();
    const pkIdx = html.indexOf("Primary Key");
    if (pkIdx >= 0) {
      const seg = html.slice(pkIdx, html.indexOf("Column Information", pkIdx) + 1 || html.length);
      const listTbl = tablesByClass(seg, "List")[0];
      if (listTbl) for (const r of rows(listTbl)) {
        if (r[0] && r[0] !== "Column Name") pk.add(r[0]);
      }
    }

    // Column Information section: a flat sequence of column blocks separated by
    // `border-bottom-width: 1px;` rows. Each block = a header row (ordinal/name/
    // type/discontinued in T1Head cells) + a description row (nested table).
    const ciIdx = html.indexOf("Column Information");
    if (ciIdx >= 0) {
      const section = html.slice(ciIdx);
      const blocks = section.split(/<tr style="border-bottom-width: 1px;">/i);
      for (const block of blocks) {
        // Ordinal/name/type/discontinued live in the four T1Head/data cells.
        const head = block.match(
          /<td class="T1Head"[^>]*>\s*(\d+)\s*<\/td>\s*<td class="T1Head"[^>]*>([^<]*)<\/td>\s*<td class="T1Head"[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>/i
        );
        if (!head) continue;
        const ord = parseInt(head[1], 10);
        const name = stripTags(head[2]);
        const type = stripTags(head[3]);
        const disc = stripTags(head[4]);
        // Description: the first white-space:normal cell in this block.
        const dm = block.match(/white-space:\s*normal;"[^>]*>([\s\S]*?)<\/td>/i);
        const desc = dm ? stripTags(dm[1]) : "";
        cStmt.run(tableName, ord, name, type, disc, pk.has(name) ? 1 : 0, desc || null);
        nCols++;
      }
    }
  }
});
load();

console.log(`Parsed ${nTables} schema tables, ${nCols} column docs into ${outDb}`);
db.close();
