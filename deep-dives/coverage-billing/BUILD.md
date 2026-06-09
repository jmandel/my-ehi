# BUILD — coverage-billing

How an analyst rebuilds `viewmodel.json` for this dive **starting from the raw Epic EHI export**
(`db/ehi.sqlite` + `raw/`). Part 1 is the target schema (the contract the app consumes). Part 2 is the
data + abstraction spec: for each slot, the **raw tables / notes** it comes from, the **derivation logic in
words**, the **constraints that bite**, and the **cleaning rules** that take a raw row to the display-clean
target shape. It explains the logic; it does not transcribe the scripts.

The spine of the whole dive is one structural fact about Epic billing: **there are two independent ledgers**,
Professional Billing (PB, `ARPB_TRANSACTIONS`) and Hospital Billing (HB, `HSP_TRANSACTIONS`), and they must
never be summed together. Almost every figure is PB-only; exactly one episode is HB.

---

## PART 1 — The target schema (TypeScript)

```ts
interface ViewModel {
  summary: string;                       // multi-sentence assessment lede
  sections: Section[];                   // the prose spine; each paragraph cites evidence ids
  evidence: Record<string, Evidence>;    // every cite resolves here; quotes live ONLY here

  coverage: Coverage;
  moneyflow: MoneyFlow;
  claims: Claims;
  carc: Carc;
  denial: Denial;
  hb: HbEpisode;
  correspondence: Correspondence;
}

interface Section {
  id: string;
  title: string;
  narrative: { text: string; cites: string[] }[];
}

interface Evidence {
  kind: "fact" | "note";               // "fact" = readable statement of a structured finding; "note" = verbatim quote
  date?: string;                       // human label, e.g. "2018 – 2025", "Dec 1, 2022"
  who?: string;                        // author/source, note kind only
  text?: string;                       // fact kind: the readable statement
  quote?: string;                      // note kind: the verbatim line (PHI-bearing; lives here, nowhere else)
}

interface Coverage {
  payer: string; plan: string; planType: string;
  group: string; subscriber: string; secondaryPayer: string;
  costSharing: {
    officeCopay: string;               // "$0"
    inNetworkCoinsurance: string;      // "10%"
    outNetworkCoinsurance: string;     // "30%"
    note: string;
  };
  src: { coverageId: string };
}

interface MoneyFlow {
  scope: string;
  billedGross: number;                 // PB Σ charges
  voidedDuplicate: number;             // the one voided duplicate charge
  billedNet: number;                   // gross − voided
  segments: { key: "writeoff" | "insurance" | "patient"; label: string; sub: string; amount: number; evidenceId: string }[];
  patientShareNote: string;
  reconciliation: {
    billedNet: number; insurancePaid: number; contractualWriteoff: number; patientOwed: number;
    checksum: number;                  // == billedNet, to the penny
    note: string; aggregationNote: string;
  };
}

interface Claims {
  rows: ClaimRow[];
  totals: { nClaims: number; nPaid: number; nRejected: number; nVoided: number; nAccepted: number };
}
interface ClaimRow {
  claimNo: string;                     // the L-number (INV_NUM)
  date: string; dateIso: string;
  service: string;                     // clean service label
  payer: string;
  nCharges: number;
  billed: number;
  insurancePaid: number | null;        // null = never adjudicated (rejected / interim)
  writeoff: number | null;
  patientOwed: number | null;
  status: string;                      // plain words
  statusKey: "closed" | "rejected" | "voided" | "accepted";
  resubmittedFrom: string | null;      // L-number this rebills, if any
  isDenialSaga: boolean;
  src: { invId: string; icn: string | null };
}

interface Carc {
  scope: string;
  writeoff: { label: string; total: number; rows: CarcRow[] };
  patient:  { label: string; total: number; rows: CarcRow[] };
  basis: string;                       // the NET recipe, stated for the reader
}
interface CarcRow { code: string; plain: string; sub?: string; amount: number; nLines: number }

interface Denial {
  title: string;
  visitDate: string; visitDateIso: string;
  cpt: string; service: string;
  billed: number; finalPaid: number; finalPatientCoinsurance: number; finalWriteoff: number;
  sharedClaimId: string;               // the ICN shared by denial + reversal + rebill
  dxBefore: string; dxAfter: string;
  steps: DenialStep[];
}
interface DenialStep {
  n: number;
  key: "submitted" | "denied" | "voided" | "reversed" | "rebilled" | "paid";
  label: string; date: string; detail: string;
  carc?: { code: string; plain: string } | { code: string; plain: string; amount: number }[];
  money: Partial<{ billed: number; paid: number; voided: number; reversed: number; allowed: number; writeoff: number; coinsurance: number }>;
  tone: "neutral" | "bad" | "action" | "good";
  evidenceId: string;
}

interface HbEpisode {
  label: string; accountClass: string; payer: string;
  status: string; zeroBalanceDate: string;
  charges: { date: string; dateIso: string; service: string; amount: number; src: { txId: string } }[];
  billed: number; writeoff: number; patientDeductible: number; insurancePaid: number;
  note: string;
  emptyShells: number; emptyShellsNote: string;
}

interface Correspondence {
  events: { date: string; dateIso: string; label: string; patientBalance: number; insuranceBalance: number }[];
  note: string;
}
```

