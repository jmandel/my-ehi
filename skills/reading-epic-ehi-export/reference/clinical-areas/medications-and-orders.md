# Medications & orders — Epic EHI field guide

**Scope.** Outpatient prescriptions and inpatient med orders: the drug, the order instance, its
lifecycle (sent → discontinued, reorders, historical-med documentation), the discontinue reason, the
patient instructions (sig), med reconciliation, and the per-encounter "current med list" snapshot.

**Where it sits.** Every order carries `PAT_ID` (the patient, §1) and `PAT_ENC_CSN_ID` (the contact the
order was placed on, §2). The per-encounter med-list snapshot (`PAT_ENC_CURR_MEDS`) and discontinue/
reconciliation rows hang off the CSN. The drug catalog (`CLARITY_MEDICATION`) is reached only through
`MEDICATION_ID`, never the order id.

## Tables

| table | role | rows in specimen | notes |
|---|---|---|---|
| `ORDER_MED` | **spine** — one row per medication order/prescription instance, keyed by `ORDER_MED_ID` | 20 | 116 cols. Drug, dose, qty, refills, status, class, mode, dates, provider ids, pharmacy, discon reason, reorder pointer. |
| `ORDER_MED_2 … ORDER_MED_7` | horizontal supplements (§8), 1:1 on the order | 20 each | **Key column drifts:** `_2/_3/_4/_5/_7` use `ORDER_ID`; base and `_6` use `ORDER_MED_ID`. |
| `ORDER_MEDINFO` | addendum: IV rate/volume/duration, dose calc, dispensable-med id, prior-auth, order source | 20 | Keyed `ORDER_MED_ID`; carries a *second* `MEDICATION_ID` copy. |
| `ORDER_MED_SIG` | free-text patient sig (instructions), one *row* per order (§46 placeholders) | 20 | Keyed `ORDER_ID` (= `ORDER_MED_ID`). `SIG_TEXT` is NULL on the inpatient/imported orders — populated only for outpatient Rx and historical meds. |
| `ORDER_DX_MED` | order → indication diagnosis, `(ORDER_MED_ID, LINE)` with `DX_ID` | 6 | Only 6 of 20 orders carry an explicit dx. |
| `PAT_ENC_CURR_MEDS` | **per-encounter current-med-list snapshot**, `(PAT_ENC_CSN_ID, LINE)` → `CURRENT_MED_ID` | 241 | The "what meds were on the list at contact X" view. See §41 gotcha below. |
| `DISCONTINUED_MEDS` | per-contact list of orders discontinued there, `(PAT_ENC_CSN_ID, LINE)` → `MEDS_DISCONTINUED` | 17 | `MEDS_DISCONTINUED` = `ORDER_MED_ID`. |
| `PAT_ENC_IP_MEDS` | inpatient-mode meds on a contact's list, → `MEDS_INP_ENC_ORD_ID` | 8 | How the 8 imported NaCl IV orders attach to their inpatient CSNs (they are absent from `PAT_ENC_CURR_MEDS`). |
| `PAT_MEDS_HX` | **patient-level index of every med order ever**, `(PAT_ID, LINE)` → `MEDS_HX_ID` | 20 | `MEDS_HX_ID` = `ORDER_MED_ID` (resolves 20/20 here) — the quickest full enumeration without touching encounters. |
| `EXTERNAL_ORDER_INFO` | external-encounter order metadata; one placeholder row per order across the shared ORD space (§46) | 62 | `DISPLAY_NAME` / `LINK_GROUP_IDENTIFIER` / `LINK_TYPE_C_NAME` populated only on orders imported from external encounters — the link-group id is the mechanism by which the imported NaCl rows declare themselves one event (gotcha 4). |
| `EXT_ORD_SIGNED_SUMMARY` | free-text signed-summary lines for the same external-encounter orders | 8 | `(ORDER_ID, LINE)`; all rows join the inpatient-mode `ORDER_MED` rows here. |
| `ORDER_RPTD_SIG_HX` | reconciliation **event log**: Initial Prescription / Taking As Prescribed / Taking Differently / Not Taking / Historical Med Edited | 17 | `(ORDER_ID, LINE)` with `ENTRY_DTTM`, `SOURCE_C_NAME`, dose/freq. |
| `ORDER_RPTD_SIG_DIFFS` | which fields differ from the prescription on a "Taking Differently" | 3 | Companion to `_HX`. |
| `ORDER_RPTD_SIG_TEXT` | the as-reported sig **string** per reconciliation event — `_HX` itself ships no sig-text column | 17 | `(ORDER_ID, GROUP_LINE, VALUE_LINE)` (§10), where `GROUP_LINE` = `ORDER_RPTD_SIG_HX.LINE` (joins 17/17 here). Siblings `ORDER_RPTD_SIG_INSTR` (free-text instructions) and `ORDER_RPTD_SIG_PRNRSN` (PRN reason) use the same key shape. |
| `MEDS_REV_HX` | med-rec audit: one row per "user reviewed meds" action (user, instant, CSN, count) | 16 | Keyed by `PAT_ID`/CSN; reviewer in `MEDS_HX_REV_USER_ID_NAME`. |
| `MEDS_REV_HX_LIST` | the med-list snapshot for each review, `MEDICATION_ORDER_ID` + `TAKING_YN` | 35 | `MEDICATION_ORDER_ID` = `ORDER_MED_ID`. |
| `MEDS_REV_LAST_LIST` | med-list snapshot at the **most recent** review: `MEDICATION_ORDER_ID` + `TAKING_YN` | 6 | `(PAT_ID, LINE_COUNT)` — the "current" counterpart to the per-review `MEDS_REV_HX_LIST`. |
| `CLARITY_MEDICATION` | **drug master**: `MEDICATION_ID` → `GENERIC_NAME` | 9 | Join target of `MEDICATION_ID`. `ORDER_MED_ID` does NOT join here (schema says so explicitly). |
| `ERX_EVENT` | e-prescribe transmission events (here: Discontinue Prescription) | 3 | `(ORDER_ID, LINE)`. |
| `PRESC_ID` | external e-Rx transmission ids | 2 | `(ORDER_ID, LINE)`; composite external id string. |
| `ORDER_RXVER_NOADSN` | pharmacist verify / discontinue-verify instant per order | 20 | Keyed `ORDER_MED_ID`. |
| `ORDER_SIGNED_MED` | cosign / verbal-order signing info | 1 | `(ORDER_MED_ID, LINE)`. |
| `ORDER_STATUS` | **shared** "overtime single-response" order-contact table across ALL order types | 101 | NOT the med status field. See gotcha. Med rows: 20; rest are lab/imaging. |
| `ORDER_DISP_INFO / _2 / _3` | dispense/fill detail (fill pharmacy, supply days, dispensed qty, DAW) | 20 each | **All fill fields NULL in this specimen** — only `CONTACT_DATE_REAL` populated; no fills exported. Key drifts here too: base and `_3` use `ORDER_MED_ID`, `_2` uses `ORDER_ID`. |
| `ORDER_MED_MORPHINE_EQUIV` | opioid morphine-equivalent conversion factor | 20 | **Stub**: `PCA_MORPHINE_EQUIV_CONV_FACTOR` NULL for every row (no opioids here). |
| `ORDER_MED_VITALS` | vitals captured at order time | 20 | Peripheral. |
| `ORD_INDICATIONS` | order → indication, `(ORDER_ID, LINE)` | 4 | `INDICATIONS_ID` → `MEDICAL_COND_INFO`, the indication condition master (all rows resolve here; it sits in `histories-family-social-medical.md`'s table list by name only — this domain is its real consumer), with an inline `_MEDICAL_COND_NAME` companion (§6). **None of its `ORDER_ID`s are med orders here** (all are non-med decision-support orders) — confirms the shared `ORDER_ID` space. Likewise `ORDER_COMMENT`: generic name, but all its rows are non-med (procedure) orders here — med comments live on `ORDER_MED.MED_COMMENTS`. |
| `MEDICATION_COST_ESTIMATES` | bridge only: `(ORDER_ID, LINE)` → `MEDICATION_ESTIMATE_ID` — **no cost fields here** (3 columns total) | 5 | The actual RTPB estimate record is `MED_CVG_INFO` (next row). |
| `MED_CVG_INFO`, `MED_CVG_DETAILS` | **real-time prescription benefit (RTPB) estimates**: `MED_CVG_INFO` is the estimate record (keyed `MED_ESTIMATE_ID`; also carries `ORDER_ID` straight to `ORDER_MED`, the coverage member, e-prescribing network, viewed-before-sign flag); `MED_CVG_DETAILS` `(MED_ESTIMATE_ID, LINE)` holds the payload — plan-pay/patient-pay/OOP/deductible amounts, days supply, formulary status, PA-required, pharmacy | 6 / 6 | Wider family in the same key space: `MED_CVG_ESTIMATE_VALS`, `MED_CVG_RESPONSE_RSLT`, `MED_CVG_STATUS_DETAILS`, `MED_CVG_DX_VALUE`, `MED_CVG_ALTERNATIVES`, `MED_CVG_USERACTION`. |
| `ORDER_DOCUMENTS` | scanned order docs (hardcopy Rx, etc.) | 4 | None are for these meds in this specimen. |
| `ORD_MED_ADMININSTR` | admin-instruction free text per med order | 7 | `(ORDER_MED_ID, LINE)` + `MED_ADMIN_INSTR`. |
| `ORD_MED_PRNREASONS` | PRN reason *category* for PRN orders | 1 | `(ORDER_MED_ID, LINE)`, `MED_PRN_REASON_C_NAME`. |
| `MED_PEND_APRV_STAT` | approval/refusal status of meds **pended** in (telephone) encounters | 7 | `(PAT_ENC_CSN_ID, LINE)` with `MED_PEND_APRV_FLG_C_NAME` / `MED_REFUSE_RSN_C_NAME` — hangs off the encounter, not the order. |
| `ORD_DOSING_PARAMS / _2` | dosing weight/height/BSA captured at ordering | 62 each | One placeholder row per order across the shared ORD space (§46); populated only where dose-checking ran (the outpatient meds here). |
| `PAT_ENC_SEL_PHARMACIES`, `PAT_RCNT_USD_PHRMS`, `PAT_PREF_PHARMACY` | pharmacy-routing context: per-encounter selected, recently-used, and preferred pharmacies | 6 / 3 / 1 | First keyed `(PAT_ENC_CSN_ID, LINE)`, the others `(PAT_ID, LINE)`; all carry inline `_PHARMACY_NAME` companions (§6). Context for where an Rx was sent vs. the order's own `PHARMACY_ID`. |
| `MED_DISPENSE_SIG` | sig text lines for an **external** dispense document | 9 | `(DOCUMENT_ID, GROUP_LINE, VALUE_LINE)` (§10); the parent `DOCUMENT_ID` is not exported — a §15 pointer-without-body. |
| `MDL_MD_PRBLM_LIST`, `MDL_HISTORY` | problem-oriented medication list (the "med-problem" parallel view) | 9 / 12 | `ORDER_MED.MDL_ID` → `MDL_MD_PRBLM_LIST.MED_PRBLM_LIST_ID` (verified). |

## How they join

All joins below were run against rows in this specimen and confirmed.

- **Spine:** `ORDER_MED.ORDER_MED_ID` is the master key. `ORDER_MEDINFO`, `ORDER_MED_6`,
  `ORDER_RXVER_NOADSN`, `ORDER_SIGNED_MED`, `ORDER_DX_MED`, `ORDER_MED_MORPHINE_EQUIV`(via `ORDER_ID`)
  all carry one row per order. **Supplement key names drift (§8):** `ORDER_MED_2/_3/_4/_5/_7` name their
  key `ORDER_ID`, while base + `_6` use `ORDER_MED_ID`. Both hold the same id values; you must use the
  right column name per table — `PRAGMA table_info` first, always (§7).
- **Drug catalog:** `ORDER_MED.MEDICATION_ID → CLARITY_MEDICATION.MEDICATION_ID → GENERIC_NAME`. All 20
  orders resolve to 9 distinct drugs. The schema doc explicitly warns `ORDER_MED_ID` **cannot** link to
  `CLARITY_MEDICATION` — only `MEDICATION_ID` can. Both sit side by side in `ORDER_MED` (§41 two-ID-spaces
  in miniature: drug record ≠ order record).
- **Shared-`ORDER_ID` tables:** `ORDER_MED_SIG`, `ORDER_STATUS`, `ERX_EVENT`, `PRESC_ID`, `ORD_INDICATIONS`,
  `MEDICATION_COST_ESTIMATES`, `EXTERNAL_ORDER_INFO`, `ORD_DOSING_PARAMS` name their key `ORDER_ID` because
  the ORD id space is shared with lab/imaging orders. Join `ORDER_ID = ORDER_MED_ID`, but expect **non-med
  rows mixed in** — filter with `ORDER_ID IN (SELECT ORDER_MED_ID FROM ORDER_MED)`.
- **RTPB estimates:** `MED_CVG_INFO.ORDER_ID → ORDER_MED.ORDER_MED_ID` directly (and via the
  `MEDICATION_COST_ESTIMATES` bridge `MEDICATION_ESTIMATE_ID = MED_CVG_INFO.MED_ESTIMATE_ID`); the
  dollar/formulary detail joins down on `MED_CVG_DETAILS.MED_ESTIMATE_ID` `(+ LINE)`.
- **Encounter:** `ORDER_MED.PAT_ENC_CSN_ID → PAT_ENC.PAT_ENC_CSN_ID`; then
  `PAT_ENC.DEPARTMENT_ID → CLARITY_DEP.DEPARTMENT_NAME` ("MAC APL INTERNAL MEDICINE" for ambulatory Rx,
  "GENERIC EXTERNAL DATA DEPARTMENT" for the imported inpatient NaCl orders). (See §2 CSN.)
- **Indication dx:** `ORDER_DX_MED.DX_ID → CLARITY_EDG.DX_ID → DX_NAME` (e.g. 108212 Primary hypertension
  for lisinopril, 260690 Post concussion syndrome for nortriptyline, COVID-19 for Paxlovid). `(ORDER_MED_ID, LINE)` (§9).
- **Reorder chain (self-link):** `ORDER_MED.CHNG_ORDER_MED_ID → ORDER_MED.ORDER_MED_ID` — the order this
  one *replaced*. All non-null `CHNG_ORDER_MED_ID` values resolve to a predecessor row. `OLD_ORDER_ID`
  (the documented refill-parent pointer) is **NULL throughout** this specimen — use `CHNG_ORDER_MED_ID`.
- **Current-med snapshot:** `PAT_ENC_CURR_MEDS.CURRENT_MED_ID → ORDER_MED.ORDER_MED_ID`. **All 12 distinct
  `CURRENT_MED_ID`s resolve** (see the §41 friction note — the pattern says they shouldn't). Discontinue:
  `DISCONTINUED_MEDS.MEDS_DISCONTINUED → ORDER_MED_ID`; inpatient list:
  `PAT_ENC_IP_MEDS.MEDS_INP_ENC_ORD_ID → ORDER_MED_ID`; reconciliation:
  `MEDS_REV_HX_LIST.MEDICATION_ORDER_ID → ORDER_MED_ID` — all verified to resolve 100%.
- **Problem-oriented med list:** `ORDER_MED.MDL_ID → MDL_MD_PRBLM_LIST.MED_PRBLM_LIST_ID` (verified; note
  several orders for the same therapy share one `MDL_ID`, e.g. the nortriptyline chain all = 73847702).

## Unstructured tie-back

- **Patient instructions (sig):** the only substantial free text *inside* the med tables lives in
  `ORDER_MED_SIG.SIG_TEXT` (one string per order, e.g. "Take 1 (one) capsule by mouth nightly. Start
  with 10 mg…"), mirrored/varied per reconciliation event in `ORDER_RPTD_SIG_HX` (dose/freq/route columns
  plus `REASON_COMMENT`, `PRN_COMMENT`, `INDICATIONS_COMMENT`). The full **as-reported sig string** per
  reconciliation event lives in `ORDER_RPTD_SIG_TEXT` (`GROUP_LINE` = the `_HX` row's `LINE`, §10) —
  `_HX` itself has no sig-text column. Siblings `ORDER_RPTD_SIG_INSTR` / `_PRNRSN` carry instructions
  and PRN reason the same way.
- **Order-entry comments:** `ORDER_MED.MED_COMMENTS`, `PRN_COMMENT`, `INDICATION_COMMENTS` exist for short
  order-entry text. `PRN_COMMENT` and `INDICATION_COMMENTS` are empty in this specimen, but `MED_COMMENTS`
  is populated on one order — check it before declaring order-entry comments absent.
- **No note→order foreign key.** There is no clinical-narrative note body in the med tables. The note that
  *prescribed* a med (HNO / `Rich Text/*.RTF`) ties back only **indirectly through the shared
  `PAT_ENC_CSN_ID`** — match the order's CSN to the encounter's notes; there is no direct order→note id.
- **Scanned order documents** attach via `ORDER_DOCUMENTS` (DCS records) — none for these meds here.

## Gotchas & quirks (chased to *why*)

1. **`CURRENT_MED_ID` resolves perfectly to `ORDER_MED_ID` here — contradicting general-patterns §41.**
   §41 claims `PAT_ENC_CURR_MEDS.CURRENT_MED_ID` is a *different id space* from `ORDER_MED_ID` and "most
   don't match." In this UnityPoint export, **all 12 distinct `CURRENT_MED_ID`s join 1:1 to
   `ORDER_MED_ID`**, and the schema doc literally defines `CURRENT_MED_ID` as "the current medication
   order ID for the encounter." *Mechanism:* in this Epic build the current-med list points straight at
   the originating ORD record; there is no separate "current med" master to bridge. *Handle:* try the
   direct join first and check the resolve rate — if it's ~100% (as here), §41's bridge worry doesn't
   apply; treat `CURRENT_MED_ID` as an `ORDER_MED_ID`. (Reported as friction.)

2. **The 8 inpatient orders never appear in `PAT_ENC_CURR_MEDS` — `count(curr_meds)` ≠ `count(orders)`.**
   `PAT_ENC_CURR_MEDS` shows 12 distinct meds; `ORDER_MED` has 20. The missing 8 are exactly the
   `ORDERING_MODE_C_NAME = 'Inpatient'` NaCl IV orders. *Mechanism:* the current-med list is the
   *outpatient* med list; imported inpatient/external orders are tracked separately via `PAT_ENC_IP_MEDS`.
   *Handle:* to enumerate every order use `ORDER_MED`; to reconstruct the ambulatory med list use
   `PAT_ENC_CURR_MEDS`, and reach inpatient meds through `PAT_ENC_IP_MEDS`.

3. **`ORDER_STATUS` is NOT the medication status field.** Despite the name, `ORDER_STATUS` is a shared
   "overtime single-response" order-contact table spanning lab/imaging/med orders (82 cols of mostly
   resulting metadata). The real med status is **`ORDER_MED.ORDER_STATUS_C_NAME`** ("Sent" /
   "Discontinued" / blank for Historical Med) — but even that is a *transmit* status: it does **not**
   flip when an outpatient Rx is discontinued. Discontinued e-Rx rows still read "Sent"; in one specimen
   "Discontinued" appeared only on imported inpatient orders. Discontinuation lives in
   `RSN_FOR_DISCON_C_NAME`, `DISCONTINUED_MEDS`, and the `ERX_EVENT` "Discontinue Prescription" row
   (gotcha 8). Worse, `ORDER_STATUS.CONTACT_DATE` for a med order
   **predates** its `ORDERING_DATE` (e.g. order 1034471696 ordered 1/27/2025 shows contact 7/28/2024).
   *Mechanism:* the status row inherits an earlier workflow/contact bucket, not the prescribe date.
   *Handle:* never read med status or dates from `ORDER_STATUS`; use `ORDER_MED`.

4. **One drug therapy spans several order rows (reorder chain) — naive `COUNT(*)` overstates meds (§12).**
   Each renewal mints a *new* `ORDER_MED` row whose `CHNG_ORDER_MED_ID` points at its predecessor; the
   old row *often* — not always — gets `RSN_FOR_DISCON_C_NAME = '*Reorder (sends cancel message to
   pharmacy)'` (in one specimen only 2 of 4 superseded predecessors carry it). Detect chain membership
   by the `CHNG_ORDER_MED_ID` pointer, never by the discon reason. Nortriptyline is
   4 rows for one continuous therapy (qty escalating 90→180→270 capsules). *Handle:* collapse to the
   *head* of each chain — the rows **not** pointed at by any `CHNG_ORDER_MED_ID` — to get distinct active
   therapies (recipe below). Similarly, the **8 NaCl rows on 7/30/2024 are one external inpatient event**
   split across two CSNs (4 lines each), not 8 medications.

5. **`DISPLAY_NAME` is NULL on 6 of 20 orders — but `DESCRIPTION` and the drug master are not.**
   The reordered/historical rows ship a blank `DISPLAY_NAME`. *Mechanism:* `DISPLAY_NAME` is a
   denormalized display cache that isn't always materialized; `DESCRIPTION` (the raw order description,
   e.g. "NORTRIPTYLINE HCL 10 MG PO CAPS") is always present, and `MEDICATION_ID → CLARITY_MEDICATION.
   GENERIC_NAME` always resolves. *Handle:* name a med with
   `COALESCE(DISPLAY_NAME, DESCRIPTION)` or join the drug master; never rely on `DISPLAY_NAME` alone.

6. **"Historical Med" ≠ a prescription.** Orders with `ORDER_CLASS_C_NAME = 'Historical Med'` (Epinephrine,
   Loratadine, entered 12/4/2025) have **blank `ORDER_STATUS_C_NAME`** and `PROVIDER_TYPE_C_NAME =
   'Documenting'` rather than 'Authorizing'. *Mechanism:* they document a med the patient was already
   taking, not something the clinician prescribed/transmitted — so there is no Sent status and no
   pharmacy. *Handle:* split `Historical Med` from `Normal` when reporting "what was prescribed here."

7. **`IS_ACTIVE_YN` in `PAT_ENC_CURR_MEDS` is mostly NULL.** 226 of 241 rows have NULL; only 15 carry Y/N.
   *Handle:* you cannot read "active" off this flag. Infer active status from the *latest* snapshot's
   membership plus order start/end dates and reconciliation events (recipe below).

8. **Reconciliation is event rows, not a status column.** A discontinuation surfaces as **three** facts on
   the same contact: an `ORDER_RPTD_SIG_HX` "Not Taking" event, a `DISCONTINUED_MEDS` row, and (if
   e-prescribed) an `ERX_EVENT` "Discontinue Prescription". `MEDS_REV_HX`/`MEDS_REV_HX_LIST` separately
   audit who reviewed the list and the `TAKING_YN` they set. *Handle:* to know *why/when* a med stopped,
   read these event tables, not just `ORDER_MED.END_DATE`.

9. **`ORDER_MED.DOSAGE` is NULL on every order — read the dose from the `HV_*` discrete fields.**
   `DOSAGE` is a free-text dose cache that is blank for all 20 rows. The structured dose lives in
   `HV_DISCRETE_DOSE` + its unit in `HV_DOSE_UNIT_C_NAME` (both populated on 7 rows, e.g. `30`/`mg`),
   and the frequency in `HV_DISCR_FREQ_ID_FREQ_NAME` (5 rows, e.g. "NIGHTLY", "NIGHTLY PRN"); for human
   display pair these with the sig string from `ORDER_MED_SIG.SIG_TEXT` (§"Unstructured tie-back"). The
   `HV_*` fields are themselves blank on the inpatient NaCl and some historical/reordered rows, so they
   are best-effort discrete values, not a guarantee. *Handle:* never project `ORDER_MED.DOSAGE`.

10. **`QUANTITY` / `REFILLS` / `PHARMACY_ID_PHARMACY_NAME` are dispensing fields — populated only for
    transmitted outpatient Rx.** All three are filled on exactly the 10 `Normal` + `Outpatient` orders and
    blank on the 8 inpatient NaCl orders and the 2 `Historical Med` rows. *Mechanism:* these describe a
    dispensed/transmitted prescription, which the inpatient and documented-history orders are not.
    *Handle:* a blank here means "not a dispensed prescription," **not** missing data — interpret it the
    same way you split `Historical Med`/inpatient from prescribed (gotchas 4, 6).

11. **Prior-auth/ePA decoys: med-flavored names that ship as pure stubs (§46).** `ORDER_AUTH_INFO` emits
    one row per order across the shared ORD space, but every payload column (`MED_AUTH_RESULT_C_NAME`,
    `MED_AUTH_NUM`, `AUTH_*`) is NULL here. `EPA_INFO`/`_2` is keyed **`REFERRAL_ID`** — ePA is modeled
    as a *referral*, one NULL stub per referral — and joins no `ORDER_MED`/`ORDER_PROC` row.
    `IP_ORDER_REC` (inpatient med-rec) ships NULL stubs keyed by an `EVENT_ID` that joins nothing
    reachable, and `ANTICOAG_SELF_REGULATING` is a single NULL-flag row. *Handle:* the discrete
    prior-auth status that *does* ship is `ORDER_MEDINFO.PRIOR_AUTH_STATUS_C_NAME`; don't burn time
    dereferencing these stubs.

## Recipes

```sql
-- 1. All medication orders, human-readable (drug, dose, status, indication, pharmacy).
--    Dose/freq come from the HV_* discrete fields (ORDER_MED.DOSAGE is NULL on every row — gotcha 9);
--    QUANTITY/REFILLS/PHARMACY are populated only for transmitted outpatient Rx (gotcha 10).
SELECT om.ORDER_MED_ID,
       COALESCE(om.DISPLAY_NAME, om.DESCRIPTION)        AS drug,
       cm.GENERIC_NAME,
       om.HV_DISCRETE_DOSE, om.HV_DOSE_UNIT_C_NAME,
       om.HV_DISCR_FREQ_ID_FREQ_NAME                    AS frequency,
       om.QUANTITY, om.REFILLS,
       om.ORDER_STATUS_C_NAME  AS status,
       om.ORDER_CLASS_C_NAME   AS class,
       om.ORDERING_MODE_C_NAME AS mode,
       om.ORDERING_DATE,
       om.RSN_FOR_DISCON_C_NAME AS discon_reason,
       om.PHARMACY_ID_PHARMACY_NAME AS pharmacy
FROM ORDER_MED om
LEFT JOIN CLARITY_MEDICATION cm ON om.MEDICATION_ID = cm.MEDICATION_ID
ORDER BY CAST(om.PAT_ENC_DATE_REAL AS REAL);

-- 2. Distinct active therapies = heads of each reorder chain (rows nothing else supersedes),
--    excluding historical-only documentation and inpatient orders.
SELECT om.ORDER_MED_ID,
       COALESCE(om.DISPLAY_NAME, om.DESCRIPTION) AS drug,
       om.ORDER_STATUS_C_NAME, om.ORDERING_DATE
FROM ORDER_MED om
WHERE om.ORDER_MED_ID NOT IN
      (SELECT CHNG_ORDER_MED_ID FROM ORDER_MED WHERE CHNG_ORDER_MED_ID IS NOT NULL)
  AND om.ORDER_CLASS_C_NAME = 'Normal'
  AND om.ORDERING_MODE_C_NAME = 'Outpatient'
ORDER BY CAST(om.PAT_ENC_DATE_REAL AS REAL);

-- 3. The current med list AS OF the most recent encounter that carries a snapshot.
--    Caveat §43: the most recent snapshot may sit on an automated/system contact (NULL dept),
--    not the last real visit; join PAT_ENC.DEPARTMENT_ID if you need the last *clinical* snapshot.
WITH latest AS (
  SELECT PAT_ENC_CSN_ID
  FROM PAT_ENC_CURR_MEDS
  ORDER BY CAST(PAT_ENC_DATE_REAL AS REAL) DESC
  LIMIT 1
)
SELECT cm.LINE,
       cm.CURRENT_MED_ID,
       COALESCE(om.DISPLAY_NAME, om.DESCRIPTION) AS drug,
       om.ORDER_STATUS_C_NAME, om.ORDER_CLASS_C_NAME
FROM PAT_ENC_CURR_MEDS cm
JOIN latest USING (PAT_ENC_CSN_ID)
LEFT JOIN ORDER_MED om ON cm.CURRENT_MED_ID = om.ORDER_MED_ID
ORDER BY cm.LINE;

-- 4. How long each med stayed on the list (count of distinct encounters it appeared on).
SELECT cm.CURRENT_MED_ID,
       COALESCE(om.DISPLAY_NAME, om.DESCRIPTION) AS drug,
       count(DISTINCT cm.PAT_ENC_CSN_ID) AS encounters_on_list
FROM PAT_ENC_CURR_MEDS cm
LEFT JOIN ORDER_MED om ON cm.CURRENT_MED_ID = om.ORDER_MED_ID
GROUP BY cm.CURRENT_MED_ID
ORDER BY encounters_on_list DESC;

-- 5. Why/when a med stopped: discontinue + reconciliation events for one order.
SELECT 'discontinued' AS src, dm.PAT_ENC_CSN_ID AS csn, dm.CONTACT_DATE AS dt, NULL AS action
FROM DISCONTINUED_MEDS dm WHERE dm.MEDS_DISCONTINUED = :order_id
UNION ALL
SELECT 'reconcile', h.PAT_ENC_CSN_ID, h.ENTRY_DTTM, h.ACTION_C_NAME
FROM ORDER_RPTD_SIG_HX h WHERE h.ORDER_ID = :order_id
UNION ALL
SELECT 'erx', NULL, e.ERX_UTC_DTTM, e.ERX_EVENT_C_NAME
FROM ERX_EVENT e WHERE e.ORDER_ID = :order_id
ORDER BY dt;

-- 6. Sig (patient instructions) + indication for each order.
SELECT om.ORDER_MED_ID, COALESCE(om.DISPLAY_NAME, om.DESCRIPTION) AS drug,
       s.SIG_TEXT, edg.DX_NAME AS indication
FROM ORDER_MED om
LEFT JOIN ORDER_MED_SIG s ON s.ORDER_ID = om.ORDER_MED_ID
LEFT JOIN ORDER_DX_MED dm ON dm.ORDER_MED_ID = om.ORDER_MED_ID AND dm.LINE = 1
LEFT JOIN CLARITY_EDG edg  ON edg.DX_ID = dm.DX_ID
ORDER BY CAST(om.PAT_ENC_DATE_REAL AS REAL);
```

## Open questions / specimen notes

- **Specimen scope.** 20 med orders for one patient (9 distinct drugs/devices), ambulatory Rx from MAC
  APL INTERNAL MEDICINE plus 8 imported inpatient NaCl IV orders from a single 7/30/2024 external stay
  (creator/verifier placeholder "EPIC, USER", dept "GENERIC EXTERNAL DATA DEPARTMENT"). The current-med
  snapshot spans 88 encounters / 241 rows but only 12 distinct meds.
- **No dispense/fill events anywhere** (`ORDER_DISP_INFO*` fill fields all NULL). The only
  dispense-shaped data is `MED_DISPENSE_SIG` — sig text lines for an external (payer/Surescripts-style)
  dispense document whose parent record is not exported (§15); still no quantities or fill events. Open:
  is pharmacy-fill capture simply out of scope for an ambulatory EpicCare EHI export (no Willow/MAR
  tables present), or were there genuinely no fills? In this specimen the latter cannot be distinguished
  from the former — flag fill data as **not exported**, not as "patient never filled."
- **`ORDER_STATUS.CONTACT_DATE` predates `ORDERING_DATE`** on *every* med order in one specimen, by
  months. Likely the order's earlier workflow/contact bucket rather than the prescribe date. Compare via
  `*_DATE_REAL` (`ORDER_STATUS` has `ORD_DATE_REAL`) — the string dates are variable-width `M/D/YYYY`,
  so any positional or lexical compare silently lies (§17). Treat `ORDER_MED.ORDERING_DATE` as
  authoritative.
- **`ORDER_MED_MORPHINE_EQUIV`** ships one stub row per order with NULL conv factor (no opioids here) —
  expect it populated only for opioid PCA orders in other specimens.
- The `MDL_*` problem-oriented med list parallels the order-based view (`ORDER_MED.MDL_ID` resolves) but
  was not fully mapped; worth a deeper trace where med-adherence scoring matters.
