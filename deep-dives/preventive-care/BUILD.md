# BUILD — *Up to Date?* from the raw export to `viewmodel.json`

How an analyst gets from the **raw** Epic EHI export (`db/ehi.sqlite` + `raw/`) to this dive's
`viewmodel.json`. The deliverable is a worklist of preventive-care **measures**, each carrying an
*independently computed* verdict (eligibility → status → next-due) **plus** a reconciliation against Epic's
own Health-Maintenance engine, every claim citing a patient fact and a published guideline.

The engine has two halves that meet at the end: a **projection** off the structured tables (the patient's
facts and completions) and a **judgment** half (the cited guidelines, abstracted from outside this repo).
A runnable implementation is kept in `scripts/` (`project-patient.ts` → `parts/patient-data.json`,
guideline research → `parts/guidelines.json`, hand-authored `parts/sections.json`, then `evaluate.ts` joins
them → `viewmodel.json`); it is *one* way to run the recipe below, not the recipe itself.

## 1. Target schema (the contract the app consumes)

```ts
interface ViewModel {
  meta: { title: string; subtitle: string; asOf: string; retrieved: string; patient: { sex: string; age: number } };
  sections: { id: string; title: string; prose: string[]; cites: string[] }[];   // the narrative spine
  summary: { headline: string; counts: {
    upToDate: number; openGaps: number; overdue: number; comingDue: number;
    notApplicable: number; epicNoise: number; epicMissing: number; divergent: number } };
  riskFacts: { key: string; label: string; value: string; decisive?: boolean; evidenceId: string; trend?: any[] }[];
  bmiTrend: { iso: string; display: string; bmi: number }[];
  actNow: string[];                       // measure keys = the order-at-next-visit list
  measures: Measure[];
  reconciliation: string[];               // measure keys where the audit departs from Epic
  forecastArtifacts: { topic: string; status: string; nextDue: Day; ageAtDue: number; note: string }[];
  evidence: Record<string, Evidence>;     // the only thing the drawer reads
}
type Day = { iso: string; display: string };
interface Measure {
  key: string; title: string; category: "screening" | "immunization" | "counseling";
  authority: string; rule: string | null; citationId: string | null;       // e.g. "USPSTF · Grade A"
  secondaryAuthority: string | null; secondaryCitationId: string | null;    // ADA, for the diabetes split
  eligibility: { state: "applies"|"excluded"|"conditional"|"not-yet-eligible"; reason: string; factEvidence?: string };
  status: "up-to-date"|"gap"|"overdue"|"due-soon"|"partial"|"optional"|"optional-done"|"monitored"|"not-yet-eligible"|"not-applicable";
  lastDone: Day | null; nextDue: Day | null;
  intervalMonths: number | null; oneTime: boolean; riskBased: boolean; sharedDecision: boolean;
  completions: { iso: string; display: string; evidenceId: string | null }[];
  lane: { markers: { iso: string; display: string; evidenceId: string | null }[];
          bands: { kind: "covered"|"overdue"; from: string; to: string }[] };
  reconciliation: { kind: "agree"|"epic-noise"|"epic-missing"|"divergent-eligibility"; epicStatus: string | null;
                    epicNextDue: string | null; dateArtifact?: boolean; note: string };
  note: string | null;
}
type Evidence =
  | { kind: "fact"|"lab"|"immunization"; who?: string; date?: string; text: string }
  | { kind: "guideline"; who: string; date: string; text: string; url: string };
```

## 2. The recipe (a workflow of parallel agents)

The lead assembles; these slots fan out. Independent slots A–D run in parallel; E (evaluation) is the join.

### A. Patient facts & risk drivers — *projection* (`riskFacts`, `bmiTrend`)
Source: `PATIENT` (`BIRTH_DATE`, `SEX_C_NAME`) for age/sex; `SOCIAL_HX` (latest by `CONTACT_DATE`) for
`TOBACCO_USER_C_NAME` / `SMOKING_TOB_USE_C_NAME` (the never-smoker fact that **excludes** AAA & lung-CA
screening), `ALCOHOL_USE_C_NAME`, `ILL_DRUG_USER_C_NAME`/`IV_DRUG_USER_YN`; `PAT_ENC.BMI` for the BMI trend
(the diabetes-screening eligibility hinge); `PROBLEM_LIST` (active) for chronic-disease risk — its
`DESCRIPTION` is blank, so **resolve each problem's name via `DX_ID → CLARITY_EDG.DX_NAME`** (the field-guide
recipe; a blank name column is *not* "no problems"). Here the four active problems (reflux, two allergy
diagnoses, post-concussion) are non-cardiometabolic, so an average-risk default holds — but that is a
*computed* conclusion from the resolved names, not from an empty column. Cleaning: parse `BIRTH_DATE` and
compute age as of `asOf` (a fixed date,
not `now()`, for determinism). **Gotcha:** Epic dates are TEXT `M/D/YYYY h:mm:ss AM`, so `ORDER BY
CONTACT_DATE` sorts *lexically* ("12/4/2025" < "9/28/2023") — parse to ISO and sort on that, or the "latest"
BMI/social-hx row is wrong. Each fact becomes an `evidence` entry (`kind:"fact"`) keyed `e_<key>`.

