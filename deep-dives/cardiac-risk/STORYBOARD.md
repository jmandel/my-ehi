# Cardiac-risk deep dive — storyboard (the view designed first)

**Patient:** MANDEL, JOSHUA C — 43M, primary prevention (no established ASCVD, no diabetes).

**The argument the whole page makes:** his modifiable cardiovascular risk is real and drifting
upward, yet the chart treats him as a healthy young man. The mechanism is structural — a single
2022 hypertension diagnosis that was diagnosed, treated for one day on paper, declined, and then
never carried forward, so it never reaches the problem list, never triggers a registry/reminder,
and the chart never computes the one number (ASCVD) that would frame the whole case. The page is
the consult the chart never produced: it states the case, proves the undercoding with a dated
paper trail, shows the complete record for each modifiable axis against guideline categories,
computes the risk the chart never did, and closes with an honest list of what the export cannot
answer.

**The tool a cardiologist would want — NOT an infographic.** A working page that (1) opens the way a
consult note opens, (2) proves the undercoding with the dated paper trail, (3) shows the *complete*
record for each modifiable axis (BP, lipids) against guideline categories, (4) computes the ASCVD
risk the chart never did with every input drillable, (5) shows the family loading as a real
pedigree, (6) reconciles the reassuring-but-orphaned 2024 acute work-ups, (7) closes with the
metabolic driver, the cardiologist's plan, and an honest list of what the export simply cannot
answer. The reader is a clinician; the page lets them drill from any claim to its source, not
admire a dashboard.

**Structural rule — the contract every section obeys.** The app imports ONLY `viewmodel.json`
(`import vm from "./viewmodel.json"`). Every value in it is already display-clean (dates
"Aug 29, 2022", drugs "lisinopril 10 mg", plain category/flag words, no raw `_C_NAME`, no
`date_real`, no locator ids). Every claim cites an `evidenceId` that resolves, in a drawer, to a
clean note **quote** (with date + author) or a clean readable **statement** — never a raw row.
Figures are crunched in the projection and baked into the viewmodel (recomputed from the substrate
`dataset.json`), so the views render numbers, they do not derive them.

This dive HAS a projection pipeline, so the **anti-drift rule** applies: `parts/` is the editable
source and `viewmodel.json` is the *assembled* output (`scripts/assemble-viewmodel.ts`). To change
a number or a sentence, edit the part (or the script that writes it) and re-assemble; the view
model is never hand-edited. The BUILD record carries the per-slot recipe and the verification that
each recipe reproduces the committed value.

**The split this page is honest about.** Half the page is *projection* — deterministic, re-runnable
SQL→figures (the BP series, the lipid panels, the ASCVD computation, the family pedigree, the
undercoding scorecard). Half is *judgment* — the prose spine and the curated note quotes
(the home-BP self-report, the boilerplate annual lines, the "99213 for HTN" billing line, the two
radiology reads, the CGM "not taking" note). The judgment half was agentic reasoning frozen into
the viewmodel; it is documented and evidence-traced (every quote checks against the source note),
but it is not deterministically re-runnable. The page never blurs the two: a projected figure
always traces to a row; a curated fact always traces to a note quote.

---

## Section order, beat by beat

Each section lists: **narrative beat** · **visualization(s)** · **crunched figures/tables** ·
**evidence it drills to**. Section ids match `viewmodel.sections[].id`
(`htn`, `bp`, `lipids`, `ascvd`, `family`, `acute`, `metabolic`, `assessment`).

### 0. Header / problem banner — `summary`
- **Beat:** A consult-note opener. One paragraph states the paradox (real, rising, unowned risk on a
  chart that reads "healthy 43-year-old"), then a compact **driver board** — one line per modifiable
  problem with a tone (bad / watch / reassuring) and a jump link to its section.
- **Visualization:** the driver board (Blood pressure, Hypertension coding, Lipids, Family
  history, 10-yr ASCVD, Weight/glycemia) + a thin "reassuring counterweights" strip (negative
  troponin, clean neck CTA, normal A1c, clean kidneys).
