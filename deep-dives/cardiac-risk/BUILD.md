# BUILD — cardiac-risk: from the raw EHI export to `viewmodel.json`

This is the recipe an analyst follows to rebuild `viewmodel.json` **from the raw export alone**
(`db/ehi.sqlite` + `raw/`). It is method, not data: it names the raw tables, the joins, the
constraints that bite, and the abstraction rubrics — the actual values, quotes and figures live in
`viewmodel.json`, cited here only by slot / `evidenceId` / table. Confirm any raw table/column with
`bun lib/q.ts "<SQL>"`; read note bodies with `bun lib/rtf2txt.ts "raw/Rich Text/<file>.RTF"`.

Patient is a single subject; every query is implicitly scoped to him (one `PAT_ID`). No SSN, street
address, phone, email, or raw MRN ever enters the view model — several free-text fields carry them
and must be parsed-then-dropped (flagged below).

---

## PART 1 — The target schema (TypeScript)

```ts
interface ViewModel {
  summary: string;                       // the consult-opener paragraph
  sections: Section[];                   // the prose spine, storyboard order
  evidence: Record<string, Evidence>;    // the cite drawer; every cite id resolves here
  bp: BPBlock;
  metabolic: MetabolicBlock;
  lipids: LipidsBlock;
  ascvd: AscvdBlock;
  family: FamilyBlock;
  htn: HtnBlock;
  acute: AcuteEvent[];
}

interface Section { id: string; title: string; narrative: { text: string; cites: string[] }[]; }

// kind 'note' = a verbatim note quote (who+date+quote); kind 'fact' = a readable statement (date+text)
interface Evidence {
  kind: "note" | "fact";
  who?: string; date?: string;
  quote?: string;                        // present on kind 'note'
  text?: string;                         // present on kind 'fact'
}

interface BPReading { date: string; date_iso: string; sys: number; dia: number; category: BPCategory; }
type BPCategory = "Normal" | "Elevated" | "Stage 1" | "Stage 2";
interface BPBlock { readings: BPReading[]; meanSys: number; n: number; nStage1Plus: number; }

interface MetabolicBlock {
  weight: { date: string; date_iso: string; lb: number }[];
  a1c:    { date: string; date_iso: string; pct: number }[];
  cgm: { ordered: { item: string; orderedOn: string }[]; note: string };
}

interface LipidPanelRow { analyte: string; value: number | null; unit: string | null; refText: string | null; flag: "Low" | "High" | null; }
interface LipidPanel { date: string; dateIso: string; fasting: boolean; rows: LipidPanelRow[]; }
interface LipidsBlock {
  panels: LipidPanel[];
  trend: { dates: string[]; totalChol: (number|null)[]; ldl: (number|null)[]; hdl: (number|null)[]; tg: (number|null)[]; ratio: (number|null)[] };
}

interface AscvdInput { label: string; value: string; evidenceId: string; }
interface AscvdBand  { label: string; range: string; from: number; to: number; }
interface AscvdPoint { date: string; pct: number; panel: string; evidenceId: string; }
interface AscvdSensitivity { title: string; note: string; panel: string; points: { label: string; pct: number }[]; evidenceId: string; }
interface AscvdBlock {
  low: string; high: string; low_pct: number; high_pct: number; unit: string;
  basis: string; threshold_note: string;
  bands: AscvdBand[];
  inputs: AscvdInput[];
  trajectory: AscvdPoint[];
  sensitivities: { systolic: AscvdSensitivity; fasting_redraw: AscvdSensitivity };
  cross_check: { model: string; value: string; note: string; evidenceId: string };
  caveats: string[];
  interpretation: string;
}

interface FamilyMember {
  id: string; relation: string; sex: "male" | "female"; deceased: boolean;
  affected: string[];                                  // CV condition keys → shading
  conditions: { label: string; cardiovascular: boolean }[];
  parents: string[]; generation: 1 | 2 | 3; proband?: boolean;
}
interface FamilyBlock {
  members: FamilyMember[];
  conditions: { key: string; label: string; color: string }[];
  generations: { generation: number; label: string; ids: string[] }[];
  totalFacts: number; totalCvFacts: number; bilateral: string; onsetCaveat: string;
}

interface HtnBlock {
  coding: {
    onProblemList: boolean; encounterDxCount: number; encounterDxDetail: string;
    declinedMed: boolean; declinedMedName: string; elevatedReadings: string;
    readdressedInLaterVisits: number; laterVisitCount: number; windowYears: number;
  };
  scorecard:  { label: string; value: string; detail?: string; tone: "bad"|"watch"|"good"; evidenceId: string }[];
  timeline:   { date: string; event: string; tone: string; evidenceId: string }[];
  boilerplateVsVitals: { date: string; noteSays: string; bpRecorded: string; category: string; evidenceId: string }[];
}

interface AcuteEvent {
  date: string; label: string; setting: string; result: string;
  studies: { study: string; result: string }[];
  unreconciled: boolean; unreconciledNote: string; reassurance: string;
  evidenceId: string; readEvidenceId: string;
  unreconciledEvidenceId?: string; pcpSilentEvidenceId?: string;
}
```

