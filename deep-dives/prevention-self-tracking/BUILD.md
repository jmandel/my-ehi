# BUILD — prevention & self-tracking, from the raw export to `viewmodel.json`

This is the recipe an analyst follows to rebuild `viewmodel.json` **from the raw Epic EHI export**
(`db/ehi.sqlite` + `raw/Rich Text/*.RTF` + the MyChart message tables) — nothing else. It is the *method*:
the source tables, the joins and constraints that bite, the cleaning that turns shouty Epic strings into
display-clean labels, and the note-reading rubrics for the judgment slots. Values, quotes, and figures live
in `viewmodel.json`; here we point at them by slot name / `evidenceId` / table and never transcribe them.

The whole dive is one patient (the export's only patient; the immunization-ledger queries carry an explicit
`PAT_ID` filter, the rest are single-patient tables). All dates in the raw tables print as `M/D/YYYY 12:00:00 AM`;
every projection parses that to an ISO `date_iso` side field (for sort) plus a display `date` like `"Feb 5, 2019"`.
Where a table is snapshot-versioned, the truth is the **latest** snapshot (see the per-slot constraints).

---

## Part 1 — The target schema (TypeScript)

```ts
interface ViewModel {
  // ---- narrative spine ----
  summary: string;
  sections: Section[];                 // exactly 5: immunizations, travel, screening, cgm, assessment
  evidence: Record<string, Evidence>;  // keyed by evidenceId; every sections[].narrative[].cites[] resolves here

  // ---- structured slots (all display-clean) ----
  immunizations: Dose[];               // the de-duplicated administered timeline (18 rows)
  lanes: Lane[];                        // per-lane dose counts, display order
  influenzaProgram: InfluenzaProgram;
  covidSeries: CovidSeries;
  travelCluster: TravelCluster;
  selfReported: SelfReported;
  forecast: ForecastEntry[];           // forward booster forecasts only (flu, COVID)
  a1c: A1cResult[];
  cgmOrders: CgmOrder[];
  screening: Screening;
}

interface Section {
  id: "immunizations" | "travel" | "screening" | "cgm" | "assessment";
  title: string;
  narrative: { text: string; cites: string[] }[];   // cites = evidenceId keys
}

interface Evidence {
  kind: "fact" | "note" | "message";
  date: string;          // display date or range ("2017–2025", "Feb 1, 2019", "—")
  who?: string;          // present on note/message: author or role
  quote?: string;        // present on note/message: the verbatim line
  text?: string;         // present on fact: a readable statement of a structured finding
}

interface Dose {
  date: string;          // "Oct 25, 2017"
  date_iso: string;      // "2017-10-25"
  vaccine: string;       // clean label, e.g. "COVID-19 (Pfizer bivalent)", "Typhoid (Typhim VI)"
  lane: "Influenza" | "COVID-19" | "Travel cluster";
}

interface Lane { name: "Influenza" | "COVID-19" | "Travel cluster"; count: number; }

interface InfluenzaProgram {
  seasonsCovered: number;     // 8
  seasonStart: number;        // 2017
  seasonEnd: number;          // 2025
  yearsCovered: number[];     // calendar years with a flu dose
  gapYears: number[];         // [2020]
  doses: { date: string; date_iso: string }[];
  note: string;
}

interface CovidSeries {
  doseCount: number;
  doses: { doseNumber: number; date: string; date_iso: string; vaccine: string; product: string | null }[];
}

interface TravelCluster {
  date: string; date_iso: string;            // shot day, "Feb 5, 2019"
  consultDate: string; consultDate_iso: string;
  destination: string;                       // "Bangalore and Hyderabad, India"
  travelDates: string;                       // "Feb 23 – Mar 3, 2019"
  doses: { vaccine: string; product: string | null }[];
  pharmacistRecommended: string[];           // ["Hepatitis A", "Typhoid"]
  alsoAdvised: string[];                     // yellow fever / malaria / TD advice
}

interface SelfReported {
  count: number;                             // 4
  doses: { date: string; date_iso: string; vaccine: string }[];
  note: string;
}

interface ForecastEntry { vaccine: string; dueDate: string; dueDate_iso: string; }

interface A1cResult {
  date: string; date_iso: string;
  value: number; unit: string;               // the result, e.g. "%"
  refLow: number; refHigh: number;           // reference band bounds
  flag: string;                              // "normal"
}

interface CgmOrder {
  date: string; date_iso: string;
  item: string;                              // "FreeStyle Libre 3 sensor" | "... reader"
  status: string;                            // "Sent"
  quantity: string; refills: string;
  sig: string;                               // sentence-cased
  orderingProvider: string;                  // "Dr. Zoe Rammelkamp"
}

interface Screening {
  phq2: {
    series: Phq2Screen[];
    positiveThreshold: number;               // 3
    note: string;
  };
  topics: ScreeningTopic[];                   // HM dashboard subset
}

interface Phq2Screen {
  date: string; date_iso: string;
  itemInterest: number;                       // PHQ-2 item 1
  itemDown: number;                           // PHQ-2 item 2
  total: number;
  positive: boolean;                          // total >= 3
}

interface ScreeningTopic {
  topic: string;                              // "Diabetes screening", "Annual Wellness Visit", ...
  status: string;                             // "Not Due" | "Completed"
  nextDue: string; nextDue_iso: string | null;
  lastCompleted: string; lastCompleted_iso: string | null;
}
```