- **Crunched:** mean systolic 132; HDL 52→40; ASCVD 1.06%→2.04%; +13 lb; family CV facts 8 of 12.
- **Drills to:** each driver line → its section; the headline phrase → the 2022 diagnosis note quote.

### 1. The hypertension undercoding story — `htn`  *(the spine)*
- **Beat:** The single most consequential gap. Hypertension was correctly diagnosed and treated ONCE
  (8/29/2022), then the thread simply ends: the prescription was declined, it was never re-coded,
  never added to the problem list, never re-addressed across six later visits. With HTN off the
  problem list, nothing in the chart's machinery ever prompts the chronic axis again — the omission
  is self-perpetuating.
- **Visualization:** a **horizontal HTN-thread timeline** — diagnosis ● → lisinopril started ● →
  *(13-month gap)* → declined / discontinued ✕ → then three annual visits each stamped with the
  verbatim boilerplate ("BP and weight good") while the printed BP sat in Stage 1. A **coding
  scorecard**: On the structured problem list? **No**. Encounter diagnoses carrying it? **2** (both
  on the single 8/29/2022 diagnosis day — the establish-care visit and its same-day lab contact;
  coded nowhere else). Antihypertensive ever taken? **No (declined)**. Office readings at or above
  Stage 1? **7 of 9**. Times re-addressed in 6 later visits? **0**.
- **Crunched table — the boilerplate vs. the vitals:** for each of the 3 post-decline annuals, the
  note's reassurance line beside the BP actually recorded that day (e.g. 12/4/2025: note says "BP and
  weight good"; vitals show 132/62, Stage 1). This is the contradiction the chart never surfaces.
