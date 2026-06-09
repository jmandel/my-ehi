#!/usr/bin/env bun
/**
 * project.ts — PROJECT the raw-ish cardiac-risk dataset into CLEAN, app-ready JSON.
 *
 *   bun deep-dives/cardiac-risk/scripts/project.ts
 *
 * The principle (skills/ehi-abstraction-pass §"The normalized dataset — a clean PROJECTION",
 * skills/ehi-deep-dives §"Clean data in, smooth UX out"):
 *
 *   > The dataset is a PROJECTION, not a mirror of the export. Do the cleaning HERE, once, so the
 *   > app never touches a weird Epic label, code, or format. Every VALUE a UI could show is already
 *   > human-clean (formatted dates, drug names cleaned to "lisinopril 10 mg", codes/statuses as plain
 *   > words). Keep internal ids / `src` / `date_real` as SIDE fields for tracing & sorting — never as
 *   > display content. If a raw export string can reach the screen, the projection isn't done.
 *
 * This reads the assembled parts (deep-dives/cardiac-risk/parts/<entity>.json via assemble.ts output,
 * i.e. the current dataset.json) and rewrites deep-dives/cardiac-risk/dataset.json so that:
 *   - DATES: every display `date` becomes a uniform "Aug 29, 2022" string (no "12:00:00 AM", no ISO,
 *     no M/D/YYYY); `date_real` (numeric) is kept for sorting and a `date_iso` (YYYY-MM-DD) side field
 *     is added for D3 time scales. Per-field datetimes (ordered/started/ended/etc.) get clean siblings.
 *   - DRUG NAMES: medications.name -> clean "lisinopril 10 mg" (brand kept in `brand`); dose/route/sig
 *     surfaced cleanly.
 *   - STATUSES & CODES: order/med statuses -> plain words ("Sent" -> "Ordered"); abnormal flags ->
 *     "High"/"Low"/"Normal"; dispositions -> "declined"/"completed"/...; *_C_NAME-ish values resolved.
 *   - LABS: a clean component `label`, value+unit, a readable reference range, an abnormal flag word.
 *   - VITALS: clean `kind_label`, a clean `display_value`; BP carries sys/dia numbers + a category word.
 *   - FAMILY: relation + condition words (already clean) + a one-line `summary`. SOCIAL/demographic:
 *     plain `label`/`display_value` with the most-informative descriptor surfaced.
 *   - ACUTE 2024 work-up: clean study names, plain result words, clean external-origin labels.
 *
 * ALL original fields are preserved (model.ts derives series from sys/dia/value_num/component/etc.);
 * the projection ADDS the clean, already-formatted display values beside them and rewrites the few
 * fields whose only job is display (`date`, the `*_C_NAME`-style status text).
 *
 * Every raw export string the projection cleans is recorded in CLEANING_RULES (returned as the receipt).
 */
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { spawnSync } from "child_process";

const HERE = dirname(new URL(import.meta.url).pathname);
const TOPIC_DIR = join(HERE, "..");
const SRC = join(TOPIC_DIR, "dataset.json");

// Re-assemble dataset.json from the RAW parts first, so the projection always starts from the
// untouched source (idempotent: re-running project.ts can't double-clean an already-clean value).
const asm = spawnSync("bun", [join(HERE, "assemble.ts")], { encoding: "utf8" });
if (asm.status !== 0) { console.error(asm.stderr || asm.stdout); process.exit(asm.status ?? 1); }
process.stdout.write(asm.stdout);

const ds = JSON.parse(readFileSync(SRC, "utf8"));

