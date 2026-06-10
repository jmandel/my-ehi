#!/usr/bin/env bun
/**
 * evaluate.ts — the evaluation engine. Joins the patient projection (parts/patient-data.json)
 * with the sourced, cited guidelines (parts/guidelines.json) and computes, per measure:
 *   eligibility (applies/excluded/conditional/not-yet-eligible) from THIS patient's facts,
 *   an INDEPENDENT status + last-done + next-due (recomputed from the interval, not read from Epic),
 *   lane data (covered + overdue bands, completion markers, forward projection),
 *   and a reconciliation against Epic's Health-Maintenance status.
 * Writes the assembled viewmodel.json.
 *
 *   bun deep-dives/preventive-care/scripts/evaluate.ts
 */
import { readFileSync, writeFileSync } from "fs";
const DIR = "deep-dives/preventive-care";
const pd = JSON.parse(readFileSync(`${DIR}/parts/patient-data.json`, "utf8"));
const gl = JSON.parse(readFileSync(`${DIR}/parts/guidelines.json`, "utf8"));
const sectionsPart = JSON.parse(readFileSync(`${DIR}/parts/sections.json`, "utf8"));
const ASOF = pd.asOf as string;
const evidence: Record<string, any> = { ...pd.evidence };
const ev = (id: string, e: any) => { evidence[id] = e; return id; };

// ---------- date math ----------
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmt = (iso: string) => { const [y,m,d] = iso.split("-").map(Number); return `${MONTHS[m-1]} ${d}, ${y}`; };
const addMonths = (iso: string, months: number) => {
  const [y,m,d] = iso.split("-").map(Number); const dt = new Date(Date.UTC(y, m-1+months, d));
  return dt.toISOString().slice(0,10);
};
const ageOnDate = (iso: string) => (Date.parse(iso) - Date.parse(pd.patient.dob.iso)) / (365.2425*864e5);
const dateAtAge = (age: number) => { const [y,m,d] = pd.patient.dob.iso.split("-").map(Number); return `${y+age}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`; };
const monthsBetween = (a: string, b: string) => (Date.parse(b)-Date.parse(a))/(30.44*864e5);

// ---------- guideline lookup ----------
const measures: any[] = gl.measures ?? [];
const findGuideline = (re: RegExp, authority?: string) =>
  measures.find(m => (!authority || m.authority === authority) && (re.test(m.measureId||"") || re.test(m.title||"")));

// ---------- patient completions per canonical measure ----------
const imm = (fam: string) => pd.immunizations.filter((i: any) => i.family === fam)
  .map((i: any) => ({ iso: i.date.iso, display: i.date.display, evidenceId: i.evidenceId }));
const epicTopicByName = (name: string) => pd.epicStatus.find((t: any) => t.topic === name) || null;
const epicCompletions = (name: string) => (epicTopicByName(name)?.everCompleted ?? []).map((iso: string) => ({ iso, display: fmt(iso), evidenceId: null }));

// the lipid/glucose/hepC completions from labs
const lipidDates = pd.screenings.lipids.map((d: any) => ({ iso: d.iso, display: d.display, evidenceId: d.evidenceId }));
const glucDates  = pd.screenings.glucose.map((d: any) => ({ iso: d.iso, display: d.display, evidenceId: d.evidenceId }));
const hepCDates  = pd.screenings.hepC.map((d: any) => ({ iso: d.date.iso, display: d.date.display, evidenceId: d.evidenceId, result: d.value }));

// ---------- the canonical measure registry: the audit's worklist ----------
// Each entry maps a clinical measure to its guideline(s), this patient's completions, eligibility logic,
// the recurrence interval used for the independent recompute, and the Epic HM topic to reconcile against.
type Elig = { state: "applies"|"excluded"|"conditional"|"not-yet-eligible"; reason: string; factEvidence?: string };
interface Reg {
  key: string; title: string; category: "screening"|"immunization"|"counseling";
  guideline: () => any; secondary?: () => any;
  completions: () => any[];
  intervalMonths: number | null; oneTime?: boolean; riskBased?: boolean; sharedDecision?: boolean; ongoing?: boolean;
  eligibility: () => Elig;
  epicTopic?: string;
  note?: string;
}
const F = pd.patient.riskFacts.reduce((a: any, f: any) => (a[f.key]=f, a), {});
const neverSmoker = /never/i.test(F.smoking?.value || "");
const age = pd.patient.ageYears;
const bmi = pd.patient.bmi?.bmi;
const bmiEverGE25 = pd.patient.bmiTrend.some((b: any) => b.bmi >= 25);
const bmiNow = bmi >= 25;

