# BUILD — post-concussion: from the raw EHI export to `viewmodel.json`

This is the recipe an analyst follows to rebuild `viewmodel.json` **from the raw export only**
(`db/ehi.sqlite` + `raw/Rich Text/*.RTF` + the top-level radiology PDF). It does not read any
intermediate file. Part 1 is the target schema (the contract the app consumes). Part 2 is, per slot,
the raw source + the abstraction logic that produces it.

The dive is a **mix of projection and judgment**. The structured spine — the problem record, the
2020 imaging burst, the nortriptyline order chain, the referral fates, the encounter-diagnosis
fingerprint — is **projected** from Clarity tables. The narrative spine — `summary`, `sections[]`,
the verbatim note quotes in `evidence`, and the `arc[]` detail lines — is **judgment**: it is read
out of the clinical notes and frozen into prose. The structured *facts* in `evidence` (`kind:"fact"`)
are plain-language restatements of the projected figures.

---

## PART 1 — The target schema (TypeScript)

```ts
interface ViewModel {
  meta: {
    topic: string;
    title: string;
    patient: string;            // "LAST, FIRST M"
    generatedFrom: string[];    // provenance prose
    generatedBy: string;
    db: string;                 // "db/ehi.sqlite"
  };

  // ---- narrative spine (judgment) ----
  summary: string;              // one long consult-opener paragraph
  sections: Section[];
  evidence: Record<string, Evidence>;   // every cite id resolves here
  arc: ArcEvent[];              // the dual-track timeline events

  // ---- structured spine (projection) ----
  problem: Problem;
  imaging: { orders: ImagingOrder[]; read: ImagingRead };
  medCourse: MedCourse;
  encounterDx: EncounterDx[];
  referrals: Referrals;
}

interface Section {
  id: string;                   // matches STORYBOARD section ids
  title: string;
  narrative: { text: string; cites: string[] }[];   // cites -> evidence keys
}

// Evidence is a discriminated union by `kind`.
type Evidence =
  | { kind: "note"; who: string; date: string; quote: string }   // verbatim note line
  | { kind: "fact"; date: string; text: string };                // restated projection

interface ArcEvent {
  dateIso: string;             // "2020-07-14"
  date: string;                // display label, may be a range ("Feb – Mar 2022")
  title: string;
  detail: string;
  kind: "injury" | "imaging" | "therapy" | "diagnosis"
       | "medication" | "response" | "care" | "resolution";
  cites: string[];
}

interface Problem {
  diagnosis: string;
  status: string;              // "Active"
  chronic: boolean;            // CHRONIC_YN === "Y"
  onsetNoted: string;          // "Sep 1, 2020"
  onsetNotedIso: string;
  addedToChart: string;        // "Aug 29, 2022"
  addedToChartIso: string;
  resolved: string | null;
  encounterCount: number;      // 11
  enteredBy: string;
  patientEnteredSameDay: boolean;
  src: { problemListId: string; dxId: string };
}

interface ImagingOrder {
  study: string;               // cleaned display label
  orderedOn: string;
  orderedOnIso: string;
  status: string;              // "Canceled" / "Completed"
  finalRead: boolean;          // RADIOLOGY_STATUS == "Final"
  hasNarrative: boolean;
  src: { orderProcId: string; csn: string };
}

interface ImagingRead {
  impression: string;          // "Negative cerebral MRI."
  performedOn: string;
  performedOnIso: string;
  facility: string;
  radiologist: string;
  reportText: string;          // full radiology read, newline-joined
  src: { orderProcId: string };
}

interface MedCourse {
  drug: string;                // "nortriptyline"
  brand: string;
  drugClass: string;
  start: string; startIso: string;
  end: string; endIso: string;
  spanDays: number;            // 1099
  spanYears: number;
  orderCount: number;          // 4
  doseRange: string;           // "10 → 20 → 30 mg, then tapered off"
  finalOutcome: string;
  oneContinuousTherapy: boolean;
  mdlId: string;               // shared chain id
  nameDiscrepancyNote: string;
  orders: MedOrder[];
  doseSegments: DoseSegment[]; // step-plot input
  reorderIntervals: ReorderInterval[];
}

interface MedOrder {
  seq: number;
  drug: string;
  dose: string;                // "10 mg nightly"
  doseMg: number;
  capsules: number;
  quantity: string;            // "90 capsule"
  refills: number;
  orderedOn: string; orderedOnIso: string;
  endedOn: string; endedOnIso: string;
  indication: string;
  sig: string;                 // cleaned sig text
  changeNote: string;          // up-titration narrative
  discontinueReason: string | null;
  src: { orderMedId: string; csn: string; mdlId: string; reorderOf: string | null };
}

interface DoseSegment {
  doseMg: number; dose: string;
  fromIso: string; from: string;
  toIso: string; to: string;
}

interface ReorderInterval {
  fromDate: string; toDate: string;
  intervalDays: number;
  newQuantity: string;
}

interface EncounterDx {
  diagnosis: string;           // DX_NAME
  encounters: number;          // distinct CSNs
  src: { dxId: string };
}

interface Referrals {
  items: ReferralItem[];
  otVisits: OtVisit[];
  neurologyFulfilledInSystem: boolean;   // false
  otFulfilledInSystem: boolean;          // true
}

interface ReferralItem {
  referredTo: string;          // "Neurology" / "Occupational Therapy"
  status: string;              // "Closed"
  outcome: string;             // cleaned close-reason phrase
  placedOn: string; placedOnIso: string;
  expiresOn: string;
  referredBy: string;          // resolved provider display name
  diagnosis: string;           // referral DX_NAME
  src: { referralId: string; csn: string };
}

interface OtVisit {
  date: string; dateIso: string;
  department: string;
  src: { csn: string };
}
```

