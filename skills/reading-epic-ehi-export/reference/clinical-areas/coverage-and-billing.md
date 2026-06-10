# Coverage & billing — Epic EHI field guide

**Scope.** The money side of the chart: insurance coverage and eligibility, the charge/payment/adjustment
ledger, claims, EOBs (835 remittance), claim-status tracking, guarantor accounts, and the void/reverse/
rebill saga. Epic Resolute splits this into two parallel worlds — **Professional Billing (PB)** and
**Hospital Billing (HB)** — that you must keep straight.

**Where it sits.** Every charge carries a `PAT_ENC_CSN_ID` back to the encounter (§2) and an
`ACCOUNT_ID`/`COVERAGE_ID` to the guarantor and payer. The patient is reached via the guarantor bridge
`ACCT_GUAR_PAT_INFO.PAT_ID` and via the charge's CSN → `PAT_ENC.PAT_ID`. There is no `PAT_ID` column on
`ACCOUNT`, `ARPB_TRANSACTIONS`, or `INVOICE`.

## Tables

### Professional Billing (PB / ETR master file) — the spine here
| table | role | rows in specimen | notes |
|---|---|---|---|
| `ARPB_TRANSACTIONS` (+`2`,+`3`) | PB ledger. One row per Charge/Payment/Adjustment. | 151 | The PB spine. `2`/`3` are 1:1 supplements (§6) — same 151 `TX_ID`s. `ARPB_TX_MODERATE` is a 4th 1:1 wide companion. |
| `ARPB_VISITS` | PB visit = the per-encounter PB account (a HAR). Grouping level between CSN and invoices. | 20 | `PB_VISIT_ID`, `PRIM_ENC_CSN_ID`, `GUARANTOR_ID`, `COVERAGE_ID`, `PB_TOTAL_*`, `FIRST_PB_CHG_TX_ID`. |
| `ARPB_TX_MATCH_HX` | Match ledger: each charge↔payment / charge↔adjustment settlement. | 247 | Symmetric **and** references TXs outside the export (see gotcha 4). |
| `ARPB_TX_VOID` | Void/repost chain. | 2 | `TX_ID`/`OLD_ETR_ID`/`REPOSTED_ETR_ID`, `VOID_REASON_C_NAME`, `DEL_REVERSE_DATE`. |
| `ARPB_CHG_ENTRY_DX` | Line-numbered diagnoses per charge. | 62 | `(TX_ID, LINE) → DX_ID` (§7). |
| `ARPB_TX_ACTIONS`, `ARPB_TX_CHG_REV_HX`, `ARPB_TX_STMCLAIMHX`, `ARPB_TX_MODIFIERS`, `ARPB_AUTH_INFO` | Per-TX action log, charge-review history, statement/claim history, CPT modifiers, auth refs. | 59/78/40/14/6 | Satellites of the PB ledger keyed by `TX_ID`. |

### Invoices / claims (INV master)
| table | role | rows | notes |
|---|---|---|---|
| `INVOICE` | The claim container (INV master). | 21 | `INVOICE_ID` is the INV key; `PB_HOSP_ACT_ID` → the PB visit/HAR; `ACCOUNT_ID` → guarantor. |
| `INV_BASIC_INFO` | One row per claim submission. | 22 | `INV_ID`(=`INVOICE_ID`), `INV_NUM` (the L-number), `INV_STATUS_C_NAME`, `CLM_ID`, `FILING_ORDER_C_NAME`, `CLM_ACCEPT_DT`. |
| `INV_TX_PIECES` | Maps invoice → its charge TXs. | 34 | `INV_ID → TX_ID` with `LINE`. |
| `INV_NUM_TX_PIECES`, `INV_CLM_LN_ADDL`, `INV_DX_INFO`, `INV_PMT_RECOUP`, `INV_CLM_ICN`, `INV_NDC_INFO` | Alt charge-piece map, claim-line detail, claim diagnoses, payment recoupment, ICN, NDC. | 35/35/49/56/1/1 | Claim-line satellites. |

### Claim image (the transmitted 837)
| table | role | rows | notes |
|---|---|---|---|
| `CLM_VALUE_RECORD` | Claim-image header. | 20 | `RECORD_ID`, `CLM_TYP_C_NAME` (CMS Claim vs UB Claim), `FORM_TYP_C_NAME` (Electronic/Paper), `CLAIM_RECON_ID`. |
| `CLM_VALUES` (+`2`..`5`) | Wide near-EAV snapshot of every 837 field. | 20 ea | `INV_NUM` (→ invoice), `ICN` (→ remittance/EOB), `BIL_PROV_NPI`, `TTL_CHG_AMT`. |
| `CLM_DX`, `CLM_OTHER_DXS`, `CLM_NOTE`, `CLM_STAT_DETAILS`, `CLM_INJURY_DESC`, `CLM_ALL` | Claim diagnoses, other dx, free-text claim notes, status detail. | 46/5/16/25/2/2 | `CLM_NOTE.RECORD_ID` → `CLM_VALUE_RECORD`. |
| `CLAIM_INFO`/`INFO2`/`INFO3`/`INFO_3` | More claim-image supplements. | 2 ea | Sparse here. |