const REG: Reg[] = [
  // ---- screenings ----
  { key: "hiv", title: "HIV screening", category: "screening",
    guideline: () => findGuideline(/hiv/i, "USPSTF"), completions: () => [], oneTime: true, intervalMonths: null,
    eligibility: () => ({ state: "applies", reason: `Age ${age} is within the 15–65 one-time-screening band; no record of a prior HIV test.`, factEvidence: F.age.evidenceId }) },
  { key: "hepC", title: "Hepatitis C screening", category: "screening",
    guideline: () => findGuideline(/hepatitis.?c|hep.?c/i, "USPSTF"), completions: () => hepCDates, oneTime: true, intervalMonths: null, epicTopic: "Lab-Hepatitis C Screening",
    eligibility: () => ({ state: "applies", reason: `One-time screen recommended for all adults 18–79.`, factEvidence: F.age.evidenceId }) },
  { key: "colorectal", title: "Colorectal cancer screening", category: "screening",
    guideline: () => findGuideline(/colorect|colon/i, "USPSTF"), completions: () => [], intervalMonths: null,
    eligibility: () => ({ state: "not-yet-eligible", reason: `Screening begins at 45; he is ${age} and reaches 45 on ${fmt(dateAtAge(45))}.`, factEvidence: F.age.evidenceId }) },
  { key: "diabetes-uspstf", title: "Diabetes screening — USPSTF", category: "screening",
    guideline: () => findGuideline(/diabet|glucose/i, "USPSTF"), secondary: () => findGuideline(/diabet/i, "ADA"),
    completions: () => glucDates, intervalMonths: 36, epicTopic: "Lab-Diabetes Screening",
    eligibility: () => bmiNow
      ? ({ state: "applies", reason: `USPSTF screens adults 35–70 who are overweight/obese; current BMI ${bmi} ≥ 25.`, factEvidence: F.bmi.evidenceId })
      : ({ state: "conditional", reason: `USPSTF gates on BMI ≥ 25; his BMI hovers around 25 (was ${pd.patient.bmiTrend[0].bmi}, now ${bmi}) so eligibility flickers visit-to-visit.`, factEvidence: F.bmi.evidenceId }),
    note: "USPSTF/ADA divergence — see reconciliation." },
  { key: "diabetes-ada", title: "Diabetes screening — ADA", category: "screening",
    guideline: () => findGuideline(/diabet/i, "ADA"), completions: () => glucDates, intervalMonths: 36,
    eligibility: () => ({ state: "applies", reason: `ADA screens ALL adults beginning at 35, regardless of BMI; he is ${age}.`, factEvidence: F.age.evidenceId }),
    note: "Shown beside USPSTF to stage the disagreement." },
  { key: "lipids", title: "Cholesterol / lipid screening", category: "screening",
    guideline: () => findGuideline(/lipid|cholesterol|statin/i), completions: () => lipidDates, intervalMonths: 60, epicTopic: "Lab-Cholesterol Screening",
    eligibility: () => ({ state: "applies", reason: `Lipids screened periodically in adults; last panel shows a rising-triglyceride / low-HDL signal worth follow-up.`, factEvidence: F.age.evidenceId }) },
  { key: "hypertension", title: "Hypertension (blood-pressure) screening", category: "screening",
    guideline: () => findGuideline(/hypertension|blood.?pressure/i, "USPSTF"),
    completions: () => (pd.patient.bp?.readings ?? []).map((r: any) => ({ iso: r.iso, display: `${r.sys}/${r.dia}`, evidenceId: r.evidenceId })),
    intervalMonths: 12, epicTopic: undefined,
    eligibility: () => ({ state: "applies", reason: `Recommended for all adults ≥18; blood pressure is measured at each office visit (latest ${pd.patient.bp?.latest?.sys}/${pd.patient.bp?.latest?.dia} mmHg).`, factEvidence: pd.patient.bp?.latest?.evidenceId }),
    note: pd.patient.bp?.elevatedCount ? `${pd.patient.bp.elevatedCount} elevated office reading(s) on record (2022) that never progressed to a diagnosis — a hand-off to cardiovascular-risk review, not a screening gap.` : null },
  { key: "depression", title: "Depression screening", category: "screening",
    guideline: () => findGuideline(/depress/i, "USPSTF"), completions: () => pd.depression.instrumentPresent ? [{ iso: ASOF, display: "documented", evidenceId: pd.depression.evidenceId }] : [],
    intervalMonths: 24,
    eligibility: () => ({ state: "applies", reason: `Recommended for all adults; a PHQ-2 instrument is present in the record.`, factEvidence: pd.depression.evidenceId }) },
  { key: "alcohol", title: "Unhealthy alcohol-use screening", category: "screening",
    guideline: () => findGuideline(/alcohol/i, "USPSTF"), completions: () => [], intervalMonths: 12,
    eligibility: () => ({ state: "conditional", reason: `Recommended for all adults; alcohol use is recorded in the social history but a validated screen (e.g. AUDIT-C) is not clearly captured.`, factEvidence: F.alcohol.evidenceId }) },
  { key: "tobacco", title: "Tobacco-use screening", category: "counseling",
    guideline: () => findGuideline(/tobacco|smok/i, "USPSTF"), completions: () => [{ iso: ASOF, display: "asked", evidenceId: F.smoking.evidenceId }], intervalMonths: 12,
    eligibility: () => ({ state: "applies", reason: `Asked of all adults; recorded as a lifelong never-smoker.`, factEvidence: F.smoking.evidenceId }) },
  { key: "lung", title: "Lung-cancer screening", category: "screening",
    guideline: () => findGuideline(/lung/i, "USPSTF"), completions: () => [], intervalMonths: null,
    eligibility: () => ({ state: "excluded", reason: `Requires a ≥20 pack-year smoking history (ages 50–80). He is a lifelong never-smoker — not indicated.`, factEvidence: F.smoking.evidenceId }) },
  { key: "aaa", title: "Abdominal aortic aneurysm screening", category: "screening",
    guideline: () => findGuideline(/aortic|aaa|aneurysm/i, "USPSTF"), completions: () => [], intervalMonths: null,
    eligibility: () => ({ state: "excluded", reason: `One-time screen is for men 65–75 who ever smoked. He is ${age} and a never-smoker — not indicated.`, factEvidence: F.smoking.evidenceId }) },
  // ---- immunizations ----
  { key: "influenza", title: "Influenza vaccine", category: "immunization",
    guideline: () => findGuideline(/influenza|flu/i, "ACIP-CDC"), completions: () => imm("influenza"), intervalMonths: 12, epicTopic: "Influenza Vaccine",
    eligibility: () => ({ state: "applies", reason: `Recommended annually for all adults.` }) },
  { key: "covid", title: "COVID-19 vaccine", category: "immunization",
    guideline: () => findGuideline(/covid/i, "ACIP-CDC"), completions: () => imm("covid"), intervalMonths: 12, epicTopic: "COVID-19 Vaccine",
    eligibility: () => ({ state: "applies", reason: `Recommended for all adults; cadence ~annual.` }) },
  { key: "tdap", title: "Tetanus–diphtheria–pertussis (Td/Tdap)", category: "immunization",
    guideline: () => findGuideline(/tdap|tetanus|td\b/i, "ACIP-CDC"), completions: () => imm("tdap"), intervalMonths: 120, epicTopic: "Tetanus/Pertussis Vaccine Teen/Adult",
    eligibility: () => ({ state: "applies", reason: `Td/Tdap booster every 10 years; Tdap given ${imm("tdap")[0]?.display ?? "—"}.` }) },
  { key: "hepB", title: "Hepatitis B vaccine", category: "immunization",
    guideline: () => findGuideline(/hepatitis.?b|hep.?b/i, "ACIP-CDC"), completions: () => imm("hepB"), intervalMonths: null, oneTime: true, epicTopic: "Hepatitis B Vaccine",
    eligibility: () => ({ state: "applies", reason: `ACIP (2022) recommends Hep B vaccination for all adults 19–59. No adult series on file.`, factEvidence: F.age.evidenceId }) },
  { key: "hepA", title: "Hepatitis A vaccine", category: "immunization",
    guideline: () => findGuideline(/hepatitis.?a|hep.?a/i, "ACIP-CDC"), completions: () => imm("hepA"), intervalMonths: null, riskBased: true, epicTopic: "Hepatitis A Vaccine",
    eligibility: () => ({ state: "conditional", reason: `Risk/travel-based; one dose given ${imm("hepA")[0]?.display ?? "—"} (a 2-dose series — second dose not on file).` }) },
  { key: "hpv", title: "HPV vaccine", category: "immunization",
    guideline: () => findGuideline(/hpv|papilloma/i, "ACIP-CDC"), completions: () => imm("hpv"), intervalMonths: null, sharedDecision: true, epicTopic: "HPV Vaccine (9-26yo & Shared Decision 27-45yo)",
    eligibility: () => ({ state: "conditional", reason: `Routine through 26; ages 27–45 by shared clinical decision. He is ${age} — optional, not a failure.`, factEvidence: F.age.evidenceId }) },
  { key: "zoster", title: "Zoster (shingles) vaccine", category: "immunization",
    guideline: () => findGuideline(/zoster|shingl/i, "ACIP-CDC"), completions: () => [], intervalMonths: null, epicTopic: "Zoster (Shingles) Vaccine 50+",
    eligibility: () => ({ state: "not-yet-eligible", reason: `Recommended at 50; he is ${age}, eligible ${fmt(dateAtAge(50))}.`, factEvidence: F.age.evidenceId }) },
  { key: "pneumococcal", title: "Pneumococcal vaccine", category: "immunization",
    guideline: () => findGuideline(/pneumo/i, "ACIP-CDC"), completions: () => [], intervalMonths: null, epicTopic: "Pneumococcal Vaccines 0-49 yo",
    eligibility: () => ({ state: "not-yet-eligible", reason: `Routine at 50 (earlier only with specific risk conditions, none documented). He is ${age}.`, factEvidence: F.age.evidenceId }) },
  { key: "rsv", title: "RSV vaccine", category: "immunization",
    guideline: () => findGuideline(/rsv|respiratory.syncytial/i, "ACIP-CDC"), completions: () => [], intervalMonths: null, epicTopic: "RSV Adult",
    eligibility: () => ({ state: "not-yet-eligible", reason: `Routine at 75 (shared decision 60–74 with risk). He is ${age}.`, factEvidence: F.age.evidenceId }) },
  { key: "typhoid", title: "Typhoid vaccine (travel)", category: "immunization",
    guideline: () => findGuideline(/typhoid/i, "ACIP-CDC"), completions: () => imm("typhoid"), intervalMonths: null, riskBased: true, epicTopic: "Typhoid Vaccine",
    eligibility: () => ({ state: "conditional", reason: `Travel/risk-based; given ${imm("typhoid")[0]?.display ?? "—"} (consistent with the documented travel-screening history).` }) },
];

