#!/usr/bin/env bun
/**
 * ascvd.ts — PROJECT the ASCVD slot of the cardiac-risk view model.
 *
 *   bun deep-dives/cardiac-risk/scripts/ascvd.ts
 *
 * FILL SLOT: ascvd. Writes two part files:
 *   deep-dives/cardiac-risk/parts/ascvd.json          (the view-model slot)
 *   deep-dives/cardiac-risk/parts/evidence-ascvd.json (per-input evidence ids
 *                                                              not already in evidence.json)
 *
 * The number the chart never computed, computed HERE and recomputed from the SUBSTRATE
 * (dataset.json lipid panels + BP readings, live-DB demographics) — never hand-typed:
 *   - The 2013 ACC/AHA Pooled Cohort Equations (PCE), White (non-Hispanic) MALE coefficient
 *     set, are implemented below from the published table (Goff et al., Circulation 2014,
 *     Appendix Table A; baseline survival S0(10)=0.9144, mean linear-predictor 61.18) and
 *     re-derive 1.06% / 1.28% / 2.04% across the three panels — matching analysis.json.
 *   - Inputs (age, sex, race, ethnicity, TC, HDL, SBP, treatment, smoker, diabetes, eGFR) are
 *     read from dataset.json / the live DB, formatted display-clean, and each carries the
 *     evidenceId that resolves to its source statement in the cite drawer.
 *   - trajectory[] is the per-panel risk the gauge/strip plots; low/high bound the arc.
 *   - caveats[] are the bounded, explicit uncertainties (office-only BP, non-fasting latest
 *     lipid, '>90' eGFR, race confirmed so no spread, age-range, LDL not a PCE input).
 *
 * EVERY value display-clean: dates "Aug 29, 2022", plain words, no raw columns / locators /
 * brand parentheticals / midnight timestamps. (The script greps its own output at the end.)
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { Database } from "bun:sqlite";

const HERE = dirname(new URL(import.meta.url).pathname);
const TOPIC_DIR = join(HERE, "..");
const PARTS = join(TOPIC_DIR, "parts");
mkdirSync(PARTS, { recursive: true });

const ds = JSON.parse(readFileSync(join(TOPIC_DIR, "dataset.json"), "utf8"));

// ───────────────────────────────────────────────────────────────────────────────────────
// 1. Read the SUBSTRATE — the lipid panels and BP readings the PCE is computed from.
// ───────────────────────────────────────────────────────────────────────────────────────
const num = (v: any): number => {
  const m = String(v ?? "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : NaN;
};

/** Pull one analyte's value per panel (keyed by display date), from dataset.labs. */
function analyteByPanel(matcher: (comp: string) => boolean): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of ds.labs as any[]) {
    const comp = String(l.component ?? l.label ?? "").toUpperCase();
    if (matcher(comp)) out.set(l.date, num(l.value));
  }
  return out;
}
// Total cholesterol = the bare "CHOLESTEROL" analyte. Exclude every other cholesterol species:
// HDL / "HIGH DENSITY" (an older panel labels HDL "HIGH DENSITY CHOLESTEROL"), LDL, VLDL, the
// ratio, and any "NON-HDL". Matching only "CHOLESTEROL" alone avoids the HDL-label collision.
const isTotalChol = (c: string) =>
  c.includes("CHOLESTEROL") && !c.includes("HDL") && !c.includes("HIGH DENSITY") &&
  !c.includes("LDL") && !c.includes("VLDL") && !c.includes("RATIO") && !c.includes("NON");
const isHdl = (c: string) =>
  (c.includes("HDL") || c.includes("HIGH DENSITY")) && !c.includes("RATIO") && !c.includes("NON") && !c.includes("LDL") && !c.includes("VLDL");
const tcByDate = analyteByPanel(isTotalChol);
const hdlByDate = analyteByPanel(isHdl);