---

## Part 2 — The data + abstraction spec (how to populate it from raw)

### Workflow shape

The view model decomposes into **independent units** that fan out to parallel agents, then a lead assembles
and checks invariants:

- **Immunization-projection agent** owns everything off the vaccine tables: `immunizations`, `lanes`,
  `influenzaProgram`, `covidSeries`, `travelCluster.doses`, `selfReported`, `forecast`. One raw timeline feeds
  all of them — build it once, then slice.
- **Screening/metabolic-projection agent** owns `a1c`, `cgmOrders`, `screening.phq2`, `screening.topics`. Four
  unrelated raw families (labs, meds, flowsheets, health-maintenance), no cross-dependencies.
- **Note/message judgment agent** owns the `evidence` map's `note` and `message` entries and the
  `travelCluster` framing fields (`destination`, `travelDates`, `pharmacistRecommended`, `alsoAdvised`) — these
  come from reading RTF notes and MyChart messages, not from a query. This agent also writes the `summary` and
  the five `sections[]` narrative, because the analytic claims it makes are the reasoning frozen into the view
  model.
- **The lead** writes the `fact`-kind `evidence` entries (each is a one-sentence readable restatement of a
  figure the projection agents computed), assembles all slots into the schema, and checks the **invariants**:
  every `sections[].narrative[].cites[]` id exists in `evidence`; lane counts sum to `immunizations.length`;
  the COVID `doseCount` and `selfReported.count` match their arrays; every `date`/`date_iso` pair agrees.

Two slot kinds appear below: **projection** (deterministic from structured tables) and **judgment** (an agent
reads free text and applies a rubric). Both are reproducible recipes; the judgment ones name the rubric and
cite by `evidenceId`, never pasting the quote.

---

### The shared immunization timeline (feeds 7 slots) — projection

**Source.** `IMM_ADMIN` — the administered-immunization master document. This table is **snapshot-versioned**:
the same logical record is re-emitted under one `DOCUMENT_ID` many times, once per `CONTACT_DATE_REAL`
snapshot. **The gotcha that bites here:** if you `SELECT *` you get every historical snapshot and over-count
wildly. The de-duplicated truth is the **single latest snapshot** — the rows of the master `DOCUMENT_ID` whose
`CAST(CONTACT_DATE_REAL AS REAL)` equals the `MAX` over that `DOCUMENT_ID`. That one snapshot is the 18-dose
administered history. (`CONTACT_DATE_REAL` is TEXT; you must `CAST(... AS REAL)` before `MAX`/compare or it
sorts lexically.)