---

## PART 2 — The recipe to populate it from raw

### Workflow shape (fan-out)

Eight slots are largely independent and map to parallel agents; the lead assembles them into the schema and
checks the cross-slot invariants. Most slots are **projection** (structured tables → clean rows). Two fields
are **judgment** (read a note, capture one verbatim line). The split:

- **Projection agents (own a slot end-to-end from raw):**
  `coverage`, `moneyflow`, `claims`, `carc`, `hb`, `correspondence`, and the structured scaffold of `denial`.
- **Judgment agents (read raw free-text, emit one quote):** the two `evidence` entries of kind `note` —
  `e_saga_visit` (the progress note for the Dec 1 2022 visit) and `e_saga_corrected` (the `CLM_NOTE` free
  text). Everything else in `evidence` is kind `fact`: a one-paragraph readable restatement of a structured
  finding another slot already computed — authored by the lead, not a quote.
- **Lead assembles** the slots into the `ViewModel`, writes `summary` + `sections` prose (each paragraph
  citing evidence ids), and **checks invariants:**
  1. **PB reconciliation:** `moneyflow.insurancePaid + contractualWriteoff + patientOwed == billedNet`, to the cent.
  2. **CARC nets to the flow:** `carc.writeoff.total == moneyflow.contractualWriteoff` and
     `carc.patient.total == moneyflow.patientOwed`, to the cent. (This is the load-bearing check — see CARC.)
  3. **Two-ledger invariant:** no PB figure includes the HB OT episode, and no HB figure includes a PB row.
  4. **Every cite resolves:** every `cites[]` / `evidenceId` string exists as a key in `evidence`.

### The constraints that bite across every projection slot

- **All amounts are TEXT.** `CAST(... AS REAL)` before any SUM/compare; `ROUND` to cents on output.
- **`ARPB_TRANSACTIONS` ids are TEXT with no `*_DATE_REAL`.** Order by `CAST(TX_ID AS INTEGER)` and
  `CAST(LINE AS INT)` (numeric), never the lexical string. Dates here are display strings like
  `8/9/2018 12:00:00 AM`.
- **Dates → display shape.** Parse `M/D/YYYY [12:00:00 AM]`, drop the meaningless midnight time, emit
  `"Aug 9, 2018"` as `date` and `"2018-08-09"` as a sortable `dateIso` side field. Never surface `12:00:00 AM`.
- **PB vs HB by table, not by flag.** PB = `ARPB_TRANSACTIONS` / `INV_*` / `CL_RMT_*` / `PMT_EOB_*`;
  HB = `HSP_TRANSACTIONS` / `HSP_ACCOUNT` / `HSP_PMT_REMIT_DETAIL`. The L-number invoices (`FILE_INV_NUM LIKE 'L%'`)
  are PB; the HB claim image is keyed off the HAR, so excluding `LIKE 'L%'`-violations keeps the two apart.
- **Dedup is the recurring gotcha.** The same money appears multiple times in the raw — a denial image posted
  twice, a charge re-billed under a new L-number, a CARC line re-counted across retried claims. Each slot below
  states its dedup rule; getting it wrong inflates a "by category" total above the whole it decomposes.

---

### `coverage` — projection