---

## PART 2 — The data + abstraction spec

### Workflow shape

The condition anchors on two identifiers an analyst pins first by inspecting the problem list and
the head/concussion `CLARITY_EDG` diagnosis family: the **post-concussion-syndrome problem**
(`PROBLEM_LIST_ID`) and its **diagnosis** (`DX_ID`). Everything downstream filters on one of these.

Fan out into independent units, each owned by one agent; the lead assembles them into the schema and
checks the one hard invariant — **every `cites[]` id resolves in `evidence`**:

- **Projection agents** (structured, off Clarity tables; each is a standalone query + cleaning pass):
  1. `problem` + the encounter count
  2. `imaging` (the 2020 order burst) + `imaging.read` (the MRI narrative)
  3. `medCourse` (the nortriptyline chain, dose ladder, intervals, dose segments)
  4. `encounterDx` (the coding fingerprint)
  5. `referrals` (Neurology fates + the fulfilled OT thread)
- **Judgment agents** (free text, off the RTF notes):
  6. `evidence` note quotes — one verbatim line per claim, by note + anchor phrase
  7. `summary` + `sections[]` + `arc[]` detail — the analytic prose, each claim citing an
     `evidenceId`
- The lead also writes the `evidence` **facts** (`kind:"fact"`): plain-language restatements of the
  projection figures (`s_*`, `m_*`, `dx_head_initial`). These are not new data — they are the
  projection results, written for a human to read in the drawer.

**Date convention used everywhere.** Epic stores display dates as `"M/D/YYYY 12:00:00 AM"` and sort
keys as `*_DATE_REAL` (days since the **1840-12-31** epoch). Two cleaning rules recur:
- `"M/D/YYYY 12:00:00 AM"` → split off the time, parse → emit both `"Aug 29, 2022"` (display) and
  `"2022-08-29"` (iso side field). Never let the midnight timestamp reach the view model.
- Any chronological **sort** is by `CAST(*_DATE_REAL AS REAL)` (text column → numeric), never by the
  string date. Day-count math (therapy span, reorder gaps) is done on the integer `DATE_REAL` (or by
  converting the `M/D/YYYY` to that epoch), not by subtracting display strings.

---

### `problem` — projection

**Source.** `PROBLEM_LIST` (the one PCS problem row), joined to `CLARITY_EDG` on `DX_ID` for the
diagnosis name; `PAT_ENC_DX` for the encounter count.