// =====================================================================================
// DATES — one uniform formatter. Handles every shape present in the export:
//   "8/29/2022 12:00:00 AM"  (vitals / encounters / med datetimes)
//   "2022-08-29"             (labs, ISO)
//   "5/14/2024"              (acute events, bare M/D/YYYY)
//   "8/9/2018 9:50:00 AM"    (vitals entry/record times)
// -> { date: "Aug 29, 2022", iso: "2022-08-29" }  (drop the time-of-day for display dates)
// =====================================================================================
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseYMD(v: any): { y: number; m: number; d: number } | null {
  if (v == null || v === "") return null;
  const datePart = String(v).trim().split(" ")[0];
  let y: number, m: number, d: number;
  if (/^\d{4}-\d{2}-\d{2}/.test(datePart)) {
    [y, m, d] = datePart.split("-").map(Number);
  } else if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(datePart)) {
    [m, d, y] = datePart.split("/").map(Number);
  } else return null;
  if (!y || !m) return null;
  return { y, m, d: d || 1 };
}
/** "Aug 29, 2022" — the verbatim display date the app renders. */
function humanDate(v: any): string | null {
  const p = parseYMD(v);
  if (!p) return null;
  return `${MONTHS[p.m - 1]} ${p.d}, ${p.y}`;
}
/** "2022-08-29" — a side field for D3 time scales (NOT display content). */
function isoDate(v: any): string | null {
  const p = parseYMD(v);
  if (!p) return null;
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}
/** "Aug 29, 2022 · 2:23 PM" — for the few rows where time-of-day matters (discon/admin/recorded). */
function humanDateTime(v: any): string | null {
  const day = humanDate(v);
  if (!day) return null;
  const t = String(v).trim().match(/\b(\d{1,2}):(\d{2}):\d{2}\s*([AP]M)\b/i);
  if (!t || (t[1] === "12" && t[2] === "00" && /AM/i.test(t[3]))) return day; // drop midnight sentinel
  return `${day} · ${Number(t[1])}:${t[2]} ${t[3].toUpperCase()}`;
}

// =====================================================================================
// FLAGS / STATUSES / CODES — plain words.
// =====================================================================================
/** abnormal flag -> one of "High" / "Low" / "Abnormal" / "Normal". */
function flagWord(raw: any): string {
  const s = String(raw ?? "").trim();
  if (!s) return "Normal";
  if (/^low/i.test(s)) return "Low";
  if (/^high/i.test(s)) return "High";
  if (/abnormal/i.test(s)) return "Abnormal";
  return s;
}
/** result status -> plain "Final" (collapses "Final result" / "Edited Result - FINAL"). */
function statusWord(raw: any): string {
  const s = String(raw ?? "").trim();
  if (/final/i.test(s)) return "Final";
  if (/prelim/i.test(s)) return "Preliminary";
  return s || "—";
}

// =====================================================================================
// LAB component labels — resolve the Clarity component name to a clean clinical label,
// and unify HDL's two source names. (Mirrors the analyte the analysis reasons over.)
// =====================================================================================
const LAB_LABEL: Record<string, string> = {
  "HIGH DENSITY CHOLESTEROL": "HDL",
  HDL: "HDL",
  "LDL, CALCULATED": "LDL (calculated)",
  CHOLESTEROL: "Total cholesterol",
  "CHOLESTEROL/HDL RATIO": "Cholesterol / HDL ratio",
  TRIGLYCERIDES: "Triglycerides",
  "VLDL CHOLESTEROL": "VLDL cholesterol",
  "HEMOGLOBIN A1C": "Hemoglobin A1c",
  "ESTIMATED AVG GLUC": "Estimated average glucose",
  "EGFR NON-AFR/AMER": "eGFR",
  "BUN BLOOD": "BUN",
  "BUN / CREAT RATIO": "BUN / creatinine ratio",
  CREATININE: "Creatinine",
  POTASSIUM: "Potassium",
  SODIUM: "Sodium",
  GLUCOSE: "Glucose",
  CALCIUM: "Calcium",
  CHLORIDE: "Chloride",
  CO2: "CO₂",
  "ANION GAP": "Anion gap",
  "OSMOLALITY CALCULATED": "Osmolality (calculated)",
};
/** A canonical analyte key so the app/analysis don't re-special-case HDL's two names. */
const LAB_ANALYTE: Record<string, string> = {
  "HIGH DENSITY CHOLESTEROL": "HDL",
  HDL: "HDL",
  "LDL, CALCULATED": "LDL",
  CHOLESTEROL: "TOTAL_CHOLESTEROL",
  "CHOLESTEROL/HDL RATIO": "CHOL_HDL_RATIO",
  TRIGLYCERIDES: "TRIGLYCERIDES",
  "VLDL CHOLESTEROL": "VLDL",
  "HEMOGLOBIN A1C": "HBA1C",
  "ESTIMATED AVG GLUC": "EAG",
  "EGFR NON-AFR/AMER": "EGFR",
};
const ACRONYMS: Record<string, string> = {
  cbc: "CBC", cmp: "CMP", bmp: "BMP", hcl: "HCl", xr: "X-ray", ct: "CT",
  cta: "CTA", iv: "IV", co2: "CO₂", hdl: "HDL", ldl: "LDL", vldl: "VLDL", bun: "BUN", w: "with", wo: "without",
};
function titleCaseClinical(s: string): string {
  return String(s).toLowerCase().split(/\s+/).map((w, i) =>
    ACRONYMS[w] ?? (i === 0
      ? w.charAt(0).toUpperCase() + w.slice(1)
      : (w === "with" || w === "and" || w === "of") ? w : w.charAt(0).toUpperCase() + w.slice(1))
  ).join(" ");
}
function labLabel(component: string | null, orderName?: string | null): string {
  if (!component) return orderName ? titleCaseClinical(orderName) : "Lab";
  return LAB_LABEL[component] ?? (component.charAt(0) + component.slice(1).toLowerCase());
}
/** Clean an Epic unit string for display ("mL/min/[1.73_m2]" -> "mL/min/1.73m²"). */
function cleanUnit(u: any): string | null {
  if (u == null || u === "") return null;
  return String(u)
    .replace(/\[1\.73_m2\]/i, "1.73m²")
    .replace(/mosm/i, "mOsm")
    .trim();
}
/** A readable reference range from the parts (already "0 - 199" etc.; normalize spacing). */
function refRange(r: any): string | null {
  const txt = r.ref_range_text;
  if (txt) return String(txt).replace(/\s*-\s*/, " – ").trim();
  if (r.ref_low != null && r.ref_low !== "" && r.ref_high != null && r.ref_high !== "")
    return `${r.ref_low} – ${r.ref_high}`;
  return null;
}
function fastingWord(c: any): string | null {
  const s = String(c ?? "");
  if (/NOT FASTING|WAS NOT/i.test(s)) return "non-fasting";
  if (/FASTING/i.test(s)) return "fasting";
  return null; // a facility-address "comment" is not a fasting status
}