// ---------- the verdict computation ----------
const within = (iso: string, days: number) => monthsBetween(ASOF, iso) <= days/30.44 && Date.parse(iso) >= Date.parse(ASOF);
function statusFor(r: Reg, elig: Elig, comps: any[]) {
  if (elig.state === "excluded") return { status: "not-applicable", lastDone: null as string|null, nextDue: null as string|null };
  if (elig.state === "not-yet-eligible") {
    const at = (r.guideline()?.ageMin != null) ? dateAtAge(r.guideline().ageMin) : null;
    return { status: "not-yet-eligible", lastDone: null, nextDue: at };
  }
  if (r.ongoing) return { status: "monitored", lastDone: null, nextDue: null };
  const sorted = [...comps].sort((a,b)=>a.iso.localeCompare(b.iso));
  const lastDone = sorted.length ? sorted[sorted.length-1].iso : null;
  if (r.oneTime) return { status: lastDone ? "up-to-date" : "gap", lastDone, nextDue: null };
  if (r.riskBased || r.sharedDecision) return { status: lastDone ? "optional-done" : "optional", lastDone, nextDue: null };
  // conditional eligibility with no completion is a SOFT gap (partial), not a hard act-now item
  if (!lastDone) return { status: elig.state === "conditional" ? "partial" : "gap", lastDone: null, nextDue: ASOF };
  const nextDue = r.intervalMonths ? addMonths(lastDone, r.intervalMonths) : null;
  let status = "up-to-date";
  if (nextDue) {
    if (Date.parse(nextDue) < Date.parse(ASOF)) status = "overdue";
    else if (monthsBetween(ASOF, nextDue) <= 2) status = "due-soon";
  }
  return { status, lastDone, nextDue };
}

