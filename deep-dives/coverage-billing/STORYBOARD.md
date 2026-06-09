# Coverage & billing deep dive — storyboard (the view designed first)

**Patient:** MANDEL, JOSHUA C — single-payer commercial billing history, 2018–2025.
**The argument the whole page makes:** this is a clean, well-behaved insured ledger that reconciles
to the penny, and the single most instructive thing in it is *not* a number but a process — one
December 2022 office visit that Blue Cross denied for "missing information," which the clinic walked
through a textbook **void → reverse → repost → rebill** correction (fixing a vague diagnosis into a
specific one) until it paid. The headline economics are quietly radical — over half the sticker price
is fictional, erased as contractual write-off the patient never sees, and the patient's true share is
about 14% — but the *story* is the denial state machine, and the page is built to make a billing
analyst trust every dollar before it tells that story.

**The tool a billing analyst would want:** not an infographic. A page that (1) states the four-step
machine every charge runs through and pins down the one insurer and its cost-sharing rule, (2) settles
the money on a single honest anchor — the per-claim remittance — and shows where the gross/raw ledger
*lies* (the famous −$10,205 net is a window artifact, not a balance), (3) lays out the full per-claim
ledger so the analyst can scan all 22 submissions, see which never paid, and watch each rejected one
get quietly rebilled, (4) opens the **denial saga** as a real state machine over a single claim, with
the diagnosis fix that actually unstuck it, (5) treats the one hospital-billing episode on its own so
the two billing systems are never double-counted, (6) shows the sparse patient-facing friction, and
(7) closes with an analyst's assessment and an honest list of what the export cannot answer.

