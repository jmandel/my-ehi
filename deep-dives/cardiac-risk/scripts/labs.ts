#!/usr/bin/env bun
/**
 * labs.ts — COMPLETE normalized CV/metabolic-risk lab dataset for the cardiac-risk deep dive.
 *
 *   bun deep-dives/cardiac-risk/scripts/labs.ts
 *
 * Writes deep-dives/cardiac-risk/parts/labs.json = { rows:[...], meta:{...} }.
 *
 * SCOPE (topic = cardiovascular / metabolic risk). One row per component result for every lab
 * result relevant to CV/metabolic risk across ALL dates:
 *   - full lipid panels  (CHOLESTEROL, TRIGLYCERIDES, HDL/HIGH DENSITY CHOLESTEROL, LDL CALCULATED,
 *                          VLDL CHOLESTEROL, CHOLESTEROL/HDL RATIO)
 *   - glycemic           (HEMOGLOBIN A1C, ESTIMATED AVG GLUC, GLUCOSE)
 *   - BMP / CMP analytes (SODIUM, POTASSIUM, CHLORIDE, CO2, BUN BLOOD, CREATININE, CALCIUM,
 *                          ANION GAP, BUN / CREAT RATIO, OSMOLALITY CALCULATED, EGFR NON-AFR/AMER)
 *   - cardiac biomarker  (TROPONIN — order header only; see "result gap" below)
 *
 * Excluded as NOT CV/metabolic (a different clinical domain, not curation-down within-topic):
 *   H PYLORI ANTIGEN STOOL, HEPATITIS C AB, SARS-COV-2 INTERP (ES) EXT.
 *   These are the only 3 of 47 ORDER_RESULTS rows outside the topic (44 CV/metabolic component rows).
 *
 * RESULT GAP (Reading skill lab-results §Gotcha 4): some CV/metabolic ORDER_PROC headers are
 * LAB_STATUS='Final result' yet carry ZERO ORDER_RESULTS and zero ORDER_NARRATIVE — the analytes were
 * not carried into the structured export. For CV/metabolic risk a cardiologist MUST know these were
 * ordered, so each such order is emitted as a single "gap" row (component=null, value_text noting the
 * gap). Captured here: COMPREHENSIVE METABOLIC PANEL (2024-05-14, abnormal), TROPONIN (2024-05-14),
 * BASIC METABOLIC PANEL (2024-07-30). (Non-CV empty Final-result orders — CBC — are out of topic scope.)
 *
 * Placement-vs-result split (§Gotcha 1): blank-status placement orders that produced no results are
 * intentionally NOT emitted (they are duplicate stubs of the resulted order); only resulted orders and
 * the "Final result but empty" gap orders appear.
 *
 * GOTCHAS honored (reading-epic-ehi-export lab-results.md):
 *  - §17 everything is TEXT: CAST(... AS REAL) for ordering; value_num is parsed in JS, null if non-numeric.
 *  - §Gotcha 2 ORD_NUM_VALUE=9999999 is the qualitative sentinel -> value_num=null, real value is ORD_VALUE
 *    (kept in value_text). VALUE_NORMALIZED (e.g. ">90") preserved in ref/text where present.
 *  - §Gotcha 3 abnormal = RESULT_FLAG_C_NAME in (High,Low); '(NONE)'/empty treated as normal (-> null flag).
 *  - §Gotcha 5 reference range is parsed (REFERENCE_LOW/HIGH) + one-sided/descriptive (REF_NORMAL_VALS,
 *    RAW_*). ref_range_text combines them so nothing is lost.
 *  - §Gotcha 6 sortable real date = CAST(ORD_DATE_REAL AS REAL) for result rows; PAT_ENC_DATE_REAL for
 *    gap orders. Display date parsed from RESULT_DATE / ORDERING_DATE.
 *  - COMPONENT_COMMENT carries fasting status and performing-lab footnotes -> fasting_comment.
 *
 * Every row carries `src` (table + keys). Read-only.
 */
import { Database } from "bun:sqlite";