**Source.** `COVERAGE` (the single row) for `GROUP_NAME`, `SUBSCR_OR_SELF_MEM_PAT_ID`, `PAYOR_ID`, `PLAN_ID`,
`COVERAGE_ID`. Payer/plan **names do not ship on `COVERAGE`** — resolve `PAYOR_ID` → `CLARITY_EPM.PAYOR_NAME`
and `PLAN_ID` → `CLARITY_EPP.BENEFIT_PLAN_NAME` (the general "resolve the id against its master file" pattern).
Cost-sharing comes from `SERVICE_BENEFITS` (the eligibility grid, ~510 rows fanned across query headers).

**Logic.** The patient is the subscriber when `SUBSCR_OR_SELF_MEM_PAT_ID` equals the export's single
`PATIENT.PAT_ID` → `subscriber: "Self"`; there is exactly one coverage row and no secondary, so
`secondaryPayer` is the constant "None — single payer across the whole record." For cost-sharing, pick the
richest `SERVICE_BENEFITS` query header (most rows / most service types — these grids are re-pulled over time;
the fullest pull is the usable one), then per `CVG_SVC_TYPE_ID_SERVICE_TYPE_NAME` collapse to one copay + the
in/out-of-network coinsurance percents. The grid is consistent across service types: `$0` office copay, **10%
in-network / 30% out-of-network** coinsurance — `MIN(COINS_PERCENT)` = in-network, `MAX` = out. This 10% is
exactly what materialises downstream as the patient's small coinsurance balances, so it is the right anchor.

**Cleaning.** `coverageId` is a side field under `src`, never display content. `plan`/`planType`/`group` are
short human labels. The deductible and out-of-pocket-max are **not** in the export's eligibility grid — say so
in the assessment, do not invent them.

---

### `moneyflow` — projection (the headline, PB only)

**Source.** Charges from `ARPB_TRANSACTIONS WHERE TX_TYPE_C_NAME='Charge'`. The net split from the **per-claim
remittance** `CL_RMT_CLM_INFO` joined to claims via `FILE_INV_NUM` (the L-number).

**Logic — three lenses, anchor on the right one.** This is the central "reconcile competing aggregations"
decision. Three views of the same PB money exist in the raw and they disagree:
- **(a) per-claim remittance** (`CL_RMT_CLM_INFO`, HB image excluded): charged, insurer-paid, patient-resp.
  The three pieces add to net billed **to the penny** — the authoritative claim-level flow.
- **(b) the charge-anchored match log** (`ARPB_TX_MATCH_HX` joined charge↔partner): its *adjustment* total
  equals (a)'s write-off exactly, but its *payment* total is **gross postings** (credits later shifted onto the
  patient as deductible, plus payments whose matching charge falls outside the export window), so it overstates
  insurer-paid and shows patient ≈ $0. **Do not anchor here.** Its naive ledger "net" (a large negative artifact) is
  an export-window artifact, not a balance.
- **(c) `PMT_EOB_INFO_I`** allowed/paid/ded/coins spans **PB and HB lines together**, so it cannot be the
  PB-only flow.

So: `billedGross` = Σ all PB charges (`4821`); `voidedDuplicate` = Σ charges whose `VOID_DATE` is non-empty
(`315`, the denial-saga charge); `billedNet = billedGross − voidedDuplicate` (`4506`). From the **closed**
claims' remittance (rejected/interim claims have no remittance row), `insurancePaid` = Σ `CLAIM_PAID_AMT`,
`patientOwed` = Σ `PAT_RESP_AMT`; `contractualWriteoff` = `billedNet − insurancePaid − patientOwed` (the
residual, which by construction equals the match-log adjustment). The three segments must sum to `billedNet`.

**Constraints.** Exclude the HB OT claim from the per-claim sum (it lives in `HSP_*`, not `CL_RMT_CLM_INFO`'s
L-number space). Dedup the duplicate denial image before summing (see CARC dedup rule — though for the closed
claims only the final adjudication survives). Treat a missing/blank `PAT_RESP_AMT` as `0`.

**Cleaning.** `segments[].amount` rounded to cents; `reconciliation.checksum` must equal `billedNet`. The
`aggregationNote` states plainly that the match-log gross "payment" figure is not used — this honesty
is part of the slot, since the raw ledger actively misleads here.

---

### `claims` — projection (the per-claim table)