---

## PART 2 — The data + abstraction spec (workflow of parallel agents)

### Workflow shape

The view model splits cleanly into **independent units** a fan-out of agents can own in parallel.
Two kinds of agent:

- **Projection agents** (deterministic SQL → figures): `bp` + the weight/A1c half of `metabolic`,
  `lipids`, `ascvd`, `family`, `htn.coding`/`scorecard`/`boilerplateVsVitals`, and the studies in
  `acute`. Each reads only raw tables, applies the cleaning rules below, and recomputes its own
  aggregates in code (never hand-types a count or a mean) so a figure cannot drift from the rows.
- **Judgment agents** (read the notes): the `summary` and `sections[].narrative` prose spine, and
  the **note-quote** entries of `evidence` (`kind:"note"`). These read the progress-note bodies in
  `raw/Rich Text/*.RTF` and the two radiology reads, and freeze a clinician's reasoning into the
  view model. They are evidence-traced but not deterministically re-runnable — say so honestly.

The **lead** assembles the populated slots into the schema and checks the invariants:
**every `cites` / `evidenceId` / `readEvidenceId` / `unreconciledEvidenceId` / `pcpSilentEvidenceId`
resolves in `evidence`**; every projected figure agrees with the prose that quotes it (e.g. the BP
mean in `summary` equals `bp.meanSys`); no display string carries a raw artifact (`12:00:00 AM`, a
`*_C_NAME`, a locator id, a `(PRINIVIL,ZESTRIL)` brand parenthetical, an ISO date leaking into prose).

**Shared cross-cutting constraints** every projection agent honors (Epic EHI genre):
- Everything in the export is **TEXT**. `CAST(... AS REAL)` (or INTEGER) **before** any `ORDER BY` /
  `MIN` / `MAX` — text dates and numbers sort lexically and lie.
- True cross-encounter chronology is `CAST(PAT_ENC.PAT_ENC_DATE_REAL AS REAL)` (days since the
  1840-12-31 epoch; the `.NN` fraction sequences same-day contacts). Display dates are parsed from
  the `*_DATE` / `RECORDED_TIME` text and rendered `"Aug 9, 2018"`; the midnight tail `12:00:00 AM`
  is stripped, and a `date_iso` (`"2018-08-09"`) rides along as a **side field** for D3 scales, never
  as display content.
- Qualitative-lab sentinel: `ORDER_RESULTS.ORD_NUM_VALUE = 9999999` means "not a number" — treat the
  numeric as null and read the real value from `ORD_VALUE` / `VALUE_NORMALIZED`.
- Histories (`SOCIAL_HX`, `FAMILY_HX`) are **re-snapshotted every reviewed encounter**; the current
  view is the snapshot on the latest encounter `PAT_ENC_DATE_REAL`.

---

### `bp` — projection