**Logic.** Read the single problem row: `PROBLEM_STATUS_C_NAME` → `status` ("Active"); `CHRONIC_YN`
→ `chronic` (the boolean `=== "Y"` — here **N**, the documented gotcha: the structured flag says
non-chronic while the clinical course is chronic, which the narrative calls out explicitly).
`NOTED_DATE` → `onsetNoted` (back-dated to 2020); `DATE_OF_ENTRY` → `addedToChart` (the 2022
establish-care visit); `RESOLVED_DATE` → `resolved` (null). `enteredBy` and `patientEnteredSameDay`
are facts established by the judgment work (the `PROBLEM_LIST_HX` editor and the patient-review
channel, below) and pinned here as display constants.

**Encounter count.** `encounterCount` = `COUNT(DISTINCT PAT_ENC_CSN_ID)` from `PAT_ENC_DX` filtered to
this problem. Two independent filters agree at **11** — `DX_LINK_PROB_ID = <problemListId>` (the
problem-bridge) and `DX_ID = <pcsDxId>` (the diagnosis) — so either is sound; the agreement is the
cross-check.

**Patient-typed corroboration** (feeds `patientEnteredSameDay` and the `s_patient_typed` fact). The
patient himself entered the diagnosis on the patient-review channel: `PAT_REVIEW_PROBLEM` rows whose
`PAT_REVIEW_LPL_ID` equals this `PROBLEM_LIST_ID` (and/or whose `PAT_REV_LPL_EXTERN` free-text is the
diagnosis phrase). The earliest such row is the same-day entry; later rows confirm repeated patient
review of the same problem-list entry.

`src.problemListId` / `src.dxId` carry the raw ids for tracing only.

---

### `imaging.orders` — projection

**Source.** `ORDER_PROC`, with `ORDER_NARRATIVE` for the "does this order have a read" flag.

**Logic.** Select the 2020 head-imaging burst: `ORDER_TYPE_C_NAME = 'Imaging'` and
`DESCRIPTION` matching head/brain (`LIKE '%BRAIN%' OR '%HEAD%'`). This yields four orders — three
brain-MRI-without-contrast and one head/brain CT. Sort by `CAST(PAT_ENC_DATE_REAL AS REAL)`.

Per order: `ORDER_STATUS_C_NAME` → `status` (two **Canceled**, two **Completed**);
`RADIOLOGY_STATUS_C_NAME == "Final"` → `finalRead` (only the Jul 31 order); `hasNarrative` = a count
of non-blank `ORDER_NARRATIVE.NARRATIVE` lines for that `ORDER_PROC_ID` being > 0.

**Cleaning.** Map the raw `DESCRIPTION` (`"MRI BRAIN WO CONTRAST"`, `"CT HEAD OR BRAIN W WO
CONTRAST"`) to human study labels via a small lookup → `"Brain MRI without contrast"`, `"Head/brain
CT with & without contrast"`. Dates cleaned per the date convention. `src` carries `ORDER_PROC_ID` +
`PAT_ENC_CSN_ID`.

---

### `imaging.read` — projection (structured text) + judgment (the verbatim impression quote)

**Source.** `ORDER_NARRATIVE` for the one Final MRI `ORDER_PROC_ID`.

**Logic.** Pull all non-blank `NARRATIVE` lines for that order, **ordered by `CAST(LINE AS INT)`**
(numeric, not text — the CAST-before-ORDER constraint, or line 10 sorts before line 2), and join them
with newlines into `reportText`. `impression` is the line containing the negative-read phrase. The
report body is structured radiology text, not PHI to redact — keep it; it is the centerpiece of the
view. `performedOn`, `facility`, and `radiologist` are read off the report content (and corroborated
by the top-level faxed PDF, next) and pinned as display constants.

**Reconciliation note.** The same read also exists as a faxed PDF at the top level of `raw/`
(`D-PRD-1252065769 Radiology MRI.PDF`). It reconciles **by content** with the `ORDER_NARRATIVE` — no
id links the PDF to the order — which is why the `s_mri_read` fact says "reconciles by content." The
verbatim `q_negative_mri` quote is the radiologist's impression line; it is captured as a `note`
evidence entry (kind `note`, author "David Kurtz, MD (radiology)").

---

### `medCourse` — projection (the nortriptyline chain)