### EOB / remittance (835)
| table | role | rows | notes |
|---|---|---|---|
| `PMT_EOB_INFO_I` | EOB lines: payment → matched charge, with CVD/DED/COINS/PAID split. | 87 | `TX_ID`=payment, `PEOB_MTCH_CHG_TX_ID`=charge, `ICN`, `INVOICE_NUM`, amounts. |
| `PMT_EOB_INFO_II` | CARC reason codes + ANSI group code per EOB line. | 111 | `EOB_CODES`, `WINNINGRMC_ID_REMIT_CODE_NAME`, `PEOB_EOB_GRPCODE_C_NAME`. |
| `CL_RMT_CLM_INFO` | Parsed 835 claim header per remittance image. | 24 | `IMAGE_ID`, `INV_NO`/`FILE_INV_NUM`, `CLM_STAT_CD_C_NAME` (Processed/Denied/Reversal), `ICN_NO`, amounts. |
| `CL_RMT_SVCE_LN_INF` | 835 service line → back to the charge TX. | 40 | `SVC_LINE_CHG_PB_ID`→`ARPB_TRANSACTIONS.TX_ID`, `SVC_LINE_CHG_HB_ID`→`HSP_TRANSACTIONS.TX_ID`, `PROC_IDENTIFIER` (`HC:99213:95`). |
| `CL_RMT_SVC_LVL_ADJ`, `CL_RMT_SVC_AMT_INF`, `CL_RMT_SVC_DAT_INF`, `CL_RMT_HC_RMK_CODE`, `CL_RMT_CLM_ENTITY`, `CL_RMT_PRV_SUM_INF`, … | CAS adjustment codes, service amounts/dates, remark codes, entities, provider summary. | 52/34/40/5/68/24 | CAS keyed `(IMAGE_ID, SERVICE_LINE)`. |
| `ARPB_PMT_RELATED_DENIALS` | Denial linkage on payments. | 8 | |

### Claim-status reconciliation (277/277CA feed)
| table | role | rows | notes |
|---|---|---|---|
| `RECONCILE_CLM` | One row per tracked claim. | 22 | `CLAIM_REC_ID`, `CLAIM_INVOICE_NUM`, `EPIC_CLM_STS_C_NAME`, `CUR_EPIC_STATUS_C_NAME`, `TOTAL_BILLED`. |
| `RECONCILE_CLAIM_STATUS` | Over-time X12 status events. | 119 | `CLAIM_RECON_ID`(=`CLAIM_REC_ID`), `CONTACT_DATE_REAL`, `CLM_CAT_CODE_C_NAME`, `CLM_STAT_CODE_C_NAME`, `CLM_STATUS_MSG`. |
| `RECONCILE_CLM_OT` | Dense status-over-time feed. | 147 | Wider sibling of the status feed. |

### Guarantor account (EAR master)
| table | role | rows | notes |
|---|---|---|---|
| `ACCOUNT` (+`2`,+`3`) | Guarantor accounts. PB balances + bolted-on `HB_*`/`SBO_HSP_ACCOUNT_ID` (Single Billing Office). | 2 | `ACCOUNT_TYPE_C_NAME`, `TOTAL_BALANCE`, `INSURANCE_BALANCE`, `PATIENT_BALANCE`, `HB_BALANCE`. No `PAT_ID`. |
| `ACCT_GUAR_PAT_INFO` | **Guarantor → patient bridge.** | 3 | `(ACCOUNT_ID, LINE) → PAT_ID`, `GUAR_REL_TO_PAT_C_NAME` (Self/Father/…). |
| `ACCOUNT_CONTACT` (+`2`) | Per-account follow-up / correspondence log. | 34 | `(ACCOUNT_ID, LINE, CONTACT_DATE)`; `LETTER_NAME`, `LETTER_SUMMARY`, `NOTE_ID`, `FOL_UP_NOTE`, `REFUND_REQ_*`. |