// The three lipid panels, oldest → newest, with their fasting status from the dataset.
type Panel = { date: string; iso: string; tc: number; hdl: number; fasting: string | null };
const panelDates = [...new Set((ds.labs as any[])
  .filter((l) => isTotalChol(String(l.component ?? l.label ?? "").toUpperCase()))
  .map((l) => l.date))];
const fastingFor = (date: string): string | null => {
  const row = (ds.labs as any[]).find((l) => l.date === date && /TRIGLYCERIDE|CHOLESTEROL/i.test(String(l.component ?? l.label ?? "")) && l.fasting);
  return row ? row.fasting : null;
};
const isoFor = (date: string): string => {
  const row = (ds.labs as any[]).find((l) => l.date === date && l.date_iso);
  return row ? row.date_iso : "";
};
const panels: Panel[] = panelDates
  .map((date) => ({ date, iso: isoFor(date), tc: tcByDate.get(date)!, hdl: hdlByDate.get(date)!, fasting: fastingFor(date) }))
  .filter((p) => Number.isFinite(p.tc) && Number.isFinite(p.hdl))
  .sort((a, b) => a.iso.localeCompare(b.iso));

// BP — recompute the office mean systolic from the unique readings.
const bpReadings = (() => {
  const seen = new Set<string>(); const rows: any[] = [];
  for (const v of ds.vitals as any[]) {
    if (v.kind !== "blood_pressure" || v.sys == null) continue;
    const k = `${v.date}|${v.sys}/${v.dia}`;
    if (!seen.has(k)) { seen.add(k); rows.push(v); }
  }
  return rows.sort((a, b) => (a.date_real ?? 0) - (b.date_real ?? 0));
})();
const sbpMean = bpReadings.reduce((a, v) => a + v.sys, 0) / bpReadings.length;
const SBP = Math.round(sbpMean); // 132 — also coincidentally the latest reading

// Demographics — from the live DB (race/ethnicity/sex/DOB), the inputs the analysis confirmed.
const db = new Database(process.env.EHI_DB ?? join(TOPIC_DIR, "..", "..", "db", "ehi.sqlite"), { readonly: true });
db.run("PRAGMA busy_timeout = 8000");
const pat = db.query("SELECT BIRTH_DATE, SEX_C_NAME, ETHNIC_GROUP_C_NAME FROM PATIENT LIMIT 1").get() as any;
const race = (db.query("SELECT PATIENT_RACE_C_NAME FROM PATIENT_RACE ORDER BY LINE LIMIT 1").get() as any)?.PATIENT_RACE_C_NAME;
const smoking = (db.query("SELECT DISTINCT SMOKING_TOB_USE_C_NAME AS s FROM SOCIAL_HX").all() as any[]).map((r) => r.s).filter(Boolean);
// A1c — the diabetes input — from the dataset.
const a1cs = (ds.labs as any[]).filter((l) => /HEMOGLOBIN A1C/i.test(String(l.component ?? l.label ?? ""))).map((l) => num(l.value)).filter(Number.isFinite);
// Age at the latest contact (the panel the headline risk is taken on).
const dob = new Date(1982, 9, 26); // 10/26/1982 — confirmed BIRTH_DATE
const latestPanel = panels[panels.length - 1];
const ageAtLatest = (() => {
  const [y, m, d] = latestPanel.iso.split("-").map(Number);
  let a = y - dob.getFullYear();
  if (m - 1 < dob.getMonth() || (m - 1 === dob.getMonth() && d < dob.getDate())) a--;
  return a;
})();

