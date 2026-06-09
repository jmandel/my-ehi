#!/usr/bin/env bun
/**
 * vitals.ts — COMPLETE normalized cardiovascular-risk vitals dataset (dataset layer, NOT curated).
 *
 *   bun deep-dives/cardiac-risk/scripts/vitals.ts
 *     -> writes deep-dives/cardiac-risk/parts/vitals.json  ({rows:[...], meta:{...}})
 *
 * Patient: MANDEL, JOSHUA C (Z7004242). Read-only.
 *
 * Scope = every flowsheet measurement relevant to CV risk over the whole record:
 *   blood pressure (5), pulse (8), weight (14), height (11), SpO2 (10),
 *   BMI — entered (210000000020) and all calculated variants (5445, 301070, 210100200230),
 *   BSA — calculated sq-m (301060) and Haycock (13705),
 *   and the BP capture-context rows (BP Location 210000000012 / Position 210000000013 /
 *   Cuff Size 210000000014), which are kept as their own rows AND folded onto the BP reading.
 *
 * One row per measurement. Nothing is curated away here — judgment lives in the analysis layer.
 *
 * Genre gotchas honored (reading-epic-ehi-export / vitals-and-flowsheets.md):
 *   - The VALUE lives only in V_EHI_FLO_MEAS_VALUE.MEAS_VALUE_EXTERNAL; join MEAS on (FSD_ID,LINE). [§gotcha 1]
 *   - VALUE_TYPE_C_NAME decides parsing; 'Blood Pressure' is packed "sys/dia" — split on '/'. [§gotcha 2]
 *   - Weight is in OUNCES -> /16 for lb; keep raw oz. Height in inches. Read UNITS, never assume. [§gotcha 3]
 *   - FLO_CNCT_DATE_REAL on MEAS is NOT a timestamp; use RECORDED_TIME (instant) and, for true
 *     cross-encounter chronology, CAST(PAT_ENC.PAT_ENC_DATE_REAL AS REAL). All text dates sort
 *     lexically and lie. [§gotcha 5/6]
 *   - Vitals abnormal flags are mostly absent (here exactly one BP carries it). [§gotcha 7]
 *   - A "stay" can span 2 calendar days -> 2 FSDs under one INPATIENT_DATA_ID/CSN. We key the
 *     encounter by PAT_ENC_CSN_ID (resolved via INPATIENT_DATA_ID). [§gotcha 8]
 */
import { Database } from "bun:sqlite";

const DB = process.env.EHI_DB ?? "db/ehi.sqlite";
const OUT = "deep-dives/cardiac-risk/parts/vitals.json";
const db = new Database(DB, { readonly: true });

// ---- CV-relevant flowsheet measures (id -> normalized kind) ---------------------------------
// Grouped so we can carry a clean `kind` and route the value into the right typed numeric field.
const KIND: Record<string, string> = {
  "5": "blood_pressure",
  "8": "pulse",
  "14": "weight",
  "11": "height",
  "10": "spo2",
  // BMI: one entered, three auto-calculated variants — all kept (dataset completeness)
  "210000000020": "bmi",            // BMI (entered/displayed)
  "5445": "bmi",                    // BMI (Calculated)
  "301070": "bmi",                  // BMI (Calculated)
  "210100200230": "bmi",            // BMI Frailty (a BMI restatement)
  // BSA: calculated, two variants
  "301060": "bsa",                  // BSA (Calculated - sq m)
  "13705": "bsa",                   // BSA Haycock
  // BP capture context (kept as rows AND folded onto the BP reading)
  "210000000012": "bp_location",
  "210000000013": "bp_position",
  "210000000014": "bp_cuff",
};
const IDS = Object.keys(KIND);

// "Calculated" rows are derived by Epic formula templates, not entered by a human. Flag them so the
// analysis can prefer the entered value when reconciling duplicate BMI/BSA per encounter — but we
// still EMIT every one (no curation in the dataset).
const CALCULATED = new Set(["5445", "301070", "210100200230", "301060", "13705"]);

type Raw = {
  FSD_ID: string; LINE: string; FLO_MEAS_ID: string; disp: string;
  value: string; units: string | null; vtype: string;
  recorded: string; entry: string; taken_by: string | null;
  abn: string | null; abn_type: string | null; comment: string | null;
  enc_csn: string | null; pat_enc_date_real: string | null; record_date: string | null;
};

