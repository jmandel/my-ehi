# Encounters & visits — Epic EHI field guide

**Scope.** The encounter/contact backbone: `PAT_ENC` and its `_2…_8` supplements, the CSN contact model,
how related contacts assemble into one logical visit, closure/calculated status, departments and visit
providers, encounter diagnoses (`PAT_ENC_DX`), reasons-for-visit (`PAT_ENC_RSN_VISIT`), disposition/E&M
level (`PAT_ENC_DISP`), and inferring an encounter *type* that Epic does **not** export as a code.

**Where it sits.** This domain **is** the hub. Every clinical fact (orders, results, vitals, notes, dx,
meds snapshots) back-links to an encounter by `PAT_ENC_CSN_ID`; every encounter back-links to the patient
by `PAT_ID`. If you only learn one join in the whole export, learn `child.PAT_ENC_CSN_ID = PAT_ENC.PAT_ENC_CSN_ID`.

## Tables

| table | role | rows in specimen | notes |
|---|---|---|---|
| `PAT_ENC` | **Spine.** One row per contact; PK `PAT_ENC_CSN_ID`. Date, visit/PCP provider, department, appt status, closure, calc status, AVS, copay/coverage/account IDs. | 169 | All 169 CSNs distinct: one base row per contact. |
| `PAT_ENC_2` | Supplement: vitals (`PHYS_BP`/`PHYS_TEMP`/`PHYS_SPO2`), smoking, cosigner/supervising prov, tel-message fields, `PARENT_ENC_CSN_ID`, visit payor. | 169 | 1:1 on `PAT_ENC_CSN_ID`. |
| `PAT_ENC_3` | Supplement: billing area, checkout user, copay calc, referral type, self-pay. | 169 | **Join trap:** key column is `PAT_ENC_CSN` (no `_ID`). |
| `PAT_ENC_4` | Supplement: `VISIT_NUMBER`, eCheck-in status, copay collection, `ORIG_ENC_CSN`, BCRA inputs. | 169 | 1:1. |
| `PAT_ENC_5` | Supplement: prepay/discount, `EVISIT_STATUS_C_NAME`, `ATTR_DEPARTMENT_ID`, video-visit flag. | 169 | 1:1. (Discovery report said its schema doc was missing; in this DB build it documents 34 cols — see Gotchas.) |
| `PAT_ENC_6` | Supplement: `LINKED_ENC_CSN`, eVisit fields (`EVISIT_YN`, `EVISIT_RFV_C_NAME`), telehealth loc flags. | 169 | 1:1. |
| `PAT_ENC_7` | Supplement: notification flags, `CONTACT_NUM`, ABN, eVisit submit/turnaround, contraception counseling. | 169 | 1:1. |
| `PAT_ENC_8` | Tiny supplement (7 cols): re-carries `PAT_ID`+`CONTACT_DATE`, case-mgmt owner, payment-plan agreement ID. | 169 | 1:1. |
| `PAT_ENC_APPT` | Appointment skeleton; PK `PAT_ENC_CSN_ID`+`LINE` (LINE = provider within a joint appt). `DEPARTMENT_ID`, `PROV_START_TIME`. | 74 | Presence ≈ "was a scheduled appointment." No multi-LINE (joint) appts here: `MAX(LINE)=1`. |
| `PAT_ENC_DX` | Encounter-level diagnoses; PK CSN+`LINE`. `DX_ID`, `PRIMARY_DX_YN`, `DX_CHRONIC_YN`, `DX_ED_YN`, `DX_LINK_PROB_ID`. | 48 | `DX_ID`→`CLARITY_EDG`. |
| `PAT_ENC_RSN_VISIT` | Reason-for-visit; PK CSN+`LINE`. `ENC_REASON_ID`, `RFV_ONSET_DT`, body location. | 31 | `ENC_REASON_ID`→`CL_RSN_FOR_VISIT`. |
| `PAT_ENC_DISP` | Disposition / E&M level-of-service: `LOS_NEW_OR_EST_C_NAME`, hx/exam/MDM levels, `LOS_AUTH_PROV_ID`. | 14 | One row per encounter that got an E&M code. |
| `PAT_ENC_LOS_DX` | The dx lines attached to the E&M level-of-service charge (CSN+`LINE`, just `DX_UNIQUE`). | 28 | Sub-list of LOS; not the same as `PAT_ENC_DX`. |
| `PAT_ENC_THREADS` | One row per encounter; `THREAD_ID` non-null only for in-basket-threaded **telephone** encounters. | 169 | 27 have a `THREAD_ID` → telephone-encounter marker. |
| `PAT_ENC_HSP` / `PAT_ENC_HSP_2` | Hospital/ADT supplement for facility-style contacts. `ADT_PAT_CLASS_C_NAME`, `HOSP_ADMSN_TIME`, `HOSP_DISCH_TIME`, disch disp. | 2 / 2 | **Not real admissions here** — both `ADT_PAT_CLASS_C_NAME='Therapies Series'` (outpatient OT). |
| `PAT_ENC_CURR_MEDS` | Per-encounter active-med snapshot (CSN+`LINE`); a *different id space* from `ORDER_MED` (§24). | 241 | Even automated contacts carry one. |
| `PAT_ENC_BILLING_ENC` | Billing-linkage row per encounter; `BILLING_ENC_TYPE_C_NAME`. | 169 | **`BILLING_ENC_TYPE_C_NAME` is 100% NULL here** — the one promisingly-named type column is empty. |
| `PAT_ENC_PAS` / `_CALL_DATA` / `_CC_AUTO_CHG` / `_ELIG_HISTORY` / `_SEL_PHARMACIES` / `_DOCS` / `_LETTERS` | Peripheral per-encounter sidecars (patient-access status, call data, auto-charges, eligibility checks, selected pharmacies, attached docs, generated letters). | 169 / 169 / 169 / 33 / 6 / 12 / 1 | Hang off CSN; mostly registration/billing plumbing. |
| `ECHKIN_STEP_INFO` | eCheck-in steps per appointment (CSN+`LINE`): `INCLUDED_STEP_C_NAME` × `ECHKIN_STEP_STAT_C_NAME`. | 144 | Covers 13 appointments. |
| `PAT_ENC_ADMIT_DX_AUDIT` / `_COMM_MGT` / `_QNRS_ANS` / `_IP_MEDS` | Sparse/edge sidecars. | 1 / 1 / 1 / 8 | Mostly empty for an outpatient record; flagged so you know they exist. |

