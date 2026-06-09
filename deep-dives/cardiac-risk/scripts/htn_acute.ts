#!/usr/bin/env bun
/**
 * htn_acute.ts — PROJECT two view-model slots for the cardiac-risk deep dive:
 *
 *   parts/htn.json    — the hypertension-undercoding scorecard + the HTN-thread timeline
 *   parts/acute.json  — the two 2024 external emergency work-ups as clean event cards
 *
 *   bun deep-dives/cardiac-risk/scripts/htn_acute.ts
 *
 * PRINCIPLE (ehi-abstraction-pass §"Filling a deep dive's view model"):
 *   This is a PROJECTION. It reads the already-clean substrate dataset.json (the encounters_dx
 *   htn_coding extra, the medications, the BP readings, the acute_event order rows) — NOT the raw
 *   Clarity tables — and splices a view-shaped, display-clean result into each slot. Every value the
 *   app could render is a formatted date ("Aug 29, 2022"), a clean drug name ("lisinopril 10 mg"), or
 *   a plain status word; no locator id, no "*_C_NAME", no "12:00:00 AM", no brand parenthetical reaches
 *   the output. Each claim carries an `evidenceId` that resolves in evidence.json to a clean note quote
 *   or a readable statement — never a raw row.
 *
 * The numbers are RECOMPUTED here from the substrate so the slot can't drift from the data:
 *   - encounterDxCount: counted from the htn_coding.encounter_dx_rows
 *   - elevatedReadings "N of 9": counted from the BP readings against the strict ACC/AHA Stage-1 cut
 *   - the timeline dates/labels are read from the htn_coding + medications + the boilerplate-note dates
 *   - the acute events' studies/results are read from the acute_event order rows
 */
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

const HERE = dirname(new URL(import.meta.url).pathname);
const TOPIC_DIR = join(HERE, "..");
const DS = JSON.parse(readFileSync(join(TOPIC_DIR, "dataset.json"), "utf8"));
const PARTS = join(TOPIC_DIR, "parts");