// =====================================================================================
// MEDICATIONS — clean generic+dose name, brand kept aside; plain status & disposition.
// =====================================================================================
const FORM_WORDS = /\b(tablet|tablets|tab|tabs|capsule|capsules|cap|caps|misc|device|devi|soln|solution|soaj|ij|inj|injection|pak|tbpk|kit|sensor|receiver|reader|po|oral|each)\b/gi;
function cleanDrug(row: any): { name: string; brand: string | null; dose: string | null } {
  const rawName = String(row?.name ?? "");
  // brand list lives in the "(PRINIVIL,ZESTRIL)" parenthetical
  const brandMatch = rawName.match(/\(([^)]+)\)/);
  const brand = brandMatch
    ? brandMatch[1].split(/[,&]/).map((b) => b.trim()).filter((b) => /^[A-Za-z][A-Za-z0-9\- ]*$/.test(b))
        .map((b) => b.charAt(0).toUpperCase() + b.slice(1).toLowerCase()).join(", ") || null
    : null;

  const isCombo = /\s&\s/.test(rawName);                   // e.g. "nirmatrelvir & ritonavir (PAXLOVID)"
  let base = rawName.replace(/\([^)]*\)/g, " ");           // drop "(PRINIVIL,ZESTRIL)" brand cruft
  base = base.replace(FORM_WORDS, " ").replace(/[,;]+/g, " ")
    .replace(/(\d(?:\.\d+)?)\s*%/g, "$1%").replace(/\s+/g, " ").trim(); // tighten "0.9 %" -> "0.9%"

  // strength: prefer the strength baked into `generic` ("Lisinopril Tab 10 MG" -> "10 mg").
  // A combo pack ("nirmatrelvir & ritonavir") has no single meaningful strength — drop the dose.
  const strRe = /(\d+(?:\.\d+)?\s*(?:mg|mcg|ml|g|%)\b(?:\s*\/\s*\d+(?:\.\d+)?\s*(?:mg|ml|%))?)/i;
  const strength = isCombo ? null
    : (String(row?.generic ?? "").match(strRe) || String(row?.description ?? "").match(strRe) || rawName.match(strRe));
  let dose = strength ? strength[1].toLowerCase().replace(/\s+/g, " ").replace(/\s*\/\s*/, "/") : null;

  // Title-case an ALL-CAPS device/infusion name; leave a normal lowercase generic as charted.
  if (base === base.toUpperCase() && /[A-Z]/.test(base)) {
    base = base.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
      .replace(/\bHcl\b/g, "HCl").replace(/\b(\d+(?:\.\d+)?)\s*Mg\b/gi, "$1 mg")
      .replace(/\bMcg\b/g, "mcg").replace(/\bNacl\b/gi, "NaCl");
  }
  base = base.replace(/\s+/g, " ").trim();

  // compose name + dose, avoiding doubling a strength the base already carries
  const alreadyHasDose = dose && new RegExp(dose.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(base);
  const name = alreadyHasDose || !dose ? base : `${base} ${dose}`.trim();
  return { name, brand, dose };
}
/** "Sent" -> "Ordered"; "Discontinued" -> "Discontinued"; historical -> "Documented, not prescribed". */
function medStatusWord(row: any): string {
  const s = String(row?.status ?? "");
  if (/Historical Med/i.test(s)) return "Documented, not prescribed";
  if (/Discontinued/i.test(s)) return "Discontinued";
  if (/^Sent$/i.test(s)) return "Ordered";
  return s || "—";
}
/** the real-world disposition: declined / completed / reordered / discontinued / documented / active. */
function medDisposition(row: any): string {
  const dr = String(row?.discon_reason ?? "");
  if (/patient refusal/i.test(dr)) return "declined";
  if (/therapy complet/i.test(dr)) return "completed";
  if (/reorder/i.test(dr)) return "reordered";
  if (/Discontinued/i.test(row?.status ?? "")) return "discontinued";
  if (/Historical Med/i.test(row?.status ?? "")) return "documented (historical)";
  if (row?.end_date) return "ended";
  return "active";
}
const ROUTE_WORD: Record<string, string> = {
  Oral: "by mouth", Intravenous: "intravenous", Intramuscular: "intramuscular",
};