- **Drills to:** the 8/29/2022 diagnosis quote ("BP of 138/76 is consistent with Stage I HTN… start
  lisinopril 10 mg daily" + "99213 for HTN"); the problem-list-absent statement; the lisinopril
  decline statement ("Patient refusal", never taken); each boilerplate quote with its date/author.

### 2. The complete blood-pressure record — `bp`
- **Beat:** This is not white-coat lability or a one-off — it is a stable, sustained elevation across
  seven years and multiple providers. And the chart holds the very confirmation guidelines ask for:
  the patient's own home report agrees with the office mean. The escape hatch ("probably white-coat,
  don't treat") is refuted by the patient's own data.
- **Visualization:** a **BP band plot** — paired systolic/diastolic points over 2018→2025 on category
  bands (Normal / Elevated / Stage 1 / Stage 2), the 12/1/2022 142/74 marked as the single
  Epic-flagged reading, a horizontal reference line at the office mean (132), and a labeled
  annotation for the home self-report band ("upper 130s"). Each point drillable to its reading.
- **Crunched figures (recomputed, reconciled):** n = 9 office readings; mean systolic **132.3** (range
  122–142); **0 readings truly Normal** (<120/80); **7 of 9 at/above Stage 1** (≥130 systolic OR ≥80
  diastolic); 2 Elevated (122/70, 128/70); **1 Epic-flagged** (142/74). A small **office-vs-home**
  reconciliation card: office mean 132 ≈ patient-reported "upper 130s" ⇒ concordant, NOT white-coat.
- **Drills to:** the 9 reading statements; the home-report quote (8/29/2022).

### 3. Lipid trajectory — `lipids`
- **Beat:** An atherogenic shift. The protective HDL is falling while the ratio and triglycerides
  climb — the metabolic-syndrome-type pattern that adds to ASCVD risk beyond LDL alone, and that
  tracks the weight gain. The 2025 panel is the first to carry multiple abnormal flags. The honest
  caveat (non-fasting) is shown and *bounded* — the driver is the directly-measured HDL, which is
  fasting-independent.
- **Visualization:** small-multiple **lab-trend sparklines**, one per analyte (Total chol, LDL, HDL,
  Triglycerides, Chol/HDL ratio, VLDL), each plotting value against its own reference interval with
  out-of-range points marked; an arrow/trend chip (improving / stable / worsening). Plus a
  **three-panel table** (2018 fasting · 2023 non-fasting · 2025 non-fasting) with value, ref, flag.
- **Crunched:** HDL 52→44→40 (now Low); chol/HDL 3.1→3.5→4.7; TG 88→92→282 (High, non-fasting); VLDL
  56 (High); TC 159→156→188; LDL near-stable 89→94→92. A **fasting-redraw callout** that previews
  where a true fasting panel lands (handed to the ASCVD section's scenario strip).
- **Drills to:** each analyte trend statement; the non-fasting lab statement; the
  fasting-vs-non-fasting comment quotes.

### 4. The 10-year ASCVD risk the chart never computed — `ascvd`  *(analytical climax)*
- **Beat:** This is the number the chart should have produced and never did, computed here from the
  Pooled Cohort Equations with every input recovered from the export — including race (which a first
  pass wrongly thought was missing). It sits BELOW the statin-discussion thresholds, which is exactly
  why the omission felt defensible — but the point is the trajectory: it has nearly DOUBLED on
  still-modest inputs, driven by the HDL fall, and the conversation that movement should trigger has
  never been framed.
- **Visualization:** the **ASCVD arc gauge** (0–10% with guideline bands <5 low / 5–7.5 borderline /
  7.5%+ intermediate, needle at the 2025 value) + a magnified **trajectory strip** (0–3% detail) where
  the near-doubling 2018→2023→2025 is a visible movement; **drillable input chips** (every PCE input,
  each to its source); two **sensitivity mini-bars** (office-only SBP 122/132/142; fasting-redraw
  TC 188→159 with the 2018 baseline marked).
- **Crunched:** PCE (White male, untreated, non-smoker, non-diabetic, SBP 132): **1.06% → 1.28% →
  2.04%**. SBP sensitivity 1.78 / 2.04 / 2.32%. Fasting-redraw (HDL 40 fixed) 2.04 / 1.88 / 1.70 /
  1.52 / 1.50%. PREVENT 2023 race-free cross-check ~1.6 → 2.4%. Every figure recomputed in
  `ascvd.ts` from the published coefficients (not hand-typed).
- **Drills to:** each input chip → its source statement (age, sex, race, ethnicity, TC, HDL, SBP+home,
  treatment-declined, never-smoker, non-diabetic, eGFR); the 6-caveat list.

### 5. Family loading — `family`  *(the pedigree)*
- **Beat:** The family history is heavily cardiovascular and bilateral — two first-degree relatives
  carry the exact two conditions he is drifting toward, and all four grandparents had a hard
  atherosclerotic event. A guideline-recognized risk enhancer the equations under-weight. Closed
  honestly: whether those grandparent events were *premature* cannot be answered from this export.
- **Visualization:** a **real graphical pedigree** (3 generations; square=male, circle=female,
  slash=deceased, proband arrow+P; affected status shaded inside each symbol as one wedge/band per CV
  condition, color-keyed HTN/HLD/MI/CVA). A per-relative drill row beneath.
- **Crunched:** 8 of 12 family-history facts are cardiovascular; HTN ×2 first-degree (mother, brother),
  hyperlipidemia ×2 first-degree (father, brother), stroke ×2 (maternal grandparents), MI ×2
  (paternal grandparents).
- **Drills to:** each affected relative's family-history statement; an "onset absent everywhere"
  open-flag (null in the table AND blank in every annual note's Age-of-Onset column).

### 6. The 2024 acute work-ups — reassuring, unintegrated — `acute`
- **Beat:** The system reliably worked up his ACUTE symptoms but never folded the reassuring results
  back into the chronic story. Two pieces of genuinely good cardiovascular news — a negative troponin
  and a clean neck CTA showing no atherosclerosis at 41–42 — sit orphaned as imported external orders,
  never acknowledged by the PCP narrative. They argue the chronic risk is still pre-clinical and
  therefore still preventable; the risk discussion should USE them.
- **Visualization:** two **event cards** (5/14/2024 chest pain; 7/30/2024 suspected vertebral
  dissection), each listing the studies done and their plain-language results, with an "unreconciled"
  tag and the verbatim radiology read. A small note that the 7/2/2024 PCP visit, six weeks after the
  chest pain, never mentions it.
- **Crunched:** chest pain → troponin negative + chest x-ray normal + CMP/CBC; dissection scare → neck
  CTA clean (<50% ICA bilaterally, no dissection, no atherosclerosis) + IV fluids. Discrete lab values
  did not survive the import (an honest gap, surfaced not hidden).
- **Drills to:** the troponin-negative statement; the two verbatim radiology reads; the 7/2/2024 PCP
  A/P quote (cervicalgia/concussion only).

### 7. Weight & glycemia — the metabolic driver — `metabolic`
- **Beat:** He is not diabetic and not prediabetic, so dysglycemia isn't a current driver — but the
  steady 13-lb gain is the plausible common cause behind the simultaneous BP, HDL, and triglyceride
  drift toward metabolic syndrome. Weight/lifestyle is the highest-yield, lowest-risk lever, and he
  has shown real engagement (self-funded a CGM) that the visits could harness but didn't.
- **Visualization:** a **weight trend line** (174→187 lb, 2018→2025) with the overweight band marked;
  an **A1c chip pair** (5.4 / 5.5%, both normal); a CGM note (FreeStyle Libre 3, ordered 3/2024,
  marked "not taking" by 12/2025, no glucose data reached the record).
- **Crunched:** weight +13.2 lb; BMI ~24 → 25–26; A1c 5.4→5.5%.
- **Drills to:** the weight series statement; the A1c statements; the CGM note quote.

### 8. Assessment + what a cardiologist would do + open questions/limits — `assessment`
- **Beat:** Close like a consult. (a) **Assessment:** the case in one paragraph — favorable
  fundamentals (negative troponin, clean CTA, normal A1c, clean kidneys = nothing is acutely dangerous
  and nothing is blocking treatment except inertia) but every modifiable lever drifting the wrong way
  and the chart's structure actively hiding it. (b) **What a cardiologist would do:** the 5-step plan
  (confirm BP with home/ABPM + problem-list it; re-open the one-sided "refusal" as a documented shared
  decision; repeat lipids fasting and carry the now-computed ASCVD into the discussion; make the
  weight/lifestyle plan concrete and leverage the CGM engagement; fold the 2024 negative troponin +
  clean CTA in as the reassuring baseline). (c) **Open questions / limits:** the honest unknowns and
  the export's limits.
- **Visualization:** a **clean safety panel** (eGFR >90 ×2, creatinine, potassium, glucose normal —
  "nothing is blocking treatment"); a numbered plan list; an open-questions list with "not in the
  export" tags.
- **Crunched:** the safety labs table; the acute-vs-chronic window figure (6 PCP visits over ~3.3
  years, HTN re-addressed at 0).
- **Drills to:** the safety-lab statements; the plan items reference the sections that motivate them.

---

## Visualizations inventory (reused / adapted components)
- **BP band plot** — bands behind paired sys/dia; office-mean reference line; the one flagged reading.
- **Lab-trend sparklines** — value vs shaded reference range, one per analyte.
- **ASCVD arc gauge + trajectory strip + input chips + sensitivity bars** — `ASCVDView` / `RiskGauge`.
- **Graphical pedigree** — SVG, affected-status wedges, proband marker, descent edges.
- **HTN-thread timeline** — bespoke horizontal event timeline.
- **Weight trend line** — simple line with overweight band.
- **Event cards** — bespoke for the two acute work-ups.
- **Driver board + safety panel** — small bespoke tables.

## The crunched figures the viewmodel must carry (recomputed from substrate)
- BP: per-reading category, mean 132.3, counts (0 normal / 7 at-or-above-Stage-1 / 2 elevated / 1 flagged).
- Lipids: 3 panels × up to 6 analytes with value/ref/flag/fasting; per-analyte trend direction.
- ASCVD: 3 panels' PCE risk (1.06/1.28/2.04), SBP sensitivity, fasting-redraw scenario, PREVENT range.
- Family: 8/12 CV facts; pedigree node set with sex/deceased/affected CV conditions.
- Acute: 2 events with studies + plain results.
- Metabolic: weight series, A1c pair, CGM status.
- HTN coding scorecard: on-problem-list No, encounter-dx count 2, re-addressed 0 of 6, window ~3.3 yr.