**Source.** `ORDER_MED` (the four orders), joined to `CLARITY_MEDICATION` (generic name),
`ORDER_MED_SIG` (the sig, keyed `ORDER_MED_SIG.ORDER_ID = ORDER_MED.ORDER_MED_ID`), and
`ORDER_DX_MED` → `CLARITY_EDG` for the indication (the `LINE='1'` dx).

**Identifying the chain.** Filter `ORDER_MED` on `DESCRIPTION LIKE '%NORTRIPTYLINE%' OR '%PAMELOR%'`
→ four orders. The "one continuous therapy" claim is what the raw data supports two ways: all four
share a single `MDL_ID` (the med-chain identifier → `mdlId`, `oneContinuousTherapy`), and each
reorder points at its predecessor via `CHNG_ORDER_MED_ID` (→ `src.reorderOf`; the first is null).
Sort by `CAST(PAT_ENC_DATE_REAL AS REAL)`; assign `seq` 1..4.

**Per-order fields.** `QUANTITY` → `quantity` ("90 capsule" … "270 capsule"); `REFILLS` → number;
`ORDERING_DATE`/`END_DATE` cleaned per the date convention; `RSN_FOR_DISCON_C_NAME` →
`discontinueReason`, mapped through a small lookup so the raw Epic phrases become plain words
(`"*Reorder (sends cancel message to pharmacy)"` → `"Reordered (superseded by next order)"`;
`"* Therapy completed (sends cancel message to pharmacy)"` → `"Therapy completed"`); the first three
are reorder-supersessions, the last is the planned completion. `indication` is the joined DX_NAME
(post-concussion syndrome on every order).

**Sig cleaning.** `ORDER_MED_SIG.SIG_TEXT` is the take-instruction; if it arrives ALL-CAPS,
sentence-case it (lowercase body, capitalize sentence starts, keep the `mg` unit lowercase),
otherwise pass through. This produces a readable `sig` without a raw shouting string.

**Dose ladder — the judgment-tinged step.** The export does **not** carry a clean mg field; the dose
is read from the **sig + the quantity escalation + the clinic notes** and pinned per `ORDER_MED_ID`:
10 mg / 1 capsule (90 caps), 20 mg / 2 capsules (180 caps), 30 mg / 3 capsules (270 caps ×2). The
quantity ladder 90 → 180 → 270 corroborates the mg ladder, and the start-order sig literally says
"start 10 mg; increase to 20 mg." `dose`, `doseMg`, `capsules`, and the `changeNote` up-titration
prose are this mapping. (This small lookup is the one place a human read the sig — it is judgment
frozen into the projection, not a pure column.)

**Reorder intervals.** Day gaps between consecutive `ORDERING_DATE`s, computed on the `DATE_REAL`
epoch (not string subtraction): **81, 305, 402** days, each paired with the new quantity that order
dispensed. The widening gaps track the growing quantity (more capsules last longer at steady
once-nightly use) — that is the analytic point of the slot.

**Therapy span.** `start` = first `ORDERING_DATE`; `end` = last order's `END_DATE`; `spanDays` =
their `DATE_REAL` difference; `spanYears` = `spanDays / 365.25` rounded. `orderCount` = the nortriptyline order count.
`doseRange` / `finalOutcome` are summary prose pinned from the ladder + the final discontinue reason.

**Dose segments** (the step-plot input). One segment per order, running **from its order date to the
next order's order date** (the dose held until the next order changes it), the last order running to
its `END_DATE`. Then append an explicit **taper-to-zero tail** at the final end date (`doseMg: 0`,
label "Off (tapered)") — the 2025 note documents the taper-off, which the order ladder alone (which
ends at 30 mg) cannot show, so this terminal segment is added from the note judgment, not from a
column.

**The name discrepancy** (`nameDiscrepancyNote`, the `m_name_discrepancy` fact). The structured
record is **nortriptyline throughout** (one `MDL_ID`, one `MEDICATION_ID`); the 2024–2025 clinic
notes call it "amitriptyline." Both are TCAs used the same way for headache prophylaxis; the slot
flags the mismatch honestly rather than silently picking one. This is found by comparing the order
chain (projection) against the note quotes (`q_30mg_amitrip`, `q_taper`, judgment).