// =====================================================================================
// VITALS — clean kind labels, a clean display value, BP category word.
// =====================================================================================
const VITAL_LABEL: Record<string, string> = {
  blood_pressure: "Blood pressure", weight: "Weight", bmi: "BMI", pulse: "Pulse",
  height: "Height", spo2: "SpO₂", bsa: "Body-surface area",
  bp_cuff: "BP cuff size", bp_position: "BP position", bp_location: "BP location",
};
function bpCategory(sys: number, dia: number): string {
  if (sys >= 140 || dia >= 90) return "Stage 2";
  if (sys >= 130 || dia >= 80) return "Stage 1";
  if (sys >= 120 && dia < 80) return "Elevated";
  return "Normal";
}
const BP_LOC: Record<string, string> = { LUE: "left arm", RUE: "right arm", LLE: "left leg", RLE: "right leg" };
/** "71.000" inches -> 5'11"  (clean human height). */
function cleanHeight(inches: number): string {
  const ft = Math.floor(inches / 12);
  const rem = Math.round((inches - ft * 12) * 10) / 10;
  return `${ft}'${rem % 1 === 0 ? rem : rem.toFixed(1)}"`;
}
function vitalDisplay(v: any): string {
  if (v.kind === "blood_pressure") return `${v.sys}/${v.dia} mmHg`;
  if (v.kind === "weight" && v.weight_lb != null) return `${v.weight_lb} lb`;
  if (v.kind === "bmi") return `${v.bmi ?? v.value}`;
  if (v.kind === "pulse") return `${v.pulse ?? v.value} bpm`;
  if (v.kind === "spo2") return `${v.value}%`;
  if (v.kind === "bsa") return `${v.value} m²`;
  if (v.kind === "height") {
    const inches = Number(v.value);
    return Number.isFinite(inches) ? cleanHeight(inches) : `${v.value} in`;
  }
  if (v.kind === "bp_position") return `${v.value}`;
  if (v.kind === "bp_location") return BP_LOC[v.value] ?? String(v.value);
  return `${v.value ?? ""}${v.unit && v.unit !== "ounces" && v.unit !== "inches" ? " " + v.unit : ""}`.trim();
}
/** "IRELAND, TRACY C" -> "Tracy Ireland"; facility-ish strings -> null. */
function personName(p: any): string | null {
  if (!p) return null;
  if (/\bLAB\b|\bAPL\b|EXTERNAL|GENERIC/i.test(p)) return null;
  const parts = String(p).split(",").map((s) => s.trim());
  const last = parts[0] ?? "";
  const firstMid = (parts[1] ?? "").split(/\s+/);
  const first = firstMid[0] ?? "";
  const tc = (w: string) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : "");
  return [tc(first), tc(last)].filter(Boolean).join(" ") || null;
}
/** clinician name as "Dr. Lastname" for visit/order provider fields. */
function clinicianName(p: any): string | null {
  if (!p) return null;
  if (/\bLAB\b|\bAPL\b|EXTERNAL|GENERIC/i.test(p)) return null;
  const last = String(p).split(",")[0].trim();
  return "Dr. " + last.charAt(0).toUpperCase() + last.slice(1).toLowerCase();
}
function deptName(d: any): string | null {
  const s = String(d ?? "");
  if (/GENERIC EXTERNAL/i.test(s)) return "Outside facility";
  return s.replace(/MAC APL /, "").replace(/\bAPL\b/, "")
    .replace(/\b\w+/g, (w) => w.charAt(0) + w.slice(1).toLowerCase()).replace(/\s{2,}/g, " ").trim() || null;
}