// build lane bands (covered + overdue) for recurring measures from real completions
function lanes(r: Reg, comps: any[], status: string) {
  if (!r.intervalMonths || r.oneTime || r.riskBased) {
    const markers = comps.map(c => ({ iso: c.iso, display: c.display, evidenceId: c.evidenceId }));
    return { markers, bands: [] as any[] };
  }
  const sorted = [...comps].sort((a,b)=>a.iso.localeCompare(b.iso));
  const bands: any[] = [];
  for (let i=0;i<sorted.length;i++){
    const start = sorted[i].iso;
    const coverEnd = addMonths(start, r.intervalMonths);
    const nextComp = sorted[i+1]?.iso;
    const coveredUntil = nextComp && Date.parse(nextComp) < Date.parse(coverEnd) ? nextComp : coverEnd;
    bands.push({ kind: "covered", from: start, to: coveredUntil });
    const gapStart = coverEnd;
    const gapEnd = nextComp ?? ASOF;
    if (Date.parse(gapEnd) > Date.parse(gapStart)) bands.push({ kind: "overdue", from: gapStart, to: gapEnd });
  }
  return { markers: sorted.map(c => ({ iso: c.iso, display: c.display, evidenceId: c.evidenceId })), bands };
}

// Epic reconciliation: classify how the independent verdict relates to Epic's HM status
function reconcile(r: Reg, status: string, lastDone: string|null) {
  if (!r.epicTopic) return { kind: "epic-missing", epicStatus: null as string|null, epicNextDue: null as string|null,
    note: "Epic's Health-Maintenance engine does not track this measure for this patient — the audit adds it." };
  const t = epicTopicByName(r.epicTopic);
  if (!t) return { kind: "epic-missing", epicStatus: null, epicNextDue: null, note: "No matching Epic HM topic." };
  const epicNext = t.nextDue?.iso ?? null;
  const epicStatus = t.currentStatus as string | null;
  const suppressed = /Hidden|Aged Out/i.test(epicStatus || "");
  // an implausibly-old next-due (>3y in the past, or before the patient turned 18) is a birthdate/age-rule artifact
  const staleDate = !!epicNext && (Date.parse(epicNext) < Date.parse(dateAtAge(18)) ||
                                   monthsBetween(epicNext, ASOF) > 36);
  if (r.key === "diabetes-uspstf") return { kind: "divergent-eligibility", epicStatus, epicNextDue: epicNext,
    note: "Epic tracks one diabetes-screening topic; the audit shows it is USPSTF-conditional (BMI-gated) yet ADA-unconditional — two defensible answers from two authorities." };
  if (suppressed) return { kind: "epic-noise", epicStatus, epicNextDue: epicNext,
    note: `Epic ${/Hidden/i.test(epicStatus||"")?'hides':'has "aged out"'} this topic, so it never reaches the worklist; the audit reclassifies it as ${r.riskBased?'a risk/travel-based item':r.status==='not-yet-eligible'?`deferred to age-based eligibility (${r.nextDue?.display ?? 'a later age'})`:'still in scope'}.` };
  // verdict agrees on the action, but flag when Epic's date itself is an artifact
  const dateNote = staleDate ? ` (Epic's next-due of ${fmt(epicNext!)} is a birthdate-anchored artifact, not a real date.)` : "";
  return { kind: "agree", epicStatus, epicNextDue: epicNext, dateArtifact: staleDate,
    note: `Epic's status ("${epicStatus}") and the audit agree.${dateNote}` };
}

