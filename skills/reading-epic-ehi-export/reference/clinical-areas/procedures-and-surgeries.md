# Procedures & surgeries — Epic EHI field guide
**Scope.** Ordered procedures (the `ORDER_PROC` spine: labs, imaging, referrals, injections — and, in
principle, surgical/clinical procedures), patient-reported surgical history (`SURGICAL_HX`), the
procedure master file (`CLARITY_EAP`), procedure→diagnosis links, imaging reads, and how procedures
surface as professional-billing charges.
**Where it sits.** Every ordered procedure carries `PAT_ENC_CSN_ID` (the contact it was placed/resulted
on, §2) and `PAT_ID` (§1). Surgical history rows tie to the encounter where the section was reviewed via
`HX_LNK_ENC_CSN`. Procedures re-emerge in billing as `ARPB_TRANSACTIONS` charge rows keyed on `PROC_ID`.

## Tables
| table | role | rows in specimen | notes |
|---|---|---|---|
| `ORDER_PROC` | **Spine.** One row per ordered procedure (header). | 42 | Covers ALL order types: `ORDER_TYPE_C_NAME` ∈ Lab, Microbiology, Imaging, Outpatient Referral, Immunization/Injection. **No surgical/OR procedure orders in this specimen.** PK `ORDER_PROC_ID`, FK `PROC_ID`→`CLARITY_EAP`. |
| `ORDER_PROC_2` … `ORDER_PROC_6` | Numbered supplements (1:1 on the order id, §8). | 42 each | More columns of the same order: specimen handling, charge timestamps, `REMARKS_HNO_ID` (note tie-back), referral routing. Left-join the stack. **Key-name drift:** only `_2` calls the key `ORDER_PROC_ID`; `_3`…`_6` name it `ORDER_ID` (same values) — join `ORDER_PROC.ORDER_PROC_ID = ORDER_PROC_3.ORDER_ID`, etc. |
| `CLARITY_EAP` (+`_3`,`_5`) | Procedure master file (EAP). `PROC_ID`→`PROC_NAME`. | 64 | The Rosetta for every `PROC_ID` — orderable AND charge procedures both live here. `_3.PT_FRIENDLY_NAME` is a layperson name: **blank for order-side `PROC_ID`s, populated for most charge-side ones** (29/64 rows) — see Gotcha 5. No CPT column here — but CPT is recoverable from the remittance side (Gotcha 5, Recipe 6). |
| `ORDER_DX_PROC` | Diagnoses attached to an order (`LINE` child rows, §9). | 41 | `(ORDER_PROC_ID, LINE)` → `DX_ID`→`CLARITY_EDG`. Why a procedure was ordered. |
| `ORDER_NARRATIVE` | Line-exploded procedure result/report text (§11). | 465 | `(ORDER_PROC_ID, LINE)`, one physical line per row. Imaging reads + a couple lab interp blocks. 6 distinct orders here. |
| `ORDER_IMPRESSION` | Radiologist **impression** lines for imaging. | 11 | `(ORDER_PROC_ID, LINE)` → `IMPRESSION` text. The "bottom line" of a read. |
| `ORDER_RAD_READING` | Reading physician for an imaging study. | 4 | `(ORDER_PROC_ID, LINE)` → `PROV_ID`→`CLARITY_SER`. External reads show "GENERIC EXTERNAL DATA PROVIDER". |
| `ORDER_PARENT_INFO` | Panel/parent linkage for an order. | 42 | `ORDER_ID`/`PARENT_ORDER_ID`; 31/42 self-referential, but **11 rows encode a real parent→child link** (the parent is a distinct, present `ORDER_PROC_ID`). |
| `ORD_PROC_INSTR` | Free-text process instructions on an order. | 9 | `(ORDER_ID, LINE)` → `ORDER_PROC_INSTR`. |
| `ORDER_SIGNED_PROC` | Verbal/cosign provenance for an order. | 4 | Who gave/cosigned the verbal order, with timestamps. |
| `ORDER_RESULTS` | Discrete lab result components. | 47 | See the **labs** guide. Imaging has *no* `ORDER_RESULTS` rows — its result is the narrative. |
| `SURGICAL_HX` | **Patient-reported surgical history** (clinical-history `_HX`, §31). | 8 | All 8 rows = the *same* surgery re-snapshotted once per encounter (§34). `PROC_ID`→`CLARITY_EAP`. |
| `HV_ORDER_PROC` | Hospital-visit (inpatient) procedure-order extension. | 42 | 1:1 on `ORDER_PROC_ID`; admit/transfer/discharge order fields. Mostly empty for an ambulatory patient. |
| `ARPB_TRANSACTIONS` | Pro-fee billing transactions (charges/payments). | 151 | Charges carry `PROC_ID` (a **charge-side** EAP record) + `MODIFIER_ONE`..`_FOUR`. The billing face of a procedure. See **billing** guide. |
| `ARPB_DISCOUNT_PROC` | Discount procedures on a charge. | 5 | `(TX_ID, LINE)` → `DISCOUNT_PROC_ID` — but that id does **not** resolve in the exported `CLARITY_EAP` slice (0/5 here): a pointer-survives gap (§15). The export materializes EAP rows only for procedures that were ordered or charged. |
| `TIMEOUT` | Pre-procedure safety time-out / Procedure Pass. | 2 | PK `TIMEOUT_ID` (what `TIMEOUT_ANSWERS.RECORD_ID` joins); `PAT_CSN` links the contact (joins `PAT_ENC`). Skeletal here (type/attest fields blank). |
| `TIMEOUT_ANSWERS` (+`_2`) | Per-question surgical-safety-checklist answers (correct patient/site/side, counts, …), contact-versioned. | 2 each | `RECORD_ID` → `TIMEOUT.TIMEOUT_ID`. In this specimen only the contact-date skeleton survived — every answer `_C_NAME` is blank, same export-stripping as the `TIMEOUT` header. |
| `REFERRAL_PX` | Procedures associated with a referral. | 10 | `(REFERRAL_ID, LINE)` → `PX_ID` (an EAP procedure) with requested/approved units. |
| `HSP_ADMIT_PROC` *(peripheral)* | Hospital admission procedure. | 1 | Inpatient admit-order shape; near-empty here. |
| `PAT_CANCEL_PROC` *(peripheral)* | Cancelled procedure record. | 1 | |
| `CATARACT_PLANNING_GOALS` / `_INFO` *(EMPTY-ish)* | Cataract-surgery planning. | 1 / 1 | Keyed `SUMMARY_BLOCK_ID` = `EPISODE.EPISODE_ID` (the HSB episode master). A companion-row placeholder (§46): the row ships because an episode exists, with every cataract payload column NULL. Describe from schema only. |
| `NSQIP_OPIOIDS_DISCHARGE` *(peripheral)* | Surgical-registry (NSQIP) discharge opioids. | 1 | A surgical-quality-registry table — appears even without a coded OR procedure. |