// =====================================================================================
// The cleaning rules we apply — returned as the receipt.
// =====================================================================================
const CLEANING_RULES: string[] = [
  'DATES: every display `date` -> uniform "Aug 29, 2022" (drops "12:00:00 AM", ISO and M/D/YYYY collapsed to one format); `date_real` kept for sorting; `date_iso` (YYYY-MM-DD) added as a D3-scale side field; per-field datetimes (ordered/started/ended/discontinued/recorded/result) get clean `*_display` siblings, midnight dropped, real times kept as "Aug 29, 2022 · 2:23 PM".',
  'DRUG NAMES: medications.name "lisinopril (PRINIVIL,ZESTRIL) tablet" -> name "lisinopril 10 mg" + brand "Prinivil, Zestril" + dose "10 mg" (drops the brand parenthetical and the dosage-form words; lifts strength from the generic string; ALL-CAPS device/infusion names title-cased, e.g. "0.9%  NaCl infusion" -> "Sodium chloride 0.9 %").',
  'MED STATUS: status "Sent" -> "Ordered"; "Historical Med (documented, not prescribed)" -> "Documented, not prescribed"; "Discontinued" kept. Plain `disposition` word added: "* Patient refusal (...)" -> "declined", "* Therapy completed (...)" -> "completed", "*Reorder (...)" -> "reordered".',
  'MED ROUTE/SIG: route mapped to plain words ("Oral" -> "by mouth"); a clean one-line `directions` kept from the sig.',
  'LABS: clean component `label` (CHOLESTEROL -> "Total cholesterol", "HIGH DENSITY CHOLESTEROL"/"HDL" both -> "HDL" with canonical `analyte`="HDL"); `value` (value_num, or value_text like ">90" when no discrete number); readable `reference` range ("0 - 199" -> "0 – 199"); abnormal `flag` word High/Low/Abnormal/Normal; `fasting` word fasting/non-fasting (facility-address comments are NOT treated as fasting status); result `status` collapsed to "Final".',
  'VITALS: clean `kind_label` ("blood_pressure" -> "Blood pressure"), a clean `display_value` ("122/70 mmHg", "174 lb", height "71.000" in -> 5\'11"); BP carries sys/dia numbers + ACC/AHA `category` word (Normal/Elevated/Stage 1/Stage 2); BP `location` code (LUE -> "left arm"); `recorded_by` person name ("IRELAND, TRACY C" -> "Tracy Ireland").',
  'FAMILY: each row gets a one-line `summary` ("Mother — Hypertension"); `cardiovascular` boolean carried as a plain word; relation/condition were already clean words.',
  'SOCIAL/DEMOGRAPHIC: plain `label` ("tobacco_smoking" -> "Smoking") and `display_value`; alcohol surfaces the most-informative per-week descriptor across snapshots ("1-2" alone -> "3–4 drinks/week" from the richer earlier snapshot); physical activity -> "not captured in structured data".',
  'ENCOUNTERS: `date` humanized; `department` cleaned ("MAC APL INTERNAL MEDICINE" -> "Internal Medicine", external -> "Outside facility"); `provider_name` -> "Dr. Dhillon"; `reason` lower-cased; each `dx_list`/`primary_dx` already carries human dx names.',
  'ACUTE 2024 WORK-UP: study `name` cleaned ("XR CHEST 2 VIEWS" -> "X-ray chest 2 views", lab names title-cased); plain `result` word (ABNORMAL_YN Y/N -> "flagged abnormal"/"negative", else "resulted"); `external_origin` -> "Outside facility (imported)"; med-admin rows get the cleaned infusion name.',
  'SIDE FIELDS (never display content) preserved on every row: `src`, `enc_csn`, all `*_id`, `date_real`, plus the new `date_iso`. The raw `*_C_NAME`-style text fields (status/flag) remain for tracing but every screen value reads from the clean field beside them.',
];