const db = new Database(process.env.EHI_DB ?? "./db/ehi.sqlite", { readonly: true });
db.run("PRAGMA busy_timeout = 8000");

const SENTINEL = "9999999";
// Epic VALUE_NORMALIZED can carry an embedded control byte (e.g. ">\x10 90" for ">90");
// strip control chars [0x00-0x1f] built from char codes so no literal control byte lives in source.
const CTRL = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(31) + "]", "g");

// Components that belong to the CV / metabolic-risk topic.
const CV_COMPONENTS = new Set([
  // lipids
  "CHOLESTEROL", "TRIGLYCERIDES", "HDL", "HIGH DENSITY CHOLESTEROL",
  "LDL, CALCULATED", "VLDL CHOLESTEROL", "CHOLESTEROL/HDL RATIO",
  // glycemic
  "HEMOGLOBIN A1C", "ESTIMATED AVG GLUC", "GLUCOSE",
  // BMP / CMP electrolytes & renal
  "SODIUM", "POTASSIUM", "CHLORIDE", "CO2", "BUN BLOOD", "CREATININE",
  "CALCIUM", "ANION GAP", "BUN / CREAT RATIO", "OSMOLALITY CALCULATED",
  "EGFR NON-AFR/AMER",
]);

// CV/metabolic order DESCRIPTIONs whose "Final result but empty" headers must surface as gap rows.
const CV_ORDER_DESCRIPTIONS = new Set([
  "LIPID PANEL", "BASIC METABOLIC PANEL", "COMPREHENSIVE METABOLIC PANEL",
  "HEMOGLOBIN A1C", "TROPONIN",
]);

// ---- helpers ---------------------------------------------------------------