**Source.** The blood-pressure value lives **only** in the flowsheet *view*
`V_EHI_FLO_MEAS_VALUE.MEAS_VALUE_EXTERNAL` (the base `IP_FLWSHT_MEAS` row holds no value). Join the
view to `IP_FLWSHT_MEAS` on `(FSD_ID, LINE)`; `FLO_MEAS_ID = 5` (disp name `BP`,
`VALUE_TYPE_C_NAME = 'Blood Pressure'`) is the BP measure. Tie each reading to its encounter through
`IP_FLWSHT_REC.INPATIENT_DATA_ID = PAT_ENC.INPATIENT_DATA_ID` to get the sortable
`PAT_ENC_DATE_REAL` and the display date.

**Logic.** The value is packed `"sys/dia"` — split on `/` into two integers. Order by
`PAT_ENC_DATE_REAL`. Compute, **in code from the rows**:
- `meanSys` = mean of systolics, rounded to 0.1;
- `n` = count of readings;
- `category` per reading via the **ACC/AHA 2017** rule: Stage 2 if `sys≥140 || dia≥90`; else Stage 1
  if `sys≥130 || dia≥80`; else Elevated if `sys≥120 && dia<80`; else Normal;
- `nStage1Plus` = count at/above the Stage-1 cut (`sys≥130 || dia≥80`).

**Constraints.** A multi-day inpatient stay can split one encounter across two `FSD`s under one
`INPATIENT_DATA_ID`; keying chronology by encounter avoids double-sequencing. Vitals abnormal flags
are mostly absent here (exactly one BP carries `ABNORMAL_C_NAME='Yes'`, a single Dec 2022 reading — surfaced
in `evidence` as `e_bp_flagged`, not as a `bp.readings` field). BP capture-context sibling rows
(location/position/cuff, `FLO_MEAS_ID` 210000000012/13/14) exist in the same `FSD` but are **not**
emitted into this slot.

---

### `metabolic` — projection (weight, A1c) + judgment-lite note (CGM)

**weight** — same flowsheet path as BP: `FLO_MEAS_ID = 14`, **stored in ounces** → `lb = oz / 16`
(round 0.1). Read `UNITS` to confirm; never assume the unit. Order by `PAT_ENC_DATE_REAL`.

**a1c** — `ORDER_RESULTS` component `HEMOGLOBIN A1C` (resolve the component via
`COMPONENT_ID_NAME`), numeric value `ORD_NUM_VALUE` (sentinel-guarded), `pct` rounded as drawn,
ordered by `CAST(ORD_DATE_REAL AS REAL)`.

**cgm** — the device orders are in `ORDER_MED`; match name/description for `FreeStyle Libre` (generic
via `MEDICATION_ID → CLARITY_MEDICATION`, **not** via `ORDER_MED_ID`). Classify each order line into
`sensor` / `reader` by the description text, de-dupe by `(component, orderedOn)`, and emit one clean
`item` line each. The `note` states the judgment plainly: self-funded, first ordered Mar 12 2024
despite no diabetes criteria, marked "not taking" by the Dec 4 2025 visit, and **no glucose time
series ever entered the structured record** — only the device orders are present (verified: there is
no CGM-derived flowsheet/result data). The "not taking" status is corroborated by the note quote
`e_cgm`.

---

### `lipids` — projection

**Source.** `ORDER_RESULTS` joined to `ORDER_PROC` (`op.ORDER_PROC_ID = r.ORDER_PROC_ID`), filtered
to the lipid-panel orders (`ORDER_PROC.DESCRIPTION LIKE '%LIPID%'`). One result row per analyte.

**Logic.** Group rows into **panels** by `(ORDER_PROC_ID, date_iso)` — one draw per group; order
panels oldest→newest by `ORD_DATE_REAL`. For each row:
- `value` = numeric, sentinel-guarded (`9999999` → null);
- `analyte` = a **unified human label**, the key cleaning step: the older 2018 panel names HDL
  `HIGH DENSITY CHOLESTEROL` while later panels name it `HDL` — both must collapse to one analyte
  `"HDL"`. Map the raw component names to `{Total cholesterol, LDL (calculated), HDL, Triglycerides,
  VLDL cholesterol, Cholesterol / HDL ratio}` and order the rows in that clinician-scan order;