### Coverage & benefits (CVG master)
| table | role | rows | notes |
|---|---|---|---|
| `COVERAGE` (+`2`,+`3`,+`5`) | The insurance coverage. | 1 | `COVERAGE_ID`, `PAYOR_ID`, `PLAN_ID`, `COVERAGE_TYPE_C_NAME`, `SUBSCR_OR_SELF_MEM_PAT_ID`, `PB_ACCT_ID`. |
| `COVERAGE_MEMBER_LIST`, `COVERAGE_BENEFITS`, `COVERAGE_COPAY_ECD`, `COVERAGE_SPONSOR` | Members, benefit header, copay, sponsor. | 1/38/1/1 | `COVERAGE_BENEFITS.RECORD_ID` = eligibility query header. |
| `SERVICE_BENEFITS` | Per-service-type benefit detail (RTE/eligibility). | 510 | `RECORD_ID` (joins `COVERAGE_BENEFITS`), `CVG_SVC_TYPE_ID_SERVICE_TYPE_NAME`, copay/deductible/coins/OOP. |

### Hospital Billing (HB / HAR) — sparse here
| table | role | rows | notes |
|---|---|---|---|
| `HSP_ACCOUNT` (+`2`..`5`) | HB hospital accounts (HAR). | 4 | `HSP_ACCOUNT_ID`, `ACCT_CLASS_HA_C_NAME`, `ACCT_BILLSTS_HA_C_NAME`, `TOT_CHGS`, `TOT_ADJ`. |
| `HSP_TRANSACTIONS` (+`2`,+`3`) | HB ledger. | 10 | `TX_ID`, `HSP_ACCOUNT_ID`, `TX_TYPE_HA_C_NAME` (Charge/Payment/Credit&Debit Adjustment), `PAT_ENC_CSN_ID`, `DFLT_UB_REV_CD_ID_REVENUE_CODE_NAME`. |
| `HSP_ACCT_CVG_LIST` | Coverage list per **PB** HAR (despite the `HSP_` name). | 21 | `HSP_ACCOUNT_ID` here = the PB `PB_VISIT_ID` values, not HB accounts (see gotcha 3). |
| `HSP_ACCT_*` (PRORATION, BILL_DRG, CLAIM_HAR, DX_LIST, LETTERS, …), `HSP_TX_*`, `HSP_CLP_*`, `HSP_PMT_*`, `HSP_BKT_*` | HB satellites: proration, DRG, claim, dx, letters, tx detail, claim-print lines, remit detail, payment buckets. | 1–26 | Full HB claim/remit machinery, lightly populated for the one real HB episode. |

## How they join

