import { Database } from "bun:sqlite";
const db = new Database("./db/ehi.sqlite", { readonly: true });
const rows = db.query(`
  SELECT t.table_name, t.n_rows, t.n_columns,
         COALESCE(substr(s.description,1,160),'') AS descr
  FROM _tables t LEFT JOIN _schema_table s ON s.table_name=t.table_name
  ORDER BY t.n_rows DESC, t.table_name
`).all() as any[];
for (const r of rows) {
  console.log(`${String(r.n_rows).padStart(5)}r ${String(r.n_columns).padStart(3)}c  ${r.table_name}\t${r.descr.replace(/\s+/g,' ')}`);
}
console.log(`\nTOTAL loaded tables: ${rows.length}`);