Master/lookup tables this domain joins to: `CLARITY_SER` (providers), `CLARITY_DEP` (departments),
`CLARITY_EDG` (diagnoses), `CL_RSN_FOR_VISIT` (reasons). Each is a slim 3-col id→name file here.

## How they join

- **Base ↔ supplements (1:1 stack, §6).** `PAT_ENC` ⋈ `PAT_ENC_2/4/5/6/7/8` on `PAT_ENC_CSN_ID`; all are
  exactly 169 rows. **`PAT_ENC_3` is the exception:** its key is `PAT_ENC_CSN` (no `_ID`).
  Verified: `SELECT COUNT(*) FROM PAT_ENC_3 a JOIN PAT_ENC b ON a.PAT_ENC_CSN=b.PAT_ENC_CSN_ID` = 169.
  Left-join the whole stack to reconstruct the full wide encounter record.
- **Child fact tables ↔ encounter (CSN, §2).** `PAT_ENC_DX`, `PAT_ENC_RSN_VISIT`, `PAT_ENC_DISP`,
  `PAT_ENC_APPT`, `ECHKIN_STEP_INFO`, `PAT_ENC_CURR_MEDS` all carry `PAT_ENC_CSN_ID` (+`LINE` for the
  list ones). Verified each LINE-keyed child reassembles in `LINE` order (e.g. CSN 1031703883:
  LINE 1 = RIB INJURY, LINE 2 = RIB PAIN).