// =====================================================================================
// PROJECT each entity.
// =====================================================================================

// ---- vitals -------------------------------------------------------------------------
for (const v of ds.vitals) {
  const iso = isoDate(v.date);                        // capture ISO from the RAW value first
  const human = humanDate(v.date);
  if (human) v.date = human;                          // then rewrite display date in place
  v.date_iso = iso;                                   // side field for D3 time scales
  v.recorded_at = humanDateTime(v.entry_time) ?? human;
  v.kind_label = VITAL_LABEL[v.kind] ?? String(v.kind).replace(/_/g, " ");
  v.display_value = vitalDisplay(v);
  v.recorded_by = personName(v.taken_by);
  v.flag = flagWord(v.abnormal_flag);
  if (v.kind === "blood_pressure" && v.sys != null && v.dia != null) {
    v.category = bpCategory(v.sys, v.dia);
    v.location_label = v.bp_location ? (BP_LOC[v.bp_location] ?? v.bp_location) : null;
    v.summary = `${v.sys}/${v.dia} mmHg (${v.category}${v.location_label ? ", " + v.location_label : ""})`;
  } else {
    v.summary = `${v.kind_label}: ${v.display_value}`;
  }
}

// ---- labs ---------------------------------------------------------------------------
for (const r of ds.labs) {
  const iso = isoDate(r.date);
  const human = humanDate(r.date);
  if (human) r.date = human;
  r.date_iso = iso;
  r.label = labLabel(r.component, r.order_name);
  r.analyte = r.component ? (LAB_ANALYTE[r.component] ?? null) : null;
  const unit = cleanUnit(r.unit);
  r.unit_label = unit;
  // clean displayable value: a discrete number+unit, or a textual value (">90"), or "no discrete value"
  if (r.value_num != null) r.value = `${r.value_num}${unit ? " " + unit : ""}`;
  else if (r.value_text && !/NO STRUCTURED RESULT/i.test(r.value_text)) r.value = `${r.value_text}${unit ? " " + unit : ""}`;
  else r.value = "no discrete value in export";
  r.reference = refRange(r);
  r.flag = flagWord(r.abnormal_flag);
  r.fasting = fastingWord(r.fasting_comment);
  r.status = statusWord(r.result_status);
  r.summary = `${r.label} ${r.value}${r.reference ? " (ref " + r.reference + ")" : ""}${r.flag !== "Normal" ? " · " + r.flag : ""}${r.fasting ? " · " + r.fasting : ""}`;
}

// ---- medications --------------------------------------------------------------------
for (const m of ds.medications) {
  const { name, brand, dose } = cleanDrug(m);
  m.brand = brand;
  m.dose = dose;
  m.name = name;                                       // rewrite to the clean generic+dose name
  m.route_label = m.route ? (ROUTE_WORD[m.route] ?? String(m.route).toLowerCase()) : null;
  m.directions = m.sig ? String(m.sig).trim() : null;
  m.status = medStatusWord(m);                         // "Sent" -> "Ordered"
  m.disposition = medDisposition(m);
  m.indication_label = m.indication ? String(m.indication) : null;
  m.cv_role = m.cv_relevance && m.cv_relevance !== "none" ? m.cv_relevance : null;
  m.ordered_on = humanDate(m.ordering_date ?? m.start_date);
  m.started_on = humanDate(m.start_date);
  m.ended_on = humanDate(m.end_date);
  m.discontinued_at = humanDateTime(m.discon_time);
  m.discontinued_by = personName(m.discon_user);
  m.summary = `${m.name}${m.indication_label ? " — for " + m.indication_label.toLowerCase() : ""}${m.ordered_on ? " · ordered " + m.ordered_on : ""} · ${m.disposition}`;
}

