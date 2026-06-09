#!/usr/bin/env bun
/**
 * risk_factors.ts — the COMPLETE normalized ASCVD / cardiovascular-risk-factor table
 * for patient MANDEL, JOSHUA C (Z7004242).
 *
 * This is a DATASET-layer extract (ehi-abstraction-pass model): every relevant row,
 * tidy and keyed, NOT curated. Curation/judgment belongs in the analysis layer.
 *
 * Three row kinds, all sharing a `src` (table + keys, so every row is auditable):
 *
 *   {kind:"demographic", factor, value, ...}  — the non-modifiable ASCVD inputs
 *       (age, sex, race, ethnicity) from PATIENT (+ supplements). Age is COMPUTED
 *       from BIRTH_DATE at two reference points (latest chart contact, and export
 *       reference date) and DOB is carried so the app can recompute.
 *
 *   {kind:"social", factor, value, comment, ...} — the modifiable behavioral risk
 *       factors from SOCIAL_HX: tobacco (smoking / smokeless / form flags), alcohol
 *       (status + free-text amount), illicit/IV drug use, physical activity. Taken
 *       from the LATEST history snapshot (general-patterns §34 — histories are
 *       re-snapshotted every reviewed encounter; the latest CSN is the current view),
 *       with the per-snapshot history carried in meta so the trend is inspectable.
 *
 *   {kind:"family", relation, condition, age_onset, comment, ...} — the FULL family
 *       history (every relative × condition) from the LATEST FAMILY_HX snapshot,
 *       joined to FAMILY_HX_STATUS for the relative's vital status / sex. Each row
 *       is flagged cv_related so the analysis can filter to the CV pedigree
 *       (hypertension, hyperlipidemia, stroke, heart attack/CAD) without the dataset
 *       throwing anything away.
 *
 * Gotchas honored (reading-epic-ehi-export):
 *   - everything is TEXT → CAST(... AS REAL) before ordering the date_real (§17/§18).
 *   - histories key on a same-day history-contact CSN, re-snapshotted each review
 *     (§34); we pick the latest by PAT_ENC.PAT_ENC_DATE_REAL.
 *   - family conditions are inline _C_NAME categories; no ZC_ table, FAM_MEDICAL_DX_ID
 *     is NULL throughout — resolve from MEDICAL_HX_C_NAME (histories guide quirk #3).
 *   - family condition → relative via FAM_MED_REL_ID = FAM_STAT_ID, scoped to the
 *     SAME CSN (histories guide; §34 ids are per-snapshot).
 *   - alcohol amount lives in free-text ALCOHOL_COMMENT, not the structured numeric
 *     (histories guide quirk #6); _YN booleans are Y/N/NULL (§28).
 *
 * Read-only, idempotent. Writes deep-dives/cardiac-risk/parts/risk_factors.json.
 */
import { Database } from "bun:sqlite";
const db = new Database(process.env.EHI_DB ?? "./db/ehi.sqlite", { readonly: true });

const stripMidnight = (s: string | null) =>
  s ? s.replace(/ 12:00:00 AM$/, "").trim() : s;

// Export reference date: the model is run 2026-06-07/08; ASCVD age is "current" age.
const EXPORT_REF_DATE = "2026-06-07";

// ---------------------------------------------------------------------------
// CV-relevant family-history conditions. We FLAG (don't filter) — the dataset
// stays complete; the analysis decides what's in the CV pedigree.
// ---------------------------------------------------------------------------
const CV_CONDITIONS = new Set([
  "Hypertension",
  "Hyperlipidemia",
  "Stroke",
  "Heart attack",
  "Coronary artery disease",
  "Myocardial infarction",
  "Diabetes",
  "Diabetes mellitus",
  "Peripheral vascular disease",
  "Sudden cardiac death",
]);
const isCv = (cond: string | null, other: string | null) => {
  const c = (cond ?? "").toLowerCase();
  const o = (other ?? "").toLowerCase();
  const hay = c + " " + o;
  if (CV_CONDITIONS.has(cond ?? "")) return true;
  return /hypertens|lipid|cholesterol|stroke|cerebrovascular|heart attack|myocard|coronary|cardiac|cardiovascular|\bcad\b|peripheral vascular|diabet|aneurysm|angina|\bchf\b|atrial fib/.test(
    hay,
  );
};