**Structural rule:** the app imports ONLY `viewmodel.json` (`import vm from "./viewmodel.json"`). Every
value in it is already display-clean (dates "Dec 1, 2022", money pre-summed, CARC codes carried with a
plain-English gloss — code 45 → "Above the plan's allowed amount" — never a raw `_C_NAME` or a midnight
timestamp; invoice/ICN/TX ids live only in `src` side-fields). Every claim cites an `evidenceId` that
resolves, in a drawer, to a clean note **quote** (with author + date) or a readable **statement** of a
structured billing fact — never a raw Clarity row. Figures are crunched in the projection (deduped,
netted, reconciled), so the views render numbers, they do not derive them. This dive HAS a projection
pipeline, so the anti-drift rule applies: `parts/*.json` is the editable source and `viewmodel.json` is
the *assembled* output (`scripts/assemble-viewmodel.ts`) — to change a number or a sentence, edit the
part and re-assemble; the view model is never hand-edited. The BUILD record carries the per-slot recipe
(and verifies the one note quote — the progress-note opener — against the export's Rich-Text payload).

---

## Section order, beat by beat

Each section lists: **narrative beat** · **visualization(s)** · **crunched figures/tables** ·
**evidence it drills to**. Section ids match `viewmodel.sections[].id`; the app renders them in the
order `machine → totals → claims → denial → hb → friction → assessment`.

### 0. Header — coverage card + headline figures *(not a `sections[]` entry)*
- **Beat:** Orient the analyst before any narrative. State the patient, the single payer, the window,
  and the four headline dollars that the whole page will defend.
- **Visualization:** a **coverage card** (payer, plan, type, employer group, subscriber, $0 copay /
  10% coinsurance, "no secondary") beside a **four-figure headline strip** (net billed, write-off,
  insurance paid, patient share).
- **Crunched:** net billed **$4,506** (29 charges less one $315 voided duplicate); write-off
  **$2,343.69**; insurance paid **$1,530.44**; patient share **$631.87** (≈14%).
- **Drills to:** `e_coverage` + `e_cost_sharing` (coverage card); `e_billed_net`, `e_moneyflow_split`,
  `e_patient_share` (the four figures).

### 1. How a visit becomes money — `machine`
- **Beat:** The mental model the rest of the page assumes. Every line runs the same four steps:
  charge at sticker price → bundled into a claim → adjudicated against the fee schedule → remittance
  splits it three ways (insurer-paid, patient-responsibility, contractual write-off). One insurer
  drives the whole record; the 10% in-network coinsurance is literally visible in the downstream math.
  And money flows through **two** billing systems (professional and hospital) that must be kept apart
  to avoid double-counting.
- **Visualization:** prose only — this section is the conceptual frame; the figures live downstream.
- **Crunched:** the PB/HB split as a stated fact (29 professional charges / $4,821; one real hospital
  episode / $1,638.82; three empty hospital shells).
- **Drills to:** `e_machine_overview`, `e_coverage`, `e_cost_sharing`, `e_pb_hb_split`.

### 2. Where the money went — `totals`  *(the reconciliation)*
- **Beat:** Settle the money on one honest anchor and prove it sums. The single largest destination of
  the sticker price is not payment — it is the write-off; the list price is largely fictional and the
  allowed amount governs. Then the crucial honesty move: the raw transaction-match log shows a bigger
  "payment" ($2,162.31) and a $0 patient share, and the raw ledger "net" reads −$10,205 — both are
  window/gross artifacts, not balances. The per-claim remittance is the anchor; it reconciles exactly.
- **Visualization:** a custom **money-disposition flow** — one net-billed source block fans through
  scaled ribbons into three stacked destinations (write-off / insurer / patient), widths to scale,
  each with its share-of-billed. Below it, the **CARC reason ledger** — two grouped bar lists
  (contractual write-off, patient responsibility) by reason code.
- **Crunched figures (recomputed, reconciled):** $2,343.69 + $1,530.44 + $631.87 = **$4,506** to the
  penny. By reason: code **45** "above the allowed amount" **$2,247.69 / 26 lines** (essentially the
  whole write-off), codes 97 and 234 at $48 each; patient = code **1** deductible **$604.16 / 5 lines**
  + code **2** coinsurance **$27.71 / 4 lines**. An explicit gross-vs-net note: summing every remittance
  line instead would inflate code 45 to a **gross $8,663.69** — that excess is rebilling churn
  re-counted, not money written off twice.
- **Drills to:** `e_moneyflow_split`, `e_carc_45`, `e_patient_share`, and `e_reconcile_artifact` (the
  why-the-raw-ledger-misleads statement).

### 3. The claims, one by one — `claims`  *(the full ledger)*
- **Beat:** Show the complete record, not a chosen slice. 22 submissions over 21 invoices; 17 paid and
  closed, the rest the interesting ones. The four that did not pay on the first try share a pattern —
  a rejection or denial followed by a quiet resubmission under a new claim number carrying the same
  charges — and every underlying service was legitimate and eventually paid.
- **Visualization:** a custom **per-claim ledger table** — date, service, billed, insurer paid,
  patient, a **mini split-bar** (write-off | insurer | patient, proportional to billed), and a status
  dot. Never-paid rows are dimmed; resubmissions carry a **"rebilled from <date>"** badge pointing at
  the claim that did pay; the four December-2022 saga rows are shaded with a "denial saga ↓" jump.
- **Crunched:** status chips (17 paid & closed / 3 rejected / 1 voided / 1 interim-accepted); per-row
  billed/insurer/patient with the resubmission lineage in `resubmittedFrom`.
- **Drills to:** `e_claim_counts`, `e_rebill_pattern`.

### 4. Anatomy of a denial — the $315 office visit — `denial`  *(the centerpiece)*
- **Beat:** This is the page. A real, routine post-concussion office visit (CPT 99214, $315) was
  denied for *specificity*, not for being unnecessary, and the clinic ran a clean, auditable correction
  to recover it in full. The patient paid nothing extra — the denial cost staff time, three claim
  submissions, and a manual void, not patient dollars. What actually fixed it was the diagnosis.
- **Visualization:** a bespoke **denial state machine** — six laned steps down a colored rail
  (Filed → Denied → Void + repost → Payment reversed → Rebilled → Paid), each with a tone-tagged
  header, a date, **money chips** (billed / paid / voided −$315 / reversed −$315 / allowed / write-off
  / coinsurance), and **CARC chips** (the red CARC 16 at denial; CARC 45 + CARC 2 at payment). Beneath
  it a **before → after diagnosis box** contrasting the vague code with the corrected, specific set.
- **Crunched:** the final adjudication on the rebill — billed $315, allowed $198.91, write-off $116.09
  (CARC 45), patient coinsurance $19.89 (CARC 2), insurer paid $179.02 — on the shared claim id
  2022341BT5497.
- **Drills to:** `e_saga_visit` (the verbatim progress-note opener), `e_saga_denied`, `e_saga_void`,
  `e_saga_reversal`, `e_saga_corrected` (the verbatim "CORRECTED CLAIM" note — the only such note in
  the export), `e_saga_dx_fix`, `e_saga_paid`.

### 5. The hospital-billing episode — occupational therapy — `hb`  *(kept separate)*
- **Beat:** Set apart from the clinic ledger so it can never double-count: the patient's single most
  expensive event, a March 2022 OT series, and the cleanest illustration of the deductible in the whole
  record. It is *not* a radiology account; the other three hospital shells are empty Epic artifacts.
- **Visualization:** a bespoke **HB episode panel** — the three OT charges listed and totaled on the
  left, and on the right a **split bar + rows** showing how Blue Cross divided the $1,638.82 (write-off
  vs. applied-to-deductible) with insurer-paid pinned at $0.
- **Crunched:** billed $1,638.82; write-off $1,084.55; entire $554.27 allowed amount applied to the
  deductible; insurer paid $0; account closed at $0 on May 11, 2022 — the patient's largest single
  out-of-pocket across both systems.
- **Drills to:** `e_hb_episode`, `e_hb_split`.

### 6. What the patient actually saw — `friction`
- **Beat:** For all the machinery, the human-facing money trail is sparse — two letters in eight years.
  The point is proportion: the system's complexity was almost entirely invisible to the patient.
- **Visualization:** two **letter cards** — the Oct 2022 $7.82 small-balance letter (the 10%
  coinsurance again) and the Jan 2025 "no insurance on file" notice against a $237 balance (a momentary
  attach gap, not a real coverage loss).
- **Crunched:** the correspondence events with their patient/insurance balances.
- **Drills to:** `e_correspondence`.

### 7. Assessment — `assessment`
- **Beat:** Close like an analyst's memo. (a) **Assessment:** a healthy account — one payer, no COB
  tangle, a consistent rule, every claim reconciled, zero balance, modest exposure entirely explained
  by plan design. (b) **The one lesson:** procedural, not financial — a single under-coded diagnosis
  can stall an otherwise clean claim, and the void-reverse-rebill correction, when it works, is
  invisible to the patient. (c) **What the export cannot answer:** why the raw ledger net is an
  artifact and must not be read as a balance; that the export carries what the plan *assigned*, not
  what was *collected* (check/card/HSA unknown); and that the eligibility grid shows the coinsurance
  rule but not the deductible or out-of-pocket max, so the year-to-year deductible math can be inferred
  but not fully reconstructed.
- **Visualization:** prose only — the closing argument and the honest limits.
- **Drills to:** `e_moneyflow_split`, `e_hb_split`, `e_saga_dx_fix`, `e_saga_paid`,
  `e_reconcile_artifact`, `e_cost_sharing`, `e_patient_share`.

---

## Visualizations inventory (custom-built for this dive)
- **Money-disposition flow** — bespoke SVG; one source block, scaled ribbons, three stacked
  destinations (the reconciled three-way split). *(`MoneyFlow`)*
- **CARC reason ledger** — bespoke grouped bar lists by reason code, write-off vs. patient. *(`CarcLedger`)*
- **Per-claim ledger table** — bespoke table with mini three-segment split-bars, dim/rebilled/saga
  row states. *(`ClaimsTable` + `SplitBar`)*
- **Denial state machine** — bespoke laned timeline with money chips, CARC chips, and a before→after
  diagnosis box. *The centerpiece.* *(`DenialSaga`)*
- **HB OT episode panel** — bespoke charge list + disposition split bar. *(`HbEpisode`)*
- **Letter cards** — bespoke small cards for the two pieces of correspondence. *(`Correspondence`)*
- **Coverage card + headline figures** — bespoke header tiles. *(`CoverageCard` + `HeadlineFigs`)*

## The crunched figures the viewmodel must carry (recomputed from substrate)
- Money flow: billedGross 4821, voidedDuplicate 315, billedNet 4506; write-off 2343.69 / insurer
  1530.44 / patient 631.87, with a checksum back to 4506.
- CARC net-by-reason: write-off {45: 2247.69/26, 97: 48/1, 234: 48/1}; patient {1: 604.16/5, 2:
  27.71/4}; plus the gross $8,663.69 contrast for code 45.
- Claims: 22 rows with billed/insurer/write-off/patient, status key, and resubmission lineage; totals
  17/3/1/1.
- Denial saga: 6 steps with money + CARC chips; before/after diagnosis; final adjudication
  179.02/116.09/19.89.
- HB: 3 OT charges, billed 1638.82, write-off 1084.55, deductible 554.27, insurer 0; 3 empty shells.
- Correspondence: 5 events; the two patient-facing letters surfaced.