const PRIORITY: Record<string,number> = { gap: 0, overdue: 1, "due-soon": 2, partial: 3, optional: 4, monitored: 5, "up-to-date": 6, "optional-done": 7, "not-yet-eligible": 8, "not-applicable": 9 };
const built = REG.map(r => {
  const g = r.guideline() || null;
  const g2 = r.secondary?.() || null;
  const elig = r.eligibility();
  const comps = r.completions();
  const { status, lastDone, nextDue } = statusFor(r, elig, comps);
  const lane = lanes(r, comps, status);
  const recon = reconcile(r, status, lastDone);
  // a citation evidence item per authority
  let citeId: string | null = null;
  if (g) citeId = ev(`e_g_${r.key}`, { kind: "guideline", who: `${g.authority}${g.grade?` (Grade ${g.grade})`:""}`, date: gl.retrieved,
    text: `${g.citationTitle} — ${g.ruleQuote}`, url: g.citationUrl });
  let cite2Id: string | null = null;
  if (g2) cite2Id = ev(`e_g2_${r.key}`, { kind: "guideline", who: `${g2.authority}${g2.grade?` (Grade ${g2.grade})`:""}`, date: gl.retrieved,
    text: `${g2.citationTitle} — ${g2.ruleQuote}`, url: g2.citationUrl });
  return {
    key: r.key, title: r.title, category: r.category,
    authority: g ? `${g.authority}${g.grade?` · Grade ${g.grade}`:""}` : "—",
    rule: g?.ruleQuote ?? null, citationId: citeId, secondaryAuthority: g2 ? `${g2.authority}${g2.grade?` · Grade ${g2.grade}`:""}` : null, secondaryCitationId: cite2Id,
    eligibility: elig, status,
    lastDone: lastDone ? { iso: lastDone, display: fmt(lastDone) } : null,
    nextDue: nextDue ? { iso: nextDue, display: fmt(nextDue) } : null,
    intervalMonths: r.intervalMonths, oneTime: !!r.oneTime, riskBased: !!r.riskBased, sharedDecision: !!r.sharedDecision,
    completions: comps,
    lane, reconciliation: recon, note: r.note ?? null,
  };
});