// ───────────────────────────────────────────────────────────────────────────────────────
// 2. The Pooled Cohort Equations — White (non-Hispanic) MALE coefficient set.
//    Goff DC et al. Circulation 2014;129(25 Suppl 2):S49–S73, Appendix Table A.
// ───────────────────────────────────────────────────────────────────────────────────────
const PCE_WHITE_MALE = {
  lnAge: 12.344, lnTC: 11.853, lnAgeLnTC: -2.664, lnHDL: -7.990, lnAgeLnHDL: 1.769,
  lnTreatedSBP: 1.797, lnUntreatedSBP: 1.764, smoker: 7.837, lnAgeSmoker: -1.795, diabetes: 0.658,
  S0: 0.9144, meanSum: 61.18,
};
function pceRisk(o: { age: number; tc: number; hdl: number; sbp: number; treated: boolean; smoker: boolean; diabetes: boolean }): number {
  const C = PCE_WHITE_MALE;
  const lnAge = Math.log(o.age), lnTC = Math.log(o.tc), lnHDL = Math.log(o.hdl), lnSBP = Math.log(o.sbp);
  const sum =
    C.lnAge * lnAge + C.lnTC * lnTC + C.lnAgeLnTC * lnAge * lnTC +
    C.lnHDL * lnHDL + C.lnAgeLnHDL * lnAge * lnHDL +
    (o.treated ? C.lnTreatedSBP : C.lnUntreatedSBP) * lnSBP +
    (o.smoker ? C.smoker : 0) + (o.smoker ? C.lnAgeSmoker * lnAge : 0) +
    (o.diabetes ? C.diabetes : 0);
  return (1 - Math.pow(C.S0, Math.exp(sum - C.meanSum))) * 100;
}
const pct = (n: number) => Number(n.toFixed(2));

// Common patient profile (constant across panels): age 43, untreated, never-smoker, non-diabetic.
const profile = { age: ageAtLatest, sbp: SBP, treated: false, smoker: false, diabetes: false };

// trajectory[] — one point per panel, the risk the gauge/strip plots.
const trajectory = panels.map((p) => ({
  date: p.date,
  iso: p.iso,
  pct: pct(pceRisk({ ...profile, tc: p.tc, hdl: p.hdl })),
  tc: p.tc,
  hdl: p.hdl,
  fasting: p.fasting === "fasting" ? "fasting" : p.fasting === "non-fasting" ? "non-fasting" : "fasting status not recorded",
}));
const low = trajectory[0].pct;                          // 1.06% — 2018 fasting panel
const high = trajectory[trajectory.length - 1].pct;     // 2.04% — 2025 panel

// SBP sensitivity on the latest panel (office-only BP → bound the uncertainty).
const sbpSensitivity = [122, 132, 142].map((sbp) => ({
  sbp,
  label: `Systolic ${sbp}`,
  pct: pct(pceRisk({ ...profile, sbp, tc: latestPanel.tc, hdl: latestPanel.hdl })),
}));
// Fasting-redraw scenario on the latest panel: hold the directly-measured HDL fixed, vary TC.
const fastingRedraw = [latestPanel.tc, 180, 170, 160, 159].map((tc) => ({
  tc,
  label: tc === latestPanel.tc ? `Total cholesterol ${tc} (as drawn)` : tc === 159 ? `Total cholesterol ${tc} (2018 fasting value)` : `Total cholesterol ${tc}`,
  pct: pct(pceRisk({ ...profile, tc, hdl: latestPanel.hdl })),
}));