Columns read per dose: `IMM_DATE` (administration date), `IMM_TYPE_ID_NAME` (the raw vaccine product string),
and the side fields `IMM_ROUTE_C_NAME`, `IMM_SITE_C_NAME`, `IMM_MANUFACTURER_C_NAME`, `IMM_LOT_NUMBER` (these
last four are *not* rendered — they carry raw shouty strings like a manufacturer name, so they are dropped
before the view model; keep them only if tracing).

**Date parse.** `IMM_DATE` is `M/D/YYYY 12:00:00 AM`; build a zero-padded `YYYYMMDD` sort key and an ISO
`date_iso`, then sort the timeline ascending by the key. Never sort the raw `M/D/YYYY` string lexically.

**Lane / category classification.** Map each raw `IMM_TYPE_ID_NAME` to a lane by keyword on the upper-cased
string: contains `INFLUENZA` → `Influenza`; contains `COVID` or `SARS` → `COVID-19`; `TDAP`/`TETANUS`,
`TYPHOID`, or `HEPATITIS A` → the travel-cluster vaccines. This keyword rule is what separates the three lanes.

**Vaccine-label cleaning (raw → display).** The raw strings are shouty and product-laden, e.g. an influenza
prefilled-syringe string, a `COVID-19 (PFIZER-BIVALENT) MRNA AGES 12+` string, a `TYPHOID INACTIVATED (TYPHIM VI)`
string. Clean each to a human label:
  - Pull the parenthetical brand if present.
  - Influenza → `"Influenza (<Brand>)"` (title-cased brand) or `"Influenza (quadrivalent)"` when no brand.
  - COVID → `"COVID-19 (<Brand>)"`, brand title-cased with `-` → space and the `mRNA` token preserved (so
    `PFIZER-BIVALENT` → `Pfizer bivalent`, `PFIZER COMIRNATY` → `Pfizer Comirnaty`).
  - Tdap → `"Tdap"`; Typhoid → `"Typhoid (Typhim VI)"`; Hepatitis A → `"Hepatitis A"`.
  The `product` side field (used by `covidSeries` and `travelCluster`) is just the cleaned brand, or `null`.

This cleaned, lane-tagged, date-sorted array **is** `immunizations` (drop the route/site/manufacturer/lot side
fields). Everything below is a slice of it.

- **`lanes`** — projection. Count `immunizations` by lane; emit in fixed display order `["Influenza",
  "COVID-19", "Travel cluster"]`, only lanes that occur. Invariant: counts sum to `immunizations.length`.
  Backs `e_imm_count`.

- **`influenzaProgram`** — projection. From the Influenza-lane doses: distinct dose dates, distinct calendar
  **years** (`date_iso` first 4 chars). `gapYears` = every integer between the first and last flu year that has
  no dose — here that yields `[2020]`. `seasonsCovered` = count of covered years; `seasonStart`/`seasonEnd` are
  the 2017/2025 bounds. The `note` (and `e_flu_program`) state the 8-of-9 reading and that 2020 is most
  plausibly an outside-system dose, not a true skip — an interpretation, flagged as such.

- **`covidSeries`** — projection. The COVID-19-lane doses in date order, numbered `1..N` as `doseNumber`.
  `product` is the cleaned brand. `doseCount` = array length (7). Backs `e_covid_series`.

- **`travelCluster.doses`** — projection. The three doses whose `date_iso === "2019-02-05"` (the same-day
  cluster), cleaned label + product. (The framing fields beside them are judgment — see below.) Backs
  `e_travel_doses`.