- `unit` = clean unit label (`"mg/dL"`, or `null` for the dimensionless ratio);
- `refText` = a resolved reference string — prefer two-sided `REFERENCE_LOW – REFERENCE_HIGH`
  (`"0 – 199"`); fall back to the one-sided/descriptive `REF_NORMAL_VALS` (`">40"`, `"<100"`). Never
  emit the raw lo/hi columns;
- `flag` = `RESULT_FLAG_C_NAME` mapped to plain `"Low"`/`"High"`; anything else (`(NONE)`, empty,
  "Normal") → `null`.

**`fasting` (panel-level) — PHI hazard.** Fasting status lives in the free-text
`ORDER_RESULTS.COMPONENT_COMMENT`. **That same field also carries the performing lab's name and
street address** — parse only the fasting flag (`PATIENT FASTING` → `true`; `PATIENT WAS NOT FASTING`
→ `false`) and **drop the rest of the comment**; the address must never reach the view model. In this
record 2018 is fasting, 2023 and 2025 non-fasting.

**`trend`.** Pull the one value per analyte per panel across the ordered panels into parallel arrays
(`dates`, `totalChol`, `ldl`, `hdl`, `tg`, `ratio`) — the same numbers the panels carry, re-shaped
for the sparklines. Plumbing fields (`order_proc_id`, `enc_csn`, `src`, `date_real`) stay out of the slot.

---

### `ascvd` — projection (a **computed clinical score**, not a stored value)

The chart never computed a global risk; this slot computes the **10-year ASCVD risk** from the
**2013 ACC/AHA Pooled Cohort Equations (PCE)** and recomputes every figure in code from the inputs —
no number is hand-typed. (Formula source: Goff DC et al., *Circulation* 2014;129(25 Suppl 2):S49–S73,
Appendix Table A — the White/Other **male** coefficient set, baseline survival `S0(10)=0.9144`, mean
linear-predictor `61.18`.) Implement the PCE as a pure function `risk(age, totalChol, HDL, SBP,
treated, smoker, diabetes)` and call it per panel.

**Inputs — each traced to a raw source:**
- **age** — `PATIENT.BIRTH_DATE` (Oct 26 1982); age **at the latest contact** (≈43). Anchor the
  "latest contact" on `MAX(PAT_ENC_DATE_REAL)` **excluding** future `APPT_STATUS_C_NAME='Scheduled'`
  appointments (the export ships a 2027 scheduled visit that would inflate the age).
- **sex** — `PATIENT.SEX_C_NAME` (Male → male coefficient set).
- **race** — `PATIENT_RACE.PATIENT_RACE_C_NAME` (White → White/Other coefficients). Confirmed present
  in the structured table — a first pass wrongly thought it missing (the `e_input_race` statement
  records that correction).
- **ethnicity** — `PATIENT.ETHNIC_GROUP_C_NAME` (not a PCE input; shown for completeness).
- **total cholesterol, HDL** — per lipid panel (from the `lipids` source above).
- **SBP** — the office **mean systolic** recomputed from the `bp` readings (≈132); untreated.
- **treated** — `false`: the only antihypertensive (`ORDER_MED` lisinopril) was declined and never
  taken (see `htn`); the untreated-SBP coefficient applies.
- **smoker** — `false`: `SOCIAL_HX.SMOKING_TOB_USE_C_NAME = 'Never'` at every snapshot.
- **diabetes** — `false`: from `metabolic.a1c`, both points in the non-diabetic range.

**Outputs.** `trajectory[]` = one PCE point per panel (age held fixed, only the lipids varying, so the
three points isolate the lipid drift); `low`/`high` bound the gauge (2018 best → 2025 current).
`sensitivities.systolic` re-runs the PCE at SBP 122/132/142 on the latest panel (office-only BP
uncertainty); `sensitivities.fasting_redraw` holds the directly-measured HDL fixed and varies total
cholesterol across the plausible fasting range (the non-fasting caveat cannot rescue the HDL-driven
picture). `bands`, `basis`, `threshold_note`, `caveats`, `interpretation` are fixed editorial strings
stating the guideline thresholds and the bounded uncertainties. `cross_check` records an independent
**AHA PREVENT 2023** estimate (race-free) confirming the read; the eGFR input it assumes (95, since
`ORDER_RESULTS` EGFR resulted as the qualitative `">90"`) is the `e_input_egfr` statement.