- **Charge → encounter (CSN).** `ARPB_TRANSACTIONS.PAT_ENC_CSN_ID = PAT_ENC.PAT_ENC_CSN_ID` (§2). Verified: all 29 PB charges resolve to a `PAT_ENC` row. HB: `HSP_TRANSACTIONS.PAT_ENC_CSN_ID` on the charge rows (payments/adjustments have NULL CSN).
- **Charge → diagnosis.** `ARPB_CHG_ENTRY_DX(TX_ID, LINE) → DX_ID → CLARITY_EDG.DX_ID.DX_NAME` (§3, §7). Verified TX 317236398 → "Concussion without loss of consciousness, initial encounter" + 2 more.
- **Charge → PB visit/HAR → guarantor + coverage.** `ARPB_TRANSACTIONS.PAT_ENC_CSN_ID = ARPB_VISITS.PRIM_ENC_CSN_ID`; `ARPB_VISITS.GUARANTOR_ID = ACCOUNT.ACCOUNT_ID`; `ARPB_VISITS.COVERAGE_ID = COVERAGE.COVERAGE_ID`. Also `ARPB_TRANSACTIONS.ACCOUNT_ID`/`COVERAGE_ID` carry the same directly.
- **Charge → invoice/claim.** `ARPB_TRANSACTIONS.TX_ID = INV_TX_PIECES.TX_ID`; `INV_TX_PIECES.INV_ID = INVOICE.INVOICE_ID = INV_BASIC_INFO.INV_ID`. **All three INV keys are the same number.** Verified: charge 129124339 ($335) → INV 24584313 (`L1002792520`, Rejected) AND 24873734 (`L1002834030`, Closed) — one charge, two submissions.
- **Invoice → PB HAR.** `INVOICE.PB_HOSP_ACT_ID = ARPB_VISITS.PB_VISIT_ID = HSP_ACCT_CVG_LIST.HSP_ACCOUNT_ID` (16/16 verified all three). These small ids (e.g. 4307370) are PB HARs, **not** the HB `HSP_ACCOUNT` rows.
- **The universal invoice-number key.** `INV_BASIC_INFO.INV_NUM` (e.g. `L1002834030`) = `ARPB_TX_MATCH_HX.MTCH_TX_HX_INV_NUM` = `PMT_EOB_INFO_I.INVOICE_NUM` = `CL_RMT_CLM_INFO.INV_NO`/`FILE_INV_NUM` = `CLM_VALUES.INV_NUM` = `RECONCILE_CLM.CLAIM_INVOICE_NUM` (§15). This L-number ties invoice, match, EOB, remittance, claim image, and reconciliation together — the single most useful join in the domain.
- **Payment → charge (EOB).** `PMT_EOB_INFO_I.TX_ID` = the payment ETR; `PMT_EOB_INFO_I.PEOB_MTCH_CHG_TX_ID` = the matched charge. Verified payment 304446678 → charge 302543307. `PMT_EOB_INFO_I(TX_ID,LINE) ↔ PMT_EOB_INFO_II(TX_ID,LINE)` for the CARC codes — **join on both `TX_ID` and `LINE`**, never `TX_ID` alone (it fans out, see gotcha 5).
- **835 service line → charge (closes the loop).** `CL_RMT_SVCE_LN_INF.SVC_LINE_CHG_PB_ID = ARPB_TRANSACTIONS.TX_ID` (PB) or `SVC_LINE_CHG_HB_ID = HSP_TRANSACTIONS.TX_ID` (HB). Verified the full loop: charge 213432121 ($170) → invoice `L1004718920` (Closed) → 835 image 103811458 paid $113.30, all the way back to the same TX.
- **CAS adjustment codes.** `CL_RMT_SVC_LVL_ADJ(IMAGE_ID, CAS_SERVICE_LINE) → CL_RMT_SVCE_LN_INF(IMAGE_ID, SERVICE_LINE)`.
- **ICN (payer-side key).** `PMT_EOB_INFO_I.ICN = CL_RMT_CLM_INFO.ICN_NO = CLM_VALUES.ICN` — links EOB to its remittance image and claim image from the payer's side.
- **Claim-status feed.** `RECONCILE_CLM.CLAIM_REC_ID = RECONCILE_CLAIM_STATUS.CLAIM_RECON_ID`; `CLM_VALUE_RECORD.CLAIM_RECON_ID` also points here. Order events by `CAST(CONTACT_DATE_REAL AS REAL)` (LINE is not unique — gotcha 6).
- **Guarantor → patient.** `ACCT_GUAR_PAT_INFO(ACCOUNT_ID, LINE) → PAT_ID`. Verified guarantor 1810018166 → `Z#######` (Self) and `Z8599632` (Father). `ACCOUNT` itself has no `PAT_ID`.
- **Coverage benefits.** `SERVICE_BENEFITS.RECORD_ID = COVERAGE_BENEFITS.RECORD_ID` (eligibility header → per-service-type detail). Payer/plan: `COVERAGE.PAYOR_ID` = `ARPB_TRANSACTIONS.PAYOR_ID` = `INV_BASIC_INFO.EPM_ID` (EPM payor master); `PLAN_ID` = `INV_BASIC_INFO.EPP_ID` (EPP plan master).
- **Resolving payer/plan/member names.** `COVERAGE.PAYOR_ID`/`PLAN_ID` (and the same ids on `ARPB_TRANSACTIONS`/`INV_BASIC_INFO`) are **bare numeric keys with no inline `_NAME` companion** (general-patterns §6) — resolve the payer via `CLARITY_EPM.PAYOR_NAME` (1302 → "BLUE CROSS OF WISCONSIN") and the plan via `CLARITY_EPP.BENEFIT_PLAN_NAME` (130204 → "BCBS WI PPO/FEDERAL"). The displayable subscriber/member ID is **not on `COVERAGE`** — it lives in `COVERAGE_MEMBER_LIST.MEM_NUMBER`. Two pre-resolved export views save the joins: `V_EHI_COVERAGE_SUBS` (one fully-resolved subscriber row per coverage) and `V_EHI_CVG_COVERAGE_HIST_ALL`.

## Unstructured tie-back

Mostly structured, but several text/correspondence hooks:
- `CLM_NOTE(RECORD_ID, LINE, CLM_NOTE)` — free-text claim notes, joined to `CLM_VALUE_RECORD.RECORD_ID` (line-chunked, §8; empty strings common).
- `ACCOUNT_CONTACT` — the billing correspondence log: `FOL_UP_NOTE` (free text like "co-ins", "WQ 316236 Deferred…"), `LETTER_NAME`/`LETTER_SUMMARY` (statement/letter names, e.g. "ZAPL SMALL BALANCE LETTER"), and `NOTE_ID` → the `HNO` master (see the notes-and-documents guide).
- `HSP_ACCT_LETTERS` — HB billing letters (2 rows).
- `CL_RMT_*` derive from scanned/imaged 835 remittances; `IMAGE_ID` is the remittance image id.
- No clinical RTF note links *directly* into this cluster except via the shared `PAT_ENC_CSN_ID` (charge → encounter → encounter notes).

## Gotchas & quirks (chased to *why*)

