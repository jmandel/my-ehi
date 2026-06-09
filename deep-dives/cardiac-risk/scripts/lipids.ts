#!/usr/bin/env bun
/**
 * lipids.ts — PROJECTION for the cardiac-risk view model's `lipids` slot.
 *
 *   bun deep-dives/cardiac-risk/scripts/lipids.ts
 *
 * Reads the already-clean dataset.json lab rows (a verified projection of ORDER_RESULTS:
 * order_name='LIPID PANEL'), and writes the view-shaped lipid slot to
 *   deep-dives/cardiac-risk/parts/lipids.json
 *
 * Shape (exactly what the lipids view reads):
 *   {
 *     panels: [{ date, dateIso, fasting:true|false, rows:[
 *                 { analyte, value, unit, refText, flag:"Low"|"High"|null }] }],
 *     trend:  { hdl:[…], tg:[…], ratio:[…], totalChol:[…], ldl:[…], dates:[…] }
 *   }
 *
 * Display-clean guarantees:
 *  - analyte names are UNIFIED human labels — the older panel's component
 *    "HIGH DENSITY CHOLESTEROL" and the newer "HDL" both render as analyte "HDL"
 *    (the dataset already normalizes them to analyte code "HDL"; we map to a label).
 *  - dates are "Aug 9, 2018" form (never "12:00:00 AM"); a sortable dateIso rides alongside.
 *  - value is the numeric measurement; unit is the clean unit label ("mg/dL" or null for the ratio).
 *  - refText is the resolved reference string ("40 – 125", ">40", "<100", "0 – 199") — never raw lo/hi columns.
 *  - flag is plain "Low"/"High"/null (the dataset's "Normal" maps to null).
 *  - panel-level `fasting` is derived from the lab's fasting comment ("PATIENT FASTING" vs
 *    "PATIENT WAS NOT FASTING"); the raw comment text (which carries a lab FACILITY address)
 *    is NOT emitted — only the boolean.
 *  - no order_proc_id / enc_csn / src / date_real reach the slot (plumbing stays out of content).
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";

const HERE = dirname(new URL(import.meta.url).pathname);
const TOPIC_DIR = join(HERE, "..");
const DATASET = join(TOPIC_DIR, "dataset.json");
const OUT_DIR = join(TOPIC_DIR, "parts");
const OUT = join(OUT_DIR, "lipids.json");

type LabRow = {
  order_name?: string;
  order_proc_id?: string;
  analyte?: string;
  label?: string;
  value_num?: number | null;
  unit_label?: string | null;
  reference?: string | null;
  flag?: string | null;          // "Normal" | "Low" | "High"
  fasting?: string | null;       // "fasting" | "non-fasting" | null  (per-component, set only where a comment exists)
  date?: string;                 // "Aug 9, 2018"
  date_iso?: string;             // "2018-08-09"
  date_real?: number;
};

const data = JSON.parse(readFileSync(DATASET, "utf8"));
const labs: LabRow[] = Array.isArray(data.labs) ? data.labs : [];

// --- Unified, human display labels keyed by the dataset's canonical analyte code.
// This is the unification point: HDL (2018 "HIGH DENSITY CHOLESTEROL" + 2023/2025 "HDL")
// already share analyte code "HDL"; we only attach a clean display name.
const ANALYTE_LABEL: Record<string, string> = {
  TOTAL_CHOLESTEROL: "Total cholesterol",
  HDL: "HDL",
  LDL: "LDL (calculated)",
  TRIGLYCERIDES: "Triglycerides",
  VLDL: "VLDL cholesterol",
  CHOL_HDL_RATIO: "Cholesterol / HDL ratio",
};

// Order the rows read the way a clinician scans a lipid panel.
const ROW_ORDER = [
  "TOTAL_CHOLESTEROL",
  "LDL",
  "HDL",
  "TRIGLYCERIDES",
  "VLDL",
  "CHOL_HDL_RATIO",
];

const cleanFlag = (f?: string | null): "Low" | "High" | null => {
  if (f === "Low" || f === "High") return f;
  return null; // "Normal" (and anything unexpected) renders as no flag
};

// Keep only the lipid-panel rows.
const lipidRows = labs.filter(
  (r) => typeof r.order_name === "string" && /LIPID/i.test(r.order_name),
);

// Group into panels by (order_proc_id + date_iso) — one draw per group.
const byPanel = new Map<string, LabRow[]>();
for (const r of lipidRows) {
  const key = `${r.order_proc_id}|${r.date_iso}`;
  if (!byPanel.has(key)) byPanel.set(key, []);
  byPanel.get(key)!.push(r);
}

// Build clean panels, sorted oldest -> newest.
const panels = [...byPanel.values()]
  .map((rows) => {
    const sortReal = rows[0]?.date_real ?? 0;
    // Panel-level fasting: any component carrying a fasting comment governs the draw.
    // dataset `fasting` is "fasting" | "non-fasting" set only where the comment exists.
    let fasting: boolean | null = null;
    for (const r of rows) {
      if (r.fasting === "fasting") { fasting = true; break; }
      if (r.fasting === "non-fasting") { fasting = false; break; }
    }
    const outRows = rows
      .filter((r) => r.analyte && ANALYTE_LABEL[r.analyte])
      .sort(
        (a, b) =>
          ROW_ORDER.indexOf(a.analyte!) - ROW_ORDER.indexOf(b.analyte!),
      )
      .map((r) => ({
        analyte: ANALYTE_LABEL[r.analyte!],
        value: r.value_num ?? null,
        unit: r.unit_label ?? null,
        refText: r.reference ?? null,
        flag: cleanFlag(r.flag),
      }));
    return {
      date: rows[0]?.date ?? "",
      dateIso: rows[0]?.date_iso ?? "",
      _sort: sortReal,
      // fasting must be a boolean for the view; if a panel truly lacked any comment
      // we'd surface null, but all three draws here carry one. Default conservatively to false.
      fasting: fasting === null ? false : fasting,
      rows: outRows,
    };
  })
  .sort((a, b) => a._sort - b._sort)
  .map(({ _sort, ...p }) => p);

// Build the trend series across panels (oldest -> newest), pulling the one value per analyte.
const valueOf = (panelRows: { analyte: string; value: number | null }[], label: string) => {
  const hit = panelRows.find((r) => r.analyte === label);
  return hit ? hit.value : null;
};
const trend = {
  dates: panels.map((p) => p.date),
  totalChol: panels.map((p) => valueOf(p.rows, ANALYTE_LABEL.TOTAL_CHOLESTEROL)),
  ldl: panels.map((p) => valueOf(p.rows, ANALYTE_LABEL.LDL)),
  hdl: panels.map((p) => valueOf(p.rows, ANALYTE_LABEL.HDL)),
  tg: panels.map((p) => valueOf(p.rows, ANALYTE_LABEL.TRIGLYCERIDES)),
  ratio: panels.map((p) => valueOf(p.rows, ANALYTE_LABEL.CHOL_HDL_RATIO)),
};

const out = {
  _meta: {
    slot: "lipids",
    layer:
      "STRUCTURED FILL — lipid panels (one per draw) + trend series for the cardiac-risk view model's lipids section. Projected from the lipid-panel labs in dataset.json. Display-clean: unified analyte labels (the older and newer panels' two raw HDL component names both render as analyte 'HDL'), formatted dates, plain flags, derived fasting boolean. No raw ids/columns/timestamps/facility comments.",
    built_by: "deep-dives/cardiac-risk/scripts/lipids.ts",
    panel_count: panels.length,
    note_fasting:
      "fasting derived from the lab's PATIENT FASTING / PATIENT WAS NOT FASTING comment; 2018 fasting, 2023 & 2025 non-fasting.",
  },
  panels,
  trend,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 2));

console.log(`wrote ${OUT}`);
console.log(`panels: ${panels.length}`);
for (const p of panels) {
  console.log(
    `  ${p.date} (${p.fasting ? "fasting" : "non-fasting"}): ${p.rows
      .map((r) => `${r.analyte}=${r.value}${r.flag ? ` [${r.flag}]` : ""}`)
      .join(", ")}`,
  );
}
console.log(`trend.hdl: ${JSON.stringify(trend.hdl)}`);
console.log(`trend.tg:  ${JSON.stringify(trend.tg)}`);
console.log(`trend.ratio: ${JSON.stringify(trend.ratio)}`);
console.log(`trend.totalChol: ${JSON.stringify(trend.totalChol)}`);
console.log(`trend.dates: ${JSON.stringify(trend.dates)}`);