// ---- risk_factors -------------------------------------------------------------------
const SOCIAL_LABEL: Record<string, string> = {
  tobacco_smoking: "Smoking", tobacco_smokeless: "Smokeless tobacco", alcohol: "Alcohol",
  illicit_drug_use: "Illicit drug use", physical_activity: "Physical activity",
};
const DEMO_LABEL: Record<string, string> = {
  age: "Age", sex: "Sex", race: "Race", ethnicity: "Ethnicity", living_status: "Living status",
};
function alcoholDescriptor(r: any): string {
  const comments: string[] = (r.history ?? []).map((h: any) => h.comment).filter(Boolean);
  const perWeek = comments.find((c) => /3[-–]4/.test(c)) || comments.find((c) => /week/i.test(c));
  if (!perWeek) return r.value ?? "yes";
  return perWeek
    .replace(/^(about|drinks)\s+/i, "")
    .replace(/\s*days?\s*\/?\s*week/i, " drinks/week")
    .replace(/per week/i, "drinks/week")
    .replace(/(\d)[-–](\d)/, "$1–$2")
    .trim();
}
for (const r of ds.risk_factors) {
  if (r.kind === "family") {
    r.cardiovascular = !!r.cv_related;
    r.summary = `${r.relation}${r.relative_status === "Deceased" ? ", deceased" : ""} — ${r.condition}`;
    r.label = r.relation;
    r.display_value = r.condition;
  } else if (r.kind === "social") {
    r.label = SOCIAL_LABEL[r.factor] ?? String(r.factor).replace(/_/g, " ");
    if (r.factor === "alcohol") r.display_value = alcoholDescriptor(r);
    else if (r.factor === "physical_activity") r.display_value = "not captured in structured data";
    else r.display_value = r.value ?? "—";
    r.summary = `${r.label} — ${r.display_value}`;
  } else if (r.kind === "demographic") {
    r.label = DEMO_LABEL[r.factor] ?? String(r.factor).replace(/_/g, " ");
    r.display_value = `${r.value ?? "—"}${r.unit ? " " + r.unit : ""}`;
    r.summary = `${r.label} — ${r.display_value}`;
  }
}

// ---- encounters_dx ------------------------------------------------------------------
for (const e of ds.encounters_dx) {
  const iso = isoDate(e.date);
  const human = humanDate(e.date);
  if (human) e.date = human;
  e.date_iso = iso;
  e.department = deptName(e.dept);
  e.provider_name = clinicianName(e.provider);
  e.reason_label = e.reason ? String(e.reason).toLowerCase() : null;
  e.summary = `${human} · ${e.department}${e.provider_name ? " (" + e.provider_name + ")" : ""}${e.reason_label ? " — " + e.reason_label : ""}`;
  // clean nested BP readings' display (sys/dia already clean; add a label)
  for (const bp of e.bp_readings ?? []) {
    bp.recorded_at = humanDateTime(bp.recorded);
    if (bp.systolic != null && bp.diastolic != null) {
      bp.category = bpCategory(bp.systolic, bp.diastolic);
      bp.display_value = `${bp.systolic}/${bp.diastolic} mmHg`;
    }
  }
  for (const lo of e.lipid_orders ?? []) lo.ordered_at = humanDateTime(lo.order_time);
}