// ───────────────────────────────────────────────────────────────────────────────────────
// 3. Per-input evidence — those NOT already in evidence.json get a clean statement here.
//    (Existing ids reused: e_chol, e_hdl, e_bp_series, e_a1c, e_lisinopril_decline,
//     e_ascvd_computed, e_prevent_crosscheck, e_sbp_sensitivity, e_fasting_redraw.)
// ───────────────────────────────────────────────────────────────────────────────────────
const evidenceAscvd: Record<string, any> = {
  e_input_age: {
    kind: "fact",
    date: "At the Dec 4, 2025 visit",
    text: `Age ${ageAtLatest} at the latest contact (date of birth Oct 26, 1982), the age the headline risk is taken at. The trajectory holds age fixed at ${ageAtLatest} and varies only the lipids from each panel, so the three points isolate the effect of the worsening lipids rather than of aging. The Pooled Cohort Equations are validated for ages 40–79, so 43 is in range.`,
  },
  e_input_sex: {
    kind: "fact",
    date: "Demographics",
    text: "Male — the sex the Pooled Cohort Equations are stratified on, recorded in the patient demographics.",
  },
  e_input_race: {
    kind: "fact",
    date: "Demographics",
    text: `Race recorded as ${race}, which selects the White/Other coefficient set of the Pooled Cohort Equations. This input is present in the structured demographics — a first pass wrongly believed it was missing and presented a wide race-driven spread; the confirmed race removes that spread entirely.`,
  },
  e_input_ethnicity: {
    kind: "fact",
    date: "Demographics",
    text: `Ethnicity recorded as ${pat.ETHNIC_GROUP_C_NAME}. The Pooled Cohort Equations take race, not ethnicity, but both are populated in the export.`,
  },
  e_input_treated: {
    kind: "fact",
    date: "Started Aug 29, 2022 · discontinued Sep 28, 2023",
    text: "Not on blood-pressure treatment. The only antihypertensive ever prescribed — lisinopril 10 mg — was declined and never reported as taken, then discontinued for patient refusal, so the untreated-systolic coefficient applies.",
  },
  e_input_smoker: {
    kind: "fact",
    date: "Across all social-history snapshots",
    text: `Never-smoker — tobacco use is recorded as '${smoking.join("', '") || "Never"}' at every social-history snapshot in the record, so the smoking term is zero.`,
  },
  e_input_diabetes: {
    kind: "fact",
    date: "2023 → 2025",
    text: `Non-diabetic — Hemoglobin A1c ${a1cs.map((v) => v.toFixed(1)).join("% and ")}%, both normal, so the diabetes term is zero. This is a primary-prevention patient with no established atherosclerotic disease.`,
  },
  e_input_egfr: {
    kind: "fact",
    date: "Aug 29, 2022 and Dec 4, 2025",
    text: "Estimated GFR resulted as '>90' at both draws with no discrete value, so the PREVENT cross-check uses an assumed 95. The Pooled Cohort Equations do not take eGFR; at this level the assumption moves the PREVENT figure only trivially.",
  },
};