- **Visit provider → name.** `PAT_ENC.VISIT_PROV_ID` → `CLARITY_SER.PROV_ID` → `PROV_NAME`. Verified:
  144590 = "RAMMELKAMP, ZOE L" (PCP, 27 enc), 802011 = "DHILLON, PUNEET S", 3724611 = "MAC LAB APL".
  The documented denormalized companion `VISIT_PROV_ID_PROV_NAME` is **not materialized** (§4/§5); only
  `VISIT_PROV_ID` + `VISIT_PROV_TITLE_NAME` ("MD") ship. `PCP_PROV_ID` resolves the same way.
- **Department → name.** `PAT_ENC.DEPARTMENT_ID` → `CLARITY_DEP.DEPARTMENT_ID` → `DEPARTMENT_NAME`.
  Verified: 1700801002 = "MAC APL INTERNAL MEDICINE" (57 enc), 1700801005 = "MAC APL LABORATORY",
  8 = "GENERIC EXTERNAL DATA DEPARTMENT" (the catch-all for externally-loaded data).
- **Encounter dx → name.** `PAT_ENC_DX.DX_ID` → `CLARITY_EDG.DX_ID` → `DX_NAME`. Verified (15362 =
  "Screening for diabetes mellitus"). `DX_LINK_PROB_ID` ties an encounter dx to a `PROBLEM_LIST` entry.
- **Reason → name.** `PAT_ENC_RSN_VISIT.ENC_REASON_ID` → `CL_RSN_FOR_VISIT.REASON_VISIT_ID` →
  `REASON_VISIT_NAME`. Verified (160383 = "MEDICATION REFILL", 83 = "ANNUAL EXAM"). The companion
  `ENC_REASON_ID_REASON_VISIT_NAME` is **not** materialized — join the master.
- **Encounter chaining (CSN→CSN).** `PAT_ENC_2.PARENT_ENC_CSN_ID`, `PAT_ENC_4.ORIG_ENC_CSN`,
  `PAT_ENC_6.LINKED_ENC_CSN` each point at *another* CSN, letting you chain related contacts (e.g. a
  telephone follow-up linked to its source visit).

## Unstructured tie-back

Encounters anchor nearly all unstructured content **by CSN**:

- **Clinical notes.** Tie notes back via **`HNO_INFO.PAT_ENC_CSN_ID`** (populated on 77/188 rows; the rest
  are notes with no encounter link). **Caution:** `NOTE_ENC_INFO.PAT_ENC_CSN_ID` is **NULL on all 194 rows**
  — that table links by its own `CONTACT_SERIAL_NUM`, *not* the encounter CSN (general-patterns §2/§4). The
  rich-text body lives only at `Rich Text/<NOTE_ID>...RTF` (there is no DB body column). So:
  `PAT_ENC` → `HNO_INFO` (on `PAT_ENC_CSN_ID`) → `NOTE_ID` → the RTF file. See the
  `clinical-notes-and-documents` guide for the filename's inverted-date component.
- **Messages.** MyChart messages tie back through `MSG_ROUTING_PAT_ENC` / `PAT_MYC_MESG` to a CSN; for
  **telephone encounters**, `PAT_ENC_THREADS.THREAD_ID` links the contact to its in-basket message thread.
- **After-Visit Summary.** Signaled in-row on `PAT_ENC` by `AVS_PRINT_TM` + `AVS_FIRST_USER_ID` (5
  encounters here) — not a separate table; the rendered AVS PDF lives at the repo top level.
- **eCheck-in questionnaires / letters.** `ECHKIN_STEP_INFO`, plus `PAT_ENC_LETTERS` hang off the appt CSN.

## Gotchas & quirks (chased to *why*)