1. **Two billing worlds — never mix PB and HB `TX_ID`s.** PB charges live in `ARPB_TRANSACTIONS` (ETR master) grouped by `ARPB_VISITS`; HB charges live in `HSP_TRANSACTIONS` grouped by `HSP_ACCOUNT` (HAR master). **Why:** Epic Resolute is two separate modules (Professional vs Hospital Billing) with separate ledgers. They share the `TX_ID` *namespace* but a given id is in exactly one. The 835 service line exposes both via `SVC_LINE_CHG_PB_ID` and `SVC_LINE_CHG_HB_ID` (one populated, one NULL). **Handle:** decide PB-or-HB first; most clinic activity is PB, hospital/radiology/therapy episodes are HB.

2. **Single Billing Office (SBO) overlays HB onto the PB guarantor.** There are two `ACCOUNT` rows for one person: a legacy PB guarantor and the live SBO guarantor. The PB `ACCOUNT` row carries `HB_*` balance columns and `SBO_HSP_ACCOUNT_ID`. **Why:** SBO consolidates PB + HB under one guarantor and one statement; the HB balances are bolted onto the PB guarantor row rather than living only in `HSP_ACCOUNT`. **Handle:** read `TOTAL_BALANCE`/`INSURANCE_BALANCE`/`PATIENT_BALANCE` for PB and the `HB_*` siblings for HB off the same row.

3. **`HSP_ACCOUNT_ID` is overloaded: PB HARs vs HB HARs.** `INVOICE.PB_HOSP_ACT_ID`, `ARPB_VISITS.PB_VISIT_ID`, and `HSP_ACCT_CVG_LIST.HSP_ACCOUNT_ID` all share one set of small ids (e.g. 4307370) — these are **PB** hospital accounts (a PB visit *is* a HAR). The `HSP_ACCOUNT` table holds a *different* set (e.g. 376684810) — the **HB** hospital accounts. Verified: 16/16 PB_HOSP_ACT_IDs join to `ARPB_VISITS` and `HSP_ACCT_CVG_LIST` but **0** join to `HSP_ACCOUNT`. **Why:** in Epic a "hospital account" (HAR) is the billing grouping for *either* module; PB and HB both mint HARs in the same id space, so name collision is inevitable. The `SBO_HSP_ACCOUNT_ID` on the guarantor (a PB-visit-range id like 4307315, which has an `ARPB_VISITS` row with no CSN) is a consolidated/summary HAR, distinct from the per-encounter HARs that hold transactions. **Handle:** to read HB transactions join only to `HSP_ACCOUNT`; treat `HSP_ACCT_CVG_LIST`/`HSP_ACCT_PRORATION` as PB-HAR satellites despite the prefix.

4. **The transaction ledger is a NARROW window; the claim/EOB/remittance tables are WIDE.** `ARPB_TRANSACTIONS` service dates span only ~2 years (1/2023–9/2024 in this specimen) while invoices, EOBs, and remittances run 2018–2025. Consequence: **many matched charge/payment TXs referenced by `ARPB_TX_MATCH_HX`, `PMT_EOB_INFO_I`, and `CL_RMT_SVCE_LN_INF` are NOT present in `ARPB_TRANSACTIONS`.** Verified: 45 of 74 EOB-matched charge TXs are orphan; 111 of 247 match rows have a `MTCH_TX_HX_ID` not in the export (and not in HSP). **Why:** the org configured a shorter retention/extract window for the live ETR ledger than for the claim-history tables, which preserve the full billing trail. **Handle:** `LEFT JOIN` to the ledger and expect NULLs; don't assume a matched-charge id resolves. This also revises §25 — the matching table is symmetric *in principle* but pairs are routinely one-sided in the export.

5. **`ARPB_TX_MATCH_HX` is bidirectional — count from the Charge side only.** A row is added for charge→payment *and* payment→charge (§25). Naively counting rows ~doubles the matches, and a naive `TX_ID < MTCH_TX_HX_ID` dedup is imperfect here because of the orphan partners in gotcha 4 (247 rows → only 68 "lower-id" rows, not ~123). **Handle:** anchor on charges: join `ARPB_TX_MATCH_HX.TX_ID` to charge TXs and read the partner's `TX_TYPE_C_NAME` (verified: 29 charges settled by 40 payment-matches + 28 adjustment-matches, clean and non-doubled).

6. **EOB I↔II must join on `(TX_ID, LINE)`, not `TX_ID`.** Both tables are keyed `(payment TX_ID, LINE)`. Joining on `TX_ID` alone produces a Cartesian fan-out (a 2-line EOB returns 4 rows; a charge's `PAID_AMT` repeats). **Why:** the payment ETR has multiple EOB lines (one per matched charge/adjustment bucket). **Handle:** always `ON ii.TX_ID=i.TX_ID AND ii.LINE=i.LINE`. Likewise `RECONCILE_CLAIM_STATUS.LINE` is not unique per claim — order by `CONTACT_DATE_REAL` (§10). **Date caveat:** `ARPB_TRANSACTIONS` carries **no `*_DATE_REAL`** column (unlike §10's expectation) — its dates are text `M/D/YYYY h:mm:ss AM` that sort lexically (and `strftime` returns NULL on them). For chronology, order PB activity by the L-number `INV_NUM` (chronological by claim run) or by `CONTACT_DATE_REAL` on the tables that do have it (`RECONCILE_CLAIM_STATUS`, `CLM_VALUE_RECORD.CRD_CONTACT_DATE_REAL`).