**Per-input evidence.** Inputs not already covered by a `lipids`/`bp` evidence id get their own
`kind:"fact"` statement (`e_input_age/sex/race/ethnicity/treated/smoker/diabetes/egfr`), each a clean
readable sentence — no raw column names. These merge into `evidence` at assembly.

---

### `family` — projection (a real 3-generation pedigree)

**Source.** The latest `FAMILY_HX` snapshot, joined to `FAMILY_HX_STATUS` for each relative's vital
status and sex.
- Pick the snapshot on the latest encounter (`FAMILY_HX` grew 3→11→12 facts over the years; use the
  newest). Pull rows with `RELATION_C_NAME`, condition `MEDICAL_HX_C_NAME` (the **inline category
  name** — `FAM_MEDICAL_DX_ID` is null throughout, so resolve from the `_C_NAME`, not a ZC_ table),
  `AGE_OF_ONSET`.
- Join condition→relative within the **same encounter CSN** via
  `FAMILY_HX.FAM_MED_REL_ID = FAMILY_HX_STATUS.FAM_STAT_ID` (these ids are per-snapshot); read
  `FAM_STAT_SEX_C_NAME` and `FAM_STAT_STATUS_C_NAME` (Alive/Deceased).

**Logic / shaping.** Build a fixed pedigree skeleton of 8 nodes — 4 grandparents (gen 1), mother +
father (gen 2), proband + brother (gen 3) — with `parents` edges giving the descent graph. The
**proband is synthesised** (he has no `FAMILY_HX` row of his own); flag `proband:true`, leave his
`affected` empty (his own HTN/lipid drift is the *subject* of the dive, not "family history"). For
each real relative, group the snapshot rows by relation, take sex/deceased from the status join, and
build:
- `conditions[]` = every recorded condition, display-clean label + a `cardiovascular` boolean;
- `affected[]` = only the **cardiovascular** condition **keys** (`htn`, `hld`, `mi`, `stroke`), which
  drive the symbol shading. Map raw condition names → keys (`"Heart attack"→mi`, `"Stroke"→stroke`,
  `"Hypertension"→htn`, `"Hyperlipidemia"→hld`); the `conditions[]` legend carries label+color.
- Relation labels are rendered sentence-case (`"Maternal grandmother"`).

`totalFacts` / `totalCvFacts` are counted from the snapshot rows; `bilateral` and `onsetCaveat` are
editorial summaries. **`onsetCaveat` is load-bearing and must be verified, not assumed:**
`AGE_OF_ONSET` is null for **every** `FAMILY_HX` row (confirm with a `COUNT(AGE_OF_ONSET)` = 0 check),
so whether the grandparents' events were *premature* (the ASCVD-relevant cut) genuinely cannot be
answered from the export — the strongest form of the family-history risk enhancer must be asked, not
mined. (`e_family_onset_absent` carries this; the per-relative facts `e_family_*` are
`kind:"fact"` statements derived from these same rows.)

---

### `htn` — projection (the undercoding scorecard + the thread timeline)

**`coding.onProblemList` / the undercoding determination.** This is the spine's central claim and is
proven structurally:
- **Not on the problem list:** query `PROBLEM_LIST` for the hypertension `DX_ID`s (`108212`
  "Primary hypertension", `463437`) → **0 rows**; also check `PROBLEM_LIST_HX` (`HX_PROBLEM_ID` in the
  same set) in case a problem was deleted before export → **0 rows**. `PROBLEM_LIST` ships
  resolved/deleted problems too, so both being empty is conclusive. (Verified: the list holds only
  GERD, post-concussion syndrome, resolved neck pain, two allergy diagnoses — `e_problemlist_absent`.)
