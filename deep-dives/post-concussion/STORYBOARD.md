# Post-concussion deep dive — storyboard (the view designed first)

**Patient:** MANDEL, JOSHUA C — a multi-year post-concussion syndrome (2020 → 2025).
**The argument the whole page makes:** this is a clean, self-limited concussion course that the
chart can tell almost completely — a minor 2020 head injury, a **normal brain MRI that the symptoms
outlasted**, a syndrome named and owned, one well-chosen medication (nortriptyline) titrated against
a documented response and then deliberately tapered to "therapy completed" — with exactly one honest
seam: the specialist evaluation left this health system (neurology moved to Massachusetts), so the
formal neurology work-up and any logged headache metric live somewhere this export cannot see.

**The tool a neurologist would want:** not an infographic, and not a headache dashboard. A page that
(1) opens like a consult — states the case and lays the whole arc out as a glanceable board; (2)
puts the **two tracks a neurologist actually reasons over on one time axis** — the discrete events
(two injuries, the scan, the diagnosis, the referrals, the relocation, the taper) against the
**continuous nortriptyline dose** — so the cause-and-effect is legible at a glance (drug *begins* at
the second injury, dose climbs *as* the response is documented, steps to zero at the planned taper,
all of it beneath the flat reality of a normal scan); (3) shows the central fact — the **negative
MRI** — verbatim; (4) walks the **medication course** with the documented response and the four-order
chain; (5) tells the **referral split** honestly (OT fulfilled, neurology expired and relocated);
(6) reads the **coding fingerprint**; (7) closes with an assessment and an explicit list of what this
export simply cannot answer.

**Structural rule:** the app imports ONLY `viewmodel.json`. Every value in it is already
display-clean (dates "Dec 1, 2022"; drug "nortriptyline 10 mg nightly"; statuses as plain words
"Canceled / Completed / Final", "Expired / auto-closed", "Therapy completed"). Every claim cites an
`evidenceId` that resolves, in a drawer, to a clean note **quote** (with date + author) or a clean
readable **statement** of a structured fact — never a raw row. Figures are crunched in the viewmodel
(encounter counts, the reorder intervals, the dose segments), so the views render numbers, not
derive them. `src` ids (order/proc/problem/referral) ride along for tracing but never display. The
view model was *built* by a real DB→figures→viewmodel pipeline (recovered in `BUILD.md`); no copy of
that pipeline lives in the dive folder anymore, so `viewmodel.json` is the on-disk source of truth and
the recipe to rebuild it is the BUILD record.

---

## Section order, beat by beat

Each section lists: **narrative beat** · **visualization(s)** · **crunched figures/tables** ·
**evidence it drills to**. Section ids match `viewmodel.sections[].id`. The header and the centerpiece
chart sit above the numbered sections.

### Header / arc board — `summary` (+ `arc`, `problem`)
- **Beat:** A consult-note opener — one paragraph names the whole five-year arc and how it resolved,
  then a compact **arc board** (one row per event: title + date + one line) and a small "reassuring"
  strip (negative MRI, documented response, planned taper, one drug across four linked orders).
- **Visualization:** the arc board (10 event rows, each linking to the section that owns it) + the
  reassuring counterweights strip.
- **Crunched:** PCS on 11 encounters; MRI negative; one drug, four linked orders, ~1,099 days.
- **Drills to:** each arc beat → its evidence; the headline → the negative-MRI quote and the
  "therapy completed" record.

### ★ The course on one axis — `course` *(the centerpiece)*
- **Beat:** The spine. A neurologist reads this case on two tracks at once — the discrete arc of
  events and the one medication held against them. Drawn together, the cause-and-effect is legible:
  the nortriptyline thread **begins at the second injury**, the dose climbs **as the response is
  documented**, it is maintained through the stable years, then steps to zero at a planned taper —
  all of it beneath the flat, persistent reality the normal scan established.
- **Visualization:** a **bespoke dual-track course chart** — an event rail (packed, non-overlapping,
  color-keyed by thread, each dot drillable) above a **dose step plot** (mg nightly, each dose held
  until the next order changes it) with the on-drug band shaded, the taper-to-zero terminus marked
  "off", and a dashed marker at the July 2020 MRI labeled "normal MRI — symptoms persist".
