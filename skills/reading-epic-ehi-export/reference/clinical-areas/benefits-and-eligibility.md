# Benefits & eligibility — Epic EHI field guide

**Scope.** What the insurance says it *will* cover — distinct from what was actually charged and paid
(that ledger is the [coverage-and-billing](coverage-and-billing.md) guide). Three sub-stories: **(1)**
plan-level benefit snapshots — copay / coinsurance / deductible / out-of-pocket by *service type*, held in
benefit-collection (BEN) records; **(2)** the per-encounter pharmacy-benefit **eligibility verification**
history; **(3)** **real-time prescription benefit (RTPB)** checks — a request/response/alternatives
conversation with the patient's PBM, run per drug at prescribing time.

**Where it sits.** Three separate homes. Medical benefits live in **BEN** records (`BENEFITS` +
`COVERAGE_BENEFITS`/`SERVICE_BENEFITS` children) reached from an encounter via `PAT_ENC_3.BENEFIT_ID` or
flagged as coverage plan-period records via `BENEFITS.BENEFIT_PERIOD_COVERAGE_ID` →
`COVERAGE.COVERAGE_ID`. Pharmacy eligibility is logged **on the encounter contact itself**
(`PAT_ENC_ELIG_HISTORY`, `EXT_PHARM_TYPE_COVERED`, keyed by CSN — §2). RTPB checks are **LME (medication
estimate)** records keyed `MED_ESTIMATE_ID`, tied back to the med order (`MED_CVG_INFO.ORDER_ID` →
`ORDER_MED`) and the encounter (`MED_CVG_INFO.ENC_CSN`). For payor/plan/member resolution (`CLARITY_EPM`,
`CLARITY_EPP`, `COVERAGE_MEMBER_LIST`) see coverage-and-billing — not recapped here.

## Tables