---

### `encounterDx` — projection (the coding fingerprint)

**Source.** `PAT_ENC_DX` joined to `CLARITY_EDG` for `DX_NAME`.

**Logic.** Restrict to the head/concussion diagnosis family (the small set of head/post-concussion
`DX_ID`s the analyst pinned from `CLARITY_EDG`), group by `DX_ID`, and count **distinct**
`PAT_ENC_CSN_ID` per code; order by count descending. The fingerprint: post-concussion syndrome on 11
encounters (dominant), traumatic-injury-of-head-initial on 5, and one encounter each for
post-concussion headache, chronic post-traumatic headache, and late-effect-of-TBI. Each row carries
`src.dxId`. The `dx_head_initial` evidence fact restates the acute-code observation in prose.

---

### `referrals` — projection (the two diverging threads)

**Source.** `REFERRAL` (status + close reason + dates + referring provider), bridged to the placing
order via `ORDER_PROC_2.REFERRAL_ID` → `ORDER_PROC`; `REFERRAL_DX` → `CLARITY_EDG` for the referral
diagnosis; `PAT_ENC` + `CLARITY_DEP` for the OT fulfilling visits.

**Selecting the referrals.** The Neurology and OT referrals for this thread: filter `REFERRAL` where
`PROV_SPEC_C_NAME = 'Neurology'` (the three neuro referrals) or the bridged order description is the
OT/neuro-OT referral. Three Neurology + one Occupational Therapy.

**Per referral.** `referredTo` from the specialty; `RFL_STATUS_C_NAME` → `status` ("Closed");
`CLOSE_RSN_C_NAME` → `outcome`, mapped to plain phrases (`"Expired-Auto Closed"` → `"Expired /
auto-closed (never fulfilled in-system)"`; `"Patient Discharged"` → `"Fulfilled — patient
discharged"`). `ENTRY_DATE` → `placedOn`, `EXP_DATE` → `expiresOn` (date-cleaned). `referredBy` from
`REFERRING_PROV_ID_REFERRING_PROV_NAM`, resolved from the raw `"LAST, FIRST M"` to a display name via
a small lookup. `diagnosis` = the `LINE='1'` `REFERRAL_DX` DX_NAME (post-concussion syndrome on all
three neuro referrals; late-effect-of-TBI on the OT one). `src` carries `REFERRAL_ID` + the placing
CSN.

**The fates** (`s_neuro_referrals`, `s_ot_fulfilled` facts; the `neurologyFulfilledInSystem=false` /
`otFulfilledInSystem=true` flags). All three Neurology referrals closed **Expired-Auto Closed** with
no in-system neurology visit. The OT referral was **fulfilled**: its two fulfilling visits are
`PAT_ENC` rows (the two known OT CSNs), each labeled via `CLARITY_DEP.DEPARTMENT_NAME` and cleaned to
`"Occupational Therapy — Neuro Center"`, in March 2022, after which the referral closed "Patient
Discharged." (The note `q_massachusetts` supplies the *why* the neurology referrals lapsed — care
relocated out of state — which is judgment, not in the structured fate.)

---

### `evidence` (note quotes) — judgment

**Source.** The clinical progress / consult notes as **RTF**: `raw/Rich Text/HNO_<NOTE_ID>_*.RTF`,
de-RTF'd to plain text via `lib/rtf2txt.ts` (strips RTF control words, SmartList metadata, bookmark
groups; decodes `\'hh` hex escapes; collapses whitespace). One note file per `NOTE_ID`. The MRI
impression quote comes from the radiology read text (already pulled for `imaging.read`).

**Rubric.** For each claim the narrative makes, capture the **single verbatim line** in the note that
proves it — the line a skeptic would demand — with its **author and date**. The anchor approach: hold
a stable phrase per claim, locate it case-insensitively in the de-RTF'd note text, and expand to the
surrounding sentence boundary so the quote reads as a clean clinical line. One quote per claim; quote
the note body, not a cached restatement.

The quote keys and the note each is drawn from (do **not** paste the quote text — it lives in
`viewmodel.evidence[<id>].quote`):