const s = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).replace(CTRL, " ").replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
};
const numOrNull = (v: unknown): number | null => {
  const t = s(v);
  if (t === null) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
// Epic RESULT_DATE/ORDERING_DATE render like "8/9/2018 12:00:00 AM" -> ISO date.
const isoDate = (v: unknown): string | null => {
  const t = s(v);
  if (t === null) return null;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return t;
  const [, mo, d, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
};
// Build a human reference-range string from the available parsed + descriptive fields.
const refRangeText = (r: any): string | null => {
  const lo = s(r.REFERENCE_LOW);
  const hi = s(r.REFERENCE_HIGH);
  const norm = s(r.REF_NORMAL_VALS);           // one-sided/descriptive, e.g. ">40", "<30", ">60"
  const rawRef = s(r.RAW_REF_VALS);
  if (lo !== null && hi !== null) return `${lo} - ${hi}`;
  if (lo !== null) return `>= ${lo}`;
  if (hi !== null) return `<= ${hi}`;
  if (norm !== null) return norm;
  if (rawRef !== null) return rawRef;
  return null;
};

type Row = Record<string, unknown>;
const rows: Row[] = [];

// ---- (A) resulted CV/metabolic component rows ------------------------------

const resultSql = `
  SELECT r.ORDER_PROC_ID, r.LINE, r.COMPONENT_ID_NAME, r.COMPONENT_ID,
         r.ORD_VALUE, r.ORD_NUM_VALUE, r.VALUE_NORMALIZED,
         r.RESULT_FLAG_C_NAME, r.RESULT_IN_RANGE_YN,
         r.REFERENCE_LOW, r.REFERENCE_HIGH, r.REFERENCE_UNIT,
         r.REF_NORMAL_VALS, r.RAW_LOW, r.RAW_HIGH, r.RAW_REF_VALS,
         r.COMPONENT_COMMENT, r.RESULT_STATUS_C_NAME, r.LAB_STATUS_C_NAME,
         r.RESULT_DATE, r.ORD_DATE_REAL, r.PAT_ENC_CSN_ID,
         r.RESULTING_LAB_ID_LLB_NAME,
         op.DESCRIPTION AS ORDER_NAME, op.ORDER_TYPE_C_NAME, op.ORDERING_DATE,
         op.ABNORMAL_YN
  FROM ORDER_RESULTS r
  JOIN ORDER_PROC op ON op.ORDER_PROC_ID = r.ORDER_PROC_ID
  ORDER BY CAST(r.ORD_DATE_REAL AS REAL), op.DESCRIPTION, CAST(r.LINE AS INTEGER)
`;

for (const r of db.query(resultSql).all() as any[]) {
  const comp = s(r.COMPONENT_ID_NAME);
  if (comp === null || !CV_COMPONENTS.has(comp)) continue; // topic filter

  const rawNum = s(r.ORD_NUM_VALUE);
  const isSentinel = rawNum === SENTINEL;
  // value_num: the real numeric value, sentinel-safe. Qualitative -> null.
  const value_num = isSentinel ? null : numOrNull(r.ORD_NUM_VALUE);
  // value_text: the human-readable value (ORD_VALUE), always populated; carries ">90", "Negative", etc.
  const value_text = s(r.ORD_VALUE) ?? s(r.VALUE_NORMALIZED);

  const flagRaw = s(r.RESULT_FLAG_C_NAME);
  const abnormal_flag = flagRaw === "High" || flagRaw === "Low" ? flagRaw : null;

  rows.push({
    order_proc_id: s(r.ORDER_PROC_ID),
    order_name: s(r.ORDER_NAME),
    component: comp,
    component_id: s(r.COMPONENT_ID),
    value_num,
    value_text,
    value_normalized: s(r.VALUE_NORMALIZED),
    unit: s(r.REFERENCE_UNIT),
    ref_low: s(r.REFERENCE_LOW),
    ref_high: s(r.REFERENCE_HIGH),
    ref_range_text: refRangeText(r),
    abnormal_flag,
    in_range_yn: s(r.RESULT_IN_RANGE_YN),
    fasting_comment: s(r.COMPONENT_COMMENT),
    result_status: s(r.RESULT_STATUS_C_NAME) ?? s(r.LAB_STATUS_C_NAME),
    resulting_lab: s(r.RESULTING_LAB_ID_LLB_NAME),
    date: isoDate(r.RESULT_DATE) ?? isoDate(r.ORDERING_DATE),
    date_real: numOrNull(r.ORD_DATE_REAL),
    enc_csn: s(r.PAT_ENC_CSN_ID),
    is_result_gap: false,
    src: `ORDER_RESULTS:ORDER_PROC_ID=${s(r.ORDER_PROC_ID)},LINE=${s(r.LINE)}`,
  });
}

// ---- (B) CV/metabolic "Final result but empty" gap orders ------------------
// Order headers that are LAB_STATUS='Final result', belong to a CV/metabolic panel, and have NO
// ORDER_RESULTS rows. Emitted as one gap row each so the order is not invisible to the analysis.

const gapSql = `
  SELECT op.ORDER_PROC_ID, op.DESCRIPTION, op.ORDER_TYPE_C_NAME, op.LAB_STATUS_C_NAME,
         op.ABNORMAL_YN, op.ORDERING_DATE, op.RESULT_TIME, op.PAT_ENC_DATE_REAL, op.PAT_ENC_CSN_ID,
         op.RESULT_LAB_ID_LLB_NAME
  FROM ORDER_PROC op
  LEFT JOIN ORDER_RESULTS r ON r.ORDER_PROC_ID = op.ORDER_PROC_ID
  WHERE op.ORDER_TYPE_C_NAME IN ('Lab','Microbiology')
    AND op.LAB_STATUS_C_NAME = 'Final result'
  GROUP BY op.ORDER_PROC_ID
  HAVING COUNT(r.LINE) = 0
  ORDER BY CAST(op.PAT_ENC_DATE_REAL AS REAL), op.DESCRIPTION
`;

for (const o of db.query(gapSql).all() as any[]) {
  const desc = s(o.DESCRIPTION);
  if (desc === null || !CV_ORDER_DESCRIPTIONS.has(desc)) continue; // CV/metabolic topic only

  const abn = s(o.ABNORMAL_YN) === "Y";
  rows.push({
    order_proc_id: s(o.ORDER_PROC_ID),
    order_name: desc,
    component: null,
    component_id: null,
    value_num: null,
    value_text: `NO STRUCTURED RESULT IN EXPORT (order LAB_STATUS='Final result'${abn ? ", ABNORMAL_YN=Y" : ""}; analyte values not carried into EHI extract)`,
    value_normalized: null,
    unit: null,
    ref_low: null,
    ref_high: null,
    ref_range_text: null,
    abnormal_flag: abn ? "Abnormal (order-level)" : null,
    in_range_yn: null,
    fasting_comment: null,
    result_status: s(o.LAB_STATUS_C_NAME),
    resulting_lab: s(o.RESULT_LAB_ID_LLB_NAME),
    date: isoDate(o.RESULT_TIME) ?? isoDate(o.ORDERING_DATE),
    date_real: numOrNull(o.PAT_ENC_DATE_REAL),
    enc_csn: s(o.PAT_ENC_CSN_ID),
    is_result_gap: true,
    src: `ORDER_PROC:ORDER_PROC_ID=${s(o.ORDER_PROC_ID)} (no ORDER_RESULTS rows)`,
  });
}

// ---- sort by real date, then order name, then component --------------------
rows.sort((a, b) => {
  const da = (a.date_real as number) ?? 0;
  const dbb = (b.date_real as number) ?? 0;
  if (da !== dbb) return da - dbb;
  const na = String(a.order_name ?? "");
  const nb = String(b.order_name ?? "");
  if (na !== nb) return na < nb ? -1 : 1;
  return String(a.component ?? "").localeCompare(String(b.component ?? ""));
});

// ---- meta ------------------------------------------------------------------

const totalResultRows = (db.query("SELECT COUNT(*) n FROM ORDER_RESULTS").get() as any).n;
const cvResultRows = rows.filter((r) => !r.is_result_gap).length;
const gapRows = rows.filter((r) => r.is_result_gap).length;
const components = [...new Set(rows.filter((r) => r.component).map((r) => r.component))].sort();
const dates = [...new Set(rows.map((r) => r.date).filter(Boolean))].sort();

const out = {
  meta: {
    entity: "labs",
    topic: "cardiovascular / metabolic risk",
    generated: new Date().toISOString(),
    source_tables: ["ORDER_PROC", "ORDER_RESULTS"],
    row_count: rows.length,
    cv_result_rows: cvResultRows,
    result_gap_rows: gapRows,
    raw_order_results_total: totalResultRows,
    excluded_non_cv_result_rows: totalResultRows - cvResultRows,
    excluded_non_cv_components: ["H PYLORI ANTIGEN STOOL", "HEPATITIS C AB", "SARS-COV-2 INTERP (ES) EXT"],
    components_present: components,
    date_span: dates.length ? [dates[0], dates[dates.length - 1]] : [],
    notes: [
      "ORD_NUM_VALUE=9999999 is the qualitative sentinel -> value_num=null; real value in value_text (e.g. EGFR '>90').",
      "abnormal_flag = High/Low from RESULT_FLAG_C_NAME; '(NONE)'/empty treated as normal (null).",
      "is_result_gap rows are CV/metabolic orders that are LAB_STATUS='Final result' but carry NO structured analytes in the export (Reading skill lab-results Gotcha 4): CMP & TROPONIN 2024-05-14, BMP 2024-07-30.",
      "3 of 47 ORDER_RESULTS rows are out-of-topic (H pylori, Hep C Ab, COVID) and excluded; 44 CV/metabolic component rows captured + 3 gap rows.",
    ],
  },
  rows,
};

await Bun.write(
  "deep-dives/cardiac-risk/parts/labs.json",
  JSON.stringify(out, null, 2) + "\n",
);

console.log(
  `wrote ${rows.length} rows (${cvResultRows} CV/metabolic component results + ${gapRows} gap orders) ` +
  `to deep-dives/cardiac-risk/parts/labs.json`,
);
console.log(`  raw ORDER_RESULTS total=${totalResultRows}; ${totalResultRows - cvResultRows} out-of-topic excluded`);
console.log(`  components: ${components.join(", ")}`);
console.log(`  date span: ${out.meta.date_span.join(" .. ")}`);