- **`selfReported`** — projection from a **second** vaccine table. `IMM_ADMIN` says *what/when*; provenance
  (in-house vs patient-entered) lives on the EPT-side ledger: join `PAT_IMMUNIZATIONS` (filtered to the
  patient's `PAT_ID`) to `IMMUNE` on `IMMUNE_ID`, reading `IMMUNE_DATE`, `IMMUNZATN_ID_NAME`, and the
  provenance flag `EXTERNAL_ADMIN_C_NAME`. Self-reported doses are exactly the rows where
  `EXTERNAL_ADMIN_C_NAME = 'MyChart Entered'`. `count` and the date/vaccine list come from that filter (4 COVID
  doses). Backs `e_self_reported`. Constraint: this is the one place `PAT_ID` matters, because `PAT_IMMUNIZATIONS`
  is a cross-patient link table.

- **`forecast`** — projection from a **third** vaccine table. `IMM_DUE` holds the forecast engine's output,
  again snapshot-versioned: take the **latest** `CAST(CONTACT_DATE_REAL AS REAL)` snapshot, order by
  `CAST(LINE AS INT)`. Read `COALESCE(IMM_DUE_TYPE_ID_NAME, IMM_DUE_TYPE_FT)` (the vaccine), `IMM_DUE_DUE_DATE`,
  `IMM_DUE_EARLIEST_DT`, `IMM_DUE_NEXT_DOSE`. **The interpretation step that matters:** this engine emits both
  *forward boosters* and *birthday-anchored catch-up* rows (DOB 1982 → some due dates land in the patient's
  childhood/past). Keep only the **forward** forecasts — those with a future due date — and drop the past
  catch-up rows (e.g. a hepatitis-B "due" date decades ago is an artifact, not a real recommendation). The view
  model keeps the two relevant forward entries (Influenza, COVID-19) with cleaned vaccine names. Backs
  `e_forecast`.

---

### Metabolic & screening slots

- **`a1c`** — projection. Source: `ORDER_RESULTS` (the lab-component results). Filter to A1c components
  (`COMPONENT_ID_NAME LIKE '%A1C%'`). **Sentinel constraint:** lab results use `9999999` in `ORD_NUM_VALUE`
  as a "no numeric value" sentinel — exclude those rows or you'll plot a garbage point. Read `RESULT_DATE`,
  `ORD_VALUE` (cast to number), `REFERENCE_LOW`/`REFERENCE_HIGH`/`REFERENCE_UNIT`, and
  `RESULT_FLAG_C_NAME` (blank → `"normal"`). Sort by `CAST(ORD_DATE_REAL AS REAL)`, not the display date.
  This yields the two normal A1c points (4.0–6.0% band).

  *Indication enrichment (computed, not displayed in the final shape but driving `e_a1c`'s prose):* the reason
  the A1c was ordered comes from the order's diagnosis links — join the result's `ORDER_PROC_ID` through
  `ORDER_DX_PROC` to `CLARITY_EDG` and read `DX_NAME`. That is how `e_a1c` knows the 2023 draw was "Screening
  for diabetes mellitus" and the 2025 draw "Preventative health care". Backs `e_a1c`.

- **`cgmOrders`** — projection. Source: `ORDER_MED` (the medication/DME order ledger). Filter
  `DESCRIPTION LIKE '%LIBRE%'` to catch the FreeStyle Libre orders. Read `ORDER_MED_ID`, the item
  (`COALESCE(DISPLAY_NAME, DESCRIPTION)`), `ORDERING_DATE`, `ORDER_STATUS_C_NAME`, `QUANTITY`, `REFILLS`,
  `PAT_ENC_CSN_ID`. The sig text is on a child table — left-join `ORDER_MED_SIG` on `ORDER_ID = ORDER_MED_ID`
  and read `SIG_TEXT`. Sort by `CAST(PAT_ENC_DATE_REAL AS REAL)`. The **ordering provider** is resolved through
  the encounter: join `PAT_ENC` on `PAT_ENC_CSN_ID`, then `CLARITY_SER` on `VISIT_PROV_ID` for `PROV_NAME`
  (and `CLARITY_DEP` for the department, a side field). Cleaning: collapse the shouty item string to
  `"FreeStyle Libre 3 sensor"` / `"... reader"` by keyword; sentence-case the SIG; render the provider as
  `"Dr. Zoe Rammelkamp"`. Three orders result (sensor + reader on the first encounter, a 4-sensor/4-refill
  refill on the second), all status "Sent". Backs `e_cgm_orders`.

- **`screening.phq2`** — projection from the **flowsheet** family. PHQ-2 is recorded as flowsheet measurements,
  not labs. The value lives in `V_EHI_FLO_MEAS_VALUE.MEAS_VALUE_EXTERNAL`, joined to its row metadata in
  `IP_FLWSHT_MEAS` on `(FSD_ID, LINE)`. Tie that to an encounter through `IP_FLWSHT_REC` (on `FSD_ID`) →
  `PAT_ENC` (on `INPATIENT_DATA_ID`). Filter to the three relevant `FLO_MEAS_ID`s: the two PHQ-2 item rows
  (item 1 "little interest", item 2 "feeling down") and the **live total** row — read these by their stable
  `FLO_MEAS_ID` values (the items and the numeric total). **Assembly constraint:** the three measurements for
  one screen are separate rows; group them by encounter (`PAT_ENC_CSN_ID`) into one screen, mapping each
  `FLO_MEAS_ID` to `itemInterest` / `itemDown` / `total`. Sort screens by `CAST(PAT_ENC_DATE_REAL AS REAL)`.
  Compute `positive = total >= 3` (the PHQ-2 positive threshold; `positiveThreshold: 3`). Seven negative
  screens result. Backs `e_phq2`.

- **`screening.topics`** — projection from the **health-maintenance** engine. Source:
  `HM_HISTORICAL_STATUS`, which logs one row per status change per topic (`LINE` increments). **The truth is
  the latest line per topic:** group by `HM_TOPIC_ID`, take `MAX(CAST(LINE AS INT))`, self-join back to that
  line. Read `HM_TOPIC_ID_NAME`, `HM_STATUS_C_NAME`, `NEXT_DUE_DATE`, `LAST_COMPLETED_DATE`. Keep only the
  screening subset (topic name matches Diabetes / Cholesterol / Hepatitis C / Wellness — the vaccine HM topics
  are already covered by the immunization slots, so they're excluded here). Cleaning: tidy the topic label
  (strip an `HM-`/`Lab-` prefix, normalize "Screening" casing) and date-format `nextDue`/`lastCompleted`
  (null-safe — a "Completed" topic may have no next-due date). Backs `e_screening_dash`.

---

### The data-gap fact (`e_no_glucose_series`) — projection (a negative finding)

This is the honest limit of the dive, and it is a **query result you assert by its emptiness.** Establish two
things from raw:
  1. **There is no continuous-glucose series in the export.** A CGM stores its readings in the vendor app, not
     the EHR; confirm no flowsheet/lab family carries a dense glucose time-series for this patient.
  2. **The only glucose values present are two point labs.** In `ORDER_RESULTS`, the only glucose component is
     `GLUCOSE` (a single point-draw component), and it has exactly two non-sentinel results. State that — two
     point glucose draws — without transcribing the values into BUILD (they live in `e_no_glucose_series`).
This negative finding is what the `cgm` section's closing beat and the assessment's "what the data cannot
answer" rest on. It has no structured slot of its own; it exists only as the `e_no_glucose_series` evidence
`fact`.

---

### Judgment slots — notes, messages, and the narrative

These cannot be reproduced by a query: an agent reads the raw free text and applies a rubric. All quotes are
referenced by `evidenceId`; the quote text itself is only ever written into `viewmodel.evidence`, never here.

**Where the raw text lives.**
- **Progress / triage / phone notes** are RTF files in `raw/Rich Text/`, named `HNO_<HNO_ID>_*.RTF` (the
  `HNO_ID` is in the filename). Decode with `lib/rtf2txt.ts`. (Linkage of an `HNO_ID` to its encounter/author
  is in `HNO_INFO`/`HNO_PLAIN_TEXT` if you need to confirm the CSN.)
- **MyChart messages** are in `MYC_MESG` (one row per message: `MESSAGE_ID`, `CREATED_TIME`,
  `TOFROM_PAT_C_NAME` for direction, `SUBJECT`, `PAT_ENC_CSN_ID`) with the body on `MYC_MESG_RTF_TEXT`
  (`MESSAGE_ID`, `LINE`, `RTF_TXT` — concatenate lines, decode RTF), keyed by `MESSAGE_ID`.

**`evidence` — note and message entries (judgment).** For each, capture author/role + date and the single
verbatim line a skeptic would demand:
  - `e_travel_destination` — the travel-consult intake note (RTF); the trip destination + dates line.
  - `e_travel_rph` — the pharmacist's triage note (RTF, author Jennifer George, PharmD); the CDC-based
    recommendation line (Hep A + Typhoid firm; yellow fever considered; malaria + TD advice).
  - `e_travel_signoff` — the physician's co-sign note (RTF); the one-line agreement.
  - `e_cgm_outofpocket` — the PCP's phone note (RTF, author Rammelkamp); the out-of-pocket line.
  - `e_practice_reply` / `e_advocacy` — the April-2021 message thread (MyChart): the practice's "not scheduling
    random COVID injections" reply and the patient's risk-factor advocacy.
  - `e_cgm_request` / `e_cgm_followup` — the March-2024 CGM-prescription message and the May-2024
    renewal-request message (patient → Rammelkamp).
  **Rubric:** one quote per claim; the shortest line that *proves* the claim; author + date attached; quote the
  note/message, not a downstream summary. **PHI:** these notes and messages may carry a lab address, phone, or
  the patient's MRN in surrounding text — capture only the clinically meaningful line; never the address/phone/
  MRN/email. The travel note's destination is a city, which is fine; do not pull any street address.

**`evidence` — fact entries (lead, restating projections).** `e_imm_count`, `e_flu_program`, `e_covid_series`,
`e_self_reported`, `e_travel_doses`, `e_phq2`, `e_a1c`, `e_screening_dash`, `e_cgm_orders`, `e_no_glucose_series`,
`e_forecast` are each a one-sentence readable statement of a figure the projection agents computed — written so
the evidence drawer shows a human sentence, not a row. Each restates only what its slot already proves.

**`travelCluster` framing fields (judgment, off the same two RTF notes).**
  - `destination` (`"Bangalore and Hyderabad, India"`) and `travelDates` (`"Feb 23 – Mar 3, 2019"`) are read
    from the travel-intake note (the raw note spells the cities idiosyncratically; the view model carries the
    corrected display spelling). `consultDate` is the note date (Feb 1, 2019); `date` is the shot day
    (Feb 5, 2019, from the projection).
  - `pharmacistRecommended` (`["Hepatitis A", "Typhoid"]`) is the **firm** vaccine recommendations parsed from
    the pharmacist note; `alsoAdvised` is the non-vaccine advice (yellow fever considered, malaria prophylaxis,
    TD treatment). **Rubric:** "firm" = the immunizations the pharmacist affirmatively recommends; "advised" =
    everything conditional or non-vaccine. The dive's analytic claim — that the administered shots match the two
    firm recommendations exactly (with Tdap added for routine adult coverage) — is the agent's reasoning over
    note + timeline, frozen into the narrative.

**`summary` + `sections[]` narrative (judgment).** The five sections (`immunizations`, `travel`, `screening`,
`cgm`, `assessment`) and the summary are the analyst's written reasoning over everything above. Each narrative
beat cites the `evidenceId`s that back it (a mix of `fact` restatements and note/message quotes). The
`assessment` section additionally makes a **cross-dive** claim — that this engaged patient's modifiable cardiac
risk drifts untreated in the sibling cardiac-risk dive — which is interpretive synthesis, not a query result,
and is presented as such. **Invariant the lead enforces:** every `cites` id resolves in `evidence`.

---

### One runnable path (not the recipe)

The repo kept one implementation of the above: two SQL extractors (one for the vaccine tables, one for labs/
meds/flowsheets/HM) that emit figure JSON, a fuse step that attaches the hand-read note/message quotes, and a
final projector that does the label/date cleaning into `viewmodel.json`. That is *one* way to run this recipe;
the steps that matter are the ones above, all of which start at the raw tables and raw notes.