| evidenceId | drawn from (note role / date) |
|---|---|
| `q_mechanism`, `q_recovery`, `q_plateau` | the **OT consult note**, Mar 11, 2022 (mechanism, ~90–95% recovery, plateau) |
| `q_course_2022`, `q_chronic_2yr` | the **establish-care note**, Aug 29, 2022 (the course HPI, "chronic problem … over 2 years") |
| `q_snorkel`, `q_trial`, `q_nortrip_start` | the **Dec 1, 2022 visit note** (second injury, shared-decision trial, start sig + neuro referral) |
| `q_better`, `q_first_week` | the **Mar 2, 2023 follow-up note** (early documented response) |
| `q_massachusetts` | the **Sep 28, 2023 note** (neurology relocated to Massachusetts) |
| `q_30mg_amitrip` | the **Nov 7, 2024 note** (the "30 mg amitriptyline" naming wrinkle) |
| `q_off`, `q_taper` | the **Dec 4, 2025 note** (tapered off, headaches tolerable) |
| `q_negative_mri` | the **MRI radiology read** (`ORDER_NARRATIVE` / the faxed PDF), Jul 29, 2020 |

Each entry is `{ kind:"note", who, date, quote }`; `who`/`date` are the note's author and contact
date.

**PHI note.** The notes contain identifiers the view never shows (the note bodies carry name, the MRI
history line carries age/weight, etc.). The rubric keeps only the one clinical line per claim and
drops the rest; never surface a street address, phone, email, SSN, or raw MRN. The radiology report
text that *is* kept is clinical (technique, findings, impression), not identifying.

**`evidence` facts** (`kind:"fact"`: `s_*`, `m_*`, `dx_head_initial`) are not read from notes — the
lead writes them as plain-language restatements of the corresponding **projection** result (imaging
burst, MRI read, problem record, patient-typed, neuro referrals, OT fulfilled, dx frequency, the med
chain / span / dose steps / reorder intervals / name discrepancy / therapy-completed). They are the
"readable statement of a structured fact" the drawer shows instead of a raw row.

---

### `summary`, `sections[]`, `arc[]` (detail/prose) — judgment

**Source.** The analyst's reading of the whole record — the projected figures above plus the note
quotes — written as clinical reasoning. There is no query that produces this prose; it is the
domain-expert synthesis, frozen into the view model.

**Rubric.** `summary` is one consult-opener paragraph stating the whole 2020→2025 arc and how it
resolved. `sections[]` follow the STORYBOARD beats (ids match `STORYBOARD.md`): each `narrative[]`
entry is a claim with a `cites[]` list of `evidenceId`s. Every claim must cite at least one resolved
evidence entry — a `note` quote where the point is what a clinician/patient said, a `fact` where the
point is a projected figure. `arc[]` events pair a clean `dateIso` (sortable) + display `date` (which
may be a range) with a short `detail` line and the same `cites[]` discipline; `kind` tags the thread
for the dual-track chart's color key.

**The honest seams the prose must carry** (each its own evidence): the structured `CHRONIC_YN = N`
vs the "chronic … over 2 years" note; the nortriptyline-vs-"amitriptyline" name discrepancy; the
neurology referrals expiring and care relocating out of state; and the absence of any structured
headache metric (`s_no_headache_metric` — a stated gap, not a queryable value: nothing in the export
logs a pain scale / HIT-6 for this condition, so the symptom course is reconstructable only from note
phrases).

---

### Assembly + the invariant

The lead nests the populated slots into `ViewModel` and runs the one check: walk `sections` and `arc`,
collect every `cites[]` id, and confirm each resolves in `evidence` (no dangling cite). Re-confirm the
cross-checked figures while assembling — encounter count **11** (two filters agree), the **four**-order
chain under one `MDL_ID`, span **1099** days, reorder gaps **81/305/402**, problem onset 2020 / entered
2022 — so a number in the prose can never disagree with the projection it claims to come from.

> One runnable implementation of this recipe existed as a `figures → quotes → assemble → project`
> script chain; it is preserved in git history but is **not** the recipe. The recipe is the from-raw
> logic above; the scripts were one way to run it.