const raw = db.query(`
  SELECT m.FSD_ID, m.LINE, v.FLO_MEAS_ID,
         v.FLO_MEAS_ID_DISP_NAME              AS disp,
         v.MEAS_VALUE_EXTERNAL                AS value,
         v.UNITS                              AS units,
         v.VALUE_TYPE_C_NAME                  AS vtype,
         m.RECORDED_TIME                      AS recorded,
         m.ENTRY_TIME                         AS entry,
         m.TAKEN_USER_ID_NAME                 AS taken_by,
         m.ABNORMAL_C_NAME                    AS abn,
         m.ABNORMAL_TYPE_C_NAME               AS abn_type,
         m.MEAS_COMMENT                       AS comment,
         e.PAT_ENC_CSN_ID                     AS enc_csn,
         e.PAT_ENC_DATE_REAL                  AS pat_enc_date_real,
         r.RECORD_DATE                        AS record_date
  FROM V_EHI_FLO_MEAS_VALUE v
  JOIN IP_FLWSHT_MEAS m ON v.FSD_ID = m.FSD_ID AND v.LINE = m.LINE
  JOIN IP_FLWSHT_REC  r ON m.FSD_ID = r.FSD_ID
  LEFT JOIN PAT_ENC   e ON r.INPATIENT_DATA_ID = e.INPATIENT_DATA_ID
  WHERE v.FLO_MEAS_ID IN (${IDS.map(() => "?").join(",")})
`).all(...IDS) as unknown as Raw[];

// ---- BP context lookup: within an FSD, the BP reading's position/location/cuff are sibling rows ---
// Build per-FSD context so we can fold it onto the BP row (the rows themselves are still emitted).
type Ctx = { position?: string; bp_location?: string; bp_cuff?: string };
const ctxByFsd = new Map<string, Ctx>();
for (const r of raw) {
  const k = KIND[r.FLO_MEAS_ID];
  if (k === "bp_position" || k === "bp_location" || k === "bp_cuff") {
    const c = ctxByFsd.get(r.FSD_ID) ?? {};
    if (k === "bp_position") c.position = r.value || undefined;
    if (k === "bp_location") c.bp_location = r.value || undefined;
    if (k === "bp_cuff") c.bp_cuff = r.value || undefined;
    ctxByFsd.set(r.FSD_ID, c);
  }
}

const num = (s: string | null | undefined): number | null => {
  if (s == null || s === "") return null;
  const n = Number(String(s).trim());
  return Number.isFinite(n) ? n : null;
};

type Row = {
  date: string | null;            // display: actual measurement instant (RECORDED_TIME)
  date_real: number | null;       // sortable: PAT_ENC_DATE_REAL (true cross-encounter chronology)
  record_date: string | null;     // flowsheet record date (display)
  entry_time: string | null;      // when charted (can differ from recorded)
  kind: string;
  value: string;                  // raw MEAS_VALUE_EXTERNAL (verbatim)
  unit: string | null;
  // typed numeric fields, populated per kind:
  sys?: number | null;
  dia?: number | null;
  pulse?: number | null;
  weight_lb?: number | null;
  weight_oz?: number | null;      // raw, before /16
  height_in?: number | null;
  bmi?: number | null;
  bsa?: number | null;
  spo2?: number | null;
  // BP context (on the BP row; also present as standalone rows):
  position?: string | null;
  bp_location?: string | null;
  bp_cuff?: string | null;
  calculated?: boolean;           // true for Epic-derived (formula) rows
  abnormal_flag: string | null;   // 'High' etc. when ABNORMAL_C_NAME='Yes'; else null
  taken_by: string | null;
  comment: string | null;
  enc_csn: string | null;
  flo_meas_id: string;
  disp_name: string;
  value_type: string;
  src: string;
};