1. **Encounter TYPE is not a coded column — it must be inferred.** *Observed:* there is no
   `ENC_TYPE_C`/`VISIT_TYPE_C`/`APPT_TYPE` anywhere in the `PAT_ENC` family; a DB-wide sweep finds
   `ENC_TYPE_C_NAME` only in unrelated tables (`PYR_FEEDBACK`), and `PAT_ENC_BILLING_ENC.BILLING_ENC_TYPE_C_NAME`
   is 100% NULL. *Why:* Epic's `PAT_ENC.ENC_TYPE_C` exists in Chronicles but this export's table set simply
   does not surface it (the Epic doc even notes `PAT_ENC` excludes registration/PCP-change types). *Handle:*
   infer type from **companion-table presence + status columns**:
   - `PAT_ENC_APPT` row present (and/or `APPT_STATUS_C_NAME` non-null) ⇒ scheduled appointment / office visit;
   - `PAT_ENC_THREADS.THREAD_ID` non-null ⇒ **telephone encounter** (27 here);
   - `PAT_ENC_HSP` row / `HOSP_ADMSN_TIME` non-null ⇒ facility/ADT contact (but read `ADT_PAT_CLASS_C_NAME` — here it's outpatient therapy, not admission);
   - `PAT_ENC_6.EVISIT_YN='Y'` ⇒ eVisit (0 here);
   - neither department nor visit provider, no appt/dx/orders ⇒ an **automated/system contact** (see #4).

2. **One logical visit = many CSN contacts on the same day (§2, §10).** *Observed:* day 64869 (8/9/2018)
   has four `PAT_ENC` rows: `64869.00` (Completed office visit, Internal Med, Dr. Dhillon), `.01` (Business
   Services), `.02` (a second IM contact), `.03` (Laboratory, provider "MAC LAB APL"). *Why:* the CSN is a
   **contact** serial, not a visit; the office visit, its lab draw, and the billing contact each mint their
   own CSN, and the **two-digit fraction of `PAT_ENC_DATE_REAL` sequences them within the day**. *Handle:*
   to recover "the visit," group contacts by calendar day (`FLOOR(PAT_ENC_DATE_REAL)`) — or follow the
   `PARENT_ENC_CSN_ID`/`LINKED_ENC_CSN`/`ORIG_ENC_CSN` chains — rather than counting `PAT_ENC` rows.

3. **`CONTACT_DATE` sorts lexically and lies; `PAT_ENC_DATE_REAL` is the only real sort key (§10).**
   *Observed:* `MIN(CONTACT_DATE)`='1/2/2026', `MAX(CONTACT_DATE)`='9/8/2020' — nonsense, because the date
   is rendered text ("M/D/YYYY 12:00:00 AM"). The true range is `DATE_REAL` 64869 (8/9/2018) → 68102. *Why:*
   `CONTACT_DATE` is an effective calendar string (always midnight); `PAT_ENC_DATE_REAL` is the float
   (integer = days since 1840-12-31). *Handle:* always `ORDER BY CAST(PAT_ENC_DATE_REAL AS REAL)`.

4. **A long run of "phantom" monthly contacts.** *Observed:* dozens of encounters dated the **25th of
   consecutive months** (10/25/2018, 11/25/2018, …) with NULL department, NULL provider, NULL appt status,
   no dx/reason/orders, `ENC_CLOSED_YN='Y'`. 95 encounters here have neither department nor provider.
   *Why:* these are **automated/recurring system contacts** (refill-protocol / administrative), not visits;
   they populate only the universal skeleton supplements and a `PAT_ENC_CURR_MEDS` snapshot (§26). *Handle:*
   exclude `DEPARTMENT_ID IS NULL AND VISIT_PROV_ID IS NULL AND APPT_STATUS_C_NAME IS NULL` (and check for
   absence of dx/orders) before treating a row as a clinical visit; don't read `MAX(date)` as "last care."

5. **Closure ≠ calculated completeness (two independent status axes, §16).** *Observed cross-tab:*
   135 closed+Complete, 25 blank-closed+Complete, 3 blank-closed+Invalid, 2 `N`+Invalid, 1 +Possible.
   *Why:* `ENC_CLOSED_YN`/`ENC_CLOSE_DATE`/`ENC_CLOSED_USER_ID` record **manual chart closure**, while
   `CALCULATED_ENC_STAT_C_NAME` is Epic's **derived rollup** (Complete/Invalid/Possible). They diverge — an
   encounter can be calc-Complete yet never formally closed, and the `Invalid` ones are the canceled/error
   contacts. *Handle:* don't equate "closed" with "complete"; filter on whichever axis you actually mean.

6. **`PAT_ENC_HSP` is not an admission here.** *Observed:* the only 2 hospital-supplement rows have
   `ADT_PAT_CLASS_C_NAME='Therapies Series'` (outpatient OT-Neuro). *Why:* outpatient therapy *series* reuse
   the ADT/HSP machinery to track arrival/discharge, so an `HOSP_ADMSN_TIME` doesn't imply an inpatient
   stay. *Handle:* always read `ADT_PAT_CLASS_C_NAME` before calling a `PAT_ENC_HSP` row an admission.

7. **Supplement schema docs can be incomplete *or back-filled* between builds.** *Observed:* the prior
   discovery report flagged `PAT_ENC_5` as having **no** `_schema_column` doc; in the current DB it documents
   all 34 columns (doc cols == actual cols for every `PAT_ENC_N`). *Why:* the schema-doc loader is a separate
   pass and its coverage can change between loads; §6 warns a supplement may ship data with no doc. *Handle:*
   never assume doc presence; always `PRAGMA table_info` for the real columns, and treat any per-supplement
   doc count in another analyst's notes as a snapshot, not a constant.

8. **`PAT_ENC_DX` vs `PAT_ENC_LOS_DX` are different.** `PAT_ENC_DX` is the clinical encounter diagnosis list
   (with `DX_ID`, primary/chronic flags, problem-link). `PAT_ENC_LOS_DX` is the much thinner dx pointer list
   attached to the **E&M level-of-service charge** (`PAT_ENC_DISP`). Don't substitute one for the other.

## Recipes

```sql
-- 1. The encounter timeline (true chronological order), one row per contact, with names resolved.
SELECT CAST(e.PAT_ENC_DATE_REAL AS REAL) AS day_real,
       e.CONTACT_DATE, e.PAT_ENC_CSN_ID,
       d.DEPARTMENT_NAME, s.PROV_NAME AS visit_prov,
       e.APPT_STATUS_C_NAME, e.CALCULATED_ENC_STAT_C_NAME, e.ENC_CLOSED_YN
FROM PAT_ENC e
LEFT JOIN CLARITY_DEP d ON e.DEPARTMENT_ID = d.DEPARTMENT_ID
LEFT JOIN CLARITY_SER s ON e.VISIT_PROV_ID = s.PROV_ID
ORDER BY day_real;

-- 2. "Real" clinical visits only (drop automated/system skeleton contacts).
SELECT e.PAT_ENC_CSN_ID, e.CONTACT_DATE, d.DEPARTMENT_NAME, s.PROV_NAME
FROM PAT_ENC e
LEFT JOIN CLARITY_DEP d ON e.DEPARTMENT_ID = d.DEPARTMENT_ID
LEFT JOIN CLARITY_SER s ON e.VISIT_PROV_ID = s.PROV_ID
WHERE NOT (e.DEPARTMENT_ID IS NULL AND e.VISIT_PROV_ID IS NULL AND e.APPT_STATUS_C_NAME IS NULL)
ORDER BY CAST(e.PAT_ENC_DATE_REAL AS REAL);

-- 3. Reconstruct ONE logical visit: reasons, diagnoses, disposition for a CSN.
SELECT 'reason' kind, r.LINE, c.REASON_VISIT_NAME AS label
FROM PAT_ENC_RSN_VISIT r LEFT JOIN CL_RSN_FOR_VISIT c ON r.ENC_REASON_ID=c.REASON_VISIT_ID
WHERE r.PAT_ENC_CSN_ID = :csn
UNION ALL
SELECT 'dx', dx.LINE, g.DX_NAME || CASE WHEN dx.PRIMARY_DX_YN='Y' THEN ' (primary)' ELSE '' END
FROM PAT_ENC_DX dx LEFT JOIN CLARITY_EDG g ON dx.DX_ID=g.DX_ID
WHERE dx.PAT_ENC_CSN_ID = :csn
ORDER BY 1,2;

-- 4. Infer encounter type from companion-table signals.
SELECT e.PAT_ENC_CSN_ID, e.CONTACT_DATE,
  CASE
    WHEN t.THREAD_ID IS NOT NULL                         THEN 'telephone'
    WHEN h.PAT_ENC_CSN_ID IS NOT NULL                    THEN 'facility/ADT'
    WHEN e6.EVISIT_YN='Y'                                THEN 'eVisit'
    WHEN a.PAT_ENC_CSN_ID IS NOT NULL
      OR e.APPT_STATUS_C_NAME IS NOT NULL                THEN 'scheduled appt/office visit'
    WHEN e.DEPARTMENT_ID IS NULL AND e.VISIT_PROV_ID IS NULL THEN 'automated/system contact'
    ELSE 'other contact'
  END AS inferred_type
FROM PAT_ENC e
LEFT JOIN PAT_ENC_THREADS t ON e.PAT_ENC_CSN_ID=t.PAT_ENC_CSN_ID
LEFT JOIN (SELECT DISTINCT PAT_ENC_CSN_ID FROM PAT_ENC_HSP) h ON e.PAT_ENC_CSN_ID=h.PAT_ENC_CSN_ID
LEFT JOIN (SELECT DISTINCT PAT_ENC_CSN_ID FROM PAT_ENC_APPT) a ON e.PAT_ENC_CSN_ID=a.PAT_ENC_CSN_ID
LEFT JOIN PAT_ENC_6 e6 ON e.PAT_ENC_CSN_ID=e6.PAT_ENC_CSN_ID
ORDER BY CAST(e.PAT_ENC_DATE_REAL AS REAL);

-- 5. Full wide encounter record (left-join the supplement stack; note PAT_ENC_3's odd key).
SELECT e.*, e2.*, e3.*, e4.*, e5.*, e6.*, e7.*, e8.*
FROM PAT_ENC e
LEFT JOIN PAT_ENC_2 e2 ON e.PAT_ENC_CSN_ID=e2.PAT_ENC_CSN_ID
LEFT JOIN PAT_ENC_3 e3 ON e.PAT_ENC_CSN_ID=e3.PAT_ENC_CSN   -- <-- PAT_ENC_CSN, not _ID
LEFT JOIN PAT_ENC_4 e4 ON e.PAT_ENC_CSN_ID=e4.PAT_ENC_CSN_ID
LEFT JOIN PAT_ENC_5 e5 ON e.PAT_ENC_CSN_ID=e5.PAT_ENC_CSN_ID
LEFT JOIN PAT_ENC_6 e6 ON e.PAT_ENC_CSN_ID=e6.PAT_ENC_CSN_ID
LEFT JOIN PAT_ENC_7 e7 ON e.PAT_ENC_CSN_ID=e7.PAT_ENC_CSN_ID
LEFT JOIN PAT_ENC_8 e8 ON e.PAT_ENC_CSN_ID=e8.PAT_ENC_CSN_ID
WHERE e.PAT_ENC_CSN_ID = :csn;
```

## Open questions / specimen notes

- **What drives the monthly-25th automated contacts** isn't fully provable from the encounter tables alone
  (likely a refill-protocol / recurring charge-or-registration job). They carry a `PAT_ENC_CURR_MEDS`
  snapshot but no dx/orders/department.
- **Appt-skeleton mismatch (specimen):** 74 encounters have a `PAT_ENC_APPT` row but only 23 carry
  `APPT_STATUS_C_NAME`; the extra rows look like appt skeletons back-filled for past contacts. Cross-check
  against scheduling/slot tables if you need exact appointment provenance.
- **Specimen counts** (illustrative, this patient): 169 contacts spanning 8/9/2018 → future scheduled
  contacts; 57 at MAC APL Internal Medicine; PCP Zoe L Rammelkamp (27 enc); 19 Completed / 3 Canceled /
  1 Scheduled appointments; 27 telephone-threaded; 48 encounter dx; 31 reasons; 14 dispositions (1 New —
  the 8/9/2018 establishing visit — the rest Established); 2 outpatient-therapy `PAT_ENC_HSP` rows.
- **No true inpatient/ED encounter** exists in this specimen, so admission/discharge mechanics
  (`PAT_ENC_HSP_2`, disch disposition) are present but exercised only by outpatient therapy series.