- **Coded only as an encounter diagnosis:** `PAT_ENC_DX` carries the HTN `DX_ID` on exactly two rows,
  both on the single Aug 29 2022 diagnosis day (the establish-care visit and its same-day lab
  contact). `encounterDxCount` = that row count; the detail string explains the "2 = one clinical day"
  gloss. Resolve names through `CLARITY_EDG` (`DX_ID → DX_NAME`; no ICD-10 in this export). Crucially,
  neither `PAT_ENC_DX` row carries a `DX_LINK_PROB_ID` — the only valid bridge to a problem — so the
  diagnosis never propagated to the structured list. **That missing link is the undercoding mechanism.**

**`scorecard` / `coding` figures (recomputed):**
- `elevatedReadings` `"7 of 9"` — recount the `bp` readings against the strict Stage-1 cut
  (`sys≥130 || dia≥80`); cross-check against the recomputed `category` field.
- `declinedMed` / `declinedMedName` — the lisinopril `ORDER_MED` row: discontinue reason
  `RSN_FOR_DISCON_C_NAME` ≈ "Patient refusal", and the taking-status audit
  (`MEDS_REV_HX_LIST.TAKING_YN` for this `MEDICATION_ORDER_ID`) shows it was never reported taken
  (the `e_lisinopril_decline` statement). Display the drug as `"lisinopril 10 mg"` — never the brand
  parenthetical.
- `readdressedInLaterVisits` = **0**, `laterVisitCount` = **6**, `windowYears` ≈ 3.3 — across the six
  primary-care visits after the 2022 diagnosis, hypertension never re-enters the assessment/plan.
  This count is a **judgment** read of the visit notes (see below) frozen as a number; the scorecard
  states it and cites `e_readdressed_zero`.

**`timeline` and `boilerplateVsVitals`.** The timeline beats are built from raw dates already
pinned by the projections above — the diagnosis day from the two `PAT_ENC_DX` HTN rows (Aug 29
2022), the lisinopril discontinue day from that `ORDER_MED` row's discontinue date, and the three
annual-note dates from their progress-note encounters (`PAT_ENC.PAT_ENC_DATE_REAL` / the `e_boiler_*`
note contact dates) — each beat citing an existing `evidence` id. `boilerplateVsVitals` pairs each post-decline annual's reassurance line (a note quote,
`e_boiler_2023/2024/2025`) against the BP **recorded that same day** (from `bp`), with the category
recomputed — the contradiction the chart never surfaces.

---

### `acute` — projection (studies) + judgment (the radiology reads)

**What it is.** Two imported **external** emergency contacts at an outside facility, flagged by the
`GENERIC EXTERNAL DATA PROVIDER` (`PROV_ID 8800099`) / `GENERIC EXTERNAL DATA DEPARTMENT`
(`DEPARTMENT_ID 8`) sentinels. Identify the three external `PAT_ENC_CSN_ID`s (one May 14 2024
chest-pain cluster; two same-day Jul 30 2024 dissection-workup contacts), then gather their orders.

**Studies (projection).** From `ORDER_PROC` for those CSNs:
- The two **imaging** orders (`ORDER_TYPE_C_NAME='Imaging'`: chest x-ray, CT angiography neck) carry
  their read **only** in `ORDER_NARRATIVE` — there are no `ORDER_RESULTS` rows. Reassemble each read
  by concatenating `ORDER_NARRATIVE.NARRATIVE` in `CAST(LINE AS INT)` order, dropping blank layout
  lines. Plain results: "read normal" / "clean — no atherosclerosis, <50% carotid stenosis, no
  dissection".
- The **lab** orders (CMP, BMP, CBC, **troponin**) are `LAB_STATUS='Final result'` but carry **zero
  `ORDER_RESULTS` rows** — the discrete component values did **not** survive the import. The only
  surviving signal is the order-level `ABNORMAL_YN` rollup (troponin `N` = negative). Surface each as
  a study line that honestly states the gap ("no discrete component values in export") — do **not**
  fabricate a value. This export limitation is itself a finding the slot carries.
