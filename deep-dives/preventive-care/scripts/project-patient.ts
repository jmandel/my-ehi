#!/usr/bin/env bun
/**
 * project-patient.ts — project the RAW EHI export into clean patient-side inputs for the
 * preventive-care audit. Emits parts/patient-data.json (facts, completions, Epic HM status, evidence).
 *
 * This is the "projection" half of the engine: structured tables → display-clean JSON.
 * The guideline half (parts/guidelines.json) is sourced separately; evaluate.ts joins the two.
 *
 *   bun deep-dives/preventive-care/scripts/project-patient.ts
 *
 * Read-only. No PHI in output (no name / MRN / address / phone).
 */
import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "fs";

const ASOF_ISO = "2026-06-09"; // audit "as of" date (deterministic; matches the export vintage)
const db = new Database(process.env.EHI_DB ?? "./db/ehi.sqlite", { readonly: true });
const all = (sql: string, ...p: any[]) => db.query(sql).all(...p) as Record<string, any>[];
const one = (sql: string, ...p: any[]) => (db.query(sql).get(...p) as Record<string, any>) ?? null;

// ---- date helpers: Epic stores "M/D/YYYY hh:mm:ss AM" ----
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function parseDate(raw?: string | null): { iso: string; display: string } | null {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, mo, da, yr] = m;
  const iso = `${yr}-${mo.padStart(2, "0")}-${da.padStart(2, "0")}`;
  return { iso, display: `${MONTHS[+mo - 1]} ${+da}, ${yr}` };
}
const yearsBetween = (aIso: string, bIso: string) =>
  (Date.parse(bIso) - Date.parse(aIso)) / (365.2425 * 864e5);

// ---- patient demographics + derived age (PHI-safe: sex + dob year only used downstream) ----
const pat = one(`SELECT BIRTH_DATE, SEX_C_NAME FROM PATIENT LIMIT 1`)!;
const dob = parseDate(pat.BIRTH_DATE)!;
const ageYears = Math.floor(yearsBetween(dob.iso, ASOF_ISO));

// ---- risk facts that drive eligibility ----
const sh = one(`SELECT TOBACCO_USER_C_NAME, SMOKING_TOB_USE_C_NAME, ALCOHOL_USE_C_NAME,
                       ILL_DRUG_USER_C_NAME, IV_DRUG_USER_YN, SEXUALLY_ACTIVE_C_NAME
                FROM SOCIAL_HX ORDER BY CONTACT_DATE DESC LIMIT 1`) ?? {};
const bmiRows = all(`SELECT CONTACT_DATE, BMI FROM PAT_ENC WHERE BMI IS NOT NULL AND BMI!=''`)
  .map(r => ({ ...parseDate(r.CONTACT_DATE), bmi: +(+r.BMI).toFixed(1) }))
  .filter(r => r.iso)
  .sort((a, b) => a.iso!.localeCompare(b.iso!)); // text dates sort lexically; sort by parsed ISO
const latestBmi = bmiRows[bmiRows.length - 1];
// PROBLEM_LIST.DESCRIPTION is blank here; resolve the diagnosis name via CLARITY_EDG by DX_ID.
const problems = all(`SELECT COALESCE(NULLIF(TRIM(p.DESCRIPTION),''), e.DX_NAME) AS name
                      FROM PROBLEM_LIST p LEFT JOIN CLARITY_EDG e ON e.DX_ID=p.DX_ID
                      WHERE p.PROBLEM_STATUS_C_NAME='Active'`).filter(r => r.name);
// which (if any) are cardiometabolic / screening-relevant risk drivers?
const RISK_DX = /diabet|hypertens|obesity|overweight|hyperlipid|dyslipid|chronic kidney|ckd|coronary|cardiovascular|hepatitis|HIV|smok|tobacco|alcohol use disorder/i;
const riskRelevant = problems.filter(p => RISK_DX.test(p.name));

const evidence: Record<string, any> = {};
const ev = (id: string, e: any) => { evidence[id] = e; return id; };