7. **Invoice number = claim *run*; a rejection gets a fresh L-number.** Each submission of a claim is a new `INV_NUM`. A rejected/voided submission and its resubmission are separate `INV_BASIC_INFO` rows with different `INV_NUM`s but the **same underlying charges** (`INV_TX_PIECES`). `INV_STATUS_C_NAME` tracks Rejected → Closed/Accepted, or Voided (§16, §18). Verified: charge 129124339 appears under `L1002792520` (Rejected) and `L1002834030` (Closed). **Handle:** to count *distinct billed services* dedupe by charge `TX_ID`, not by invoice; Rejected invoices have **no** match/EOB/remittance rows (never paid).

8. **CARC buckets explain where the money went.** When an 835 posts, `PMT_EOB_INFO_II` records the X12 CARC code (`EOB_CODES`) with its ANSI group (`PEOB_EOB_GRPCODE_C_NAME`): code **45** "exceeds fee schedule" → *Contractual Obligation* (the write-off adjustment); **97** "payment included in another service" → Contractual Obligation; **1/2** (deductible/coinsurance) → *Patient Responsibility* (moves balance to self-pay). A typical visit: charge $170 = payment $113.30 + contractual adjustment $56.70. **Handle:** sum `AMOUNT` grouped by `PEOB_EOB_GRPCODE_C_NAME` to split allowed vs written-off vs patient-owed — **but only over the *final* adjudication.** EOB lines exist for *every* claim submission, including the rejected/voided/rebilled ones (gotcha 7, 9), so summing CARC `AMOUNT` across all of `PMT_EOB_INFO_II` is a **gross** figure that double-counts the denial→rebill churn and can exceed total charges. The real *net* write-off is charge-anchored (`net charges − insurance-paid − patient-responsibility`, deduping invoices by charge `TX_ID` per gotcha 7). If you report a "by reason code" total, label it gross and reconcile it to the net — a part cannot exceed its whole (§42).

   **The reliable net figure is charge-anchored and reason-code-free.** On `ARPB_TRANSACTIONS`, the per-charge `TOTAL_MATCH_*` rollups net exactly to the charges while the naive `SUM` of all Payment+Adjustment rows is inflated by reversal/repost churn — so over the non-void charges, write-off = `ΣTOTAL_MTCH_ADJ`, insurer-paid = `Σ(TOTAL_MTCH_INS_AMT − TOTAL_MTCH_INS_ADJ)`, patient = `Σ(TOTAL_MATCH_AMT − TOTAL_MTCH_INS_AMT)`, and `OUTSTANDING_AMT` sums to ~0 (verified write-off −2343.69, patient −631.87 in this specimen). Treat that as the truth.

   **The image-side by-reason split is informational only — it does *not* reconcile to the penny here.** You can compute a by-reason split from the **remittance-image** family (`CL_RMT_*`): (a) keep only `CL_RMT_CLM_INFO.CLM_STAT_CD_C_NAME = 'Processed as Primary'` to drop the `Denied` + `Reversal of previous payment` rows; (b) dedupe to one image per claim run, `MIN(IMAGE_ID)` per `INV_NO`; (c) split PB from HB via `CL_RMT_SVCE_LN_INF.SVC_LINE_CHG_PB_ID` vs `SVC_LINE_CHG_HB_ID`; (d) `SUM(SVC_ADJ_AMT)` from `CL_RMT_SVC_LVL_ADJ` grouped by `SVC_ADJ_REASON_CD` + `SVC_CAS_GRP_CODE_C_NAME`. But in this specimen the result (Contractual Obligation 3428.24 / Patient Responsibility 1186.14) **overshoots** the charge-side net above — because 18 Processed-as-Primary runs survive the `MIN(IMAGE_ID)` dedup and denial/rebill churn is still double-counted across runs. Report the image-side reason split as informational; the charge-anchored figure is the one that reconciles.