### B. Completions — *projection* (per measure: the dated events that satisfy it)
- **Immunizations** from `IMM_ADMIN` (`IMM_TYPE_ID_NAME`, `IMM_DATE`, `IMM_MANUFACTURER_C_NAME`,
  `IMM_STATUS_C_NAME='Given'`). **Gotchas:** the table is heavily duplicated (one row per
  component/group) — dedup by `(vaccine-family, date)`; and `IMM_TYPE_ID_NAME` is a raw brand-dump
  (`INFLUENZA (FLUCELVAX) CCIIV3`) — map to a clean family + human label, keep the raw product only as a
  side field. The Feb 5 2019 cluster (Tdap + Hep A + Typhoid on one day) is the pre-travel-visit signature.
- **Screening labs** from `ORDER_RESULTS` (`COMPONENT_ID_NAME`, `ORD_VALUE`, `RESULT_FLAG_C_NAME`,
  `REFERENCE_LOW/HIGH/UNIT`, `RESULT_DATE`): lipid panel (CHOLESTEROL/TRIGLYCERIDES/HDL/LDL — the rising-TG,
  low-HDL signal), A1c/GLUCOSE (diabetes), `HEPATITIS C AB` (the one-time screen, nonreactive). Group by date
  → one `evidence` entry (`kind:"lab"`) per panel.
- **Blood pressure** (hypertension screening): the reading is **not** on `IP_FLWSHT_MEAS` (its value column
  is excluded) — join to the export view `V_EHI_FLO_MEAS_VALUE` on `(FSD_ID, LINE)` and read
  `MEAS_VALUE_EXTERNAL` where `FLO_MEAS_ID='5'` (BP). Parse `sys/dia`, flag readings ≥140/90 as elevated
  office values. (This is the same "value lives in a `V_EHI_*` view" trap as any flowsheet vital.)
- **Depression**: a PHQ-2 instrument is present as flowsheet items `IP_FLWSHT_MEAS.FLO_MEAS_ID ∈
  {2100100050, 2100100051}` ("Little interest…", "Feeling down…") — presence only; do **not** surface the
  responses (PHI-adjacent).
- **HIV**: confirm *absence* — no `ORDER_RESULTS` HIV component anywhere ⇒ a true never-screened gap.

### C. Epic Health-Maintenance status & forecast artifacts — *projection* (`reconciliation`, `forecastArtifacts`)
Source: `HM_HISTORICAL_STATUS` (`HM_TOPIC_ID_NAME`, `LINE`, `HM_STATUS_C_NAME`, `NEXT_DUE_DATE`,
`LAST_COMPLETED_DATE`). `LINE` is a historical log with **no per-row timestamp**, so do *not* try to place
Epic statuses on a calendar — take the **current** status as the max-`LINE` row per topic (CAST `LINE` to int;
the same lexical-sort trap applies). Harvest **forecast artifacts** by scanning *all* lines for `NEXT_DUE_DATE`
values whose year ≤ birth-year + 18 — these are birthdate/age-rule artifacts the engine emits (a Hep C screen
"due" at birth in 1982; COVID "overdue" in 1987, before the vaccine existed). `HM_PLAN_INFO` / `IMM_DUE`
corroborate which topics the engine tracks. (`HM_FORECAST_INFO` is the engine's earliest-valid-date table —
useful but secondary.)