// ---------------------------------------------------------------------------
// DEMOGRAPHICS — the non-modifiable ASCVD inputs.
// ---------------------------------------------------------------------------
const pat = db
  .query<any, []>(
    `SELECT p.PAT_ID, p.SEX_C_NAME, p.BIRTH_DATE, p.ETHNIC_GROUP_C_NAME,
            p4.PAT_LIVING_STAT_C_NAME, p4.SEX_ASGN_AT_BIRTH_C_NAME, p4.GENDER_IDENTITY_C_NAME
     FROM PATIENT p
     LEFT JOIN PATIENT_4 p4 ON p.PAT_ID = p4.PAT_ID`,
  )
  .get();

const races = db
  .query<any, []>(`SELECT PATIENT_RACE_C_NAME AS race, LINE FROM PATIENT_RACE ORDER BY CAST(LINE AS INT)`)
  .all()
  .map((r) => r.race)
  .filter(Boolean);

// Parse "10/26/1982 12:00:00 AM" → Date.
const dobStr = stripMidnight(pat.BIRTH_DATE)!; // "10/26/1982"
const [bm, bd, by] = dobStr.split("/").map((x) => parseInt(x, 10));
const dob = new Date(Date.UTC(by, bm - 1, bd));
const dobIso = `${by.toString().padStart(4, "0")}-${bm
  .toString()
  .padStart(2, "0")}-${bd.toString().padStart(2, "0")}`;

const ageOn = (refIso: string) => {
  const [ry, rm, rd] = refIso.split("-").map((x) => parseInt(x, 10));
  let age = ry - by;
  if (rm < bm || (rm === bm && rd < bd)) age -= 1;
  return age;
};

// Latest ACTUAL chart-contact date (for "age at last visit"). Exclude future
// 'Scheduled' appointments (general-patterns §43 — the export ships a 6/16/2027
// scheduled appt; MAX(date) would read that as "last care" and inflate the age).
const latestEnc = db
  .query<any, []>(
    `SELECT REPLACE(CONTACT_DATE,' 12:00:00 AM','') AS dt, CAST(PAT_ENC_DATE_REAL AS REAL) AS dr
     FROM PAT_ENC
     WHERE PAT_ENC_DATE_REAL IS NOT NULL AND PAT_ENC_DATE_REAL <> ''
       AND COALESCE(APPT_STATUS_C_NAME,'') <> 'Scheduled'
     ORDER BY CAST(PAT_ENC_DATE_REAL AS REAL) DESC LIMIT 1`,
  )
  .get();
