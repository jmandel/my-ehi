# Coverage & billing — Epic EHI field guide

**Scope.** The money side of the chart: insurance coverage and eligibility, the charge/payment/adjustment
ledger, claims, EOBs (835 remittance), claim-status tracking, guarantor accounts, and the void/reverse/
rebill saga. Epic Resolute splits this into two parallel worlds — **Professional Billing (PB)** and
**Hospital Billing (HB)** — that you must keep straight.

**Where it sits.** Every charge carries a `PAT_ENC_CSN_ID` back to the encounter (§2) and an
`ACCOUNT_ID`/`COVERAGE_ID` to the guarantor and payer. The patient is reached via the guarantor bridge
`ACCT_GUAR_PAT_INFO.PAT_ID` and via the charge's CSN → `PAT_ENC.PAT_ID`. There is no `PAT_ID` column on
`ACCOUNT` or `ARPB_TRANSACTIONS` — but `INVOICE.PAT_ID` ships fully populated (21/21 join `PATIENT` in one
specimen), making the invoice a direct patient entry point into PB billing; the ledger and guarantor still
need the `ACCT_GUAR_PAT_INFO` bridge or the charge's CSN.

## Tables

### Professional Billing (PB / ETR master file) — the spine here
| table | role | rows in specimen | notes |
|---|---|---|---|
| `ARPB_TRANSACTIONS` (+`2`,+`3`) | PB ledger. One row per Charge/Payment/Adjustment. | 151 | The PB spine. `2`/`3` are 1:1 supplements (§8) — same 151 `TX_ID`s. `ARPB_TX_MODERATE` is a 4th 1:1 wide companion. |
| `ARPB_VISITS` | PB visit = the per-encounter PB account (a HAR). Grouping level between CSN and invoices. | 20 | `PB_VISIT_ID`, `PRIM_ENC_CSN_ID`, `GUARANTOR_ID`, `COVERAGE_ID`, `PB_TOTAL_*`, `FIRST_PB_CHG_TX_ID`. |
| `ARPB_TX_MATCH_HX` | Match ledger: each charge↔payment / charge↔adjustment settlement. | 247 | Symmetric **and** references TXs outside the export (see gotcha 4). |
| `ARPB_TX_VOID` | Void/repost chain. | 2 | `TX_ID`/`OLD_ETR_ID`/`REPOSTED_ETR_ID`, `VOID_REASON_C_NAME`, `DEL_REVERSE_DATE`. |
| `ARPB_CHG_ENTRY_DX` | Line-numbered diagnoses per charge (charge-entry time). | 62 | `(TX_ID, LINE) → DX_ID` (§9). |
| `TX_DIAG` | The transaction's *filed* diagnoses. | 53 | `(TX_ID, LINE) → DX_ID` + `DX_QUALIFIER_C_NAME`; all join the ledger — complements `ARPB_CHG_ENTRY_DX`. |
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
| `SVC_LN_INFO` (+`2`,`3`) | Claim-image **service lines** — the 837's SV1 segments. | 33 ea | `(RECORD_ID, LINE)` → `CLM_VALUE_RECORD`; `LN_PROC_CD`/`LN_PROC_MOD`/`LN_FROM_DT`. |
| `CLM_DX`, `CLM_OTHER_DXS`, `CLM_NOTE`, `CLM_STAT_DETAILS`, `CLM_INJURY_DESC`, `CLM_ALL` | Claim diagnoses, other dx, free-text claim notes, status detail. | 46/5/16/25/2/2 | `CLM_NOTE.RECORD_ID` → `CLM_VALUE_RECORD`. |
| `CLAIM_INFO`/`INFO2`/`INFO3`/`INFO_3` | More claim-image supplements. | 2 ea | Sparse here. |
| `OCC_CD`, `REL_CAUSE_CD`, `PAT_RSN_VISIT_DX`, `EXT_CAUSE_INJ_DX`, `OCCURRENCE_CODES` | Claim external-value children (occurrence/related-cause codes, visit-reason and injury dx). | 1–2 ea | All keyed `RECORD_ID` → `CLM_VALUE_RECORD`. `OCCURRENCE_CODES` holds *claim* occurrence dates despite its EPISODE-flavored schema description — a §24 label-lie. |

