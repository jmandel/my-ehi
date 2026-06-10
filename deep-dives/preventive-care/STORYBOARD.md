# STORYBOARD — *Up to Date?* An independent preventive-care audit

## The tool a domain expert wants

The reader is a **primary-care physician inheriting this patient at his next visit** (and, secondarily, the
patient himself). They have one question that no single Epic screen answers cleanly:

> *Across everything a 43-year-old man should be screened, counseled, and vaccinated for — by name, by
> recommending authority, by date — what is genuinely **done**, what is **due or overdue right now**, what is
> **coming due**, and where does the chart's own bookkeeping **disagree with the guideline**?*

This is **not** a condition course and **not** a claims history. It is a **coverage audit**: a forward-and-
backward sweep where the most valuable content is partly about what is *absent* from the record. The shape
follows the question — a triage of what to act on, a longitudinal picture of how coverage drifted, and an
explicit reconciliation of the EHR's worklist against external authority — not a header→chart skeleton.

## The argument the page makes

Epic already runs a Health Maintenance engine for this patient: 24 tracked topics, a status log
(`HM_HISTORICAL_STATUS`), a forecast engine (`HM_FORECAST_INFO`). So why build anything? Because that engine
is, at the same time, **noisy and incomplete**, and a clinician cannot trust it at a glance:

- **Noisy.** Its worklist is cluttered with travel/childhood items that don't apply to a healthy 43-year-old
  (Yellow Fever, Cholera, Rabies, Japanese Encephalitis, HIB, IPV — `Hidden`/`Aged Out`), and its
  next-due math throws **birthdate artifacts**: "COVID overdue since 1998", "Hep B overdue since 1982",
  "HPV overdue since 1997", "RSV not due until 2057". A human has to mentally discard all of it.
- **Incomplete.** The engine is **silent** on things a guideline-following physician owes this patient:
  a **one-time HIV screen** (USPSTF grade A, 15–65 — never done here), **colorectal screening** coming due
  at 45 (he turns 45 in Oct 2027), and **depression / unhealthy-alcohol** screening as recurring USPSTF
  items rather than one-off questionnaires.

So the dive's argument is: **an independent, guideline-anchored audit both denoises the EHR worklist and
fills its gaps** — and it does so transparently, showing for every measure *which authority says so, what the
rule actually is, what fact in this patient's record decides eligibility, and where our verdict departs from
Epic's.* The payoff is a worklist a physician can actually trust because every line is traceable to both a
patient fact and a cited recommendation.

## The honest finding (what the record actually shows)

The patient is **healthier and more up-to-date than a wall-of-red dashboard would suggest** — which is why the
real story is subtle, and why a thoughtful audit beats a red/green scorecard:

- A **December 2025 PCP visit caught him up**: lipids, A1c/glucose, annual wellness visit all freshly done.
- But coverage **drifted** repeatedly in prior years — diabetes screening oscillated Not-Due↔Overdue, the
  annual wellness visit lapsed and recovered, cholesterol went overdue in 2023 before being redone. The
  longitudinal lanes are the subject, not a single snapshot.
- A few **genuine open or ambiguous items remain**: **HIV** never screened (true gap); **Hepatitis B** never
  completed as an adult (a real gap under ACIP's 2022 universal-adult recommendation); **HPV** in the
  shared-decision 27–45 band (optional, not a failure); **colorectal** not yet eligible but imminent.
- The screens that *were* done **worked**: Hep C antibody **nonreactive (2023)**; A1c **5.5% (2025)**. And one
  carries a signal worth a clinician's eye — the **lipid panel is trending the wrong way** (triglycerides
  88→282 mg/dL, total-chol/HDL ratio 3.1→4.7 across 2018→2025). The audit's job is to say the *screen is
  satisfied*; the abnormal value is a hand-off to care, shown as evidence, not over-interpreted here.

## How we evaluate — the part we actually wrestle with

The intellectual core is the **eligibility-and-status engine**, because "is he due?" is rarely a lookup — it
is a predicate over patient facts, and the authorities don't always agree. We make four moves explicit on the
page for every measure:

1. **Eligibility is computed from real facts, with the deciding fact shown.** Each measure carries a
   population rule (age / sex / risk) and we evaluate it against this patient's data, naming the fact that
   decides it:
   - **AAA** and **lung-cancer** screening resolve to *not applicable* with a documented basis — he is a
     **lifelong never-smoker** (and under 65); we show that fact rather than silently dropping the measure.
   - **Diabetes screening** is the centerpiece of disagreement: **USPSTF** screens adults 35–70 **only if
     overweight/obese (BMI ≥ 25)**; **ADA** screens **all** adults ≥ 35. This patient's BMI **crossed 25 only
     recently** (24.3 in 2018 → 25.8 in 2025), so *USPSTF eligibility itself flips on a single measured
     number*, while ADA would have screened him years earlier. We **show both verdicts side by side** and do
     not pretend there is one answer.