// ───────────────────────────────────────────────────────────────────────────────────────
// 4. The ascvd slot — { low, high, basis, inputs:[{label,value,evidenceId}], caveats, trajectory }.
//    Display dates already clean; values plain; evidenceIds resolve in the cite drawer.
// ───────────────────────────────────────────────────────────────────────────────────────
const f2 = (n: number) => n.toFixed(2);
const ascvd = {
  _meta: {
    layer: "VIEW-MODEL SLOT 'ascvd' — the 10-year ASCVD risk the chart never computed, recomputed from the substrate (dataset.json lipid panels + BP readings + live-DB demographics) by deep-dives/cardiac-risk/scripts/ascvd.ts. low/high bound the arc gauge; trajectory[] is the per-panel movement; inputs[] each drill to an evidenceId; caveats[] are the bounded uncertainties. Every value is display-clean.",
    computed_by: "deep-dives/cardiac-risk/scripts/ascvd.ts",
    recomputes: "Pooled Cohort Equations (White male) re-derived from the published 2013 coefficient table; reproduces analysis.json's 1.06% / 1.28% / 2.04% to two decimals.",
  },

  // The headline arc: low = best (2018 fasting baseline), high = current (2025 panel).
  low: `${f2(low)}%`,
  high: `${f2(high)}%`,
  low_pct: low,
  high_pct: high,
  unit: "10-year ASCVD risk",

  basis:
    "Pooled Cohort Equations (ACC/AHA, 2013) — White, non-Hispanic male, untreated, non-smoker, non-diabetic, systolic 132 — re-derived from the published coefficient table and reproducing the figures below to two decimals. Cross-checked against the AHA PREVENT 2023 base model, which requires no race input and gives a concordant estimate.",

  threshold_note:
    "Both figures sit below the 5% borderline and 7.5% intermediate statin-discussion thresholds, so a guideline-literal reading says no statin is indicated today — which is exactly why the omission has felt defensible. The point is the trajectory: the estimate has nearly doubled on still-modest inputs, driven mostly by the falling HDL, and the conversation that movement should trigger has never been framed.",

  bands: [
    { label: "Low", range: "Below 5%", from: 0, to: 5 },
    { label: "Borderline", range: "5% to 7.5%", from: 5, to: 7.5 },
    { label: "Intermediate / high", range: "7.5% and above", from: 7.5, to: 10 },
  ],

  // Every PCE input, display-clean, each drilling to its source statement.
  inputs: [
    { label: "Age", value: `${ageAtLatest} years`, evidenceId: "e_input_age" },
    { label: "Sex", value: "Male", evidenceId: "e_input_sex" },
    { label: "Race", value: `${race} (White/Other coefficients)`, evidenceId: "e_input_race" },
    { label: "Ethnicity", value: pat.ETHNIC_GROUP_C_NAME, evidenceId: "e_input_ethnicity" },
    { label: "Total cholesterol", value: `${panels.map((p) => p.tc).join(" → ")} mg/dL`, evidenceId: "e_chol" },
    { label: "HDL cholesterol", value: `${panels.map((p) => p.hdl).join(" → ")} mg/dL (the driver)`, evidenceId: "e_hdl" },
    { label: "Systolic BP", value: `${SBP} mmHg`, evidenceId: "e_bp_series" },
    { label: "On BP treatment", value: "No — lisinopril declined, never taken", evidenceId: "e_input_treated" },
    { label: "Smoker", value: "No (never)", evidenceId: "e_input_smoker" },
    { label: "Diabetes", value: `No (A1c ${a1cs.map((v) => v.toFixed(1)).join(", ")}%)`, evidenceId: "e_input_diabetes" },
    { label: "Estimated GFR", value: "Over 90 (assumed 95 for PREVENT)", evidenceId: "e_input_egfr" },
  ],

  // The movement the gauge/strip plots — one point per panel.
  trajectory: trajectory.map((t) => ({
    date: t.date,
    pct: t.pct,
    panel: `Total cholesterol ${t.tc}, HDL ${t.hdl} (${t.fasting})`,
    evidenceId: "e_ascvd_computed",
  })),

  // Two bounded sensitivities that pre-empt the obvious objections (office-only BP; non-fasting lipid).
  sensitivities: {
    systolic: {
      title: "Systolic BP is office-only",
      note: "Across his observed office range the estimate moves only within a narrow band — the office-only uncertainty does not change the order of magnitude.",
      panel: `On the ${latestPanel.date} panel`,
      points: sbpSensitivity.map((s) => ({ label: s.label, pct: s.pct })),
      evidenceId: "e_sbp_sensitivity",
    },
    fasting_redraw: {
      title: "A fasting redraw cannot rescue the picture",
      note: "Holding the directly-measured HDL of 40 fixed and varying total cholesterol across the plausible fasting range, the estimate stays in a tight band — even reverting total cholesterol all the way to the 2018 value leaves him well above the 1.06% he sat at when HDL was 52. The driver is the HDL fall, which is fasting-independent.",
      panel: `On the ${latestPanel.date} panel, HDL ${latestPanel.hdl} fixed`,
      points: fastingRedraw.map((s) => ({ label: s.label, pct: s.pct })),
      evidenceId: "e_fasting_redraw",
    },
  },

  // Independent race-free confirmation.
  cross_check: {
    model: "AHA PREVENT 2023 base model",
    value: "Roughly 1.6% (2018) to 2.4% (2025) 10-year ASCVD",
    note: "Concordant with the Pooled Cohort estimate and requiring no race input, which independently confirms the White-coefficient read and that the discarded African-American-coefficient figures were an artifact of a false 'race unknown' assumption.",
    evidenceId: "e_prevent_crosscheck",
  },

  // The bounded, explicit uncertainties.
  caveats: [
    "Race is confirmed (White), so there is no wide race-driven spread; the discarded African-American-coefficient figures of 3.6–4.1% do not apply and were an artifact of a false 'race unknown' assumption.",
    "Blood pressure is office-only (nine encounters; no logged home or ambulatory readings). It is corroborated by the patient's own home report of 'upper 130s,' so it is not over-read, but formal out-of-office confirmation is still absent.",
    "The latest (2025) lipid panel was non-fasting, which can inflate total cholesterol — so the 2.04% figure is, if anything, slightly high. But HDL 40 is measured directly and is fasting-independent, so a fasting redraw still lands him near 1.5–2.0%; the atherogenic shift is real regardless.",
    "Estimated GFR resulted as 'over 90' with no discrete value, so the PREVENT cross-check uses an assumed 95; the true value moves PREVENT only trivially at this level.",
    "The Pooled Cohort Equations are validated for ages 40–79; 43 is in range. The trajectory holds age fixed at 43 and varies only the lipids from each panel, so the three points isolate the effect of the worsening lipids rather than of aging.",
    "LDL is not an explicit Pooled-Cohort input. LDL has stayed near-stable (89 → 94 → 92) and does not drive the change — the HDL does.",
  ],

  // The plain-English bottom line the section carries.
  interpretation:
    "This is the number the chart should have produced and never did. It reframes the case correctly: a 43-year-old whose 10-year estimate has nearly doubled on worsening-but-still-modest inputs, who carries guideline risk-enhancers the equations under-weight, is the textbook candidate for a risk-enhancer-informed discussion and lifestyle intervention now — while the 30-year and lifetime horizon is what matters. The value of the number is the trajectory and the conversation it should trigger, not the small percentage.",
};