// ---------- summary ----------
const actNow = built.filter(b => ["gap","overdue","due-soon"].includes(b.status) && b.category !== "counseling");
const upToDate = built.filter(b => ["up-to-date","optional-done"].includes(b.status));
const counts = {
  upToDate: upToDate.length,
  openGaps: built.filter(b => b.status === "gap").length,
  overdue: built.filter(b => b.status === "overdue").length,
  comingDue: built.filter(b => ["due-soon","not-yet-eligible"].includes(b.status)).length,
  notApplicable: built.filter(b => b.status === "not-applicable").length,
  epicNoise: built.filter(b => b.reconciliation.kind === "epic-noise").length,
  epicMissing: built.filter(b => b.reconciliation.kind === "epic-missing").length,
  divergent: built.filter(b => b.reconciliation.kind === "divergent-eligibility").length,
};

// validate section cites resolve before assembling
for (const s of sectionsPart.sections) for (const c of (s.cites ?? []))
  if (!evidence[c]) console.log(`  ⚠ section "${s.id}" cites missing evidence: ${c}`);

const vm = {
  meta: { title: "Up to Date?", subtitle: "An independent, guideline-anchored preventive-care audit", asOf: ASOF, retrieved: gl.retrieved,
    patient: { sex: pd.patient.sex, age: pd.patient.ageYears } },
  sections: sectionsPart.sections,
  summary: {
    headline: `As of ${fmt(ASOF)}, this ${pd.patient.ageYears}-year-old ${String(pd.patient.sex).toLowerCase()} is up to date on ${counts.upToDate} measures, with ${counts.openGaps} open gap(s) and ${counts.comingDue} coming due. The audit discards ${counts.epicNoise} Epic forecast artifact(s) and adds ${counts.epicMissing} measure(s) Epic does not track.`,
    counts,
  },
  riskFacts: pd.patient.riskFacts,
  bmiTrend: pd.patient.bmiTrend,
  actNow: actNow.sort((a,b)=>PRIORITY[a.status]-PRIORITY[b.status]).map(b => b.key),
  measures: built.sort((a,b)=> (PRIORITY[a.status]-PRIORITY[b.status]) || a.title.localeCompare(b.title)),
  reconciliation: built.filter(b => b.reconciliation.kind !== "agree").map(b => b.key),
  forecastArtifacts: pd.forecastArtifacts ?? [],
  guidelinesRetrieved: gl.retrieved,
  evidence,
};
writeFileSync(`${DIR}/viewmodel.json`, JSON.stringify(vm, null, 2));
console.log(`viewmodel.json: ${built.length} measures | up-to-date ${counts.upToDate}, gaps ${counts.openGaps}, overdue ${counts.overdue}, coming ${counts.comingDue}, N/A ${counts.notApplicable} | epic-noise ${counts.epicNoise}, epic-missing ${counts.epicMissing}, divergent ${counts.divergent} | ${Object.keys(evidence).length} evidence items`);
const missingG = built.filter(b => !b.rule).map(b => b.key);
if (missingG.length) console.log(`  ⚠ measures with no matched guideline: ${missingG.join(", ")}`);