> **There is no dedicated "surgery performed" table in a typical ambulatory EHI export.** Epic's OR/surgical
> case tables (`OR_LOG`, `OR_CASE`, `OR_PROC`, anesthesia tables) only ship when the org runs Epic OpTime
> and the patient had a surgery there. Here their schema docs ship (≈619 `OR_`-prefixed table docs in
> `_schema_table` — measure with `LIKE 'OR\_%' ESCAPE '\'`; the unescaped pattern also matches `ORDER_*`/`ORD_*`
> and inflates the count, this skill's own ESCAPE gotcha biting its own guide) but **not one is populated** — the only trace of a surgery is the patient-reported
> `SURGICAL_HX` row. If your export has OR cases, expect `OR_LOG`/`LOG_*` keyed by a surgical-log id, joined
> to `ORDER_PROC` via the case's procedure order.

## How they join
- **`ORDER_PROC.PROC_ID = CLARITY_EAP.PROC_ID`** — resolve an order's procedure to its name. *Verified:*
  all 19 distinct order-side `PROC_ID`s resolve (0 unmatched). (§5 master-file IDs)
- **`ORDER_PROC.PAT_ENC_CSN_ID = PAT_ENC.PAT_ENC_CSN_ID`** — order → its contact. *Verified:* 42/42 match.
  Note this is the **resulting/placing contact**, often a different CSN than the office visit (§2; for labs,
  the order-placed CSN and the result CSN differ — see labs guide).
- **`ORDER_DX_PROC.ORDER_PROC_ID = ORDER_PROC.ORDER_PROC_ID`**, then **`ORDER_DX_PROC.DX_ID = CLARITY_EDG.DX_ID`** —
  the indication(s) for a procedure. *Verified:* e.g. XR CERVICAL SPINE → DX "Cervicalgia"; AMB REFERRAL TO
  ALLERGY → "Past history of nut allergy". `LINE` 1..N = multiple diagnoses (§9).
- **`ORDER_NARRATIVE.ORDER_PROC_ID = ORDER_PROC.ORDER_PROC_ID`**, reassemble `ORDER BY CAST(LINE AS INT)` —
  the imaging report / result text. *Verified:* `439060613` MRI BRAIN reassembles to the radiologist read.
  **`LINE` is text — cast to INT or it sorts 1,10,11,2** (§17).
- **`ORDER_IMPRESSION.ORDER_PROC_ID` / `ORDER_RAD_READING.ORDER_PROC_ID = ORDER_PROC.ORDER_PROC_ID`** —
  impression text and reading physician for imaging. *Verified:* `1025926289` (XR C-spine) impression =
  "Normal cervical spine radiographs", read by SHORE, MATTHEW W (`ORDER_RAD_READING.PROV_ID`→`CLARITY_SER`).
- **`ARPB_TRANSACTIONS.PROC_ID = CLARITY_EAP.PROC_ID`** (charge → procedure name). *Verified:* charge
  `190635377` PROC_ID `23660` → "PR OFFICE/OUTPATIENT ESTABLISHED LOW MDM 20 MIN". **The charge `PROC_ID`
  space does NOT overlap the order `PROC_ID` space** (0 of 19 order PROC_IDs appear as charge PROC_IDs) — see
  gotcha below.
- **`SURGICAL_HX.HX_LNK_ENC_CSN = PAT_ENC.PAT_ENC_CSN_ID`** — surgical-history row → the office visit where
  it was reviewed. *Verified:* 8 rows link to 8 distinct office-visit CSNs (12/4/2025, 11/7/2024, …).
  (`PAT_ENC_CSN_ID` on the same row is the **history contact**, a different CSN — see gotcha.)
- **`ORDER_PROC_2.REMARKS_HNO_ID = HNO_INFO.NOTE_ID`** (when populated) — order remarks → a clinical note.
  *Verified:* order `439060607` → note `1483895113`, whose `HNO_PLAIN_TEXT` body is a nurse telephone note.

## Unstructured tie-back
Procedures are unusually note-heavy because **imaging results are stored only as free text**, not as
discrete `ORDER_RESULTS` components:
- **Imaging report body** → `ORDER_NARRATIVE(ORDER_PROC_ID, LINE)`, line-exploded (§11). Reassemble in
  `CAST(LINE AS INT)` order. This is the *entire* result for a radiology study.
- **Imaging impression** → `ORDER_IMPRESSION(ORDER_PROC_ID, LINE)` — the short "IMPRESSION:" conclusion,
  separate from (and usually echoing the tail of) the narrative.
- **Order remarks / instructions** → `ORDER_PROC_2.REMARKS_HNO_ID` → `HNO_INFO`/`HNO_PLAIN_TEXT` (the note
  body); `ORD_PROC_INSTR.ORDER_PROC_INSTR` holds shorter inline process instructions.
- **Lab interpretive text** for a *procedure* (e.g. COVID external) also lands in `ORDER_NARRATIVE`; structured
  labs additionally use `ORDER_RES_COMMENT` (labs guide).
- **Surgical history** carries its own free text in `SURGICAL_HX.COMMENTS` / `PROC_COMMENTS` — but in this
  specimen both are empty (the surgery is captured only as a coded `PROC_ID`).
- No `Media/` file is referenced directly by these procedure tables here; scanned outside reports live in
  the imaging/media (`DOC_*`) area.

## Gotchas & quirks (chased to *why*)
1. **`ORDER_PROC` is a *procedure-order* table, not a *surgery* table — and "procedure" here means lab,
   imaging, referral, or injection.** *Observe:* 42 orders, 0 of them an operative/clinical procedure.
   *Mechanism:* Epic's "procedure" (EAP) master is the universal orderable catalog — venipuncture, an A1C,
   an MRI, and a referral are all "procedures." The clinical *kind* is in **`ORDER_TYPE_C_NAME`**
   (Lab/Microbiology/Imaging/Outpatient Referral/Immunization-Injection), refined by **`ORDER_CLASS_C_NAME`**
   (Lab Collect / Clinic Performed / Ancillary Performed / Historical / Internal vs External Referral).
   *Handle:* to separate "real procedures vs labs" you filter `ORDER_TYPE_C_NAME`, not a `PROC_CLASS` column.
   The schema doc's hoped-for `PROC_CAT_C_NAME` does **not** exist in the data (§7) — use `ORDER_TYPE_C_NAME`.
2. **A surgery shows up *only* in `SURGICAL_HX`, as patient-reported history, repeated once per encounter.**
   *Observe:* 8 `SURGICAL_HX` rows, all `PROC_ID = 42500` = "WISDOM TOOTH EXTRACTION", all `LINE = 1`.
   *Mechanism:* this is the per-encounter re-snapshot of a history section (§34) — each time the surgical-Hx
   section is reviewed at a visit, Epic re-files the full list tagged with that contact's CSN. It is *not* 8
   surgeries and it is *not* a performed-procedure record; it is one self-reported past surgery, asserted 8
   times. `SURGICAL_HX_SRC_C_NAME = "Provider"` marks who entered it. *Handle:* `COUNT(DISTINCT PROC_ID)` (or
   take the latest `HX_LNK_ENC_CSN` snapshot), never `COUNT(*)`.
3. **`SURGICAL_HX` has two CSNs and they mean different things.** *Observe:* `PAT_ENC_CSN_ID` and
   `HX_LNK_ENC_CSN` differ on every row. *Mechanism:* `PAT_ENC_CSN_ID` is the **history-form contact** (a
   data-entry contact Epic mints for the history section), while `HX_LNK_ENC_CSN` is the **clinical encounter**
   the review happened at. *Handle:* join `HX_LNK_ENC_CSN` (not `PAT_ENC_CSN_ID`) to `PAT_ENC` to date the
   review against a real visit; `SURGICAL_HX_SRG_CSN` (the surgery's own contact) is empty here.
4. **Order `PROC_ID` and charge `PROC_ID` are two non-overlapping ID sets in the same master.** *Observe:*
   the A1C *order* is `PROC_ID 828`; the A1C *charge* is `PROC_ID 20302` ("PR GLYCOSYLATED HEMOGLOBIN TEST");
   0/19 order PROC_IDs appear in `ARPB_TRANSACTIONS`. *Mechanism:* Epic keeps **orderable** procedure records
   and **billing/charge** procedure records as distinct EAP entries (the charge record is what's transmitted
   on the claim; names are prefixed `PR`/`CHG`). They share the `CLARITY_EAP` table but not the same key.
   *Handle:* don't try to join orders to charges on `PROC_ID`. Bridge order↔charge via the encounter CSN
   (`ORDER_PROC.PAT_ENC_CSN_ID = ARPB_TRANSACTIONS.PAT_ENC_CSN_ID`) and date, not via `PROC_ID`. (§27, §41)
5. **CPT/HCPCS is absent from `CLARITY_EAP` and `ARPB_TRANSACTIONS` — but it IS recoverable from the
   remittance side.** *Observe:* `CLARITY_EAP` has just `PROC_ID, PROC_NAME`, and the charge rows carry no
   `PROC_CODE`/`CPT` column. But the 835-remittance service-line table `CL_RMT_SVCE_LN_INF` carries
   `PROC_IDENTIFIER` in the qualifier-prefixed `"HC:<code>[:modifier]"` shape (§27), and its
   `SVC_LINE_CHG_PB_ID` joins back to `ARPB_TRANSACTIONS.TX_ID`. In one specimen every PB charge resolved
   this way (29/29 charges had ≥1 remittance line with a code). Hospital-billing lines additionally carry
   line-level CPT in `HSP_TX_LINE_INFO.LL_CPT_CODE` and `HSP_CLP_CMS_LINE.HCPCS_CODES`. *Mechanism:* Epic
   strips the transmitted code from the charge/master rows (the same crosswalk friction labs hit with LOINC,
   §27), but the **payer's remittance echo** (the `CL_RMT_*` family = ANSI-835 tables, keyed `IMAGE_ID`)
   retains exactly what was billed. *Handle:* identify procedures by `PROC_NAME` + `MODIFIER_*`, and recover
   the billed CPT for adjudicated charges via Recipe 6; unadjudicated charges (no remittance yet) stay name-only.
   *Patient-friendly names:* `CLARITY_EAP_3.PT_FRIENDLY_NAME` carries layperson descriptions (e.g.
   "Hemoglobin A1C level") for **most charge-side `PROC_ID`s but is blank for every order-side one** — so to
   show a patient-friendly procedure name, resolve charge `PROC_ID`s with
   `COALESCE(NULLIF(CLARITY_EAP_3.PT_FRIENDLY_NAME,''), CLARITY_EAP.PROC_NAME)`; order-side names fall through
   to the coded `PROC_NAME`.
6. **Imaging has a result but no `ORDER_RESULTS`; labs are the reverse.** *Observe:* the 9 imaging orders
   have 0 `ORDER_RESULTS` rows but rich `ORDER_NARRATIVE`/`ORDER_IMPRESSION`; several FINAL labs have neither.
   *Mechanism:* a radiology result *is* prose — it lives in the narrative, not as discrete analytes. *Handle:*
   to "get the result" of a procedure, branch on `ORDER_TYPE_C_NAME`: imaging → narrative/impression; lab →
   `ORDER_RESULTS` (+ comments). Don't expect a single uniform result table. (See labs guide for FINAL labs
   that nonetheless have zero structured results.)
7. **`ORDER_CLASS_C_NAME = "Historical"` and `"Ancillary/Clinic Performed"` change provenance, not status.**
   *Observe:* some imaging/labs are class "Historical" (outside results scanned in); their imaging reads in
   `ORDER_RAD_READING.PROV_ID` resolve to "GENERIC EXTERNAL DATA PROVIDER". `RESULT_LAB_ID_LLB_NAME`
   (resulting-agency name) is populated on in-house orders but blank on these Historical/externally-imported
   imaging rows — for *those*, provenance comes from the reading-physician sentinel, not that column (don't
   write the column off as empty; it's a working provenance column for in-house work). *Mechanism:* Epic
   marks externally-sourced results as Historical so they don't re-bill/re-collect. *Handle:* class tells you
   whether the result was generated in-house vs imported; `ORDER_STATUS_C_NAME` (Completed/Canceled/Sent) is
   the lifecycle (§30).

## Recipes
```sql
-- 1. Every ordered procedure with its kind, name, date, status, and indication(s).
SELECT op.ORDER_PROC_ID, op.ORDERING_DATE, op.ORDER_TYPE_C_NAME, op.ORDER_CLASS_C_NAME,
       e.PROC_NAME, op.ORDER_STATUS_C_NAME,
       group_concat(DISTINCT d.DX_NAME) AS indications
FROM ORDER_PROC op
LEFT JOIN CLARITY_EAP e   ON op.PROC_ID = e.PROC_ID
LEFT JOIN ORDER_DX_PROC x ON op.ORDER_PROC_ID = x.ORDER_PROC_ID
LEFT JOIN CLARITY_EDG d   ON x.DX_ID = d.DX_ID
GROUP BY op.ORDER_PROC_ID
ORDER BY CAST(op.PAT_ENC_DATE_REAL AS REAL);

-- 2. Patient-reported surgical history (deduped — collapse the per-encounter re-snapshots).
--    last_reviewed via PAT_ENC_DATE_REAL: CONTACT_DATE is M/D/YYYY text, so MAX() over it sorts
--    lexically (returns 9/28/2023, not the true 12/4/2025) — same trap as the LINE warning above.
SELECT e.PROC_NAME,
       (SELECT pe2.CONTACT_DATE FROM SURGICAL_HX s2
        LEFT JOIN PAT_ENC pe2 ON s2.HX_LNK_ENC_CSN = pe2.PAT_ENC_CSN_ID
        WHERE s2.PROC_ID = s.PROC_ID
        ORDER BY CAST(pe2.PAT_ENC_DATE_REAL AS REAL) DESC LIMIT 1) AS last_reviewed
FROM SURGICAL_HX s
LEFT JOIN CLARITY_EAP e ON s.PROC_ID = e.PROC_ID
GROUP BY s.PROC_ID, e.PROC_NAME;

-- 3. Reassemble an imaging report (narrative) + its impression for one study.
--    NB: not every study has ORDER_IMPRESSION rows — some return narrative only, with the
--    impression living solely in the narrative tail. (e.g. 439060613 here is narrative-only.)
SELECT 'NARRATIVE' AS part, CAST(LINE AS INT) ln, NARRATIVE AS txt
FROM ORDER_NARRATIVE WHERE ORDER_PROC_ID = '1025926289'
UNION ALL
SELECT 'IMPRESSION', CAST(LINE AS INT), IMPRESSION
FROM ORDER_IMPRESSION WHERE ORDER_PROC_ID = '1025926289'
ORDER BY part, ln;

-- 4. Procedures as they hit pro-fee billing (charge name + modifiers + amount).
SELECT a.SERVICE_DATE, e.PROC_NAME, a.MODIFIER_ONE, a.PROCEDURE_QUANTITY, a.AMOUNT, a.PAT_ENC_CSN_ID
FROM ARPB_TRANSACTIONS a
LEFT JOIN CLARITY_EAP e ON a.PROC_ID = e.PROC_ID
WHERE a.TX_TYPE_C_NAME = 'Charge'
ORDER BY a.SERVICE_DATE;

-- 5. Co-locate orders and charges by encounter (since PROC_ID won't join across the boundary).
--    NB: this is a same-CSN fan, NOT a 1:1 line match — every charge on the contact pairs with every
--    order on it. Use it to see "what was ordered AND charged at this visit", then disambiguate by name/date.
SELECT op.ORDER_TYPE_C_NAME, eo.PROC_NAME AS ordered, ec.PROC_NAME AS charged, a.SERVICE_DATE
FROM ORDER_PROC op
LEFT JOIN CLARITY_EAP eo       ON op.PROC_ID = eo.PROC_ID
JOIN ARPB_TRANSACTIONS a       ON a.PAT_ENC_CSN_ID = op.PAT_ENC_CSN_ID AND a.TX_TYPE_C_NAME='Charge'
LEFT JOIN CLARITY_EAP ec       ON a.PROC_ID = ec.PROC_ID
ORDER BY a.SERVICE_DATE;

-- 6. Recover the transmitted CPT/HCPCS for a charge from the 835-remittance echo (Gotcha 5).
--    PROC_IDENTIFIER is qualifier-prefixed: 'HC:<code>' or 'HC:<code>:<modifier>' (§27).
SELECT a.TX_ID, a.SERVICE_DATE, e.PROC_NAME, r.PROC_IDENTIFIER
FROM ARPB_TRANSACTIONS a
LEFT JOIN CLARITY_EAP e        ON a.PROC_ID = e.PROC_ID
JOIN CL_RMT_SVCE_LN_INF r      ON r.SVC_LINE_CHG_PB_ID = a.TX_ID
WHERE a.TX_TYPE_C_NAME = 'Charge'
GROUP BY a.TX_ID, r.PROC_IDENTIFIER;   -- one charge can have several remittance lines (resubmissions)
```

## Open questions / specimen notes
- **No operative procedure exists in this specimen at all** — no OpTime/`OR_LOG` tables, and the only surgery
  (wisdom tooth extraction) is self-reported history with empty date/comment fields. The OR-case join path is
  therefore described from the genre, not verified here.
- **CPT/HCPCS is absent from `CLARITY_EAP` and `ARPB_TRANSACTIONS`** but recoverable from the remittance
  echo (`CL_RMT_SVCE_LN_INF.PROC_IDENTIFIER`, the "HC:" shape of §27) — see Gotcha 5 / Recipe 6. What remains
  open is coverage in *other* exports: charges never adjudicated by a payer have no remittance line to echo
  the code, so name-only identification is still the floor.
- `ORDER_PARENT_INFO` is mixed: 31/42 rows are self-referential (`ORDER_ID = PARENT_ORDER_ID`), but **11
  rows do encode a genuine parent→child link** (the `PARENT_ORDER_ID` is a distinct, present `ORDER_PROC_ID`).
  `PANEL_PROC_ID` on `ORDER_PROC` is unpopulated, so the panel-membership variant is still unobserved here.
- `TIMEOUT` (procedure safety time-out) exists with 2 rows but the type/attestation payload is blank — only
  the `PAT_CSN` + creation date survived the export, so it documents *that* a time-out occurred, not its content.
- `REFERRAL_PX.PX_ID` (procedures on a referral) is **order-side** EAP (in one specimen 10/10 match order-side
  `PROC_ID`s, 0 match charge-side) — it names the orderable being authorized, not the charge code.