- The 8 `SODIUM CHLORIDE 0.9%` `ORDER_MED` rows are **one** IV-fluid event split 4+4 across the two
  same-day CSNs — collapse to a single "IV fluids — administered" study line, not 8 meds.

**Reads (judgment).** The two radiology narratives are the clinical heart of the events and are quoted
verbatim in `evidence` (`e_cxr_read`, `e_cta_read`) — re-verifiable directly against
`ORDER_NARRATIVE` in the live DB. **PHI/judgment care:** the chest-XR indication line attributes the
pain to THC use; keep the clinically relevant indication, and do not transcribe any
patient-identifying header lines from the import. The `unreconciled` framing — that these arrived only
as external orders with no clinic note, and the Jul 2 2024 PCP visit six weeks later never mentions
the chest pain (`e_pcp_silent_acute`, a progress-note quote) — is the judgment the section makes.

---

### `evidence` + `summary` + `sections` — judgment (the prose spine and the cite drawer)

**`evidence` has two kinds, two sources:**
- `kind:"fact"` entries are readable **statements** of structured findings — each is the
  clean-English restatement of a projection above (problem-list absent, BP series, lipid analytes,
  ASCVD computed, family facts, safety labs). They carry no quote; they are authored alongside the
  projection they summarize and must stay numerically consistent with it.
- `kind:"note"` entries are **verbatim quotes** with author + date. Their source is the **progress-note
  bodies in `raw/Rich Text/*.RTF`** (read via `lib/rtf2txt.ts`; there are ~100 RTF note files, plus a
  `HNO_PLAIN_TEXT` table) and the two radiology reads in `ORDER_NARRATIVE`.

  **Rubric for a note quote:** for each claim the narrative makes, capture the **single verbatim line a
  skeptic would demand** — the diagnosis line ("…consistent with Stage I HTN… Start lisinopril 10 mg"),
  the billing line ("99213 for HTN"), the home-BP self-report, each annual's boilerplate reassurance
  line, the CGM "not taking" line, the PCP-silent assessment/plan, the two radiology impressions — with
  its author and date. One quote per claim. **PHI:** RTF note headers carry the performing/clinic
  address and other identifiers — extract only the clinical line, never the header block. Reference a
  quote here by its `evidenceId`; the quote text itself lives in `viewmodel.evidence`, never pasted
  into this BUILD.

**`summary` + `sections[].narrative`** are the clinician's reasoning — the analytic spine the app
renders. A judgment agent writes the multi-paragraph prose per the storyboard arc (htn → bp → lipids →
ascvd → family → acute → metabolic → assessment), each `narrative` chunk attaching the `cites` that
prove it. **This half is agentic reasoning frozen into the view model:** it is evidence-traced (every
cite resolves to a quote or a statement) but, unlike the projections, not deterministically
re-runnable — an honest rebuild reproduces the *figures* exactly and re-derives the *prose* to the
same evidence.

---

### Assembly + invariants (the lead)

Splice the populated slots into the `ViewModel` shape, dropping any editorial `_meta` blocks, and
**merge the two evidence sources** (the main note/fact map + the per-ASCVD-input fact statements) into
one `evidence` object keyed by id. Then verify, and fail loudly on any miss:
1. every referenced cite id (`cites`, `evidenceId`, `readEvidenceId`, `unreconciledEvidenceId`,
   `pcpSilentEvidenceId`) resolves in `evidence`;
2. no display string carries a raw artifact (midnight timestamp, `*_C_NAME`, locator id, brand
   parenthetical, ISO date in prose);
3. cross-figure agreement — `bp.meanSys` ≈ the "132" in `summary`/`ascvd`; `htn.coding.elevatedReadings`
   matches the recomputed Stage-1 count; the `ascvd.trajectory` percentages match the PCE recompute.

> **One runnable implementation** of this recipe is preserved in this dive's history (per-slot
> `scripts/*.ts` writing `parts/*.json`, stitched by an `assemble` step). That is *one* way to run the
> recipe, not the recipe — every step above is defined against the **raw tables and notes**, and a
> rebuild needs only `db/ehi.sqlite` + `raw/`.