9. **The full void/reverse/rebill saga is preserved, not overwritten.** A denied claim (CARC 16) posts a $0 EOB; correcting it **voids** the charge (`ARPB_TX_VOID`, `VOID_REASON`/`REPOST_TYPE_C_NAME` 'Correction', `DEL_REVERSE_DATE`), the remittance **reverses** (`CL_RMT_CLM_INFO.CLM_STAT_CD_C_NAME` 'Reversal of previous payment', a negative `CLAIM_CHRG_AMT`), a new charge is **reposted** (`ARPB_TRANSACTIONS.REPOST_ETR_ID` on the new TX points at the old; `ARPB_TX_VOID.OLD_ETR_ID`/`REPOSTED_ETR_ID`), and it **rebills** under a new L-number that pays. Verified: charge 315026147 voided 12/20/2022 → reposted 317236398; invoice `L1007201490` shows Denied $315 + Reversal −$315 under the same ICN. **Handle:** all states coexist — to read "what finally happened," follow `REPOST_ETR_ID` to the live TX and the final non-Rejected invoice.

10. **Two procedure-identifier systems side by side (§15).** `ARPB_TRANSACTIONS.PROC_ID` is Epic's internal numeric code (e.g. 23660) with **no `_PROC_NAME` companion materialized** (§4/§5 — the doc lists more name columns than ship). The 835 `CL_RMT_SVCE_LN_INF.PROC_IDENTIFIER` carries the transmitted HCPCS+modifiers (`HC:99213:95`). **Handle:** resolve internal `PROC_ID` via `CLARITY_EAP`/order tables; use `PROC_IDENTIFIER` for the as-billed CPT. Categories use `_C_NAME` inline (`TX_TYPE_C_NAME`, `INV_STATUS_C_NAME`) with no `ZC_` tables (§13).

## Recipes

```sql
-- 1. PB ledger summary by transaction type (charges/payments/adjustments, balance).
SELECT TX_TYPE_C_NAME, COUNT(*) n,
       ROUND(SUM(CAST(AMOUNT AS REAL)),2)          total,
       ROUND(SUM(CAST(OUTSTANDING_AMT AS REAL)),2) outstanding
FROM ARPB_TRANSACTIONS GROUP BY TX_TYPE_C_NAME;
```

```sql
-- 2. How one charge was settled (clean, non-double-counted): the payments + adjustments matched to it.
SELECT c.TX_ID charge, c.AMOUNT, c.PROC_ID,
       p.TX_TYPE_C_NAME settled_by, m.MTCH_TX_HX_AMT amt, m.MTCH_TX_HX_INV_NUM inv
FROM ARPB_TRANSACTIONS c
JOIN ARPB_TX_MATCH_HX m ON m.TX_ID=c.TX_ID
JOIN ARPB_TRANSACTIONS p ON p.TX_ID=m.MTCH_TX_HX_ID
WHERE c.TX_TYPE_C_NAME='Charge' AND c.TX_ID = 213432121;
```

```sql
-- 3. The full loop for a charge: charge -> invoice/status -> 835 payment.
-- NB: ARPB_TRANSACTIONS has NO *_DATE_REAL; all dates are text 'M/D/YYYY ...' (strftime returns NULL).
-- Order by the L-number (chronological by claim run) or build a sortable date as in the SELECT below.
SELECT c.TX_ID charge, c.AMOUNT billed, c.SERVICE_DATE,
       b.INV_NUM, b.INV_STATUS_C_NAME,
       s.IMAGE_ID, s.PROC_IDENTIFIER, s.PROV_PAYMENT_AMT paid_835
FROM ARPB_TRANSACTIONS c
JOIN INV_TX_PIECES tp ON tp.TX_ID=c.TX_ID
JOIN INV_BASIC_INFO b ON b.INV_ID=tp.INV_ID
LEFT JOIN CL_RMT_SVCE_LN_INF s ON s.SVC_LINE_CHG_PB_ID=c.TX_ID
WHERE c.TX_TYPE_C_NAME='Charge'
ORDER BY b.INV_NUM;
```

```sql
-- 4. EOB breakdown for a payment: allowed/deductible/coinsurance/paid + CARC reason + group.
SELECT i.TX_ID payment, i.INVOICE_NUM, i.LINE,
       i.CVD_AMT, i.DED_AMT, i.COINS_AMT, i.PAID_AMT,
       ii.EOB_CODES, ii.WINNINGRMC_ID_REMIT_CODE_NAME carc, ii.PEOB_EOB_GRPCODE_C_NAME grp
FROM PMT_EOB_INFO_I i
JOIN PMT_EOB_INFO_II ii ON ii.TX_ID=i.TX_ID AND ii.LINE=i.LINE   -- join on BOTH keys
ORDER BY i.TX_ID, i.LINE;
```

```sql
-- 5. Claim lifecycle status feed for one claim, in time order.
SELECT s.CONTACT_DATE, s.CLM_CAT_CODE_C_NAME, s.CLM_STAT_CODE_C_NAME, s.CLM_STATUS_MSG
FROM RECONCILE_CLM rc
JOIN RECONCILE_CLAIM_STATUS s ON s.CLAIM_RECON_ID = rc.CLAIM_REC_ID
WHERE rc.CLAIM_INVOICE_NUM = 'L1002834030'
ORDER BY CAST(s.CONTACT_DATE_REAL AS REAL), s.LINE;
```

