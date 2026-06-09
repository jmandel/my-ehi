#!/usr/bin/env bun
/**
 * bp-metabolic.ts — PROJECTION that fills two view-model slots for the cardiac-risk deep dive:
 *
 *   parts/bp.json        — the complete blood-pressure record (section id "bp")
 *   parts/metabolic.json — weight / A1c / CGM (section id "metabolic")
 *
 *   bun deep-dives/cardiac-risk/scripts/bp-metabolic.ts
 *
 * It reads the ALREADY-CLEAN dataset.json (the projection in scripts/project.ts has run, so dates
 * are "Aug 9, 2018", weight is in lb, BP carries sys/dia + an ACC/AHA category word) and SPLICES a
 * view-shaped result into each slot. The aggregates (mean systolic, n at/above Stage 1) are COMPUTED
 * here in code from the rows — never hard-coded — so the figures can't drift from the data.
 *
 * Slot shapes (per the fill spec):
 *   bp.json        = { readings:[{date, sys, dia, category}], meanSys, n, nStage1Plus }
 *   metabolic.json = { weight:[{date, lb}], a1c:[{date, pct}], cgm:{ordered:[...], note} }
 *
 * Every value is display-clean (formatted date strings, plain numbers, plain words). The numeric
 * `date_iso` is carried as a SIDE field for the app's D3 time scales (never display content), matching
 * the convention in project.ts. No raw export string can reach these files.
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";

const HERE = dirname(new URL(import.meta.url).pathname);
const TOPIC_DIR = join(HERE, "..");
const DS = join(TOPIC_DIR, "dataset.json");
const PARTS = join(TOPIC_DIR, "parts");
mkdirSync(PARTS, { recursive: true });

const ds = JSON.parse(readFileSync(DS, "utf8"));

// ---------------------------------------------------------------------------------------
// ACC/AHA 2017 blood-pressure category — recomputed here from sys/dia so the band plot, the
// counts, and the prose all agree (the dataset already carries this word; we re-derive to keep
// this projection self-contained and verifiable).
// ---------------------------------------------------------------------------------------
function bpCategory(sys: number, dia: number): string {
  if (sys >= 140 || dia >= 90) return "Stage 2";
  if (sys >= 130 || dia >= 80) return "Stage 1";
  if (sys >= 120 && dia < 80) return "Elevated";
  return "Normal";
}
/** at or above the Stage-1 threshold (>=130 systolic OR >=80 diastolic). */
function isStage1Plus(sys: number, dia: number): boolean {
  return sys >= 130 || dia >= 80;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// =======================================================================================
// BP slot
// =======================================================================================
const bpRows = ds.vitals
  .filter((v: any) => v.kind === "blood_pressure" && v.sys != null && v.dia != null)
  .sort((a: any, b: any) => a.date_real - b.date_real);

const readings = bpRows.map((v: any) => ({
  date: v.date as string,          // "Aug 9, 2018" — clean display date
  date_iso: v.date_iso as string,  // side field for D3 time scales (not display content)
  sys: v.sys as number,
  dia: v.dia as number,
  category: bpCategory(v.sys, v.dia),
}));

const meanSys = round1(readings.reduce((s: number, r: any) => s + r.sys, 0) / readings.length);
const nStage1Plus = readings.filter((r: any) => isStage1Plus(r.sys, r.dia)).length;

const bp = {
  readings,
  meanSys,
  n: readings.length,
  nStage1Plus,
};

writeFileSync(join(PARTS, "bp.json"), JSON.stringify(bp, null, 2));

// =======================================================================================
// METABOLIC slot
// =======================================================================================

// ---- weight -----------------------------------------------------------------------------
const weight = ds.vitals
  .filter((v: any) => v.kind === "weight" && v.weight_lb != null)
  .sort((a: any, b: any) => a.date_real - b.date_real)
  .map((v: any) => ({
    date: v.date as string,
    date_iso: v.date_iso as string,
    lb: round1(v.weight_lb as number),
  }));

// ---- A1c --------------------------------------------------------------------------------
const a1c = ds.labs
  .filter((l: any) => l.analyte === "HBA1C" && l.value_num != null)
  .sort((a: any, b: any) => a.date_real - b.date_real)
  .map((l: any) => ({
    date: l.date as string,
    date_iso: l.date_iso as string,
    pct: l.value_num as number,
  }));

// ---- CGM (FreeStyle Libre 3) -----------------------------------------------------------
// The device was self-funded and ordered; group the order rows into clean "what was ordered"
// lines (sensor / reader), de-duplicated by component+date. No CGM-derived glucose time series
// ever entered the structured record — only the device orders are present, and the device was
// marked "not taking" at the 12/4/2025 visit. State that plainly in `note`.
const COMPONENT = (desc: string): string => {
  const s = String(desc || "").toUpperCase();
  if (/READER|RECEIVER/.test(s)) return "reader";
  if (/SENSOR/.test(s)) return "sensor";
  return "device";
};
const cgmMeds = ds.medications.filter((m: any) =>
  /freestyle libre/i.test((m.name || "") + " " + (m.description || ""))
);
// one clean line per (component, ordered_on), preserving order date; de-dupe repeat sensor orders
const seen = new Set<string>();
const cgmOrdered: { item: string; orderedOn: string }[] = [];
for (const m of cgmMeds.sort((a: any, b: any) =>
  String(a.ordered_on).localeCompare(String(b.ordered_on))
)) {
  const comp = COMPONENT(m.description);
  const orderedOn = m.ordered_on as string;
  const key = `${comp}|${orderedOn}`;
  if (seen.has(key)) continue;
  seen.add(key);
  cgmOrdered.push({
    item: `FreeStyle Libre 3 ${comp}`,
    orderedOn,
  });
}

const cgm = {
  ordered: cgmOrdered,
  note:
    "Self-funded FreeStyle Libre 3 continuous glucose monitor, first ordered Mar 12, 2024 despite never " +
    "meeting diabetes criteria — a sign of real engagement with his own metabolic health. By the Dec 4, 2025 " +
    "visit the device was marked 'not taking,' and no glucose data from it ever entered the record; only the " +
    "device orders are present.",
};

const metabolic = { weight, a1c, cgm };

writeFileSync(join(PARTS, "metabolic.json"), JSON.stringify(metabolic, null, 2));

// =======================================================================================
// Receipt
// =======================================================================================
console.log(`wrote ${join(PARTS, "bp.json")}`);
console.log(
  `  bp: ${bp.n} readings, meanSys=${bp.meanSys}, nStage1Plus=${bp.nStage1Plus}`
);
console.log(`wrote ${join(PARTS, "metabolic.json")}`);
console.log(
  `  metabolic: weight=${weight.length}, a1c=${a1c.length}, cgm.ordered=${cgmOrdered.length}`
);
console.log("\n--- bp readings ---");
for (const r of readings)
  console.log(`  ${r.date}: ${r.sys}/${r.dia} (${r.category})`);
console.log("\n--- weight ---");
for (const w of weight) console.log(`  ${w.date}: ${w.lb} lb`);
console.log("\n--- a1c ---");
for (const a of a1c) console.log(`  ${a.date}: ${a.pct}%`);
console.log("\n--- cgm.ordered ---");
for (const c of cgmOrdered) console.log(`  ${c.item} — ordered ${c.orderedOn}`);