**Source.** `INV_BASIC_INFO` (one row per claim submission, 22 rows) for `INV_NUM` (the L-number),
`INV_ID`, `INV_STATUS_C_NAME`, `FILING_ORDER_C_NAME`, `CLM_ACCEPT_DT`. Billed = the charges the claim carries:
`INV_TX_PIECES` (`INV_ID → TX_ID`) joined to `ARPB_TRANSACTIONS` for `AMOUNT` (authoritative billed), counted
distinct per `TX_ID`. Adjudication outcome = `CL_RMT_CLM_INFO` keyed by `FILE_INV_NUM = INV_NUM`.

**Logic.** Per claim: `nCharges` = COUNT(DISTINCT `TX_ID`); `billed` = Σ charge `AMOUNT`. Join the remittance,
**deduped by distinct image content** `(status, charged, paid, patresp, ICN)` per L-number — this collapses the
denial image that posts twice (e.g. the saga's first claim) so a rejection isn't double-shown. A **Rejected**
claim has **no** remittance row at all → leave `insurancePaid/writeoff/patientOwed` as `null` (billed-only, never
paid); do not coerce to `0` (that would falsely imply it adjudicated). For a paid claim,
`writeoff = charged − paid − patientOwed`.

**Status & rebill pairing.** Map `INV_STATUS_C_NAME` to plain words: Closed→"Paid & closed",
Rejected→"Rejected (never paid)", Voided→"Voided (denied, then corrected)", Accepted→"Accepted (interim)";
keep the lowercased raw as `statusKey`. `resubmittedFrom` links each rebill to the original L-number it
re-files: a rejected/voided claim is quietly resubmitted under a **new** L-number carrying the **same charges**
— detect by matching the charge `TX_ID` set (or, for the void saga, the `ARPB_TX_VOID` old→reposted link)
across two invoices. `isDenialSaga` flags the three saga invoices.

**Cleaning.** `claimNo` is the human-facing L-number. `service` is a clean label for the claim's charges
(resolve each charge `PROC_ID → CLARITY_EAP.PROC_NAME`, then map the raw Epic proc string to a short human
phrase — e.g. an "office/outpatient established" proc → "Office visit (established)", a venipuncture →
"Blood draw"; a multi-charge claim gets a combined label like "Lipid panel + blood draw"). Dates parsed to
`"Aug 9, 2018"` + `dateIso`. `invId`/`icn` are side fields under `src`. Sort by `dateIso`, then `claimNo`.

> Note on service dates: `INV_BASIC_INFO` carries claim/accept dates, not the clinical service date. The
> service date for each claim's display row comes from the **service date of the charge(s)** it carries
> (`ARPB_TRANSACTIONS.SERVICE_DATE` for the `TX_ID`s in `INV_TX_PIECES`), formatted as above.

---

### `carc` — projection (where the money went, by reason — the NET recipe)

This is the slot with the sharpest trap, and the one the part-cannot-exceed-the-whole rule exists for.

**Source.** Service-line adjustment reasons `CL_RMT_SVC_LVL_ADJ` (`SVC_ADJ_REASON_CD` = the CARC, `SVC_ADJ_AMT`
= the dollars, `SVC_CAS_GRP_CODE_C_NAME` = the ANSI group CO/PR), joined to the claim image header
`CL_RMT_CLM_INFO` (`IMAGE_ID`, `FILE_INV_NUM`, `CLM_STAT_CD_C_NAME`).

**Logic — the NET recipe (must reconcile to `moneyflow`).** A naive "Σ every CARC line, grouped by reason"
**double-counts**: the export keeps the denial image, the reversal image, and the rebill image for the same
charge, so code-45 alone balloons to a gross figure several times the net actually written off.
That gross figure is *rebilling churn re-counted*, not money written off twice. To get each claim's **final
adjudication only:**
1. Keep PB images: `FILE_INV_NUM LIKE 'L%'` (this excludes the HB OT remittance, which is keyed off the HAR).
2. Keep only **Processed-as-Primary** images (the final, primary adjudication state in `CLM_STAT_CD_C_NAME`) —
   drops the Denied and Reversal cycles.
3. **Dedup to one image per claim:** for each `FILE_INV_NUM`, keep `MIN(IMAGE_ID)` (the single surviving
   adjudication), so a claim that re-imaged isn't summed twice.
4. Group the surviving service-line adjustments by `(SVC_ADJ_REASON_CD, SVC_CAS_GRP_CODE_C_NAME)` and sum
   `SVC_ADJ_AMT`, counting lines.

Split the grouped reasons into the two buckets by ANSI group: **Contractual Obligation (CO)** → `writeoff`,
**Patient Responsibility (PR)** → `patient`. The result: write-off code **45** (above allowed) dominates with
two small bundling codes (**97**, **234**); patient splits into deductible (**1**) and coinsurance (**2**).
The two bucket totals must equal `moneyflow.contractualWriteoff` and `moneyflow.patientOwed` **to the penny** —
that equality is the proof the dedup was done right. If they don't match, the gross churn leaked in.

**Cleaning.** Each row is `{ code, plain, amount, nLines }`. `plain` is the human gloss of the CARC, parsed
from the code, **not** the raw Epic string (`45-CHGS EXCD FEE SCH/MAX ALLOWABLE.` → "Above the plan's allowed
amount"); keep a small code→phrase map. `basis` states the recipe for the reader (Processed-as-Primary, deduped
per invoice, denial/reversal cycles dropped, HB kept separate).

---

### `denial` — projection scaffold + two judgment quotes (the void→reverse→repost→rebill saga)

One office visit (CPT 99214, Dec 1 2022) denied and rebuilt. The structured states are projection; two of
the evidence cites are judgment.

**Source (structured).** The void record `ARPB_TX_VOID` (`OLD_ETR_ID`/`REPOSTED_ETR_ID` link the original
charge to its repost; `REPOST_TYPE_C_NAME` = "Correction"; `DEL_CHARGE_USER_ID_NAME`/`DEL_REVERSE_DATE` = who/
when). The two charges `ARPB_TRANSACTIONS` (original carries `VOID_DATE`; repost carries `REPOST_ETR_ID` back to
the original). The three invoices `INV_BASIC_INFO` (`L1007201490` voided → `L1007233830` accepted →
`L1007233831` closed). The 835 images `CL_RMT_CLM_INFO` (the **Denied** image posts twice with reason 16, then a
**Reversal of previous payment**, then the rebill's **Processed** payment) — all three share one ICN
(`sharedClaimId`). The service-line reasons `CL_RMT_SVC_LVL_ADJ` per image (16 = denial cause; on the rebill,
45 = the contractual write-off and 2 = the coinsurance). The final EOB amounts `PMT_EOB_INFO_I` matched to the
reposted charge (the allowed and paid amounts). The **diagnosis change** — the actual fix —
`ARPB_CHG_ENTRY_DX` (`TX_ID → DX_ID`) resolved through `CLARITY_EDG.DX_NAME`: the voided charge carried a single
vague code; the reposted charge carries a specific concussion dx + an external-cause code + nausea.

**Logic.** Assemble the six states in order (submitted → denied → voided → reversed → rebilled → paid), each
with its plain `detail`, `money` deltas, `tone`, and the CARC where one applies. `dxBefore`/`dxAfter` summarise
the diagnosis upgrade in words (the "missing information" reason-16 was pointing at). The reconciliation here
is internal: allowed = paid + coinsurance; billed − allowed = write-off.

**Judgment (the two `note` quotes).**
- `e_saga_visit` — **the progress note for the Dec 1 2022 encounter.** Read the visit note from
  `raw/Rich Text/*.RTF` (via `lib/rtf2txt.ts`; the note master is `HNO_*`, the note's CSN ties it to the visit
  whose charge is the `99214` office visit). **Rubric:** capture the single opening line a skeptic would demand to
  confirm the visit was real and routine — the one-sentence reason-for-visit with author and date. Reference it
  as `e_saga_visit` (who: the visit's attending; date: Dec 1 2022); the verbatim line lives in `evidence`, not
  in `denial`. Describe, don't widen the quote — it is a brief clinical reason-for-visit, no other PHI.
- `e_saga_corrected` — **the "CORRECTED CLAIM" free text.** `CLM_NOTE.CLM_NOTE` joined to its invoice via
  `CLM_VALUES` (`RECORD_ID → INV_NUM`). **Rubric:** this is the only free-text claim note in the entire export;
  quote it verbatim as the single tell that the rebill was a deliberate correction. Reference as
  `e_saga_corrected`.

The other saga cites (`e_saga_denied`, `e_saga_void`, `e_saga_reversal`, `e_saga_dx_fix`, `e_saga_paid`) are
kind `fact`: readable restatements of the structured states above, authored by the lead — not quotes.

---

### `hb` — projection (the one Hospital-Billing episode, kept separate)

**Source.** `HSP_ACCOUNT` (the one real HAR with transactions; the other three rows are empty shells — confirm
by `n_transactions = 0` via a correlated count into `HSP_TRANSACTIONS`). Charges from
`HSP_TRANSACTIONS WHERE TX_TYPE_HA_C_NAME='Charge'` (OT eval + two self-care sessions, Mar 2022). The split
from the 835 detail `HSP_PMT_REMIT_DETAIL` (`DTL_GRP_CODE_C_NAME` = the ANSI group, `DTL_REMIT_AMT`).

**Logic.** `billed` = `HSP_ACCOUNT.TOT_CHGS` (= Σ HB charges). From the remittance detail, group by
ANSI group: **Patient Responsibility** → `patientDeductible` (the entire allowed amount landed on the
deductible); **Contractual Obligation** → `writeoff`. `insurancePaid = billed − writeoff −
patientDeductible` (here 0 — deductible not yet met, so the insurer paid nothing). **Constraint:** exclude the one
negative "excess of charges" reversal line (`DTL_REMIT_AMT < 0`) from the rollup so it doesn't deflate the
write-off. The account closed at $0 (`ACCT_ZERO_BAL_DT`).

**Cleaning.** `accountClass` = "Therapies Series" (from `ACCT_CLASS_HA_C_NAME`). Each charge's `service` is a
clean OT label from `PROCEDURE_DESC` (e.g. "OT — evaluation", "OT — self-care training"); `txId` is a side
field. `emptyShells` = 3 with a note that empty HAR shells are an Epic artifact, not care. **Invariant:** none
of these dollars touch any PB slot.

---

### `correspondence` — projection (the human-facing money trail)

**Source.** `ACCOUNT_CONTACT` (the guarantor follow-up log, keyed `(ACCOUNT_ID, LINE, CONTACT_DATE)`):
`LETTER_NAME` / `FOL_UP_NOTE` / `LETTER_SUMMARY` are the free text, `FOL_UP_CUR_PAT_BAL` /
`FOL_UP_CUR_INS_BAL` the balances at the time. (`HSP_ACCT_LETTERS` records the HB letters but their bodies live
in Media and aren't needed for the events.)

**Logic.** Keep only rows carrying a meaningful follow-up note; drop registration noise and bare work-queue
chatter (`^From Registration`, `^WQ `). Map the surviving free text to a clean event `label`: a "small balance
letter" note → "Small-balance letter sent"; a "need insurance information / no insurance listed" note →
"'No insurance on file' letter sent"; a co-ins note → "Coinsurance balance flagged"; a refer-to-financial-
services note → "Account referred to financial services"; a statement-run note → "Patient statement generated".
The whole trail is sparse: a small coinsurance balance (Oct 2022) and a "no insurance on file" notice
(Jan 2025).

**Cleaning.** `CAST(LINE AS INT)` to order. Dates → `"Oct 6, 2022"` + `dateIso`. Balances `CAST` to numbers.
Never surface the raw `LETTER_NAME`/note string — map it to the clean label. These notes are administrative
billing text, not clinical; still, emit only the mapped label, no raw free text.

---

### `evidence` — the cite map (mostly `fact`, two `note`)

Every `cites[]` / `evidenceId` across the slots resolves here. **Kind `fact`** (the majority): a single clean
paragraph restating a structured finding the projection already computed (e.g. `e_moneyflow_split`,
`e_carc_45`, `e_hb_split`) — authored by the lead from the numbers above, carrying no raw rows. **Kind `note`**
(exactly two): the verbatim quotes `e_saga_visit` and `e_saga_corrected` produced by the judgment agents above.
The quote text lives **only** here; slots reference it by id.

---

## One way to run it

A runnable implementation of this recipe is kept under this dive's `scripts/` + `parts/` (per-slot extractors
off the raw tables → a projector that applies the cleaning → an assembler that splices the parts into
`viewmodel.json` and validates that every cite resolves). It is *one* incidental implementation; the recipe
above is the source of truth and stands on its own from the raw export. To change a number or label, edit the
relevant part/script and re-assemble — never hand-edit `viewmodel.json`.