### EOB / remittance (835)
| table | role | rows | notes |
|---|---|---|---|
| `CL_REMIT` | The remittance-image (IMD) **master** — one row per 835 image. | 24 | `IMAGE_ID` is the key every `CL_RMT_*` child carries; payment method/type/amount + credit-debit header. |
| `PMT_EOB_INFO_I` | EOB lines: payment → matched charge, with CVD/DED/COINS/PAID split. | 87 | `TX_ID`=payment, `PEOB_MTCH_CHG_TX_ID`=charge, `ICN`, `INVOICE_NUM`, amounts. |
| `PMT_EOB_INFO_II` | CARC reason codes + ANSI group code per EOB line. | 111 | `EOB_CODES`, `WINNINGRMC_ID_REMIT_CODE_NAME`, `PEOB_EOB_GRPCODE_C_NAME`. |
| `CL_RMT_CLM_INFO` | Parsed 835 claim header per remittance image. | 24 | `IMAGE_ID`, `INV_NO`/`FILE_INV_NUM`, `CLM_STAT_CD_C_NAME` (Processed/Denied/Reversal), `ICN_NO`, amounts. |
| `CL_RMT_SVCE_LN_INF` | 835 service line → back to the charge TX. | 40 | `SVC_LINE_CHG_PB_ID`→`ARPB_TRANSACTIONS.TX_ID`, `SVC_LINE_CHG_HB_ID`→`HSP_TRANSACTIONS.TX_ID`, `PROC_IDENTIFIER` (`HC:99213:95`). |
| `CL_RMT_SVC_LVL_ADJ`, `CL_RMT_SVC_AMT_INF`, `CL_RMT_SVC_DAT_INF`, `CL_RMT_HC_RMK_CODE`, `CL_RMT_CLM_ENTITY`, `CL_RMT_PRV_SUM_INF`, `CL_RMT_CLM_DT_INFO`, `CL_RMT_SVC_LVL_REF`, … | CAS adjustment codes, service amounts/dates, remark codes, entities, provider summary, claim-level DTM dates, service-line REF segments. | 52/34/40/5/68/24/41/40 | CAS keyed `(IMAGE_ID, SERVICE_LINE)`. Beware decoy siblings: `CL_RMT_INP_ADJ_INF`/`CL_RMT_OPT_ADJ_INF`/`CL_RMT_DELIVER_MTD` emit one row per image but carry zero payload (§46 always-emit placeholders). |
| `ARPB_PMT_RELATED_DENIALS` | Denial linkage on payments. | 8 | |
| `BDC_INFO`, `BDC_PB_CHGS`, `BDC_ASSOC_REMARK_CODES` (+ `HSP_BDC_*`) | Denial/correspondence workflow (BDC master): write-off/recovery amounts, appeal deadline, `RESOLVE_REASON`. | 6/6/3 | `BDC_INFO.INVOICE_NUMBER` → `INV_BASIC_INFO.INV_NUM`; `BDC_PB_CHGS.TX_ID` → `ARPB_TRANSACTIONS`. The denials-*workflow* side of the gotcha 8–9 story. |

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
| `PAT_ACCT_CVG` | **Patient → account+coverage list** — the patient-side mirror of `ACCT_GUAR_PAT_INFO`. | 2 | `(PAT_ID, LINE) → ACCOUNT_ID, COVERAGE_ID`, `GUAR_PAT_REL_NAME`, `FIN_CLASS_NAME`. One of the few `PAT_ID`-keyed entry points into billing. `ACCT_COVERAGE`/`CVG_ACCT_LIST` are the account↔coverage bridges. |
| `ACCT_TX` | The account's **full ETR id list** — every transaction on the guarantor account. | 196 | `(ACCOUNT_ID, LINE) → TX_ID`. Superset of the per-patient ledger: it bounds gotcha 4's orphan set (all 45 orphan ids appear here). |
| `ACCOUNT_CONTACT` (+`2`) | Per-account follow-up / correspondence log. | 34 | `(ACCOUNT_ID, LINE, CONTACT_DATE)`; `LETTER_NAME`, `LETTER_SUMMARY`, `NOTE_ID`, `FOL_UP_NOTE`, `REFUND_REQ_*`. |
| `GUAR_ACCT_STMT_HX`, `ARPB_TX_STMT_DT`, `FRONT_END_PMT_COLL_HX`, `GUAR_PMT_SCORE_PB_HX` | The **patient-facing statement trail**: per-statement balances + statement invoice number; which statements carried a TX; point-of-service collection attempts (keyed `PAT_ENC_CSN_ID`); propensity-to-pay score history. | 9/9/16/14 | Complements the payer-side flow — statements are how the patient actually saw the balance. |

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
| `HSP_ACCT_CVG_LIST` | Coverage list per HAR — **both modules**, despite the `HSP_` name. | 21 | `HSP_ACCOUNT_ID` accepts *any* HAR: in one specimen 18 ids = PB `PB_VISIT_ID` values, 3 = HB `HSP_ACCOUNT` rows, no overlap (see gotcha 3). |
| `HSP_BKT_INV_NUM` | **HB claim invoice numbers** per liability bucket. | 1 | `(BUCKET_ID, LINE) → INVOICE_NUMBER, HSP_ACCOUNT_ID`. The way to identify HB claims/remittance images by `INV_NO` (see gotcha 1 and recipe 7b's PB/HB filter). |
| `HSP_ACCT_*` (PRORATION, BILL_DRG, CLAIM_HAR, DX_LIST, LETTERS, …), `HSP_TX_*`, `HSP_CLP_*`, `HSP_PMT_*`, `HSP_BKT_*` | HB satellites: proration, DRG, claim, dx, letters, tx detail, claim-print lines, remit detail, payment buckets. | 1–26 | Full HB claim/remit machinery, lightly populated for the one real HB episode. `HSP_ACCT_PRORATION` keys on both PB and HB HARs like `HSP_ACCT_CVG_LIST`. `HSP_BFH_ACT_DATA_2` ships with **no** base `HSP_BFH_ACT_DATA` — a §8 supplement-without-base. |

**Decoys in this domain.** `UNIV_CHG_LN_MSG_HX`/`UNIV_CHG_LN_DX`/`UNIV_CHG_LN_MOD`/`UCL_NDC_CODES` (75/54/14/1)
are Universal Charge Line children keyed `UCL_ID` with **no exported UCL master**, and the `UCL_ID` space is
disjoint from `TX_ID` (0 overlap) — charge-entry scaffolding reachable only through its own children (§15);
don't hunt for the join. And several tables have row counts that scream "data" but carry no populated payload:
`ABN_FOLLOW_UP` (one row per note contact), `PAT_ENC_CC_AUTO_CHG` and `PAT_UTILIZATION_REVIEW` (one row per
encounter, all payload columns blank) — §46 always-emit placeholders.

## How they join

- **Charge → encounter (CSN).** `ARPB_TRANSACTIONS.PAT_ENC_CSN_ID = PAT_ENC.PAT_ENC_CSN_ID` (§2). Verified: all 29 PB charges resolve to a `PAT_ENC` row. HB: `HSP_TRANSACTIONS.PAT_ENC_CSN_ID` on the charge rows (payments/adjustments have NULL CSN).
- **Charge → diagnosis.** `ARPB_CHG_ENTRY_DX(TX_ID, LINE) → DX_ID → CLARITY_EDG.DX_ID.DX_NAME` (§3, §9). Verified TX 317236398 → "Concussion without loss of consciousness, initial encounter" + 2 more.
- **Charge → PB visit/HAR → guarantor + coverage.** `ARPB_TRANSACTIONS.PAT_ENC_CSN_ID = ARPB_VISITS.PRIM_ENC_CSN_ID`; `ARPB_VISITS.GUARANTOR_ID = ACCOUNT.ACCOUNT_ID`; `ARPB_VISITS.COVERAGE_ID = COVERAGE.COVERAGE_ID`. Also `ARPB_TRANSACTIONS.ACCOUNT_ID`/`COVERAGE_ID` carry the same directly.
- **Charge → invoice/claim.** `ARPB_TRANSACTIONS.TX_ID = INV_TX_PIECES.TX_ID`; `INV_TX_PIECES.INV_ID = INVOICE.INVOICE_ID = INV_BASIC_INFO.INV_ID`. **All three INV keys are the same number.** Verified: charge 129124339 → INV 24584313 (`L1002792520`, Rejected) AND 24873734 (`L1002834030`, Closed) — one charge, two submissions.
- **Invoice → PB HAR.** `INVOICE.PB_HOSP_ACT_ID = ARPB_VISITS.PB_VISIT_ID = HSP_ACCT_CVG_LIST.HSP_ACCOUNT_ID` (16/16 verified all three). These small ids (e.g. 4307370) are PB HARs, **not** the HB `HSP_ACCOUNT` rows.
- **The universal invoice-number key.** `INV_BASIC_INFO.INV_NUM` (e.g. `L1002834030`) = `ARPB_TX_MATCH_HX.MTCH_TX_HX_INV_NUM` = `PMT_EOB_INFO_I.INVOICE_NUM` = `CL_RMT_CLM_INFO.INV_NO`/`FILE_INV_NUM` = `CLM_VALUES.INV_NUM` = `RECONCILE_CLM.CLAIM_INVOICE_NUM` (§27). This L-number ties invoice, match, EOB, remittance, claim image, and reconciliation together — the single most useful join in the domain.
- **Payment → charge (EOB).** `PMT_EOB_INFO_I.TX_ID` = the payment ETR; `PMT_EOB_INFO_I.PEOB_MTCH_CHG_TX_ID` = the matched charge. Verified payment 304446678 → charge 302543307. `PMT_EOB_INFO_I(TX_ID,LINE) ↔ PMT_EOB_INFO_II(TX_ID,LINE)` for the CARC codes — **join on both `TX_ID` and `LINE`**, never `TX_ID` alone (it fans out, see gotcha 5).
- **835 service line → charge (closes the loop).** `CL_RMT_SVCE_LN_INF.SVC_LINE_CHG_PB_ID = ARPB_TRANSACTIONS.TX_ID` (PB; every populated pointer resolves). `SVC_LINE_CHG_HB_ID = HSP_TRANSACTIONS.TX_ID` is the schema-documented HB twin but is **never populated in this export** — even the HB claim's lines carry NULL in both columns; identify them by `INV_NO` ∈ `HSP_BKT_INV_NUM.INVOICE_NUMBER` (gotcha 1). Verified the full loop: charge 213432121 → invoice `L1004718920` (Closed) → 835 image 103811458's paid line, all the way back to the same TX.
- **CAS adjustment codes.** `CL_RMT_SVC_LVL_ADJ(IMAGE_ID, CAS_SERVICE_LINE) → CL_RMT_SVCE_LN_INF(IMAGE_ID, SERVICE_LINE)`.
- **ICN (payer-side key).** `PMT_EOB_INFO_I.ICN = CL_RMT_CLM_INFO.ICN_NO` is the dependable leg (EOB ↔ remittance image; unmatched ICNs are the out-of-scope claims of gotcha 4). `CLM_VALUES.ICN` is **not** routine: it's the prior-adjudication payer claim control number (REF\*F8-style) sent only on *resubmitted* claims (populated 1/20 here) — link the claim image via its `INV_NUM` instead.
- **Claim-status feed.** `RECONCILE_CLM.CLAIM_REC_ID = RECONCILE_CLAIM_STATUS.CLAIM_RECON_ID`. `CLM_VALUE_RECORD.CLAIM_RECON_ID` exists for the claim-image → reconciliation link but ships **empty** in one specimen — bridge via the L-number instead (`CLM_VALUES.INV_NUM = RECONCILE_CLM.CLAIM_INVOICE_NUM`, 20/20). Order events by `CAST(CONTACT_DATE_REAL AS REAL)` (LINE is not unique — gotcha 6).
- **Claim diagnoses — the ICD-10 recovery path.** Two parallel lists per claim (§27/§41): `CLM_DX(RECORD_ID, LINE)` → `CLM_VALUE_RECORD`, where `CLM_DX` is the **literal ICD-10-CM code as transmitted** on the 837 (X12 qualifiers in `CLM_DX_QUAL`: `ABK` = principal, `ABF` = other; in one specimen 46/46 rows join the claim image), and `INV_DX_INFO(INVOICE_ID, LINE, DX_ID)` carrying the same diagnoses as internal EDG ids (all resolve via `CLARITY_EDG`; all join `INVOICE`). Since `CLARITY_EDG` ships no ICD column, this pair is the export's only `DX_ID` ↔ ICD-10 crosswalk — for **billed** diagnoses only (see the problems-and-diagnoses guide).
- **Guarantor → patient.** `ACCT_GUAR_PAT_INFO(ACCOUNT_ID, LINE) → PAT_ID`. Verified guarantor 1810018166 → `Z#######` (Self) and a second `Z#######` (Father) — one guarantor account can cover **multiple patients**, which is what produces gotcha 4's orphans. `ACCOUNT` itself has no `PAT_ID`; `PAT_ACCT_CVG` is the patient-side mirror.
- **Coverage benefits.** `SERVICE_BENEFITS.RECORD_ID = COVERAGE_BENEFITS.RECORD_ID` (eligibility header → per-service-type detail) — what the plan *will* cover (benefit snapshots, eligibility verification, RTPB) is the `benefits-and-eligibility.md` guide; this guide is what *was* charged and paid. Payer/plan: `COVERAGE.PAYOR_ID` = `ARPB_TRANSACTIONS.PAYOR_ID` = `INV_BASIC_INFO.EPM_ID` (EPM payor master); `PLAN_ID` = `INV_BASIC_INFO.EPP_ID` (EPP plan master).
- **Resolving payer/plan/member names.** `COVERAGE.PAYOR_ID`/`PLAN_ID` (and the same ids on `ARPB_TRANSACTIONS`/`INV_BASIC_INFO`) are **bare numeric keys with no inline `_NAME` companion** (general-patterns §6) — resolve the payer via `CLARITY_EPM.PAYOR_NAME` (1302 → "BLUE CROSS OF WISCONSIN") and the plan via `CLARITY_EPP.BENEFIT_PLAN_NAME` (130204 → "BCBS WI PPO/FEDERAL"). The displayable subscriber/member ID is **not on `COVERAGE`** — it lives in `COVERAGE_MEMBER_LIST.MEM_NUMBER`. Two pre-resolved export views save the joins: `V_EHI_COVERAGE_SUBS` (one fully-resolved subscriber row per coverage) and `V_EHI_CVG_COVERAGE_HIST_ALL`.

## Unstructured tie-back

Mostly structured, but several text/correspondence hooks:
- `CLM_NOTE(RECORD_ID, LINE, CLM_NOTE)` — free-text claim notes, joined to `CLM_VALUE_RECORD.RECORD_ID` (line-chunked, §11; empty strings common).
- `ACCOUNT_CONTACT` — the billing correspondence log: `FOL_UP_NOTE` (free text like "co-ins", "WQ 316236 Deferred…"), `LETTER_NAME`/`LETTER_SUMMARY` (statement/letter names, e.g. "ZAPL SMALL BALANCE LETTER"), and `NOTE_ID` → the `HNO` master (see the clinical-notes-and-documents guide).
- `NOTES_ACCT` — the account-note index: `(ACCOUNT_ID, …)` with `ACTIVE_STATUS`, `INVOICE_NUMBER`, `ENTRY_USER` (17 rows, all join `ACCOUNT`); its `NOTE_ID`s are HNO records — all join `HNO_INFO` (see the clinical-notes-and-documents guide).
- `CUST_SERVICE_NOTES` — MyChart billing-inquiry note pointers: `NOTE_ID` → `HNO_INFO` (4/4), but its `RECORD_ID` names a customer-service-communication master that is **not exported** (§15 pointer-survives).
- `HSP_ACCT_LETTERS` — HB billing letters (2 rows).
- `CL_RMT_*` derive from scanned/imaged 835 remittances; `IMAGE_ID` is the remittance image id.
- No clinical RTF note links *directly* into this cluster except via the shared `PAT_ENC_CSN_ID` (charge → encounter → encounter notes).

## Gotchas & quirks (chased to *why*)

1. **Two billing worlds — never mix PB and HB `TX_ID`s.** PB charges live in `ARPB_TRANSACTIONS` (ETR master) grouped by `ARPB_VISITS`; HB charges live in `HSP_TRANSACTIONS` grouped by `HSP_ACCOUNT` (HAR master). **Why:** Epic Resolute is two separate modules (Professional vs Hospital Billing) with separate ledgers. They share the `TX_ID` *namespace* but a given id is in exactly one. The 835 service line has a pointer column per module (`SVC_LINE_CHG_PB_ID`, `SVC_LINE_CHG_HB_ID`) — but don't assume one is always populated: in this export only the PB pointer materializes; the HB claim's 835 lines carry **neither** (identify them by `INV_NO` ∈ `HSP_BKT_INV_NUM.INVOICE_NUMBER`), and lines for out-of-scope charges (gotcha 4) are also NULL. **Handle:** decide PB-or-HB first; most clinic activity is PB, hospital/radiology/therapy episodes are HB.

2. **Single Billing Office (SBO) overlays HB onto the PB guarantor.** There are two `ACCOUNT` rows for one person: a legacy PB guarantor and the live SBO guarantor. The PB `ACCOUNT` row carries `HB_*` balance columns and `SBO_HSP_ACCOUNT_ID`. **Why:** SBO consolidates PB + HB under one guarantor and one statement; the HB balances are bolted onto the PB guarantor row rather than living only in `HSP_ACCOUNT`. **Handle:** read `TOTAL_BALANCE`/`INSURANCE_BALANCE`/`PATIENT_BALANCE` for PB and the `HB_*` siblings for HB off the same row.

3. **`HSP_ACCOUNT_ID` is overloaded: PB HARs vs HB HARs.** `INVOICE.PB_HOSP_ACT_ID` and `ARPB_VISITS.PB_VISIT_ID` share one set of small ids (e.g. 4307370) — these are **PB** hospital accounts (a PB visit *is* a HAR). The `HSP_ACCOUNT` table holds a *different* set (e.g. 376684810) — the **HB** hospital accounts. Verified: 16/16 PB_HOSP_ACT_IDs join to `ARPB_VISITS` and `HSP_ACCT_CVG_LIST` but **0** join to `HSP_ACCOUNT`. **Why:** in Epic a "hospital account" (HAR) is the billing grouping for *either* module; PB and HB both mint HARs in the same id space, so name collision is inevitable. The `SBO_HSP_ACCOUNT_ID` on the guarantor (a PB-visit-range id like 4307315, which has an `ARPB_VISITS` row with no CSN) is a consolidated/summary HAR, distinct from the per-encounter HARs that hold transactions. **Handle:** to read HB transactions join only to `HSP_ACCOUNT`. `HSP_ACCT_CVG_LIST`/`HSP_ACCT_PRORATION` are HAR satellites for **both modules** — their `HSP_ACCOUNT_ID`s split into a PB-visit subset and an HB subset (18 + 3 here, no overlap, all resolve); ids you reach from `INVOICE.PB_HOSP_ACT_ID`/`ARPB_VISITS` land in the PB subset, while the HB HARs' rows coexist in the same satellite.

4. **The ledger is patient-scoped; the account-level tables are not — expect orphan TX ids.** **Many matched charge/payment TXs referenced by `ARPB_TX_MATCH_HX`, `PMT_EOB_INFO_I`, and `CL_RMT_SVCE_LN_INF` are NOT present in `ARPB_TRANSACTIONS`.** Verified: 45 of 74 EOB-matched charge TXs are orphan; 111 of 247 match rows have a `MTCH_TX_HX_ID` not in the export (and not in HSP). **Why:** `ARPB_TRANSACTIONS` is extracted *per patient*, but the guarantor **account** covers more than one patient (`ACCT_GUAR_PAT_INFO` lists Self plus another family member), and account-scoped tables (`ACCT_TX`, `ARPB_TX_MATCH_HX`, `PMT_EOB_INFO_I`, `CL_RMT_SVCE_LN_INF`) reference the other member's transactions too. It is **not** a date window: once you parse the year out of the text dates, ledger service dates span the same multi-year range as the invoices/EOBs/remittances. (An earlier "ledger spans only ~2 years" reading was exactly the §17 trap — lexical `MIN`/`MAX` over `M/D/YYYY` text compares month digits, not dates.) **Evidence handle:** `ACCT_TX` is the account's *full* ETR id list — every orphan id appears there alongside the exported ones (196 = 151 + 45 here), proving the missing ids are real transactions on the account, outside this patient's export scope. **Handle:** `LEFT JOIN` to the ledger and expect NULLs; don't assume a matched-charge id resolves. This also refines §42 — the matching table is symmetric *in principle* but pairs are routinely one-sided in a per-patient export.

5. **`ARPB_TX_MATCH_HX` is bidirectional — count from the Charge side only.** A row is added for charge→payment *and* payment→charge (§42). Naively counting rows ~doubles the matches, and a naive `TX_ID < MTCH_TX_HX_ID` dedup is imperfect here because of the orphan partners in gotcha 4 (247 rows → only 68 "lower-id" rows, not ~123). **Handle:** anchor on charges: join `ARPB_TX_MATCH_HX.TX_ID` to charge TXs and read the partner's `TX_TYPE_C_NAME` (verified: 29 charges settled by 40 payment-matches + 28 adjustment-matches, clean and non-doubled).

6. **EOB I↔II must join on `(TX_ID, LINE)`, not `TX_ID`.** Both tables are keyed `(payment TX_ID, LINE)`. Joining on `TX_ID` alone produces a Cartesian fan-out (a 2-line EOB returns 4 rows; a charge's `PAID_AMT` repeats). **Why:** the payment ETR has multiple EOB lines (one per matched charge/adjustment bucket). **Handle:** always `ON ii.TX_ID=i.TX_ID AND ii.LINE=i.LINE`. Likewise `RECONCILE_CLAIM_STATUS.LINE` is not unique per claim — order by `CONTACT_DATE_REAL` (§18). **Date caveat:** `ARPB_TRANSACTIONS` carries **no `*_DATE_REAL`** column (unlike §18's expectation) — its dates are text `M/D/YYYY h:mm:ss AM` that sort lexically (and `strftime` returns NULL on them). For chronology, order PB activity by the L-number `INV_NUM` (chronological by claim run) or by `RECONCILE_CLAIM_STATUS.CONTACT_DATE_REAL` (fully populated). `CLM_VALUE_RECORD.CRD_CONTACT_DATE_REAL` *looks* like the same thing but ships empty here (a §39/§46 empty companion) — for claim images fall back to `RECORD_CREATION_DT` or the L-number.

7. **Invoice number = claim *run*; a rejection gets a fresh L-number.** Each submission of a claim is a new `INV_NUM`. A rejected/voided submission and its resubmission are separate `INV_BASIC_INFO` rows with different `INV_NUM`s but the **same underlying charges** (`INV_TX_PIECES`). `INV_STATUS_C_NAME` tracks Rejected → Closed/Accepted, or Voided (§30, §32). Verified: charge 129124339 appears under `L1002792520` (Rejected) and `L1002834030` (Closed). **Handle:** to count *distinct billed services* dedupe by charge `TX_ID`, not by invoice; Rejected invoices have **no** match/EOB/remittance rows (never paid).

8. **CARC buckets explain where the money went.** When an 835 posts, `PMT_EOB_INFO_II` records the X12 CARC code (`EOB_CODES`) with its ANSI group (`PEOB_EOB_GRPCODE_C_NAME`): code **45** "exceeds fee schedule" → *Contractual Obligation* (the write-off adjustment); **97** "payment included in another service" → Contractual Obligation; **1/2** (deductible/coinsurance) → *Patient Responsibility* (moves balance to self-pay). A typical visit nets to the penny: charge = payment + contractual adjustment. **Handle:** sum `AMOUNT` grouped by `PEOB_EOB_GRPCODE_C_NAME` to split allowed vs written-off vs patient-owed — **but only over the *final* adjudication.** EOB lines exist for *every* claim submission, including the rejected/voided/rebilled ones (gotcha 7, 9), so summing CARC `AMOUNT` across all of `PMT_EOB_INFO_II` is a **gross** figure that double-counts the denial→rebill churn and can exceed total charges. The real *net* write-off is charge-anchored (`net charges − insurance-paid − patient-responsibility`, deduping invoices by charge `TX_ID` per gotcha 7). If you report a "by reason code" total, label it gross and reconcile it to the net — a part cannot exceed its whole (§12).

   **The reliable net figure is charge-anchored and reason-code-free.** On `ARPB_TRANSACTIONS`, the per-charge `TOTAL_MATCH_*` rollups net exactly to the charges while the naive `SUM` of all Payment+Adjustment rows is inflated by reversal/repost churn — so over the non-void charges, write-off = `ΣTOTAL_MTCH_ADJ`, insurer-paid = `Σ(TOTAL_MTCH_INS_AMT − TOTAL_MTCH_INS_ADJ)`, patient = `Σ(TOTAL_MATCH_AMT − TOTAL_MTCH_INS_AMT)`, and `OUTSTANDING_AMT` sums to ~0 (verified: the three components net exactly to the non-void charges in one specimen). Treat that as the truth.

   **The image-side by-reason split is informational only — it does *not* reconcile to the penny here.** You can compute a by-reason split from the **remittance-image** family (`CL_RMT_*`): (a) keep only `CL_RMT_CLM_INFO.CLM_STAT_CD_C_NAME = 'Processed as Primary'` to drop the `Denied` + `Reversal of previous payment` rows; (b) dedupe to one image per claim run, `MIN(IMAGE_ID)` per `INV_NO`; (c) split PB from HB via `CL_RMT_SVCE_LN_INF.SVC_LINE_CHG_PB_ID` vs `SVC_LINE_CHG_HB_ID`; (d) `SUM(SVC_ADJ_AMT)` from `CL_RMT_SVC_LVL_ADJ` grouped by `SVC_ADJ_REASON_CD` + `SVC_CAS_GRP_CODE_C_NAME`. But in this specimen both group totals **overshoot** the charge-side net above — because 18 Processed-as-Primary runs survive the `MIN(IMAGE_ID)` dedup and denial/rebill churn is still double-counted across runs. Expect a third CAS group beyond CO/PR — *Other Adjustment* (recoupment/interest-style lines, can be negative) — alongside the two headline groups. Report the image-side reason split as informational; the charge-anchored figure is the one that reconciles.

9. **The full void/reverse/rebill saga is preserved, not overwritten.** A denied claim (CARC 16) posts a zero-pay EOB; correcting it **voids** the charge (`ARPB_TX_VOID`, `VOID_REASON`/`REPOST_TYPE_C_NAME` 'Correction', `DEL_REVERSE_DATE`), the remittance **reverses** (`CL_RMT_CLM_INFO.CLM_STAT_CD_C_NAME` 'Reversal of previous payment', a negative `CLAIM_CHRG_AMT`), a new charge is **reposted**, and it **rebills** under a new L-number that pays. Verified: charge 315026147 voided → reposted as 317236398; the invoice shows a Denied claim and an exactly-offsetting Reversal under the same ICN. **Directionality of the pointers:** `ARPB_TRANSACTIONS.REPOST_ETR_ID` and *both* `ARPB_TX_VOID` pointer columns (`OLD_ETR_ID`, `REPOSTED_ETR_ID`) sit on the **new** TX's row and point back at the old id, while `REPOST_TYPE_C_NAME` sits on the **old** TX's row with both pointers NULL — read the pair of `ARPB_TX_VOID` rows together. **Handle:** all states coexist — to read "what finally happened," follow `REPOST_ETR_ID` to the live TX and the final non-Rejected invoice.

10. **Two procedure-identifier systems side by side (§27).** `ARPB_TRANSACTIONS.PROC_ID` is Epic's internal numeric code (e.g. 23660) with **no `_PROC_NAME` companion materialized** (§6/§7 — the doc lists more name columns than ship). The 835 `CL_RMT_SVCE_LN_INF.PROC_IDENTIFIER` carries the transmitted HCPCS+modifiers (`HC:99213:95`). **Handle:** resolve internal `PROC_ID` via `CLARITY_EAP`/order tables; use `PROC_IDENTIFIER` for the as-billed CPT. Categories use `_C_NAME` inline (`TX_TYPE_C_NAME`, `INV_STATUS_C_NAME`) with no `ZC_` tables (§23).

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
-- NB: the 835 join is per-charge, not per-submission — paid_835 repeats across resubmission rows
-- (and a multi-line 835 repeats the invoice row); dedupe by TX_ID for totals (gotcha 7).
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
-- NB: II can carry (TX_ID, LINE) rows with no I partner (CARC-only lines; 24/111 here) —
-- the inner join drops them silently; LEFT JOIN from II if you need every reason code.
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
)                  -- (add: AND INV_NO NOT IN (SELECT INVOICE_NUMBER FROM HSP_BKT_INV_NUM) to isolate PB)
SELECT a.SVC_CAS_GRP_CODE_C_NAME grp, a.SVC_ADJ_REASON_CD carc,
       COUNT(*) n_lines, ROUND(SUM(CAST(a.SVC_ADJ_AMT AS REAL)),2) amount
