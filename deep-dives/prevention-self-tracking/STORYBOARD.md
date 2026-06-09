# Prevention & self-tracking deep dive — storyboard (the view designed first)

**Patient:** MANDEL, JOSHUA C — 43M, primary prevention (no diabetes, no established disease in this thread).
**The argument the whole page makes:** this is a patient whose prevention behavior runs *ahead* of what
the system asks of him. Across eight years the record documents three parallel, well-maintained
immunization programs (annual influenza, a complete COVID-19 series, a 2019 pre-travel cluster),
uniformly reassuring screening, and — the telling thread — a continuous glucose monitor he *requested
and self-funded against an entirely normal A1c*, purely to study his own physiology. The point is the
posture, not the numbers: he self-documents vaccines into his own chart, lobbies the practice for early
COVID eligibility using his own risk factors, and runs a months-long n-of-1 glucose experiment. The
honest counterpoint, surfaced explicitly, is that the same engaged patient's modifiable cardiac risk
drifts untreated in a sibling dive — high engagement does not guarantee every preventable risk is acted on.

**The tool a primary-care clinician would want:** not an infographic and not a vaccine card. A page that
(1) puts the *entire* prevention record on one time axis so the cadence and the parallel programs are
visible at a glance, (2) shows the influenza metronome and the COVID series as what they are — sustained
programs, with the self-reported doses marked, (3) reconstructs the 2019 travel cluster as a
recommendation-to-action mapping (a pharmacist's CDC-based advice translated into shots within days),
(4) shows screening as recurring and reassuring (every PHQ-2 negative; A1c against its reference band),
(5) tells the CGM story as the behavioral centerpiece — the request, the orders, the self-reported
result — while being scrupulously honest that the glucose data it generated never entered the EHR, and
(6) closes like an assessment: what an expert takes from the case, the cross-reference to the untreated
cardiac risk, and what the data simply cannot answer.

**Structural rule:** the app imports ONLY `viewmodel.json` (`import vm from "./viewmodel.json"`). Every
value in it is already display-clean (dates "Sep 25, 2022"; vaccines "COVID-19 (Pfizer bivalent)" not a raw
CVX/`IMM_TYPE_ID_NAME` string; statuses as plain words). Every claim cites an `evidenceId` that resolves,
in a drawer, to a clean **quote** — a verbatim note or patient-portal message with author + date — or a
readable **statement** of a structured fact; never a raw row. The figures (dose counts, the 8-of-9 season
tally, the PHQ-2 totals, the A1c values) are carried pre-computed in the view model, so the views render
numbers, they don't derive them.

The view model carries exactly **five** narrative `sections[]` — `immunizations`, `travel`, `screening`,
`cgm`, `assessment` — and the section-by-section beats below are titled to those ids. The header **program
board** and the centerpiece **engagement timeline** are rendered by `app.tsx` (the `PROGRAMS` const and an
`id="overview"` shell) *between* the header and the first numbered section; they are presentation layered on
the same view-model slots, not their own `sections[]` entries. Beats 0 and 1 below describe those two
app-only blocks; beats 2–6 map one-to-one to the five `sections[].id`.

---

## Section order, beat by beat

Each section lists: **narrative beat** · **visualization(s)** · **crunched figures/tables** ·
**evidence it drills to**. Section ids match `viewmodel.sections[].id`; the centerpiece overview sits
between the header and the first numbered section.

### 0. Header / program board — `summary` + `PROGRAMS`
- **Beat:** A one-paragraph opener that names the thesis (a deliberately prevention-minded patient whose
  engagement runs ahead of the system), then a compact **program board** — one row per prevention
  program with a headline count and a jump link to its section.
- **Visualization:** the program board (6 rows: Immunizations · Influenza · COVID-19 · Travel cluster ·
  Screening · Self-tracking/CGM), each color-keyed and linking to its section.
- **Crunched:** 18 doses; flu 8/9 seasons; COVID 7 doses (4 self-entered); travel 3-in-1-day; screening
  all clear; CGM self-funded.
- **Drills to:** (the board is navigation; its figures drill in their own sections.)

### 1. Eight years of prevention, on one axis — `overview`  *(the centerpiece)*
- **Beat:** The whole record on a single timeline, separated into the lanes a clinician reasons about.
  Read across, the *cadence* is the argument: a steady annual influenza beat, a COVID series that never
  lapses, the tight 2019 travel cluster, recurring negative screening, and one self-directed CGM window
  in 2024 — with the forecast simply projecting the same posture forward into 2026.
- **Visualization:** a bespoke **five-lane engagement timeline** (2017→2026): Influenza / COVID-19 /
  Travel cluster immunization lanes (filled dots = administered, hollow rings = self-reported, dashed
  rings = forecast next-due), a **Self-tracking** lane carrying the CGM monitoring window + order ticks,
  and a **Screening** lane carrying every PHQ-2 (squares) and A1c (labeled). The 2020 flu gap and the
  2026 forecast region are shaded.
- **Crunched:** 18 doses across 3 immunization lanes; the CGM window Mar–Sep 2024; 7 PHQ-2 + 2 A1c marks;
  forecast flu Aug 1 2026 / COVID Aug 22 2026.
- **Drills to:** the immunization-count, flu-program, COVID-series, and forecast statements.

### 2. Immunization program — `immunizations`
- **Beat:** 18 distinct doses over eight years read as a continuous, maintained record. Two routine
  threads dominate — the influenza metronome and a fully built-out COVID-19 series — and two details mark
  him as an engaged consumer rather than a passive recipient: four COVID doses self-entered into his own
  chart, and an April-2021 message arguing for *earlier* eligibility using his own risk factors.
- **Visualization:** an **influenza season-coverage strip** (one cell per fall 2017–2025: ✓ covered /
  — gap, with the dose month) and a **COVID dose ladder** (7 rungs, colored by manufacturer, the
  self-reported doses tagged).
- **Crunched table:** flu 8 of 9 seasons (lone gap 2020); COVID 7 administrations Moderna→Pfizer with
  the exact dates/products; 4 doses flagged "MyChart Entered."
- **Drills to:** the 18-dose count; the 8-of-9 influenza statement; the 7-dose COVID series; the
  self-reported flag; the practice's "not scheduling random COVID injections" reply and the patient's
  "between overweight and prehypertension I'm hoping I'll qualify ASAP" advocacy quote.

### 3. Travel immunization cluster (February 2019) — `travel`
- **Beat:** A three-shot cluster (Tdap, Typhoid, Hepatitis A, all 2/5/2019) is not random — it is a
  textbook pre-travel work-up, and the chart shows the reasoning. Four days earlier a pharmacist-led
  travel consult captured the trip to India and recommended exactly Hepatitis A and Typhoid; a physician
  signed off. The administered shots match the firm recommendations precisely, with a routine Tdap added.
- **Visualization:** a **recommendation→action mapping** — the trip header (destination, dates, consult
  vs. shot dates), then per-dose chips labeled "Pharmacist-recommended (CDC guidance)" vs. "Routine adult
  coverage (added)", plus a small table of the pharmacist's non-vaccine advice (yellow fever considered,
  malaria prophylaxis, traveler's-diarrhea treatment).
- **Crunched:** 3 doses in one day; 2 of 3 match the two firm pharmacist recommendations; trip
  Bangalore/Hyderabad, India, Feb 23 – Mar 3, 2019.
- **Drills to:** the travel-doses statement; the destination/dates note; the pharmacist's recommendation
  note; the physician sign-off ("Agree with RPh triage").

### 4. Screening: depression and diabetes — `screening`
- **Beat:** Routine screening is present, recurring, and uniformly reassuring. Depression screening
  (PHQ-2) is negative at all seven visits; HbA1c is normal twice and tracked over time; the
  health-maintenance engine carries the broader preventive panel as current and not-due.
- **Visualization:** a **PHQ-2 negative-screen strip** (seven rows, each scored against the positive
  threshold of 3, the lone amber 1 marked) and a **health-maintenance dashboard table** (Diabetes,
  Annual Wellness, Cholesterol, Hepatitis C — status, last completed, next due).
- **Crunched:** 7 PHQ-2 screens (six = 0, one = 1, none positive); A1c context carried (the 2023 draw
  ordered to screen for diabetes, 2025 under preventive care); preventive panel last completed Dec 4, 2025.
- **Drills to:** the PHQ-2 series statement; the A1c statement; the health-maintenance status statement.

### 5. Self-tracking: a CGM despite a normal A1c — `cgm`  *(the behavioral climax)*
- **Beat:** The defining thread. Against an A1c of 5.4% — no diabetes, no prediabetes — the patient asked
  his PCP for a continuous glucose monitor purely "to learn more about how my body responds to different
  foods." The physician wrote it the same week; a phone note records that he knew he would pay out of
  pocket. It became a months-long n-of-1 study: a refill request reports "learned a lot and also lost 5lb"
  and even an interest in sharing the data publicly. The honest limit, stated plainly: none of the
  glucose curves the experiment generated are in the export — only two point glucose labs survive.
- **Visualization:** an **HbA1c trend** (two points against the shaded 4.0–6.0% reference band), a paired
  **point-glucose fact card** (97 → 90 mg/dL, the only values in the record) and an explicit **data-gap
  card**, and a **self-funded order trail** (three FreeStyle Libre 3 order cards: item, qty, refills, sig,
  ordering provider).
- **Crunched:** A1c 5.4 → 5.5% (both normal); 3 Libre orders (sensor + reader 3/12/2024, no refills; then
  a 4-sensor / 4-refill script 5/7/2024), all status "Sent"; zero continuous traces in the export.
- **Drills to:** the CGM request message; the out-of-pocket phone-note quote; the orders statement; the
  refill/"lost 5lb" message; the no-glucose-series statement.

### 6. Assessment — `assessment`
- **Beat:** Close like a clinician. (a) **Assessment:** a coherent portrait of proactive, self-directed
  prevention — the vaccine history essentially complete for his age and life pattern, screening current
  and reassuring, no gap a clinician would flag in primary prevention. (b) **What an expert takes from
  the case:** the *behavior* — self-documenting vaccines, lobbying for early eligibility, self-funding a
  CGM — and the pointed cross-reference that this same posture coexists with untreated Stage-1 BP and a
  falling HDL in the cardiovascular record. (c) **What the data cannot answer:** the CGM experiment's
  actual results (the food-response curves live in the Abbott app, never imported), the 2020 flu gap, and
  any outside-system care — absence here means "not captured by this export," not "did not happen."
- **Visualization:** a **cross-reference callout** tying this dive to the cardiac-risk dive; the prose
  itself carries the assessment / expert-takeaway / open-questions structure.
- **Crunched:** the summary figures restated in service of the argument (complete vaccine history;
  current screening; the one behavioral outlier).
- **Drills to:** the immunization-count, flu-program, A1c, and screening-dashboard statements; the
  advocacy and CGM-request quotes; the no-glucose-series limit.

---

## Visualizations inventory (all hand-rolled here; the kit lacked a coverage/status primitive)
- **Five-lane engagement timeline** — bespoke SVG (programs as lanes; administered/self-reported/forecast
  marker styles; CGM window bar; screening squares + A1c marks). The centerpiece.
- **Influenza season-coverage strip** — bespoke categorical cells (covered / gap).
- **COVID dose ladder** — bespoke, manufacturer-colored, self-reported tags.
- **Travel recommendation→action chips + advice table** — bespoke.
- **PHQ-2 negative-screen strip** — bespoke threshold bars (positive ≥ 3).
- **HbA1c trend vs. reference band** — small SVG line against the 4.0–6.0% band.
- **CGM order cards + data-gap card** — bespoke.
- **Program board + health-maintenance table** — small bespoke tables.

## The crunched figures the viewmodel must carry (pre-computed)
- Immunizations: 18 doses; lane counts (Influenza 8 / COVID-19 7 / Travel 3); per-dose date/vaccine/lane.
- Influenza: 8 of 9 seasons covered, gap year 2020, the 8 dose dates.
- COVID: 7-dose series with doseNumber/date/product; the 4 self-reported dates.
- Travel: cluster date, consult date, destination, travel dates, 3 doses, 2 firm recommendations, advice list.
- Screening: 7-row PHQ-2 series (per-item + total + positive flag, threshold 3); 4 health-maintenance topics.
- Metabolic: 2 A1c values with ref range/flag; 3 CGM orders with qty/refills/sig/provider; the glucose-gap fact.
- Forecast: flu + COVID next-due dates.