const rows: Row[] = [];
for (const r of raw) {
  const kind = KIND[r.FLO_MEAS_ID];
  const abnormal_flag =
    r.abn && r.abn.toLowerCase() === "yes" ? (r.abn_type || "Abnormal") : null;

  const row: Row = {
    date: r.recorded || null,
    date_real: num(r.pat_enc_date_real),
    record_date: r.record_date || null,
    entry_time: r.entry || null,
    kind,
    value: r.value,
    unit: r.units ?? null,
    abnormal_flag,
    taken_by: r.taken_by || null,
    comment: r.comment || null,
    enc_csn: r.enc_csn ?? null,
    flo_meas_id: r.FLO_MEAS_ID,
    disp_name: r.disp,
    value_type: r.vtype,
    src: `IP_FLWSHT_MEAS+V_EHI_FLO_MEAS_VALUE:FSD_ID=${r.FSD_ID},LINE=${r.LINE}`,
  };

  switch (kind) {
    case "blood_pressure": {
      const slash = r.value.indexOf("/");
      if (slash > -1) {
        row.sys = num(r.value.slice(0, slash));
        row.dia = num(r.value.slice(slash + 1));
      }
      const c = ctxByFsd.get(r.FSD_ID) ?? {};
      row.position = c.position ?? null;
      row.bp_location = c.bp_location ?? null;
      row.bp_cuff = c.bp_cuff ?? null;
      break;
    }
    case "pulse":
      row.pulse = num(r.value);
      break;
    case "weight": {
      const oz = num(r.value);
      row.weight_oz = oz;
      row.weight_lb = oz == null ? null : Math.round((oz / 16) * 10) / 10;
      break;
    }
    case "height":
      row.height_in = num(r.value);
      break;
    case "bmi":
      row.bmi = num(r.value);
      if (CALCULATED.has(r.FLO_MEAS_ID)) row.calculated = true;
      break;
    case "bsa":
      row.bsa = num(r.value);
      if (CALCULATED.has(r.FLO_MEAS_ID)) row.calculated = true;
      break;
    case "spo2":
      row.spo2 = num(r.value);
      break;
    case "bp_location":
    case "bp_position":
    case "bp_cuff":
      // standalone context rows; value already carried in `value`
      break;
  }
  rows.push(row);
}

// Stable chronological order: by encounter date_real, then FSD/LINE for determinism.
rows.sort((a, b) => {
  const d = (a.date_real ?? 0) - (b.date_real ?? 0);
  if (d !== 0) return d;
  return a.src.localeCompare(b.src);
});

// ---- completeness check: our row count MUST equal the raw source count for these measures --------
const rawCount = (db.query(
  `SELECT COUNT(*) n FROM V_EHI_FLO_MEAS_VALUE WHERE FLO_MEAS_ID IN (${IDS.map(() => "?").join(",")})`
).get(...IDS) as { n: number }).n;

const byKind: Record<string, number> = {};
for (const r of rows) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;

// ---- PHI hygiene self-check (no SSN/email/phone/raw MRN should appear) ----------------------------
const blob = JSON.stringify(rows);
const phi: [RegExp, string][] = [
  [/\b\d{3}-\d{2}-\d{4}\b/, "SSN"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, "email"],
  [/\b\d{3}-\d{3}-\d{4}\b/, "phone"],
  [/\bAPL\d{6}\b/, "MRN"],
];
const phiHits = phi.filter(([re]) => re.test(blob)).map(([, l]) => l);

const meta = {
  entity: "vitals",
  topic: "cardiac-risk",
  patient: "MANDEL, JOSHUA C (Z7004242)",
  source_tables: ["IP_FLWSHT_MEAS", "V_EHI_FLO_MEAS_VALUE", "IP_FLWSHT_REC", "PAT_ENC"],
  generated: new Date().toISOString(),
  scope:
    "Every flowsheet measurement relevant to CV risk (BP, pulse, weight, height, SpO2, all BMI/BSA " +
    "variants, and BP capture-context rows). One row per measurement; complete, not curated.",
  flo_meas_ids: KIND,
  row_count: rows.length,
  raw_source_count: rawCount,
  complete: rows.length === rawCount,
  by_kind: byKind,
  date_real_field: "PAT_ENC.PAT_ENC_DATE_REAL (numeric; true cross-encounter chronology)",
  date_field: "IP_FLWSHT_MEAS.RECORDED_TIME (actual measurement instant; display)",
  notes: [
    "Weight stored in ounces -> weight_lb = oz/16 (rounded 0.1); raw oz kept as weight_oz.",
    "BP packed 'sys/dia' split into sys/dia; position/bp_location/bp_cuff folded onto the BP row " +
      "from sibling rows in the same FSD, and also emitted as their own context rows.",
    "BMI/BSA appear in entered and Epic-calculated variants; calculated rows flagged calculated=true. " +
      "All kept (dataset completeness); the analysis picks one per encounter.",
    "abnormal_flag is populated only when ABNORMAL_C_NAME='Yes' (here: one BP 142/74 on 12/1/2022).",
    "All text dates sort lexically and lie; sort on date_real.",
  ],
  phi_clean: phiHits.length === 0,
};

await Bun.write(OUT, JSON.stringify({ rows, meta }, null, 2));

console.log(`wrote ${OUT}`);
console.log(`rows=${rows.length} raw_source_count=${rawCount} complete=${meta.complete}`);
console.log(`by_kind=${JSON.stringify(byKind)}`);
console.log(`phi_clean=${meta.phi_clean}${phiHits.length ? " HITS=" + phiHits.join(",") : ""}`);