### D. Guidelines — *judgment, sourced beyond this repo* (`measures[].authority/rule/citationId`, `evidence` `kind:"guideline"`)
Fan one agent per authority over the **primary** web sources and return, per measure: population rule
(age band / sex / risk gate), USPSTF **grade**, the action, the interval (or one-time / risk-based /
shared-decision), a short verbatim `ruleQuote`, the `citationUrl`+`citationTitle`, and the `retrieved` date.
**Adversarially verify** each grade/interval against a second authoritative source before trusting it.
- **USPSTF** — HIV (A, one-time 15–65), Hep C (B, one-time 18–79), colorectal (B at 45–49 / A 50–75),
  prediabetes/T2DM (B, 35–70 **only if BMI ≥ 25** — the eligibility hinge), hypertension (A, ≥18),
  depression (B), unhealthy-alcohol (B), tobacco (A), lung-CA (B — *excluded, never-smoker*),
  AAA (B — *excluded, never-smoker*), and the statin/lipid statement (B, 40–75) for lipid screening.
- **CDC/ACIP adult schedule** — influenza, COVID-19, Tdap/Td (10-yr booster), Hep B (universal 19–59),
  Hep A, HPV (shared decision 27–45), zoster (≥50), pneumococcal (≥50), RSV (≥75), MMR/varicella
  (presumed-immune for a 1982 cohort), meningococcal (risk), and the travel vaccines (risk-based).
- **ADA Standards of Care** — diabetes screening **all adults ≥ 35** regardless of BMI, carried specifically
  to stage the **USPSTF-vs-ADA divergence**.
**PHI rule:** guideline text is public; never paste a patient value into it. Decode any HTML entities and
avoid `(ABBR, Brand)` comma-in-parens that trips the brand-alias linter (e.g. write `(RZV; Shingrix)`).

### E. The evaluation engine — the join (`measures`, `status`, `lane`, `summary`, `actNow`)
A canonical **measure registry** maps each clinical measure to its guideline(s) (matched by id/title +
authority), this patient's completions (from B), an eligibility predicate over the facts (from A), the
recurrence interval, and the Epic topic (from C). Per measure compute:
- **Eligibility** from the facts, naming the deciding fact: `excluded` (never-smoker → AAA, lung),
  `not-yet-eligible` (age < ageMin → colorectal, zoster, pneumococcal, RSV; `nextDue` = date at ageMin),
  `conditional` (BMI-gated diabetes; risk/shared-decision vaccines), else `applies`.
- **Status**, recomputed independently (never read from Epic): one-time ⇒ `up-to-date`/`gap`; recurring ⇒
  from `lastDone + intervalMonths` vs `asOf` (`up-to-date`/`due-soon`/`overdue`, or `gap` if never done;
  conditional-with-no-completion ⇒ `partial`). Hypertension is a recurring screen whose completions are the
  BP readings, so it lands `up-to-date` with the elevated 2022 value surfaced as a note, not a gap.
- **Lane bands** for recurring measures from the real completions: a `covered` band `[done, done+interval]`
  (clipped at the next completion) and an `overdue` band in any gap before the next completion or `asOf` —
  this *is* the independent recompute that overrides Epic's forecast.
- **Reconciliation** vs the Epic topic: no topic ⇒ `epic-missing` (audit adds it); `Hidden`/`Aged Out` ⇒
  `epic-noise` (reclassify as risk-based or age-deferred); the diabetes topic ⇒ `divergent-eligibility`
  (USPSTF-conditional vs ADA-unconditional, both shown); else `agree` (flag `dateArtifact` when Epic's
  next-due is a stale birthdate date).
The lead rolls up `summary.counts`, sets `actNow` = the hard `gap`/`overdue`/`due-soon` measures (here HIV +
Hep B), and checks the invariant that **every `cite`/`evidenceId`/section `cites` resolves in `evidence`**.

### F. Narrative — *hand-abstraction* (`sections`)
Six sections (verdict, act-now, lanes, reconciliation, immunizations, limits) authored as a clinician's
reasoning, each citing `evidence` ids (`parts/sections.json`). The prose is the spine; the figures answer
questions it poses. Keep specific values in the view model, not transcribed into prose for their own sake.

## 3. Invariants to check before shipping
- `bun lib/validate-extract.ts deep-dives/preventive-care/viewmodel.json` → VIEW-MODEL mode, **0 unresolved
  cites, no raw tells, no PHI**.
- No measure status disagrees with its own lane bands; `actNow` contains only hard gaps/overdue/due.
- Every `forecastArtifacts` entry has year ≤ birth-year + 18 (it really is impossible).
- Source of truth is `parts/` + `scripts/`; `viewmodel.json` is the **assembled output** — to change a number
  or sentence, edit the part (or guideline source) and re-run `project-patient.ts` then `evaluate.ts`, never
  hand-edit the view model.