- **Crunched:** dose segments 10 → 20 → 30 → 0 mg with their date spans; the on-drug band 2022→2025.
- **Drills to:** the dose-steps + chain records; the negative-MRI quote.

### 1. The 2020 head injury and a normal scan — `injury`
- **Beat:** The arc begins with a minor head injury (bike rack on the trunk, no loss of
  consciousness). The acute work-up was thorough — four head-imaging orders in two weeks — but the
  one final read is **unambiguously normal**, and that gap (normal imaging, real symptoms) defines
  the whole case.
- **Visualization:** an **MRI read card** (the verbatim radiology impression "Negative cerebral MRI"
  with performer/facility/date and the full report text) + a **four-order imaging table** (study /
  ordered / status / read), only the July 31 MRI marked "Final — Negative".
- **Crunched:** 4 orders (3 MRI + 1 CT), 2 Canceled / 2 Completed, 1 reaching a Final read.
- **Drills to:** the mechanism quote and the initial head-injury code; the negative-MRI quote and the
  MRI-read fact; the imaging-burst fact.

### 2. Persistent symptoms after a normal MRI — `syndrome`
- **Beat:** Post-concussion syndrome is *precisely* the diagnosis for normal-scan-with-persistent-
  symptoms. By the August 2022 establish-care visit the picture is chronic (daily left/frontal
  screen-triggered headaches, nausea); the early-2022 OT course quantified the plateau honestly
  (~90–95%, "plateaued about a year ago"); the diagnosis is entered to the chart that day, carried
  Active — and the patient himself typed "Post concussion syndrome" on the patient-review channel,
  so it is a diagnosis he owns.
- **Visualization:** prose-led (the problem record and the patient-typed fact carried as drillable
  statements; no chart needed here).
- **Crunched:** onset back-dated Sep 1, 2020; entered Aug 29, 2022; flagged non-chronic despite a
  "chronic problem … over 2 years" note.
- **Drills to:** the 2022 course quote; the "chronic problem … over 2 years" quote; the recovery and
  plateau quotes; the problem-record and patient-typed facts.

### 3. A second injury and the start of drug therapy — `second-injury`
- **Beat:** A second head injury (snorkeling, Nov 2022, again no LOC) re-aggravated the syndrome and
  was the trigger to escalate from therapy alone to medication. Nortriptyline 10 mg nightly was begun
  as a shared decision ("Josh is prepared to give nortriptyline a trial"); a Neurology referral was
  placed the same day, two more three weeks later — all three carrying the PCS diagnosis, all three
  later expired un-fulfilled.
- **Visualization:** prose-led; the referral fate is shown in full in `care-relocation`.
- **Crunched:** start 10 mg nightly; three Neurology referrals (Dec 1 + Dec 22 ×2).
- **Drills to:** the snorkel quote; the trial + start quotes and the med-chain fact; the neurology-
  referrals fact.

### 4. The nortriptyline course: dose over time and symptom response — `medication-course`
- **Beat:** Nortriptyline became the durable management — **one continuous therapy**, four orders
  sharing a single chain identifier, up-titrated 10 → 20 → 30 mg with a **fast, clean documented
  response** ("better within the first week", no side effects), then a planned taper to "therapy
  completed". One naming wrinkle is flagged honestly: the orders are nortriptyline throughout, but
  the 2024–2025 notes say "amitriptyline" (both TCAs used the same way; the dose is consistent).
- **Visualization:** a **response readout** (three verbatim quotes beside three crunched facts: <1
  week to benefit, no side effects, 10→30 mg then off) + the **four-order chain table** (#, ordered,
  dose, quantity, change, ended/reason) with a reorder-interval note and the naming-wrinkle flag.
- **Crunched:** 4 orders, ~1,099 days; doses 10/20/30 mg; quantities 90/180/270 capsules; reorder
  gaps 81 / 305 / 402 days; final order discontinued "Therapy completed".
- **Drills to:** the "better"/"first week" quotes; the dose-steps, chain, reorder-intervals, name-
  discrepancy, and therapy-completed facts; the "30 mg amitriptyline" and taper quotes.