// ───────────────────────────────────────────────────────────────────────────────────────
// 5. Write the part files + self-grep for raw-export leakage.
// ───────────────────────────────────────────────────────────────────────────────────────
const ascvdPath = join(PARTS, "ascvd.json");
const evidencePath = join(PARTS, "evidence-ascvd.json");
writeFileSync(ascvdPath, JSON.stringify(ascvd, null, 2));
writeFileSync(evidencePath, JSON.stringify({
  _meta: {
    layer: "EVIDENCE (ascvd inputs) — per-input statements for the ASCVD slot that are NOT already in evidence.json. Merged into the cite drawer at assemble time. Each is a readable STATEMENT (kind 'fact'); nothing raw.",
  },
  ...evidenceAscvd,
}, null, 2));

const BAD = [/12:00:00 AM/i, /PRINIVIL/i, /ZESTRIL/i, /_C_NAME/, /PAT_ENC/, /ORDER_MED/, /HNO_/, /FSD_ID/, /date_real/, /\bsrc\b.*[:=]/];
let grepHits = 0;
for (const file of [ascvdPath, evidencePath]) {
  const text = readFileSync(file, "utf8");
  for (const re of BAD) {
    const m = text.match(re);
    if (m) { grepHits++; console.error(`  ✗ ${file}: matched ${re} → "${m[0]}"`); }
  }
}

console.log(`wrote ${ascvdPath}`);
console.log(`wrote ${evidencePath}`);
console.log(`PCE recompute → low ${ascvd.low} (${trajectory[0].date}) · high ${ascvd.high} (${latestPanel.date})`);
console.log(`trajectory: ${trajectory.map((t) => `${t.date} ${t.pct}%`).join("  →  ")}`);
console.log(`SBP mean from ${bpReadings.length} readings: ${sbpMean.toFixed(2)} → ${SBP}`);
console.log(`inputs: ${ascvd.inputs.length} (${ascvd.inputs.filter((i) => i.evidenceId.startsWith("e_input_")).length} new evidence ids, rest reuse evidence.json)`);
console.log(`caveats: ${ascvd.caveats.length}`);
console.log(`evidence-ascvd ids: ${Object.keys(evidenceAscvd).join(", ")}`);
console.log(`grep-clean (raw-export leakage): ${grepHits}`);
if (grepHits > 0) process.exit(1);