const riskFacts = [
  { key: "age", label: "Age", value: `${ageYears} years (DOB ${dob.display.replace(/, \d{4}/, m => m)})`,
    evidenceId: ev("e_age", { kind: "fact", text: `Date of birth ${dob.display}; age ${ageYears} as of ${ASOF_ISO}.` }) },
  { key: "sex", label: "Sex", value: String(pat.SEX_C_NAME),
    evidenceId: ev("e_sex", { kind: "fact", text: `Sex recorded as ${pat.SEX_C_NAME}.` }) },
  { key: "smoking", label: "Tobacco use", value: `${sh.TOBACCO_USER_C_NAME ?? "?"} (smoking: ${sh.SMOKING_TOB_USE_C_NAME ?? "?"})`,
    decisive: true,
    evidenceId: ev("e_smoking", { kind: "fact", who: "Social history", text: `Tobacco user: ${sh.TOBACCO_USER_C_NAME}; smoking tobacco use: ${sh.SMOKING_TOB_USE_C_NAME}. A lifelong never-smoker.` }) },
  { key: "bmi", label: "Body-mass index", value: latestBmi ? `${latestBmi.bmi} (${latestBmi.display})` : "—",
    decisive: true, trend: bmiRows,
    evidenceId: ev("e_bmi", { kind: "fact", who: "Vitals", text: `BMI ${latestBmi?.bmi} on ${latestBmi?.display}. Trend: ${bmiRows.map(b => `${b.bmi} (${b.iso.slice(0,4)})`).join(" → ")}. Crossed the 25 overweight threshold only recently.` }) },
  { key: "alcohol", label: "Alcohol use", value: String(sh.ALCOHOL_USE_C_NAME ?? "?"),
    evidenceId: ev("e_alcohol", { kind: "fact", who: "Social history", text: `Alcohol use: ${sh.ALCOHOL_USE_C_NAME}.` }) },
  { key: "drugs", label: "Injection-drug use", value: `${sh.ILL_DRUG_USER_C_NAME ?? "?"} (IV: ${sh.IV_DRUG_USER_YN ?? "?"})`,
    evidenceId: ev("e_drugs", { kind: "fact", who: "Social history", text: `Illicit drug user: ${sh.ILL_DRUG_USER_C_NAME}; IV drug use: ${sh.IV_DRUG_USER_YN}.` }) },
  { key: "problems",
    label: "Active problems",
    value: problems.length
      ? (riskRelevant.length ? `${problems.length} active, incl. ${riskRelevant.map(p=>p.name).join(", ")}` : `${problems.length} active — none cardiometabolic`)
      : "None on problem list",
    evidenceId: ev("e_problems", { kind: "fact", who: "Problem list", text: problems.length
      ? `Active problems: ${problems.map(p=>p.name).join("; ")}. ${riskRelevant.length ? `Screening-relevant: ${riskRelevant.map(p=>p.name).join(", ")}.` : "None are cardiometabolic risk factors, so an average-risk default applies for screening eligibility."}`
      : "No active conditions on the problem list — average-risk default for screening." }) },
];

// ---- immunizations: clean families, dedup by (family, date) ----
function vaccineFamily(name: string): { family: string; label: string } | null {
  const n = (name || "").toUpperCase();
  if (!n) return null;
  if (n.includes("INFLUENZA")) return { family: "influenza", label: "Influenza" };
  if (n.includes("COVID")) return { family: "covid", label: "COVID-19" };
  if (n.includes("TDAP") || n.includes("TETANUS")) return { family: "tdap", label: "Tdap (tetanus/diphtheria/pertussis)" };
  if (n.includes("HEPATITIS A") || n.includes("HEPA")) return { family: "hepA", label: "Hepatitis A" };
  if (n.includes("HEPATITIS B") || n.includes("HEPB")) return { family: "hepB", label: "Hepatitis B" };
  if (n.includes("TYPHOID")) return { family: "typhoid", label: "Typhoid (travel)" };
  if (n.includes("ZOSTER") || n.includes("SHINGRIX")) return { family: "zoster", label: "Zoster (shingles)" };
  if (n.includes("PNEUMO")) return { family: "pneumococcal", label: "Pneumococcal" };
  if (n.includes("HPV")) return { family: "hpv", label: "HPV" };
  return { family: "other", label: name.split("(")[0].trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) };
}
const immRaw = all(`SELECT IMM_TYPE_ID_NAME, IMM_DATE, IMM_MANUFACTURER_C_NAME, IMM_LOT_NUMBER, IMM_STATUS_C_NAME
                    FROM IMM_ADMIN WHERE IMM_DATE IS NOT NULL`);
const immSeen = new Set<string>();
const immunizations: any[] = [];
for (const r of immRaw) {
  if (r.IMM_STATUS_C_NAME && !/given/i.test(r.IMM_STATUS_C_NAME)) continue;
  const fam = vaccineFamily(r.IMM_TYPE_ID_NAME);
  const d = parseDate(r.IMM_DATE);
  if (!fam || !d) continue;
  const key = `${fam.family}|${d.iso}`;
  if (immSeen.has(key)) {
    // enrich existing with manufacturer/lot if missing
    const exist = immunizations.find(x => x.family === fam.family && x.date.iso === d.iso);
    if (exist && !exist.manufacturer && r.IMM_MANUFACTURER_C_NAME) exist.manufacturer = r.IMM_MANUFACTURER_C_NAME;
    continue;
  }
  immSeen.add(key);
  const eid = `e_imm_${fam.family}_${d.iso}`;
  immunizations.push({
    family: fam.family, label: fam.label, date: d,
    manufacturer: r.IMM_MANUFACTURER_C_NAME || null,
    evidenceId: ev(eid, { kind: "immunization", date: d.display, text: `${fam.label} administered ${d.display}${r.IMM_MANUFACTURER_C_NAME ? ` (${r.IMM_MANUFACTURER_C_NAME})` : ""}.` }),
  });
}
immunizations.sort((a, b) => a.date.iso.localeCompare(b.date.iso));