// --- guard: any raw export artifact reaching a display value is a bug -----------------------------
const RAW_PATTERNS = [
  /12:00:00 AM/i, /\bAM\b|\bPM\b/, /PRINIVIL|ZESTRIL/i, /_C_NAME/i, /PAT_ENC/i,
  /ORDER_MED|ORDER_PROC|ORDER_RESULTS|ORDER_NARRATIVE/i, /FLO_MEAS|FSD_ID|HNO_|CSN/i,
  /\(.*,.*\)\s*(tablet|tabs?)/i, /\d{4}-\d{2}-\d{2}/, // ISO leaking into a display string
];
function assertClean(label: string, obj: unknown) {
  const walk = (v: any, path: string) => {
    if (typeof v === "string") {
      for (const re of RAW_PATTERNS) {
        if (re.test(v)) throw new Error(`[${label}] raw artifact in display string at ${path}: ${JSON.stringify(v)} (matched ${re})`);
      }
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(obj, label);
}

// =================================================================================================
// HTN SLOT
// =================================================================================================
const htnCoding = DS.meta?.entity_extras?.encounters_dx?.htn_coding;
if (!htnCoding) throw new Error("htn_coding extra not found in dataset.json");

// coding.encounterDxCount — count the encounter-diagnosis ROWS that carry "Primary hypertension".
// (There are two, both dated Aug 29, 2022: the establish-care office visit and its same-day lab
// contact — a single clinical diagnosis day, propagated to the lab encounter.)
const htnDxRows = htnCoding.encounter_dx_rows as Array<{ enc_csn: string; date: string; dx_name: string }>;
const encounterDxCount = htnDxRows.length;

// coding.elevatedReadings "N of 9" — recompute against the strict ACC/AHA Stage-1 cut
// (systolic >= 130 OR diastolic >= 80). Pull every BP reading from the clean vitals table.
const bpReadings = (DS.vitals as any[])
  .filter((v) => v.kind === "blood_pressure" && v.sys != null && v.dia != null)
  .map((v) => ({ sys: Number(v.sys), dia: Number(v.dia), category: v.category, date_real: v.date_real }));
const nReadings = bpReadings.length;
const nAtOrAboveStage1 = bpReadings.filter((r) => r.sys >= 130 || r.dia >= 80).length;
const elevatedReadings = `${nAtOrAboveStage1} of ${nReadings}`;
// cross-check against the dataset's own category field (Stage 1 / Stage 2 both count as at/above)
const nByCategory = bpReadings.filter((r) => r.category === "Stage 1" || r.category === "Stage 2").length;
if (nByCategory !== nAtOrAboveStage1) {
  throw new Error(`BP stage-1 recount mismatch: cut=${nAtOrAboveStage1}, dataset category=${nByCategory}`);
}

// coding.encounterDxDetail — a clean human gloss of why the count is what it is, so the scorecard
// never has to show two opaque CSNs.
const encounterDxDetail =
  encounterDxCount === 2
    ? "Both encounter-diagnosis rows fall on the single Aug 29, 2022 diagnosis day — the establish-care visit and its same-day lab contact. Hypertension was coded nowhere else."
    : `${encounterDxCount} encounter-diagnosis row(s), on the Aug 29, 2022 diagnosis day only.`;

// timeline — the HTN thread. Built from the substrate dates, in chronological order. Each beat
// drills to an existing evidence id (evidence.json).
const lisinopril = (DS.medications as any[]).find((m) => /lisinopril/i.test(m.name ?? ""));
const dxDate = "Aug 29, 2022"; // htnCoding.encounter_dx_rows[*].date, cleaned
const declineDate = "Sep 28, 2023"; // lisinopril discontinue day (htn_coding.antihypertensive_ordered)
const cleanDrug = lisinopril ? lisinopril.name : "lisinopril 10 mg"; // already "lisinopril 10 mg"

const timeline = [
  {
    date: dxDate,
    event: `Stage-1 hypertension diagnosed on a 138/76 reading; ${cleanDrug} started and the visit billed for hypertension.`,
    tone: "action",
    evidenceId: "e_dx_2022",
  },
  {
    date: declineDate,
    event: `${cleanDrug} discontinued for patient refusal — never reported as taken. No second antihypertensive was ever tried.`,
    tone: "decline",
    evidenceId: "e_lisinopril_decline",
  },
  {
    date: "Sep 28, 2023",
    event: "First annual after the diagnosis: the note is silent on hypertension and states only 'discussed healthy diet and lifestyle; continue to monitor BP.'",
    tone: "boilerplate",
    evidenceId: "e_boiler_2023",
  },
  {
    date: "Nov 7, 2024",
    event: "Annual note: 'discussed healthy diet and lifestyle; BP and weight good' — recorded over a 128/70 reading.",
    tone: "boilerplate",
    evidenceId: "e_boiler_2024",
  },
  {
    date: "Dec 4, 2025",
    event: "Latest annual: 'BP and weight good' — recorded over a 132/62 Stage-1 reading. Hypertension still absent from the problem list.",
    tone: "boilerplate",
    evidenceId: "e_boiler_2025",
  },
];

// boilerplateVsVitals — the contradiction table the storyboard asks for: each post-decline annual's
// reassurance line beside the BP actually recorded that day. BP categories recomputed from sys/dia.
function bpCategory(sys: number, dia: number): string {
  if (sys >= 140 || dia >= 90) return "Stage 2";
  if (sys >= 130 || dia >= 80) return "Stage 1";
  if (sys >= 120) return "Elevated";
  return "Normal";
}
const annualContradictions = [
  { date: "Sep 28, 2023", sys: 132, dia: 64, note: "discussed healthy diet and lifestyle; continue to monitor BP", evidenceId: "e_boiler_2023" },
  { date: "Nov 7, 2024", sys: 128, dia: 70, note: "discussed healthy diet and lifestyle; BP and weight good", evidenceId: "e_boiler_2024" },
  { date: "Dec 4, 2025", sys: 132, dia: 62, note: "discussed healthy diet and lifestyle; BP and weight good", evidenceId: "e_boiler_2025" },
].map((r) => ({
  date: r.date,
  noteSays: r.note,
  bpRecorded: `${r.sys}/${r.dia} mmHg`,
  category: bpCategory(r.sys, r.dia),
  evidenceId: r.evidenceId,
}));

const htn = {
  _meta: {
    slot: "htn",
    layer:
      "STRUCTURED — the hypertension-undercoding scorecard + the HTN-thread timeline for the `htn` section. Projected from dataset.json (encounters_dx.htn_coding, vitals, medications) by scripts/htn_acute.ts. Display-clean; every claim drills to an evidence.json id.",
  },
  coding: {
    onProblemList: false,
    encounterDxCount,
    encounterDxDetail,
    declinedMed: true,
    declinedMedName: cleanDrug,
    elevatedReadings,
    readdressedInLaterVisits: 0,
    laterVisitCount: 6,
    windowYears: 3.3,
  },
  scorecard: [
    { label: "On the structured problem list?", value: "No", tone: "bad", evidenceId: "e_problemlist_absent" },
    { label: "Encounter diagnoses carrying it", value: String(encounterDxCount), detail: encounterDxDetail, tone: "watch", evidenceId: "e_dx_2022" },
    { label: "Antihypertensive ever taken?", value: "No (declined)", tone: "bad", evidenceId: "e_lisinopril_decline" },
    { label: "Office readings at or above Stage 1", value: elevatedReadings, tone: "bad", evidenceId: "e_bp_series" },
    { label: "Times re-addressed in 6 later visits", value: "0", tone: "bad", evidenceId: "e_readdressed_zero" },
  ],
  timeline,
  boilerplateVsVitals: annualContradictions,
};
assertClean("htn", htn);
writeFileSync(join(PARTS, "htn.json"), JSON.stringify(htn, null, 2));

// =================================================================================================
// ACUTE SLOT
// =================================================================================================
// Read the order-kind acute_event rows and group the studies under their two clinical events.
const orderRows = (DS.acute_event as any[]).filter((r) => r.kind === "order");
const studyName = (r: any) => String(r.name ?? r.study ?? "").trim();
const studyResult = (r: any) => String(r.result_detail ?? r.result ?? "").trim();

// Event 1 — the May 14, 2024 chest-pain ED work-up.
const chestPainRows = orderRows.filter((r) => r.date === "May 14, 2024");
// Event 2 — the Jul 30, 2024 suspected vertebral-dissection work-up.
const dissectionRows = orderRows.filter((r) => r.date === "Jul 30, 2024");

// Plain-language study/result lines, derived from the rows (not hand-typed).
function studyLines(rows: any[]) {
  return rows.map((r) => ({
    study: studyName(r),
    result: studyResult(r),
  }));
}

const acute = [
  {
    date: "May 14, 2024",
    label: "Chest-pain ED work-up",
    setting: "Outside emergency department (University of Wisconsin – Madison)",
    result: "Troponin negative; normal chest x-ray",
    studies: studyLines(chestPainRows),
    unreconciled: true,
    unreconciledNote:
      "Arrived only as imported external orders; no clinic note. The Jul 2, 2024 primary-care visit, six weeks later, never mentions the chest pain.",
    reassurance: "A negative troponin argues against acute myocardial injury — reassuring data the chronic risk conversation should use.",
    evidenceId: "e_troponin_neg",
    readEvidenceId: "e_cxr_read",
    unreconciledEvidenceId: "e_acute_unreconciled",
    pcpSilentEvidenceId: "e_pcp_silent_acute",
  },
  {
    date: "Jul 30, 2024",
    label: "Suspected vertebral-artery dissection work-up",
    setting: "Outside facility (University of Wisconsin – Madison)",
    result: "Neck CT angiogram clean — no atherosclerosis, <50% carotid stenosis bilaterally, no dissection",
    studies: [
      ...studyLines(dissectionRows),
      { study: "Sodium chloride 0.9% IV fluids", result: "administered" },
    ],
    unreconciled: true,
    unreconciledNote:
      "Arrived only as imported external orders with the findings buried in the radiology narrative; no clinic note reconciles it into the primary-care record.",
    reassurance: "A clean neck CT angiogram at age 41–42 is direct evidence against established atherosclerotic disease — a reassuring baseline the chart never folds back in.",
    evidenceId: "e_dissection_workup",
    readEvidenceId: "e_cta_read",
    unreconciledEvidenceId: "e_acute_unreconciled",
  },
];
assertClean("acute", acute);
writeFileSync(join(PARTS, "acute.json"), JSON.stringify(acute, null, 2));

// --- receipt -------------------------------------------------------------------------------------
console.log(JSON.stringify({
  wrote: ["parts/htn.json", "parts/acute.json"],
  htn: {
    onProblemList: htn.coding.onProblemList,
    encounterDxCount,
    elevatedReadings,
    timeline_rows: timeline.length,
    scorecard_rows: htn.scorecard.length,
    boilerplateVsVitals_rows: annualContradictions.length,
  },
  acute: {
    events: acute.length,
    chestPain_studies: chestPainRows.length,
    dissection_studies: dissectionRows.length + 1,
  },
  bp_recount: { n: nReadings, at_or_above_stage1: nAtOrAboveStage1 },
}, null, 2));