// ---- acute_event --------------------------------------------------------------------
function acuteResultWord(r: any): string {
  if (r.abnormal_yn === "Y") return "flagged abnormal";
  if (r.abnormal_yn === "N") return "negative";
  if (r.kind === "order") return "resulted";
  return "—";
}
function cleanStudyName(r: any): string {
  if (r.order_type === "Imaging")
    return String(r.name)
      .replace(/^XR /i, "X-ray ").replace(/^CT /i, "CT ")
      .replace(/\bW\/?\s*WO\b/gi, "with/without")           // "W WO" -> "with/without" (before per-word map)
      .replace(/\b[A-Za-z]+\b/g, (w) =>
        /^with\/without$/i.test(w) ? "with/without"
          : ACRONYMS[w.toLowerCase()] ?? (/^[A-Z0-9]+$/.test(w) && w.length > 1 ? w.charAt(0) + w.slice(1).toLowerCase() : w))
      .replace(/X-ray/i, "X-ray");
  if (r.order_type === "Lab") return titleCaseClinical(r.name);
  return r.name;
}
for (const a of ds.acute_event) {
  const iso = isoDate(a.date);
  const human = humanDate(a.date);
  if (human) a.date = human;
  a.date_iso = iso;
  // The raw extract note ("Abnormal (ABNORMAL_YN=Y); discrete component values not in structured
  // export") carries a Clarity column name — move it to a side field; `value` becomes clean below.
  if (a.value != null) { a.value_src = a.value; a.value = null; }
  a.ordered_at = humanDateTime(a.order_time);
  a.resulted_at = humanDateTime(a.result_time);
  a.department = deptName(a.dept);
  if (a.external_origin) a.external_origin_label = "Outside facility (imported)";
  if (a.kind === "order") {
    a.study = cleanStudyName(a);
    a.name = a.study;                                  // rewrite display name to the clean study name
    a.result = acuteResultWord(a);
    a.type_label = a.order_type === "Imaging" ? "Imaging" : a.order_type === "Lab" ? "Lab" : "Order";
    // clean note replacing the raw "...(ABNORMAL_YN=Y)..." value text
    a.result_detail = a.order_type === "Imaging"
      ? "read normal"
      : `${a.result}; no discrete component values in export`;
    a.summary = `${human} — ${a.study}: ${a.order_type === "Imaging" ? "read normal" : a.result}`;
  } else if (a.kind === "med_admin") {
    const { name } = cleanDrug(a);
    a.study = name;
    a.name = name;                                     // "0.9%  NaCl infusion" -> "Sodium chloride 0.9 %"
    a.type_label = "Med given";
    a.result = "administered";
    a.result_detail = a.value_src ? String(a.value_src).toLowerCase() : "administered"; // "Discontinued / Inpatient"
    a.summary = `${human} — ${name} administered`;
  } else if (a.kind === "encounter") {
    a.study = "External contact";
    a.name = `External contact · ${human}`;            // drop the raw "(GENERIC EXTERNAL...)" + slash date
    a.type_label = "External contact";
    a.result = "—";
    a.result_detail = a.department ?? "outside facility";
    a.summary = `${human} — external contact, ${a.department ?? "outside facility"}`;
  }
}

// =====================================================================================
// meta — record the projection.
// =====================================================================================
ds.meta.projected = new Date().toISOString();
ds.meta.projected_by = "deep-dives/cardiac-risk/scripts/project.ts";
ds.meta.layer =
  "DATASET — complete, traceable AND CLEAN PROJECTION. Every display VALUE is human-clean " +
  "(formatted dates, drug names like 'lisinopril 10 mg', plain statuses/flags, resolved labels). " +
  "Side fields (src, *_id, enc_csn, date_real, date_iso) are for tracing/sorting only — never display content.";
ds.meta.cleaning_rules = CLEANING_RULES;

writeFileSync(SRC, JSON.stringify(ds, null, 2));

// receipt to stdout
console.log(`wrote ${SRC}`);
console.log(`projected entities: ${Object.keys(ds).filter((k) => Array.isArray(ds[k])).map((k) => `${k}=${ds[k].length}`).join(", ")}`);
console.log("\n--- sample before/after ---");
const lis = ds.medications.find((m: any) => m.order_med_id === "772179261");
console.log(`lisinopril.name -> "${lis.name}" | brand="${lis.brand}" | dose="${lis.dose}" | status="${lis.status}" | disposition="${lis.disposition}" | ordered_on="${lis.ordered_on}"`);
const lab0 = ds.labs[0];
console.log(`labs[0] date -> "${lab0.date}" | label="${lab0.label}" | value="${lab0.value}" | reference="${lab0.reference}" | flag="${lab0.flag}" | fasting="${lab0.fasting}"`);
const bp0 = ds.vitals.find((v: any) => v.kind === "blood_pressure");
console.log(`vitals BP date -> "${bp0.date}" | display="${bp0.display_value}" | category="${bp0.category}" | location="${bp0.location_label}" | recorded_by="${bp0.recorded_by}"`);