### 5. Referrals, occupational therapy, and a move out of state — `care-relocation`
- **Beat:** The two referral threads diverged sharply. OT (Feb 2022) was fulfilled — two in-system
  visits, then discharged — and is the course that got him to the plateau. The three Neurology
  referrals all expired auto-closed; the Sept 2023 note explains why ("seeing neurology in
  Massachusetts"). Specialist care was real but **relocated out of state**, so it lives entirely
  outside this export.
- **Visualization:** a **two-column referral split** — Fulfilled (OT, with the two visit rows) vs
  Expired (the three Neurology referrals) — closing on the Massachusetts relocation line.
- **Crunched:** OT fulfilled (2 visits, "patient discharged"); 3 Neurology "Expired / auto-closed".
- **Drills to:** the OT-fulfilled fact + recovery quote; the neurology-referrals fact; the
  Massachusetts quote.

### 6. How the syndrome was coded across the record — `coding`
- **Beat:** The coding fingerprint reads exactly as the clinical story does — one dominant
  longitudinal diagnosis (PCS, 11 encounters) sitting atop the acute 2020 head-injury codes and a
  few adjacent headache/late-effect codes that cluster at the events that triggered them.
- **Visualization:** **diagnosis-frequency bars** (encounter count per code, PCS marked dominant).
- **Crunched:** PCS 11 · traumatic head injury initial 5 · post-concussion headache 1 · chronic
  post-traumatic headache 1 · late effect of TBI 1.
- **Drills to:** the dx-frequency and problem-record facts.

### 7. Assessment & what the record cannot answer — `assessment`
- **Beat:** Close like a consult. (a) **Assessment:** a clean, self-limited PCS course managed almost
  entirely in primary care — normal MRI, a named/shared diagnosis, one well-chosen drug with a
  documented response, sensible up-titration, planned taper; nothing suggesting a missed lesion or a
  deteriorating course. (b) **What a neurologist would do** is mostly already done or moot — the one
  genuine gap is the specialist evaluation that never reached this system. (c) **What the data cannot
  answer:** there is **no structured headache-frequency/severity score anywhere** (the symptom course
  is reconstructable only from note phrases); the nortriptyline/amitriptyline name discrepancy is
  unresolved in the chart; and because neurology care moved out of state, any post-2022 imaging,
  testing, or specialist reasoning is simply not here to examine.
- **Visualization:** prose-led (assessment, next-steps, and an honest limits list).
- **Crunched:** the "no headache metric" gap stated as its own finding.
- **Drills to:** the negative-MRI quote, the therapy-completed and taper records; the neurology-
  referrals fact and Massachusetts quote; the name-discrepancy and no-headache-metric facts.

---

## Visualizations inventory (bespoke + light primitives)
- **Dual-track course chart** — bespoke SVG: a packed event rail over a dose step plot, on-drug band,
  taper terminus, and a dashed normal-MRI marker. This is the payoff view; built custom.
- **MRI read card + four-order imaging table** — bespoke; the verbatim impression is the centerpiece.
- **Response readout** — bespoke quote-vs-fact row.
- **Four-order chain table** — the medication ledger with reorder-interval and name-wrinkle notes.
- **Referral split** — bespoke two-column fulfilled-vs-expired layout.
- **Diagnosis-frequency bars** — small bespoke bars (encounter counts per code).
- **Arc board** — small bespoke table in the header.

## The crunched figures the viewmodel must carry (re-derived from the DB)
- Problem: PCS Active, onset 9/1/2020 (noted), entered 8/29/2022, CHRONIC_YN N, 11 encounters.
- Encounter-dx frequency: 260690=11, 1177374=5, 442362/342609/284018=1 each.
- Imaging: 4 orders, statuses (2 Canceled / 2 Completed), only 439060613 Final; the verbatim read.
- Medication: 4 orders, one chain (MDL 73847702 / MEDICATION_ID 5674), doses 10/20/30 mg, quantities
  90/180/270, reorder gaps 81/305/402 days, span ~1,099 days, final reason "Therapy completed".
- Referrals: OT fulfilled (2 visits, "Patient Discharged"); 3 Neurology "Expired-Auto Closed".