// Normalize "M/D/YYYY" → "YYYY-MM-DD" for age math.
const toIso = (mdy: string) => {
  const [m, d, y] = mdy.split("/").map((x) => parseInt(x, 10));
  return `${y}-${m.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
};
const lastVisitIso = toIso(latestEnc.dt);

const demographics = [
  {
    kind: "demographic",
    factor: "age",
    value: ageOn(EXPORT_REF_DATE),
    unit: "years",
    detail: {
      dob: dobIso,
      age_at_last_chart_contact: ageOn(lastVisitIso),
      last_actual_chart_contact: lastVisitIso,
      last_contact_note:
        "Latest non-'Scheduled' encounter. A 6/16/2027 'Scheduled' appointment exists in the export (general-patterns §43) and is intentionally excluded from this anchor.",
      age_at_export_ref: ageOn(EXPORT_REF_DATE),
      export_ref_date: EXPORT_REF_DATE,
    },
    ascvd_role: "Pooled-Cohort / PREVENT age input (computed from BIRTH_DATE).",
    src: "PATIENT:PAT_ID=Z7004242 (BIRTH_DATE)",
  },
  {
    kind: "demographic",
    factor: "sex",
    value: pat.SEX_C_NAME,
    detail: {
      sex_assigned_at_birth: pat.SEX_ASGN_AT_BIRTH_C_NAME ?? null,
      gender_identity: pat.GENDER_IDENTITY_C_NAME ?? null,
    },
    ascvd_role: "ASCVD sex input.",
    src: "PATIENT:PAT_ID=Z7004242 (SEX_C_NAME)",
  },
  {
    kind: "demographic",
    factor: "race",
    value: races.join(", ") || null,
    detail: { races },
    ascvd_role:
      "Race enters the 2013 Pooled-Cohort equations (White vs African-American); not used by 2023 PREVENT.",
    src: "PATIENT_RACE:PAT_ID=Z7004242",
  },
  {
    kind: "demographic",
    factor: "ethnicity",
    value: pat.ETHNIC_GROUP_C_NAME,
    detail: {},
    ascvd_role: "Descriptive; not an ASCVD equation input.",
    src: "PATIENT:PAT_ID=Z7004242 (ETHNIC_GROUP_C_NAME)",
  },
  {
    kind: "demographic",
    factor: "living_status",
    value: pat.PAT_LIVING_STAT_C_NAME ?? null,
    detail: {},
    ascvd_role: "Context only.",
    src: "PATIENT_4:PAT_ID=Z7004242 (PAT_LIVING_STAT_C_NAME)",
  },
];

// ---------------------------------------------------------------------------
// SOCIAL HISTORY — modifiable behavioral risk factors.
// Latest snapshot is the current view (§34); history of all snapshots in meta.
// ---------------------------------------------------------------------------
const socialSnaps = db
  .query<any, []>(
    `SELECT s.PAT_ENC_CSN_ID AS csn,
            REPLACE(e.CONTACT_DATE,' 12:00:00 AM','') AS date,
            CAST(e.PAT_ENC_DATE_REAL AS REAL) AS date_real,
            s.TOBACCO_USER_C_NAME AS tobacco_user,
            s.SMOKING_TOB_USE_C_NAME AS smoking,
            s.SMOKELESS_TOB_USE_C_NAME AS smokeless,
            s.CIGARETTES_YN AS cigarettes_yn,
            s.CIGARS_YN AS cigars_yn,
            s.PIPES_YN AS pipes_yn,
            s.SNUFF_YN AS snuff_yn,
            s.CHEW_YN AS chew_yn,
            s.TOB_HX_ADDL_PACKYEARS AS pack_years,
            s.PASSIVE_SMOKE_EXPOSURE_C_NAME AS passive_smoke,
            s.TOB_SRC_C_NAME AS tobacco_src,
            s.ALCOHOL_USE_C_NAME AS alcohol_use,
            s.ALCOHOL_COMMENT AS alcohol_comment,
            s.ALCOHOL_OZ_PER_WK AS alcohol_oz_wk,
            s.ALCOHOL_FREQ_C_NAME AS alcohol_freq,
            s.ALCOHOL_DRINKS_PER_DAY_C_NAME AS alcohol_drinks_per_day,
            s.ALCOHOL_BINGE_C_NAME AS alcohol_binge,
            s.ALCOHOL_SRC_C_NAME AS alcohol_src,
            s.ILL_DRUG_USER_C_NAME AS illicit_drug_user,
            s.IV_DRUG_USER_YN AS iv_drug_user_yn,
            s.ILLICIT_DRUG_FREQ AS illicit_drug_freq,
            s.PHYS_ACT_DAYS_PER_WEEK_C_NAME AS phys_act_days_wk,
            s.PHYS_ACT_MIN_PER_SESS_C_NAME AS phys_act_min_sess
     FROM SOCIAL_HX s
     LEFT JOIN PAT_ENC e ON s.PAT_ENC_CSN_ID = e.PAT_ENC_CSN_ID
     ORDER BY CAST(e.PAT_ENC_DATE_REAL AS REAL)`,
  )
  .all();

const latest = socialSnaps[socialSnaps.length - 1];
const latestCsn = latest.csn;
const latestDate = latest.date;

// Each social factor → one row. Value from the latest snapshot; comment carries the
// free-text detail; history (changed values across snapshots) lives in the row so the
// trend is interrogable without leaving the dataset.
const socialHistory = (sel: (s: any) => any, label: (v: any) => string) =>
  socialSnaps.map((s) => ({ date: s.date, csn: s.csn, value: label(sel(s)) }));

const social = [
  {
    kind: "social",
    factor: "tobacco_smoking",
    value: latest.smoking, // "Never"
    comment: null,
    detail: {
      tobacco_user: latest.tobacco_user,
      pack_years: latest.pack_years ?? null,
      cigarettes_yn: latest.cigarettes_yn ?? null,
      cigars_yn: latest.cigars_yn ?? null,
      pipes_yn: latest.pipes_yn ?? null,
      source: latest.tobacco_src ?? null,
    },
    history: socialSnaps.map((s) => ({ date: s.date, csn: s.csn, value: s.smoking })),
    ascvd_role: "Current smoking is a Pooled-Cohort / PREVENT input. 'Never' here.",
    src: `SOCIAL_HX:PAT_ENC_CSN_ID=${latestCsn} (SMOKING_TOB_USE_C_NAME); latest of 8 snapshots`,
  },
  {
    kind: "social",
    factor: "tobacco_smokeless",
    value: latest.smokeless, // "Never"
    comment: null,
    detail: {
      snuff_yn: latest.snuff_yn ?? null,
      chew_yn: latest.chew_yn ?? null,
      passive_smoke_exposure: latest.passive_smoke ?? null,
      source: latest.tobacco_src ?? null,
    },
    history: socialSnaps.map((s) => ({ date: s.date, csn: s.csn, value: s.smokeless })),
    ascvd_role: "Smokeless tobacco — adverse CV signal; 'Never' here.",
    src: `SOCIAL_HX:PAT_ENC_CSN_ID=${latestCsn} (SMOKELESS_TOB_USE_C_NAME)`,
  },
  {
    kind: "social",
    factor: "alcohol",
    value: latest.alcohol_use, // "Yes"
    comment: latest.alcohol_comment, // "1-2"  (free-text amount, histories guide quirk #6)
    detail: {
      oz_per_week: latest.alcohol_oz_wk ?? null,
      frequency: latest.alcohol_freq ?? null,
      drinks_per_day: latest.alcohol_drinks_per_day ?? null,
      binge: latest.alcohol_binge ?? null,
      source: latest.alcohol_src ?? null,
      note:
        "Structured numeric alcohol fields are NULL; the amount is in free-text ALCOHOL_COMMENT, which drifts across snapshots (3-4 drinks/wk → 1-2).",
    },
    history: socialSnaps.map((s) => ({
      date: s.date,
      csn: s.csn,
      value: s.alcohol_use,
      comment: s.alcohol_comment,
    })),
    ascvd_role: "Modifiable; not an equation input but a counseling/risk-modifier factor.",
    src: `SOCIAL_HX:PAT_ENC_CSN_ID=${latestCsn} (ALCOHOL_USE_C_NAME, ALCOHOL_COMMENT)`,
  },
  {
    kind: "social",
    factor: "illicit_drug_use",
    value: latest.illicit_drug_user, // "No"
    comment: null,
    detail: {
      iv_drug_user: latest.iv_drug_user_yn ?? null,
      frequency: latest.illicit_drug_freq ?? null,
    },
    history: socialSnaps.map((s) => ({
      date: s.date,
      csn: s.csn,
      value: s.illicit_drug_user,
      iv: s.iv_drug_user_yn,
    })),
    ascvd_role:
      "Stimulant use (cocaine/amphetamine) is an acute CV risk; reported 'No', IV 'N'.",
    src: `SOCIAL_HX:PAT_ENC_CSN_ID=${latestCsn} (ILL_DRUG_USER_C_NAME, IV_DRUG_USER_YN)`,
  },
  {
    kind: "social",
    factor: "physical_activity",
    value:
      latest.phys_act_days_wk || latest.phys_act_min_sess
        ? `${latest.phys_act_days_wk ?? "?"} days/wk, ${latest.phys_act_min_sess ?? "?"} min/session`
        : null,
    comment:
      "Not captured in structured SOCIAL_HX fields (PHYS_ACT_DAYS_PER_WEEK / _MIN_PER_SESS are NULL at every snapshot).",
    detail: {
      days_per_week: latest.phys_act_days_wk ?? null,
      min_per_session: latest.phys_act_min_sess ?? null,
    },
    history: socialSnaps.map((s) => ({
      date: s.date,
      csn: s.csn,
      value:
        s.phys_act_days_wk || s.phys_act_min_sess
          ? `${s.phys_act_days_wk ?? "?"} days/wk, ${s.phys_act_min_sess ?? "?"} min`
          : null,
    })),
    ascvd_role: "Modifiable lifestyle factor; not captured structurally here.",
    src: `SOCIAL_HX:PAT_ENC_CSN_ID=${latestCsn} (PHYS_ACT_DAYS_PER_WEEK_C_NAME, PHYS_ACT_MIN_PER_SESS_C_NAME)`,
  },
];

// ---------------------------------------------------------------------------
// FAMILY HISTORY — the FULL latest snapshot, every relative × condition,
// joined to FAMILY_HX_STATUS for the relative's vital status / sex.
// CV-related rows are FLAGGED, not filtered (dataset stays complete).
// ---------------------------------------------------------------------------
// Latest FAMILY_HX snapshot (by encounter date_real, §34).
const famSnaps = db
  .query<any, []>(
    `SELECT f.PAT_ENC_CSN_ID AS csn,
            REPLACE(e.CONTACT_DATE,' 12:00:00 AM','') AS date,
            CAST(e.PAT_ENC_DATE_REAL AS REAL) AS date_real,
            COUNT(*) AS n_rows
     FROM FAMILY_HX f
     LEFT JOIN PAT_ENC e ON f.PAT_ENC_CSN_ID = e.PAT_ENC_CSN_ID
     GROUP BY f.PAT_ENC_CSN_ID
     ORDER BY CAST(e.PAT_ENC_DATE_REAL AS REAL)`,
  )
  .all();
const latestFamCsn = famSnaps[famSnaps.length - 1].csn;
const latestFamDate = famSnaps[famSnaps.length - 1].date;

const famRows = db
  .query<any, [string]>(
    `SELECT CAST(fh.LINE AS INT) AS line,
            fh.RELATION_C_NAME AS relation,
            fh.MEDICAL_HX_C_NAME AS condition,
            fh.MEDICAL_OTHER AS condition_other,
            fh.AGE_OF_ONSET AS age_onset,
            fh.AGE_OF_ONSET_END AS age_onset_end,
            fh.COMMENTS AS comment,
            fh.FAM_HX_SRC_C_NAME AS source,
            fh.FAM_MED_REL_ID AS rel_id,
            fs.FAM_STAT_STATUS_C_NAME AS relative_status,
            fs.FAM_STAT_SEX_C_NAME AS relative_sex,
            fs.FAM_STAT_DEATH_AGE AS relative_death_age,
            fs.FAM_STAT_COD_C_NAME AS relative_cause_of_death
     FROM FAMILY_HX fh
     LEFT JOIN FAMILY_HX_STATUS fs
       ON fh.PAT_ENC_CSN_ID = fs.PAT_ENC_CSN_ID
      AND fh.FAM_MED_REL_ID = fs.FAM_STAT_ID
     WHERE fh.PAT_ENC_CSN_ID = ?
     ORDER BY CAST(fh.LINE AS INT)`,
  )
  .all(latestFamCsn);

const family = famRows.map((r) => ({
  kind: "family",
  relation: r.relation,
  condition: r.condition ?? r.condition_other,
  condition_other: r.condition_other ?? null,
  age_onset: r.age_onset ?? null,
  age_onset_end: r.age_onset_end ?? null,
  comment: r.comment ?? null,
  cv_related: isCv(r.condition, r.condition_other),
  source: r.source ?? null,
  relative_status: r.relative_status ?? null,
  relative_sex: r.relative_sex ?? null,
  relative_death_age: r.relative_death_age ?? null,
  relative_cause_of_death: r.relative_cause_of_death ?? null,
  src: `FAMILY_HX:PAT_ENC_CSN_ID=${latestFamCsn},LINE=${r.line} (joined FAMILY_HX_STATUS.FAM_STAT_ID=${r.rel_id})`,
}));

// ---------------------------------------------------------------------------
// Assemble. Rows are the complete dataset; meta records provenance + snapshot history.
// ---------------------------------------------------------------------------
const rows = [...demographics, ...social, ...family];

const meta = {
  entity: "risk_factors",
  topic: "cardiac-risk",
  patient: { pat_id: "Z7004242", name: "MANDEL, JOSHUA C", sex: pat.SEX_C_NAME, dob: dobIso },
  generated: new Date().toISOString(),
  export_ref_date: EXPORT_REF_DATE,
  counts: {
    total_rows: rows.length,
    demographic: demographics.length,
    social: social.length,
    family: family.length,
    family_cv_related: family.filter((f) => f.cv_related).length,
  },
  snapshots: {
    social_hx: {
      latest_csn: latestCsn,
      latest_date: latestDate,
      n_snapshots: socialSnaps.length,
      all: socialSnaps.map((s) => ({ date: s.date, csn: s.csn })),
      note:
        "SOCIAL_HX is re-snapshotted each reviewed encounter (general-patterns §34); social rows reflect the latest snapshot, with per-snapshot history embedded in each row.",
    },
    family_hx: {
      latest_csn: latestFamCsn,
      latest_date: latestFamDate,
      n_snapshots: famSnaps.length,
      growth: famSnaps.map((s) => ({ date: s.date, csn: s.csn, n_rows: s.n_rows })),
      note:
        "FAMILY_HX grew 3 → 11 → 12 facts across 2018→2025 (general-patterns §34). The dataset uses the latest 12-row snapshot; earlier snapshots are a subset. Colon polyps (Brother) was the 2025 add.",
    },
  },
  source_tables: {
    demographics: ["PATIENT", "PATIENT_4", "PATIENT_RACE"],
    social: ["SOCIAL_HX", "PAT_ENC"],
    family: ["FAMILY_HX", "FAMILY_HX_STATUS", "PAT_ENC"],
  },
  notes:
    "DATASET layer — complete, not curated. CV relevance is FLAGGED (cv_related) on family rows, never filtered. AGE_OF_ONSET, structured alcohol numerics, and pack-years are NULL in this specimen; alcohol amount is free-text ALCOHOL_COMMENT.",
};

const out = { rows, meta };
await Bun.write(
  "deep-dives/cardiac-risk/parts/risk_factors.json",
  JSON.stringify(out, null, 2),
);
console.log(
  `wrote ${rows.length} rows ` +
    `(${demographics.length} demographic, ${social.length} social, ${family.length} family; ` +
    `${family.filter((f) => f.cv_related).length} CV-related family) ` +
    `to deep-dives/cardiac-risk/parts/risk_factors.json`,
);