```sql
-- 6. Coverage + per-service-type benefits (RTE/eligibility) for the patient's coverage.
SELECT cb.RECORD_ID, sb.CVG_SVC_TYPE_ID_SERVICE_TYPE_NAME service,
       sb.IN_NETWORK_YN, sb.COPAY_AMOUNT, sb.DEDUCTIBLE_AMOUNT, sb.COINS_PERCENT
FROM COVERAGE_BENEFITS cb
JOIN SERVICE_BENEFITS sb ON sb.RECORD_ID = cb.RECORD_ID
ORDER BY cb.RECORD_ID;   -- NB: multiple COVERAGE_BENEFITS rows per RECORD_ID fan out; filter to one query header.
```

```sql
-- 7a. NET write-off / patient share (reliable, reason-code-free, charge-anchored — see gotcha 8).
SELECT ROUND(SUM(CAST(TOTAL_MTCH_ADJ AS REAL)),2)                                       writeoff,
       ROUND(SUM(CAST(TOTAL_MTCH_INS_AMT AS REAL)) - SUM(CAST(TOTAL_MTCH_INS_ADJ AS REAL)),2) insurer_paid,
       ROUND(SUM(CAST(TOTAL_MATCH_AMT AS REAL))   - SUM(CAST(TOTAL_MTCH_INS_AMT AS REAL)),2)  patient,
       ROUND(SUM(CAST(OUTSTANDING_AMT AS REAL)),2)                                      outstanding
FROM ARPB_TRANSACTIONS
WHERE TX_TYPE_C_NAME='Charge' AND (VOID_DATE IS NULL OR VOID_DATE='');  -- per-charge rollups, not naive SUM
```

```sql
-- 7b. Image-side split BY REASON CODE (informational only — does NOT reconcile to 7a in this specimen; see gotcha 8).
-- 18 Processed-as-Primary runs survive the MIN(IMAGE_ID) dedup, so denial/rebill churn is still double-counted.
WITH keep AS (
  SELECT INV_NO, MIN(IMAGE_ID) img            -- dedupe a remittance image carried twice
  FROM CL_RMT_CLM_INFO
  WHERE CLM_STAT_CD_C_NAME = 'Processed as Primary'   -- drops Denied + Reversal of every rebill cycle
  GROUP BY INV_NO
)                                              -- (add: AND INV_NO NOT IN (<HB claim INV_NOs>) to isolate PB)
SELECT a.SVC_CAS_GRP_CODE_C_NAME grp, a.SVC_ADJ_REASON_CD carc,
       COUNT(*) n_lines, ROUND(SUM(CAST(a.SVC_ADJ_AMT AS REAL)),2) amount
FROM keep k
JOIN CL_RMT_SVC_LVL_ADJ a ON a.IMAGE_ID = k.img
GROUP BY a.SVC_CAS_GRP_CODE_C_NAME, a.SVC_ADJ_REASON_CD
ORDER BY grp, amount DESC;
-- This specimen: Contractual Obligation 3428.24 / Patient Responsibility 1186.14 — overshoots 7a (2343.69 / 631.87).
```

## Open questions / specimen notes

- **Specimen shape (illustrative only):** one patient, one coverage (Indemnity, payor 1302 / plan 130204, subscriber=self), one active SBO guarantor + one legacy PB guarantor. PB ledger 151 TXs (29 charges, 43 payments, 79 adjustments), all balances now $0. 20 invoices (17 Closed, 3 Rejected, 1 Voided, 1 Accepted). One real HB account (376684810): a hospital therapy/radiology episode, $1638.82 charged / −$962.82 adjusted, UB rev codes, one UB claim. Treat all counts/dates as this-specimen, not genre.
- The `COVERAGE.PB_ACCT_ID` is blank here, so I could not confirm whether it normally binds a coverage to a specific guarantor account, or whether that binding lives only on transactions/visits.
- `RECONCILE_CLM_OT` (147) and `INV_PMT_RECOUP` (56) / `ARPB_PMT_RELATED_DENIALS` (8) hold dense recoupment/take-back and 277-over-time mechanics that I sampled but did not exhaustively map to specific charges.
- `CLM_VALUES_2..5` and `CLAIM_INFO/INFO2/INFO3/INFO_3` are additional claim-image supplements (1:1 on `RECORD_ID`) confirmed to exist but not enumerated column-by-column.
- The orphan-TX phenomenon (gotcha 4) is likely a per-org export-window configuration; on an export with a longer ETR retention window the match/EOB/remittance joins to `ARPB_TRANSACTIONS` would resolve more completely.