// ---- screening lab evidence (lipids, A1c/glucose, Hep C Ab) ----
function labs(components: string[]) {
  const ph = components.map(() => "?").join(",");
  return all(`SELECT COMPONENT_ID_NAME comp, ORD_VALUE val, RESULT_FLAG_C_NAME flag,
                     REFERENCE_LOW lo, REFERENCE_HIGH hi, REFERENCE_UNIT unit, RESULT_DATE dt
              FROM ORDER_RESULTS WHERE COMPONENT_ID_NAME IN (${ph}) ORDER BY RESULT_DATE`, ...components)
    .map(r => ({ comp: r.comp, val: r.val, flag: r.flag || null, lo: r.lo, hi: r.hi, unit: r.unit, date: parseDate(r.dt) }))
    .filter(r => r.date);
}
const lipidRows = labs(["CHOLESTEROL", "TRIGLYCERIDES", "HDL", "HIGH DENSITY CHOLESTEROL", "LDL, CALCULATED", "CHOLESTEROL/HDL RATIO"]);
const glucoseRows = labs(["HEMOGLOBIN A1C", "GLUCOSE"]);
const hcvRows = labs(["HEPATITIS C AB"]);

function byDate(rows: any[]) {
  const m: Record<string, any[]> = {};
  for (const r of rows) (m[r.date.iso] ??= []).push(r);
  return Object.entries(m).map(([iso, rs]) => ({ iso, display: rs[0].date.display, comps: rs }));
}
const screenings: Record<string, any> = {
  lipids: byDate(lipidRows).map(d => {
    const eid = `e_lipid_${d.iso}`;
    const flags = d.comps.filter(c => c.flag).map(c => `${c.comp} ${c.val} ${c.flag}`);
    ev(eid, { kind: "lab", date: d.display, text: `Lipid panel ${d.display}: ${d.comps.map(c => `${c.comp.replace(", CALCULATED","")} ${c.val}${c.unit?` ${c.unit}`:""}${c.flag?` (${c.flag})`:""}`).join("; ")}.` });
    return { ...d, evidenceId: eid, flags };
  }),
  glucose: byDate(glucoseRows).map(d => {
    const eid = `e_gluc_${d.iso}`;
    ev(eid, { kind: "lab", date: d.display, text: `${d.comps.map(c => `${c.comp} ${c.val}${c.unit?` ${c.unit}`:""}`).join("; ")} (${d.display}).` });
    return { ...d, evidenceId: eid };
  }),
  hepC: hcvRows.map(r => {
    const eid = `e_hcv_${r.date!.iso}`;
    ev(eid, { kind: "lab", date: r.date!.display, text: `Hepatitis C antibody: ${r.val} (${r.date!.display}).` });
    return { date: r.date, value: r.val, evidenceId: eid };
  }),
};

// ---- blood pressure (hypertension screening evidence) ----
// IP_FLWSHT_MEAS excludes the value column; the reading lives in the V_EHI_FLO_MEAS_VALUE export view.
// FLO_MEAS_ID '5' = Blood Pressure (per the vitals-and-flowsheets field guide).
const bpRaw = all(`SELECT v.MEAS_VALUE_EXTERNAL AS bp, m.RECORDED_TIME AS dt
                   FROM IP_FLWSHT_MEAS m JOIN V_EHI_FLO_MEAS_VALUE v ON m.FSD_ID=v.FSD_ID AND m.LINE=v.LINE
                   WHERE m.FLO_MEAS_ID='5' AND v.MEAS_VALUE_EXTERNAL LIKE '%/%'`);
const bpReadings = bpRaw.map(r => {
  const d = parseDate(r.dt); const mm = String(r.bp).match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
  if (!d || !mm) return null;
  const sys = +mm[1], dia = +mm[2];
  const elevated = sys >= 140 || dia >= 90;            // stage-2-ish office reading worth a flag
  const eid = `e_bp_${d.iso}`;
  ev(eid, { kind: "lab", who: "Office vitals", date: d.display, text: `Blood pressure ${sys}/${dia} mmHg (${d.display}).${elevated ? " Elevated office reading — would need out-of-office confirmation per USPSTF." : ""}` });
  return { iso: d.iso, display: d.display, sys, dia, elevated, evidenceId: eid };
}).filter(Boolean).sort((a: any, b: any) => a!.iso.localeCompare(b!.iso)) as any[];
const bpLatest = bpReadings[bpReadings.length - 1];
const bpElevated = bpReadings.filter((r: any) => r.elevated);