2. **Next-due is recomputed independently**, from the recommended interval and the last real completion — not
   read from Epic. That is what lets us **override the birthdate artifacts** (Epic's "overdue since 1982"
   becomes our "one-time screen, satisfied" or "due now," as the guideline dictates).

3. **Confidence and conditionality are first-class.** When eligibility hinges on a fact the structured record
   doesn't carry (travel plans behind the exotic vaccines; risk factors that would change an interval), the
   verdict is **conditional** — "*recommended if average-risk*", "*applies only with travel exposure*" — never
   a false-precise red flag. Surfacing the unknown is part of the value.

4. **Every verdict is reconciled against Epic**, and the *kind* of disagreement is labeled:
   `agree` · `epic-noise` (birthdate/aged-out artifact we discard) · `epic-missing` (measure we add) ·
   `epic-stale` (status not yet refreshed) · `divergent-eligibility` (authorities differ). The reconciliation
   is itself a finding, not a footnote.

The output per measure is a small, checkable record: **the rule, the cited authority + grade, the patient
facts that drove eligibility (each drillable to its evidence), our verdict (status · last-done · next-due ·
confidence · conditional-on), and the Epic comparison.** Assembling those inputs into a transparent verdict is
the reasoning that makes this a *tool*, not a readout.

## Authorities, cited (sourced beyond this repo)

Every interval, grade, and eligibility rule is **sourced to the primary authority and cited** (body, grade,
title, URL, date retrieved) — carried in the view model as a `guidelines` reference layer, surfaced in the UI
next to each verdict, and drillable like any other evidence:

- **USPSTF** — screenings: HIV (A), Hep C (B), colorectal (A), abnormal glucose/T2DM (B), hypertension (A),
  depression (B), unhealthy alcohol use (B), tobacco (A), lung CA (B, *excluded — never-smoker*), AAA
  (B, *excluded — never-smoker*).
- **CDC / ACIP adult immunization schedule** — influenza, COVID-19, Tdap/Td, Hep B (universal 19–59),
  HPV (shared 27–45), zoster (≥50), pneumococcal (≥50), RSV (≥75), and the travel/risk vaccines.
- **ADA Standards of Care** — diabetes screening (≥35, all adults) — carried specifically to stage the
  USPSTF-vs-ADA divergence.

The two authorities that disagree (USPSTF vs ADA on diabetes) are both shown; we never collapse them.

## The page, top to bottom

1. **The verdict in one breath.** Up-to-date / open-gap / coming-due counts framed by the *independent audit*,
   not Epic's number — with the headline that the EHR worklist was both denoised and extended.
2. **Act now.** The short list a physician would actually order at the next visit (HIV one-time; Hep B adult
   series; confirm depression/alcohol screening cadence), each line citing its authority and the patient fact
   that triggers it.
3. **The coverage lanes (the centerpiece, custom).** One horizontal lane per applicable topic, the band
   colored by status as it changes through calendar time, completion events as drillable markers, and a
   forward projection to the next computed due-date. Reading down the lanes you *see* the drift and exactly
   where today's open gaps are. Topics visibly **age in and age out** as he crosses thresholds.
4. **EHR vs guideline — reconciliation.** The measures where our verdict departs from Epic's, grouped by kind
   (`epic-noise`, `epic-missing`, `divergent-eligibility`), each with one sentence on which is right and why.
   This is where the birthdate artifacts and the diabetes USPSTF/ADA split live.
5. **The immunization record, audited.** Vaccines actually administered (`IMM_ADMIN` — date, product,
   lot) checked against the ACIP adult schedule for a 43-year-old; travel vaccines shown as *risk-based,
   tied to the travel-screening history*, not as failures.
6. **What the data can't answer.** The conditional verdicts and their unknowns — travel exposure behind the
   exotic vaccines, risk factors that would move an interval, the lipid trend handed off to care. The
   limitations surface, they don't hide.

## The structural rule

Every assertion on the page is a **verdict with two citations**: the **patient fact** (drills to an
`IMM_ADMIN` row, a lab result, a vital, a questionnaire) and the **guideline** (drills to the cited
authority). Nothing is stated that cannot be traced both to this record and to a published recommendation.
A section that doesn't help the physician decide *what to do at the next visit* is cut.

## Custom visualization, not the kit

The true structure of `HM_HISTORICAL_STATUS` is a **state machine per topic over time**, so the centerpiece is
a **bespoke compliance-lane chart** (status-band strips with completion markers and a forward due-date
projection), not the generic `Timeline`. The reconciliation view is a **two-column verdict diff** (audit vs
Epic), not a bar chart. Standard kit pieces appear only where they fit (the lipid/A1c result mini-trends shown
as drill evidence use `LabTrend` against reference ranges).

## What "good" looks like here

A physician reads it and says: *"Yes — now I know exactly what to order for this patient, I can see how his
coverage moved over the years, every line cites both his chart and the guideline behind it, and I understand
where the EHR's own worklist was misleading me."*