FROM keep k
JOIN CL_RMT_SVC_LVL_ADJ a ON a.IMAGE_ID = k.img
GROUP BY a.SVC_CAS_GRP_CODE_C_NAME, a.SVC_ADJ_REASON_CD
ORDER BY grp, amount DESC;
-- In one specimen this overshoots 7a's net (rebill churn survives the dedup — see gotcha 8), and a third
-- CAS group ('Other Adjustment': recoupment/interest-style lines) appears alongside CO and PR.
```

## Open questions / specimen notes

- **Specimen shape (illustrative only):** one patient, one coverage (Indemnity, payor 1302 / plan 130204, subscriber=self), one active SBO guarantor + one legacy PB guarantor. PB ledger 151 TXs (29 charges, 43 payments, 79 adjustments), all balances resolved to zero. 21 `INVOICE` records / 22 claim submissions (17 Closed, 3 Rejected, 1 Voided, 1 Accepted) — `INV_BASIC_INFO` is keyed `(INV_ID, LINE)`, so one invoice record can hold multiple submissions with distinct `INV_NUM`s. One real HB account (376684810): a hospital therapy/radiology episode, UB rev codes, one UB claim. Treat all counts/dates as this-specimen, not genre.
- The `COVERAGE.PB_ACCT_ID` is blank here, so I could not confirm whether it normally binds a coverage to a specific guarantor account, or whether that binding lives only on transactions/visits.
- `RECONCILE_CLM_OT` (147) and `INV_PMT_RECOUP` (56) / `ARPB_PMT_RELATED_DENIALS` (8) hold dense recoupment/take-back and 277-over-time mechanics that I sampled but did not exhaustively map to specific charges.
- `CLM_VALUES_2..5` and `CLAIM_INFO/INFO2/INFO3/INFO_3` are additional claim-image supplements (1:1 on `RECORD_ID`) confirmed to exist but not enumerated column-by-column.
- The orphan-TX phenomenon (gotcha 4) is resolved: the orphans are the *other guarantor-account member's* transactions — account-scoped tables reference them while the per-patient ledger extract excludes them, and `ACCT_TX` bounds the gap exactly. On a single-member guarantor account the match/EOB/remittance joins to `ARPB_TRANSACTIONS` should resolve completely.