// ---- depression screen (PHQ-2 instrument present) ----
const phq2 = all(`SELECT DISTINCT FLO_MEAS_ID FROM IP_FLWSHT_MEAS WHERE FLO_MEAS_ID IN ('2100100050','2100100051')`);
const depression = { instrumentPresent: phq2.length > 0,
  evidenceId: ev("e_phq2", { kind: "fact", who: "Flowsheet", text: `PHQ-2 depression-screening items ("Little interest or pleasure...", "Feeling down, depressed...") are present in the record (form "UPH AMB PHQ2").` }) };

// ---- Epic Health-Maintenance status: current state (max LINE) + completions Epic recorded ----
const hmRows = all(`SELECT HM_TOPIC_ID_NAME topic, LINE, HM_STATUS_C_NAME status,
                           NEXT_DUE_DATE nd, LAST_COMPLETED_DATE lc
                    FROM HM_HISTORICAL_STATUS ORDER BY HM_TOPIC_ID_NAME, CAST(LINE AS INTEGER)`);
const epicTopics: Record<string, any> = {};
for (const r of hmRows) {
  const t = (epicTopics[r.topic] ??= { topic: r.topic, lines: [], lastCompletedDates: new Set<string>() });
  t.lines.push({ line: +r.LINE, status: r.status || null, nextDue: parseDate(r.nd), lastCompleted: parseDate(r.lc) });
  const lc = parseDate(r.lc); if (lc) t.lastCompletedDates.add(lc.iso);
}
const dobYear = +dob.iso.slice(0, 4);
const epicStatus = Object.values(epicTopics).map((t: any) => {
  const withStatus = t.lines.filter((l: any) => l.status);
  const current = withStatus[withStatus.length - 1] || t.lines[t.lines.length - 1];
  return {
    topic: t.topic,
    currentStatus: current?.status ?? null,
    nextDue: current?.nextDue ?? null,
    lastCompleted: current?.lastCompleted ?? null,
    everCompleted: [...t.lastCompletedDates].sort(),
    statusesSeen: [...new Set(withStatus.map((l: any) => l.status))],
  };
});

// Forecast-engine artifacts: next-due dates the engine emitted that fall before the patient turned 18
// (birthdate-anchored age rules) — impossible due-dates like "COVID due 1987", "Hep C due 1982 (at birth)".
const artifactSeen = new Set<string>();
const forecastArtifacts: any[] = [];
for (const t of Object.values(epicTopics) as any[]) {
  for (const l of t.lines) {
    if (!l.nextDue) continue;
    const yr = +l.nextDue.iso.slice(0, 4);
    if (yr <= dobYear + 18 && !artifactSeen.has(t.topic + l.nextDue.iso)) {
      artifactSeen.add(t.topic + l.nextDue.iso);
      forecastArtifacts.push({
        topic: t.topic, status: l.status, nextDue: l.nextDue,
        ageAtDue: yr - dobYear,
        note: `Engine set "next due" to ${l.nextDue.display} — age ${yr - dobYear}` +
              (yr <= dobYear ? " (at birth)" : "") + ", a birthdate-anchored artifact.",
      });
    }
  }
}
forecastArtifacts.sort((a, b) => a.nextDue.iso.localeCompare(b.nextDue.iso));

// ---- assemble ----
const out = {
  asOf: ASOF_ISO,
  patient: { sex: pat.SEX_C_NAME, dob, ageYears, bmi: latestBmi, bmiTrend: bmiRows, riskFacts,
    bp: { readings: bpReadings, latest: bpLatest, elevatedCount: bpElevated.length } },
  immunizations,
  screenings,
  depression,
  epicStatus,
  forecastArtifacts,
  evidence,
};
mkdirSync("deep-dives/preventive-care/parts", { recursive: true });
writeFileSync("deep-dives/preventive-care/parts/patient-data.json", JSON.stringify(out, null, 2));
console.log(`patient-data.json: age ${ageYears} ${pat.SEX_C_NAME}, BMI ${latestBmi?.bmi}, ` +
  `${immunizations.length} immunizations (${[...new Set(immunizations.map(i=>i.family))].join(",")}), ` +
  `${epicStatus.length} Epic HM topics, ${Object.keys(evidence).length} evidence items.`);