### 1. Plan-level benefits (BEN records)
| table | role | rows in specimen | notes |
|---|---|---|---|
| `BENEFITS` | **Spine.** One row per benefit-collection (BEN) record. | 21 | Nearly all payload columns NULL here — see gotcha 1. Carries `PAT_ID` (joins `PATIENT` 21/21), `RECORD_CREATION_DT`, and the coverage-period attachment (`BENEFIT_PERIOD_COVERAGE_ID` + `BENEFIT_PERIOD_START_DATE`, populated only on coverage-level records). |
| `COVERAGE_BENEFITS` | Coverage-level benefit lines per BEN record, `(RECORD_ID, LINE)`. | 38 | Whole-plan numbers: deductible/met/remaining, OOP max/remaining, annual & lifetime maxima, `FAMILY_TIER_C_NAME` (Individual / Family / N&#8288;/&#8288;A here), plus the who/when/how audit (`CVG_UPDATE_*`, `BENEFITS_LAST_UPDATE_*` — §37). `CVG_ID` → `COVERAGE.COVERAGE_ID` (38/38 here). |
| `SERVICE_BENEFITS` | **Per-service-type** benefit lines, `(RECORD_ID, LINE)`. | 510 | The headline table: copay/coins/deductible/OOP *by service type* (`CVG_SVC_TYPE_ID` + denormalized `_SERVICE_TYPE_NAME`, §6), network tier (`NET_LVL_SVC_C_NAME` In/Out/N&#8288;/&#8288;A), visit maxima, `RTE_*` mirror columns. A sparse matrix, not duplicates — see gotcha 3. |
| `BENEFIT_SVC_TYPE` | Service-type (ECD) master: `(SERVICE_TYPE_ID, SERVICE_TYPE_NAME)`. | 19 | Org-configurable categories (PRIMARY, ED, SPEC, HOSP IP/OP, PT/OT/ST, PSYCH-IP/OP, E-VISIT, …). Exactly the 19 ids `SERVICE_BENEFITS.CVG_SVC_TYPE_ID` uses (510/510 resolve); `COVERAGE_COPAY_ECD.ECD_TBL_COPAYCAT_ID` points at the same master. |
| `COVERAGE_COPAY_ECD` | Copay-category override table configured *on the coverage*, `(COVERAGE_ID, LINE)`. | 1 | Plan-build copay/coins by copay category + department specialty — configuration, not a patient-specific query result. |

### 2. Per-encounter pharmacy-eligibility verification
| table | role | rows in specimen | notes |
|---|---|---|---|
| `PAT_ENC_ELIG_HISTORY` | Action log on the patient's **pharmacy-benefit** eligibility info, `(PAT_ENC_CSN_ID, LINE)`. | 33 | `ELIG_ACTION_C_NAME` ("Auto Verified", "Plan Selected After Copy" here), who (`ELIG_HX_USER_ID` → `CLARITY_EMP`, 29/29 resolve) and the instant (`ELIG_HX_INST_UTC_DTTM`, §19). `ELIG_PLAN_INDEX` indexes the patient-record eligibility-plans group (EPT item 42010) — always 1 here (one PBM plan). Despite the generic name, this is the *pharmacy* side — see gotcha 9. |
| `EXT_PHARM_TYPE_COVERED` | Pharmacy coverage types from the Surescripts eligibility response, `(PAT_ENC_CSN_ID, GROUP_LINE, VALUE_LINE)` — §10 two-level keys. | 100 | `GROUP_LINE` = which eligibility plan (the same 42010 group `ELIG_PLAN_INDEX` points into; always 1 here), `VALUE_LINE` = the covered types ("Retail", "Mail Order" — 2 per encounter across 50 CSNs, all join `PAT_ENC`). |

### 3. Real-time prescription benefit (RTPB / LME records)
| table | role | rows in specimen | notes |
|---|---|---|---|
| `MED_CVG_INFO` | **LME spine.** One row per medication-estimate record. | 6 | `CNCT_TYPE_C_NAME` splits "Medication Estimate" (5) vs "Alternatives for Medication Estimate" (1) — gotcha 6. `PAT_ID`, `ENC_CSN` → `PAT_ENC` (6/6), `ORDER_ID` → `ORDER_MED.ORDER_MED_ID` (6/6), PBM identity (`EPRESCRIBING_NET_ID_EXTERNAL_NAME`, `CVG_PAYER_IDNT`, `CVG_MEMBER_ID` — gotcha 10), `VIEWED_BEFORE_SIGN_YN`/`ALT_VIEWED_BEFORE_SIGN_YN`. |
| `MED_CVG_ESTIMATE_VALS` | The **request**: what was sent to the payer, one row per query contact. | 7 | Drug (`EST_ERX_ID`), quantity/unit/days-supply, pharmacy (`EST_PHARM_ID` + inline `_PHARMACY_NAME`), prescriber (`EST_AUTH_PROV_ID`), `EST_QUERY_REASON_C_NAME` ("Queried During Signing" / "Queried In Background" here). One LME had two contacts (a re-query) — gotcha 5. |
| `MED_CVG_RESPONSE_RSLT` | The **response envelope** per contact. | 7 | `RESP_RESULT_C_NAME` ("Processed", "Validation Error", "Missing/Invalid Prescriber ID" here), interface status + trigger/response instants (`TRIG_UTC_DTTM`/`RESP_UTC_DTTM`), `RESP_EXACT_MATCH_YN`, `ORIG_MED_PA_REQ_C_NAME`. |
| `MED_CVG_DETAILS` | The **priced result** per coverage line. | 6 | `DRUG_STATUS_C_NAME` ("Covered"), `PA_REQ_C_NAME` (prior-auth required?), `PHR_TYPE_C_NAME` (Retail/Mail Order), patient-pay / plan-pay / deductible-applied / OOP-applied amounts, formulary status, priced pharmacy. Failed queries get no row or an empty-payload row. |
| `MED_CVG_STATUS_DETAILS` | Free-text coverage-status detail, `(…, GROUP_LINE, VALUE_LINE)`. | 4 | Payer's text about the coverage status of the priced drug (here: on the Processed contacts and on the alternatives record). |
| `MED_CVG_RESP_RSLT_DETAIL` | Free-text response-result detail, `(…, LINE)`. | 3 | The error text for the *failed* contacts here — the complement of `MED_CVG_STATUS_DETAILS`. |
| `MED_CVG_DX_VALUE` | Diagnoses sent with the estimate, `(…, GROUP_LINE, VALUE_LINE)`. | 3 | `DX_ID` → `CLARITY_EDG` (3/3 resolve); the doc'd `DX_ID_DX_NAME` companion is **not shipped** (§7). |
| `MED_CVG_ALTERNATIVES` | Payer-suggested alternative(s), `(…, LINE)`. | 1 | `ALT_ERX_ID` (alternative drug, bare id — §6) + `ALT_CVG_ID` = the **LME id of a whole second estimate record** holding the alternative's pricing — gotcha 6. |
| `MED_CVG_USERACTION` | What the prescriber did with the estimate, `(…, LINE)`. | 1 | `UAC_SEL_ALT_YN` (picked the alternative?), user + UTC instant (§37); `UAC_LME_ID/_CSN/_LN_NUM` identify the chosen alternative when one was selected (NULL here — the original was kept). |

**Expected but EMPTY / absent in this specimen** (genre tables to look for):
- `EPA_INFO`/`EPA_INFO_2` — **medication electronic prior authorization**, keyed `REFERRAL_ID` (an ePA
  request is an RFL-family auth record). Ships one row per `REFERRAL` (10) with **every payload column
  NULL** — a §46 always-emit placeholder; no ePA ever ran for this patient. In an export where a drug
  needed prior auth, the request type/status (`EPA_REQ_TYPE_C_NAME`, `CUR_EPA_STATUS_C_NAME`) and the
  pharmacy-benefit encounter (`EPA_INFO_2.ELIG_PAT_ENC_CSN_ID`) live here.
- `BEN_VISIT_NOTES`, `BEN_LTC_SHARE_OF_COST` — schema-documented BEN children, **not shipped** (absent,
  not 0 rows).
- `PR_EST_INFO` (+ `PR_EST_FAC_FEES`/`PR_EST_PROFEE_CXT`) — patient-estimate records whose
  `BENEFITS_INFO_ID` attaches a BEN record to a cost estimate; **not shipped** here.
- On `BENEFITS` itself: `ENC_BENEFIT_VRX_ID`, `VERIFICATION_DATE`, `ORIG_VERIFICATION_DATE`,
  `RECORD_STATUS_C_NAME` all NULL in this specimen; on `COVERAGE_BENEFITS` the entire `CHECKED_*` block
  (manual phone-verification: who was called, phone/fax, agency) is NULL — these benefits were never
  hand-verified, only RTE-queried.

## How they join

All verified against rows in this specimen.

- **Encounter → its benefit snapshot:** `PAT_ENC_3.BENEFIT_ID = BENEFITS.RECORD_ID` (18/18 resolve; note
  `PAT_ENC_3`'s CSN column is `PAT_ENC_CSN`, not `PAT_ENC_CSN_ID` — §4). Then `COVERAGE_BENEFITS.RECORD_ID
  = BENEFITS.RECORD_ID` and `SERVICE_BENEFITS.RECORD_ID = BENEFITS.RECORD_ID` for the detail lines.
- **Coverage → plan-period benefits:** `BENEFITS.BENEFIT_PERIOD_COVERAGE_ID = COVERAGE.COVERAGE_ID`,
  populated only on coverage-level BEN records (2 here, both with January plan-year
  `BENEFIT_PERIOD_START_DATE`s in different years — effective-dated benefit periods, §36 flavor).
- **Benefit line → service type:** `SERVICE_BENEFITS.CVG_SVC_TYPE_ID = BENEFIT_SVC_TYPE.SERVICE_TYPE_ID`
  (510/510), name already denormalized inline (§6). `CVG_FOR_SVC_TYPE_ID` is the *coverage* the line
  evaluates (= `COVERAGE.COVERAGE_ID`, 510/510 here).
- **Benefit line → coverage:** `COVERAGE_BENEFITS.CVG_ID = COVERAGE.COVERAGE_ID` (38/38). Payor/plan names
  resolve from the coverage (`CLARITY_EPM`/`CLARITY_EPP`) — the `PAYOR_ID` columns on both benefit tables
  ship empty here; see coverage-and-billing.
- **Eligibility history → encounter:** `PAT_ENC_ELIG_HISTORY.PAT_ENC_CSN_ID = PAT_ENC.PAT_ENC_CSN_ID`
  (33/33) and `EXT_PHARM_TYPE_COVERED.PAT_ENC_CSN_ID` likewise (100/100). The two coincide: every
  elig-history CSN also has covered-pharmacy-type rows.
- **RTPB → encounter / order / drug / pharmacy:** `MED_CVG_INFO.ENC_CSN = PAT_ENC.PAT_ENC_CSN_ID` (6/6);
  `MED_CVG_INFO.ORDER_ID = ORDER_MED.ORDER_MED_ID` (6/6); `MED_CVG_ESTIMATE_VALS.EST_ERX_ID =
  CLARITY_MEDICATION.MEDICATION_ID` (6/6 populated; the alternatives-LME row carries NULL request values);
  `EST_PHARM_ID = RX_PHR.PHARMACY_ID` (6/6); `EST_AUTH_PROV_ID = CLARITY_SER.PROV_ID` (5/5 populated).
  All 6 LME `ENC_CSN`s appear in `EXT_PHARM_TYPE_COVERED` and `PAT_ENC_ELIG_HISTORY` — the RTPB check
  happens at encounters where pharmacy eligibility was verified.
- **RTPB contacts → children:** request (`MED_CVG_ESTIMATE_VALS`) ↔ response (`MED_CVG_RESPONSE_RSLT`) on
  `(MED_ESTIMATE_ID, CONTACT_DATE_REAL)`; the LINE/GROUP_LINE children (`DETAILS`, `STATUS_DETAILS`,
  `DX_VALUE`, `RESP_RSLT_DETAIL`, `ALTERNATIVES`, `USERACTION`) join the same way — **include
  `CONTACT_DATE_REAL`**, see gotcha 5.
- **Original ↔ alternative estimate:** `MED_CVG_ALTERNATIVES.ALT_CVG_ID = MED_CVG_INFO.MED_ESTIMATE_ID`
  of the second LME (`CNCT_TYPE_C_NAME = 'Alternatives for Medication Estimate'`); both share the same
  `ORDER_ID`/`ENC_CSN`. Verified for the one alternative here.
- **The order remembers its PBM:** `ORDER_MED.EXT_ELG_SOURCE_ID`/`EXT_ELG_MEMBER_ID` (12/20 med orders
  here) equal `MED_CVG_INFO.CVG_PAYER_IDNT`/`CVG_MEMBER_ID` on the linked estimates (6/6) — gotcha 10.

## Gotchas & quirks (chased to *why*)

1. **`BENEFITS` looks empty — it isn't; it's a container.** Every status/verification column is NULL in
   this specimen, and a naive scan suggests a dead table. *Why:* BEN is a collection record; the payload
   lives in its `(RECORD_ID, LINE)` related groups, exported as `COVERAGE_BENEFITS` and `SERVICE_BENEFITS`
   (§39 — blank ≠ no data; the data is one join away). All 38 + 510 child rows' `RECORD_ID`s land in
   `BENEFITS`. The reverse is **not** total: a BEN record may have no child lines at all (in this
   specimen 7 of 18 encounter snapshots ship zero `SERVICE_BENEFITS` lines, and the unattached record
   has no children) — so a per-CSN benefit query (recipe 3) can legitimately return nothing for a valid
   encounter. *Handle:* treat `BENEFITS` as the key ring (patient, attachment, creation date) and read
   benefits from the children.

2. **One table, three kinds of BEN record — classify before you read.** Here: 18 records are *encounter
   snapshots* (pointed at by `PAT_ENC_3.BENEFIT_ID` — the §34 per-encounter re-snapshot mechanism applied
   to benefits), 2 are *coverage plan-period* records (`BENEFIT_PERIOD_COVERAGE_ID` +
   `BENEFIT_PERIOD_START_DATE` populated; one per plan year), and 1 (`67112620`) is attached to **neither**
   — its attaching record (a patient estimate via `PR_EST_INFO.BENEFITS_INFO_ID`, or an HB claim via
   `HSP_CLAIM_DETAIL2.BENEFIT_RECORD_ID`, both unpopulated/unshipped here) is outside the export (§15).
   *Why:* a BEN record carries no back-pointer; its *attachers* point at it (the schema documents
   estimate-linked BENs on `PR_EST_INFO.BENEFITS_INFO_ID` — "Benefit information record (BEN) that is
   linked to the estimate" — and claim-linked BENs on `HSP_CLAIM_DETAIL2.BENEFIT_RECORD_ID`), and the
   export materializes the BEN but not every attacher. *Handle:* classify by
   `BENEFIT_PERIOD_COVERAGE_ID IS NOT NULL` vs membership in `PAT_ENC_3.BENEFIT_ID`; expect strays.

3. **`SERVICE_BENEFITS` lines are a sparse matrix — never aggregate, never take the first row.** One
   service type recurs on several `LINE`s of the same record: an In-network tier carrying coinsurance, an
   Out-of-network tier carrying coinsurance, an `N/A`-tier line carrying the copay, and often a separate
   `N/A` line holding only the `BENEFITS_LAST_UPDATE_*` source/timestamp metadata with **no amounts**.
   *Why:* Chronicles stores benefits as per-(service type × network level × benefit bucket) related-group
   lines; the RTE response writes copay buckets and coinsurance buckets as distinct lines, and the
   metadata line records the query event. *Handle:* read each line as one cell keyed (`CVG_SVC_TYPE_ID`,
   `NET_LVL_SVC_C_NAME`, which-amount-is-non-NULL); `SUM`/`MAX` across lines or "first row per type"
   both lie (§12 flavor).

4. **The `RTE_*` columns mirror, not extend.** `RTE_COPAY_AMOUNT`, `RTE_COINS_PERCENT`,
   `RTE_DEDUCT_*`, `RTE_OOP_*` duplicate their unprefixed siblings exactly wherever both are populated
   (170/170 copay, 284/284 coins here). *Why:* the `RTE_` set holds the raw values from the last
   real-time-eligibility (270/271) response; the unprefixed set is the working copy a registrar may
   override. Source tracking: `CVG_UPDATE_SRC_C_NAME`/`BENEFITS_LAST_UPDATE_SRC_C_NAME` ("Eligibility
   Query"; encounter records also show "Sync from coverage level benefit tracking" — benefits copied down
   from the coverage-level BEN, the doc'd copy mechanism). *Handle:* read the unprefixed columns; compare
   to `RTE_*` only to detect manual overrides (none here, §35 current-state collapse).

5. **`(MED_ESTIMATE_ID, LINE)` is NOT unique — the contact is part of the key.** LME is a contact-based
   master: a re-queried estimate gets a second contact, and each contact's children restart at `LINE 1`
   (verified: one LME here has two contacts, each with a `LINE 1` detail row). *Why:* §18 — the related
   groups hang off the *contact* (`CONTACT_DATE_REAL`), not the record. *Handle:* every MED_CVG join and
   dedup must include `CONTACT_DATE_REAL`; order conversations by `CAST(CONTACT_DATE_REAL AS REAL)`.

6. **`CONTACT_SERIAL_NUM` is not the encounter CSN.** `MED_CVG_ESTIMATE_VALS`/`MED_CVG_RESPONSE_RSLT`
   carry a `CONTACT_SERIAL_NUM` that joins **nothing** in `PAT_ENC` (0/7 here). *Why:* it's the CSN of the
   *LME record's own contact* — every Chronicles contact gets a serial number, not just patient encounters
   (§2/§4: the name says CSN; the master file is LME). The patient encounter is `MED_CVG_INFO.ENC_CSN`.
   *Handle:* join encounters only via `ENC_CSN`.

7. **The "alternative" is a whole second estimate record.** A payer-suggested alternative spawns its own
   LME (`CNCT_TYPE_C_NAME = 'Alternatives for Medication Estimate'`) whose pricing sits in its own
   `MED_CVG_DETAILS`; the original's `MED_CVG_ALTERNATIVES.ALT_CVG_ID` points at it (§42-style pairing,
   both sides in-export here). *Why:* the alternative needs the full request/response/pricing structure,
   so Epic reuses the LME shape rather than widening the original. *Handle:* don't count LME records as
   "drugs my doctor checked" — filter `CNCT_TYPE_C_NAME` — and read alternative pricing by following
   `ALT_CVG_ID`.

8. **Name companions are dropped across the MED_CVG family (§6/§7).** The schema documents
   `EST_ERX_ID_MEDICATION_NAME`, `ALT_ERX_ID_MEDICATION_NAME`, `EST_AUTH_PROV_ID_PROV_NAME`,
   `DX_ID_DX_NAME` — none ship; selecting them errors "no such column". Oddly `EST_PHARM_ID_PHARMACY_NAME`
   *does* ship. *Why:* §7 — documented columns are aspirational; the prescriber-name companion's own
   schema note even warns it "may be hidden in a public view." Resolve via `CLARITY_MEDICATION` (which
   here exposes only `GENERIC_NAME`), `CLARITY_SER`, `CLARITY_EDG`. *Handle:* PRAGMA first (§7); budget
   the extra joins.

9. **`PAT_ENC_ELIG_HISTORY` is *pharmacy* eligibility, not the medical RTE log — and the medical RTE log
   isn't a table at all.** The table name suggests generic insurance verification; its schema doc says
   "actions taken on a patient's **pharmacy benefit** eligibility information" and `ELIG_PLAN_INDEX`
   indexes the Surescripts eligibility-plans group (EPT 42010) (§24 — read the description). The
   *medical* (270/271) eligibility checks surface only as effects: `CVG_UPDATE_SRC_C_NAME = 'Eligibility
   Query'` rows on `COVERAGE_BENEFITS`/`SERVICE_BENEFITS` with their `BENEFITS_LAST_UPDATE_UTC_DTTM`, and
   `CVG_BEN_VERIF_ID` pointers (on `COVERAGE_BENEFITS` only; 8 rows here) to a verification master that
   is **not exported** (§15).
   "Auto Verified" actions log a real user id — the user whose workflow (check-in, refresh) triggered the
   auto-query; "Plan Selected After Copy" rows can have a NULL user (system copy of the prior plan onto a
   new contact, 4/9 here). *Handle:* pharmacy verification trail = `PAT_ENC_ELIG_HISTORY` +
   `EXT_PHARM_TYPE_COVERED`; medical verification trail = the source/timestamp columns on the benefit
   lines.

10. **The PBM identity is a parallel id system (§27/§41).** `MED_CVG_INFO.CVG_MEMBER_ID` equals
    `ORDER_MED.EXT_ELG_MEMBER_ID` (6/6) — the member id the **PBM** knows — and does *not* match the
    medical plan's `COVERAGE_MEMBER_LIST.MEM_NUMBER` (0/6). Likewise `CVG_PAYER_IDNT` =
    `ORDER_MED.EXT_ELG_SOURCE_ID`, an external Surescripts/PBM payer id, **not** an EPM `PAYOR_ID`.
    *Why:* prescription benefits ride a different network (e-prescribing eligibility) with its own
    identifier space; the `EPRESCRIBING_NET_ID` names the RTPB network vendor. *Handle:* never join PBM
    ids to `CLARITY_EPM`/`COVERAGE`; treat them as external-system identifiers (and as PHI when emitting).

## Recipes

```sql
-- 1) Plan-year benefit summary: per-service-type copay/coinsurance from the coverage-level BEN records.
SELECT b.RECORD_ID, b.BENEFIT_PERIOD_START_DATE,
       sb.CVG_SVC_TYPE_ID_SERVICE_TYPE_NAME AS service,
       sb.NET_LVL_SVC_C_NAME                AS network_tier,
       sb.COPAY_AMOUNT, sb.COINS_PERCENT, sb.DEDUCTIBLE_AMOUNT, sb.OUT_OF_POCKET_MAX
FROM BENEFITS b
JOIN SERVICE_BENEFITS sb ON sb.RECORD_ID = b.RECORD_ID
WHERE b.BENEFIT_PERIOD_COVERAGE_ID IS NOT NULL              -- coverage plan-period records only
  AND (sb.COPAY_AMOUNT IS NOT NULL OR sb.COINS_PERCENT IS NOT NULL)  -- drop metadata-only lines (gotcha 3)
ORDER BY b.BENEFIT_PERIOD_START_DATE, CAST(sb.CVG_SVC_TYPE_ID AS INT), CAST(sb.LINE AS INT);
```

```sql
-- 2) The benefit snapshot taken at each encounter: deductible/OOP state the registrar saw.
SELECT pe3.PAT_ENC_CSN AS csn, b.RECORD_ID AS ben_id, cb.LINE,
       cb.FAMILY_TIER_C_NAME, cb.DEDUCTIBLE_AMOUNT, cb.DEDUCT_REMAIN_AMT,
       cb.OUT_OF_POCKET_MAX, cb.OUT_OF_PCKT_REMAIN,
       cb.CVG_UPDATE_SRC_C_NAME, cb.CVG_UPDATE_DTTM
FROM PAT_ENC_3 pe3
JOIN BENEFITS b                ON b.RECORD_ID = pe3.BENEFIT_ID
LEFT JOIN COVERAGE_BENEFITS cb ON cb.RECORD_ID = b.RECORD_ID
WHERE pe3.BENEFIT_ID IS NOT NULL
ORDER BY CAST(pe3.PAT_ENC_DATE_REAL AS REAL), CAST(cb.LINE AS INT);
```

```sql
-- 3) "What would service X cost me?" as known at one visit (service-level snapshot for a CSN).
SELECT sb.CVG_SVC_TYPE_ID_SERVICE_TYPE_NAME AS svc, sb.NET_LVL_SVC_C_NAME AS tier,
       sb.COPAY_AMOUNT, sb.COINS_PERCENT, sb.BENEFITS_LAST_UPDATE_SRC_C_NAME
FROM PAT_ENC_3 pe3
JOIN SERVICE_BENEFITS sb ON sb.RECORD_ID = pe3.BENEFIT_ID
WHERE pe3.PAT_ENC_CSN = :csn
ORDER BY CAST(sb.CVG_SVC_TYPE_ID AS INT), CAST(sb.LINE AS INT);
```

```sql
-- 4) Pharmacy-eligibility verification log per encounter, with the covered pharmacy types returned.
SELECT h.PAT_ENC_CSN_ID, h.CONTACT_DATE, h.ELIG_ACTION_C_NAME,
       h.ELIG_HX_USER_ID_NAME AS by_user, h.ELIG_HX_INST_UTC_DTTM,
       (SELECT group_concat(x.COVERED_EXTERNAL_PHARM_TYPE_C_NAME, '; ')
        FROM EXT_PHARM_TYPE_COVERED x
        WHERE x.PAT_ENC_CSN_ID = h.PAT_ENC_CSN_ID) AS covered_pharmacy_types
FROM PAT_ENC_ELIG_HISTORY h
ORDER BY CAST(h.PAT_ENC_DATE_REAL AS REAL), CAST(h.LINE AS INT);
```

```sql
-- 5) RTPB conversations: request -> response, one row per query contact.
SELECT i.MED_ESTIMATE_ID, i.CNCT_TYPE_C_NAME, i.ENC_CSN, i.ORDER_ID,
       v.CONTACT_NUM, v.EST_QUERY_REASON_C_NAME,
       m.GENERIC_NAME AS requested_med, v.EST_QUANTITY, v.EST_QTY_UNIT_C_NAME, v.EST_DAYS_SUPPLY,
       v.EST_PHARM_ID_PHARMACY_NAME AS pharmacy,
       r.RESP_RESULT_C_NAME, r.STATUS_C_NAME, r.RESP_EXACT_MATCH_YN
FROM MED_CVG_INFO i
LEFT JOIN MED_CVG_ESTIMATE_VALS v ON v.MED_ESTIMATE_ID = i.MED_ESTIMATE_ID
LEFT JOIN MED_CVG_RESPONSE_RSLT r ON r.MED_ESTIMATE_ID = v.MED_ESTIMATE_ID
                                  AND r.CONTACT_DATE_REAL = v.CONTACT_DATE_REAL  -- gotcha 5
LEFT JOIN CLARITY_MEDICATION m    ON m.MEDICATION_ID = v.EST_ERX_ID              -- gotcha 8
ORDER BY CAST(i.MED_ESTIMATE_ID AS INT), CAST(v.CONTACT_NUM AS INT);
```

```sql
-- 6) The priced answer: coverage status, PA flag, and the patient's estimated cost per contact.
SELECT d.MED_ESTIMATE_ID, d.CONTACT_DATE_REAL, d.LINE,
       d.PHR_TYPE_C_NAME, d.DRUG_STATUS_C_NAME, d.PA_REQ_C_NAME,
       d.QTY_PRICED, d.DAYS_SUPPLY, d.PAT_PAY_AMT, d.PLAN_PAY_AMT,
       d.DEDUCT_APPLY_AMT, d.OOP_APPLIED_AMT,
       d.PHARMACY_ID_PHARMACY_NAME AS priced_at, d.PRIMARY_CVG_YN
FROM MED_CVG_DETAILS d
ORDER BY CAST(d.MED_ESTIMATE_ID AS INT), CAST(d.CONTACT_DATE_REAL AS REAL), CAST(d.LINE AS INT);
```

```sql
-- 7) Alternative offered by the PBM, its pricing (a second LME), and whether the prescriber took it.
SELECT a.MED_ESTIMATE_ID AS original_lme, m.GENERIC_NAME AS alternative_med,
       a.ALT_CVG_ID AS alternative_lme,
       d.PHR_TYPE_C_NAME, d.DRUG_STATUS_C_NAME, d.PAT_PAY_AMT,
       u.UAC_SEL_ALT_YN AS picked_alternative, u.UAC_EMP_ID_NAME AS decided_by
FROM MED_CVG_ALTERNATIVES a
LEFT JOIN CLARITY_MEDICATION m ON m.MEDICATION_ID = a.ALT_ERX_ID
LEFT JOIN MED_CVG_DETAILS d    ON d.MED_ESTIMATE_ID = a.ALT_CVG_ID   -- pricing lives on the alt LME
LEFT JOIN MED_CVG_USERACTION u ON u.MED_ESTIMATE_ID = a.MED_ESTIMATE_ID;
```

## Unstructured tie-back

No `Rich Text/*.RTF` or `Media/*` files reference this domain. The human/payer-readable text is **inline**:
- `MED_CVG_STATUS_DETAILS.DRUG_STATUS_DETAILS` — payer's free-text coverage-status message per priced drug.
- `MED_CVG_RESP_RSLT_DETAIL.RESULT_DETAILS` — free-text response/error detail (populated here on the
  failed query contacts; the success/failure texts split across these two tables).
- `COVERAGE_BENEFITS.PREEXIST_COND_DESC`, `CHECKD_WITH_CONTACT` and the `CHECKED_WITH_*` block — free-text
  slots for manual phone verification, all NULL here.
The tie to the rest of the chart is the encounter CSN (`PAT_ENC_3.PAT_ENC_CSN`, `MED_CVG_INFO.ENC_CSN`,
`PAT_ENC_ELIG_HISTORY.PAT_ENC_CSN_ID`) and the med order (`MED_CVG_INFO.ORDER_ID` → the
medications-and-orders guide).

## Open questions / specimen notes

- **Specimen shape (illustrative only):** one medical coverage; 21 BEN records (18 encounter snapshots, 2
  coverage plan-year records, 1 unattached), 38 coverage-level + 510 service-level benefit lines over 19
  service types; 33 pharmacy-eligibility actions across 33 encounters and covered-pharmacy-type rows on 50
  encounters (Retail + Mail Order on every one); 6 LME records (5 estimates + 1 alternatives record) over
  7 query contacts, with one re-query, one payer-suggested alternative (not taken), and response results
  Processed / Validation Error / Missing-Invalid-Prescriber-ID.
- The unattached BEN record's attacher (patient estimate? HB claim?) can't be determined —
  `PR_EST_INFO` isn't shipped and `HSP_CLAIM_DETAIL2.BENEFIT_RECORD_ID` is NULL. Whether estimate-attached
  BENs ever ship without their PR_EST parent is unobserved.
- `SERVICE_BENEFITS.EVALUATION_STATUS_C_NAME` (covered / not covered / in progress), `MAX_VISITS` /
  `REMAINING_VISITS`, and the visit-maximum columns are NULL throughout — the value domains of the
  covered-or-not axis can't be observed here. Same for `COVERAGE_BENEFITS.ACTIVELY_ENROLLED_YN`.
- Only two `ELIG_ACTION_C_NAME` values appear; the full action vocabulary (manual re-verification,
  plan removal, …) is unobserved. `ELIG_PLAN_INDEX` is always 1 (single PBM plan) — multi-plan behavior,
  and whether `EXT_PHARM_TYPE_COVERED.GROUP_LINE` then fans per plan, is unconfirmed.
- `MED_CVG_USERACTION`'s schema describes actions "on Patient Estimates"; here it logged a keep-original
  decision on an RTPB estimate. How it behaves inside the separate Patient Estimates workflow is untested.
- Dollar columns in `MED_CVG_DETAILS` (`PAT_PAY_AMT` etc.) appear only on Covered lines here; how a
  not-covered or PA-required drug prices (zero? NULL? rejection-only) is unobserved.
