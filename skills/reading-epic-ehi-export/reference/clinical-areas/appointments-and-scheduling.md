# Appointments & scheduling — Epic EHI field guide

**Scope.** The scheduling layer of a visit: the appointment record (slot, department, provider,
start time), its lifecycle status (Scheduled / Completed / Canceled), the patient self-service
**eCheck-in** flow and its per-step detail, appointment letters/questionnaires, and the
video-visit / eVisit flags. Distinguishes a *scheduled appointment* from the *completed-visit*
encounter it becomes.

**Where it sits.** There is **no separate appointment id** — an appointment IS an encounter.
Every appointment fact hangs off `PAT_ENC_CSN_ID` (the encounter CSN, §2) and the patient
`PAT_ID`. The appointment is a *facet* of the encounter, carried partly in `PAT_ENC` itself and
partly in the keyed child table `PAT_ENC_APPT` and the wide `PAT_ENC_2..7` supplements (§8).

## Tables

| table | role | rows in specimen | notes |
|---|---|---|---|
| `PAT_ENC` | spine: carries `APPT_STATUS_C_NAME`, check-in/cancel actors, AVS print, dept/provider | 169 | appointment status lives **only** here; PK `PAT_ENC_CSN_ID`. See the *encounters* guide for the full PAT_ENC family. |
| `PAT_ENC_APPT` | appointment "skeleton": one row per provider on the appt, holds `PROV_START_TIME` (the slot time) | 74 | PK `(PAT_ENC_CSN_ID, LINE)`; `LINE` = provider in a joint appt (all `LINE=1` here — no joint appts). Thinner than the schema doc (§7). |
| `ECHKIN_STEP_INFO` | per-appointment **eCheck-in** steps (Allergies, Insurance, Questionnaires…) × status | 144 | PK `(CSN, LINE)`; covers 13 distinct appts. `LINE` stored as **text** (sorts lexically). |
| `PAT_ENC_4` | supplement: `ECHKIN_STATUS_C_NAME` (rollup of the eCheck-in flow), `VISIT_NUMBER` | 169 | 1:1 on CSN. |
| `PAT_REVIEW_DATA` | the eCheck-in review **outcome**: patient-entered review of allergies/meds/problems (Welcome kiosk / MyChart) | 169 | 1:1 companion of `PAT_ENC` on the CSN, no `LINE` — a §46 always-emit row, populated only when the patient actually reviewed: `PAT_ALG/MED/PROB_RVW_INFO_C_NAME` say what was asserted, `PAT_REVIEW_ELG/ORD/LPL_C_YN` flag eligibility. In one specimen only eCheck-in encounters carry values. |
| `PAT_ENC_5` | supplement: `EVISIT_STATUS_C_NAME`, `IS_ON_DEMAND_VV_YN` (on-demand video visit) | 169 | **both empty in this specimen** (columns exist, no eVisits/video visits occurred). Schema-doc coverage for it varies between DB builds — trust `pragma_table_info` over the doc either way (§7, §8). |
| `PAT_ENC_6` | supplement: `EVISIT_YN`, `EVISIT_RFV_C_NAME`, telehealth allowed-location flags, `RFV_USED_TO_SCHED_C_NAME` | 169 | eVisit fields **all empty here**. |
| `PAT_ENC_7` | supplement: `EVISIT_SUBMITTED_DTTM`, `EVISIT_TURNAROUND_IN_MINUTES` | 169 | empty here. |
| `PAT_ENC_2` | supplement: appointment-letter type + last-print instants (`APPT_LET_C_NAME`, `APPTMT_LET_INST`, `RESCHED_LET_INST`) | 169 | `APPT_LET_C_NAME` is the letter-*type* category (ZC_LET; can be "No Letter" — exclude it when counting); the `*_INST` columns are most-recent-print datetime *instants* (§19), populated only if a letter actually printed. In one specimen 18 encounters carry an appt-letter type but only 1 a print instant. |
| `KIOSK_QUESTIONNAIR` | questionnaires assigned to an appt (Welcome-kiosk/eCheck-in) | 20 | keyed `(CSN, LINE)`; carries `PAT_ID`, `KIOSK_QUEST_ID(_FORM_NAME)`. |
| `MYC_APPT_QNR_DATA` | MyChart questionnaires attached to an upcoming appt + their status | 20 | `(CSN, LINE)`; `PAT_APPT_QNR_STAT_C_NAME` (Assigned/…), `MYC_QUESR_START_DT`. |
| `APPT_LETTER_RECIPIENTS` | who receives the appt letter / should attend | 40 | `(CSN, LINE)`; `SHOULD_ATTEND_VISIT_YN`, `DID_ATTEND_VISIT_YN`. |
| `PAT_ENC_LETTERS` | a letter generated on an encounter (links to a note via `LETTER_HNO_ID`) | 1 | `(CSN, LINE)`; `LTR_STATUS_C_NAME`, `LETTER_REASON_C_NAME`. |
| `APPT_REQUEST` | appointment-request records (request workflow) | 22 | **stranded in this specimen**: only `REQUEST_ID` + a few blank flags; *no FK into the PAT_ENC family* — does not join to any encounter here. |
| `REFERRAL_APT` | appointments arising from a referral | 3 | keyed `(REFERRAL_ID, LINE_COUNT)` — **no** `PAT_ENC_CSN_ID` column; the encounter link is `SERIAL_NUMBER = PAT_ENC.PAT_ENC_CSN_ID` (a §4 renamed CSN, populated only for internal appts; the `EXT_*` columns describe external/outside appointments and may be empty). See *referrals* guide. |
| `ASSOCIATED_REFERRALS` | referrals linked to an appointment | 2 | peripheral. |

EMPTY / sparse worth knowing: the **eVisit and video-visit columns exist but carry no data here**
(`EVISIT_YN`, `EVISIT_STATUS_C_NAME`, `IS_ON_DEMAND_VV_YN` all NULL across 169 rows) — this org/patient
simply had none; another export may populate them. `PAT_ENC_5`/`6`/`7` are present and 1:1 but
mostly skeletal for this domain.

## How they join

- **Appointment ↔ encounter is 1:1 on the CSN.** `PAT_ENC_APPT.PAT_ENC_CSN_ID = PAT_ENC.PAT_ENC_CSN_ID`.
  Verified: 74 `PAT_ENC_APPT` rows, **74 distinct CSNs, all `LINE=1`, all 74 present in `PAT_ENC`**.
  An appointment is not a separate object — it is the scheduling facet of an encounter (§2).
- **Appointment department/provider.** `PAT_ENC_APPT.DEPARTMENT_ID → CLARITY_DEP.DEPARTMENT_ID
  (→ DEPARTMENT_NAME)`. Verified it **always equals** `PAT_ENC.DEPARTMENT_ID` (74/74 match). The
  rendering provider is on the encounter: `PAT_ENC.VISIT_PROV_ID → CLARITY_SER.PROV_ID (→ PROV_NAME)`
  — the documented `VISIT_PROV_ID_PROV_NAME` companion is **not materialized** here, so resolve via
  `CLARITY_SER` (§5, §6).
- **eCheck-in detail.** `ECHKIN_STEP_INFO.PAT_ENC_CSN_ID = PAT_ENC.PAT_ENC_CSN_ID`, then order steps
  by `CAST(LINE AS INTEGER)`. The roll-up status is `PAT_ENC_4.ECHKIN_STATUS_C_NAME` on the same CSN,
  and the review *outcome* (what the patient asserted about allergies/meds/problems) is
  `PAT_REVIEW_DATA` on the same CSN (1:1, §46). Verified: the 13 eCheck-in CSNs are all real
  appointments (12 `Completed` + 1 `Canceled`), a strict subset of the 23 status-bearing appts, and
  every populated `PAT_REVIEW_DATA` row falls within that eCheck-in set.
- **Questionnaires & letters.** `KIOSK_QUESTIONNAIR`, `MYC_APPT_QNR_DATA`, `APPT_LETTER_RECIPIENTS`,
  `PAT_ENC_LETTERS` all key on `PAT_ENC_CSN_ID` (+ `LINE`) (§9). `PAT_ENC_LETTERS.LETTER_HNO_ID`
  joins to the note master (HNO) — see *notes-documents* guide.
- **Supplement stack** for video/eVisit flags: left-join `PAT_ENC_4/5/6/7` on `PAT_ENC_CSN_ID`
  (strict 1:1, §8). Note `PAT_ENC_3` keys on `PAT_ENC_CSN` (no `_ID`) — not needed for this domain but
  a known join trap.

## Unstructured tie-back

Scheduling rows anchor several unstructured artifacts by **CSN**:
- **Appointment letters** → `PAT_ENC_LETTERS.LETTER_HNO_ID` points at an HNO note; the RTF body is in
  `raw/Rich Text/HNO_<NOTE_ID>_<inverted-date>_<seq>.RTF` (and/or `HNO_PLAIN_TEXT`) — match on the
  first number after the `HNO_` prefix (the filename is the FK, §14); the middle number is the §22
  date complement, and a literal `<id>.RTF` glob finds nothing. Example here: CSN 724619887 has a "Sent"
  MyChart-account letter authored by DHILLON, PUNEET S, `LETTER_HNO_ID=1473625808`.
- **Questionnaire content** → `KIOSK_QUESTIONNAIR`/`MYC_APPT_QNR_DATA` name the form
  (`*_FORM_NAME`, e.g. "UPH AMB PHQ2", "UPH MUP TRAVEL SCREENING"); the actual answer text lives in
  `V_EHI_HQA_QUEST_ANSWER.QUEST_ANSWER_EXTERNAL` (a §47 externalized-value view, keyed
  `(ANSWER_ID, LINE)`), bridged from messaging via `MYC_MESG_QUESR_ANS.QUESR_ANS_ID = ANSWER_ID`.
  `QUESR_LST_ANS_INFO` indexes which forms were answered per patient — but its `QUESR_ANS_CSN_ID` is
  the HQA answer record's **own** serial (the §2 generic-CSN trap), *not* an encounter CSN.
  `PAT_ENC_QNRS_ANS` ships as a no-content stub (only CSN, LINE, CONTACT_DATE) — don't expect
  answers there.
- **After-Visit Summary** is signaled in-row on `PAT_ENC` by `AVS_PRINT_TM` + `AVS_FIRST_USER_ID`
  (5 encounters here); the printed AVS PDF lives among the top-level/Media artifacts.
- The appointment's clinical notes attach to the same encounter CSN via the note tables — see the
  *notes-documents* and *encounters* guides.

## Gotchas & quirks (chased to *why*)

- **74 appt rows but only 23 carry a status.** `PAT_ENC_APPT` has 74 rows; `APPT_STATUS_C_NAME` is
  populated on only **23** encounters (19 Completed, 3 Canceled, 1 Scheduled). *Why:* the 23 are the
  encounters that were **truly scheduled through the slot system** — each has a real wall-clock
  `PROV_START_TIME` (e.g. "8/9/2018 9:30:00 AM") and a `CHECKIN_USER_ID`. The other 51 appt rows have
  **empty `PROV_START_TIME` and NULL `APPT_STATUS`**: they are encounters that got an appt skeleton row
  but were never booked into a provider slot (lab contacts, business-services contacts, walk-in /
  back-filled / externally-sourced visits). Verified cleanly: every status-bearing appt has a time,
  every status-NULL appt has no time. **Rule:** to enumerate *real appointments*, filter
  `APPT_STATUS_C_NAME IS NOT NULL` (or `PROV_START_TIME IS NOT NULL`), not "has a `PAT_ENC_APPT` row."
- **Appointment status ↔ derived encounter status are coupled, but not to closure.** Verified crosstab:
  `Completed`→`CALCULATED_ENC_STAT_C_NAME='Complete'`; `Canceled`→`'Invalid'`; `Scheduled`→`'Possible'`.
  *Why:* `APPT_STATUS_C_NAME` is the scheduler's state; `CALCULATED_ENC_STAT_C_NAME` is Epic's derived
  rollup of chart completeness (§30). A **canceled appointment is `Invalid` and is NOT chart-closed**
  (`ENC_CLOSED_YN` blank) — the encounter shell persists (§32) but holds no real visit. Don't count
  Canceled/Invalid contacts as visits.
- **`PROV_START_TIME` is a full datetime, not a clock time.** It renders as a date *and* time
  (`DATETIME (Local)` per the doc). The companion `CONTACT_DATE`/`PAT_ENC_DATE_REAL` render the day at
  midnight (§19). So `PROV_START_TIME` is the only place the actual **appointment time of day** lives —
  use it, not `CONTACT_DATE`, for "what time was the appointment."
- **eCheck-in can be *offered* without producing steps.** `PAT_ENC_4.ECHKIN_STATUS_C_NAME` can be
  "Not Started" / "Not Yet Available" with **zero** `ECHKIN_STEP_INFO` rows (verified: 4 "Not Started" +
  2 "Not Yet Available" have no step rows). *Why:* the rollup status is set when eCheck-in is *enabled*
  for the appt; the per-step rows are written when the system *evaluates* the step list (which steps
  apply / are offered) — **not** strictly on patient engagement. A "Not Started" rollup can still carry
  step rows whose statuses are all Not Started / Not Needed / Not Offered / Filtered, with zero actions.
  So row *existence* is not evidence the patient did anything: engagement is signaled by
  `STEP_ACTION_C_NAME` non-NULL and `STEP_COMPLETED_UTC_DTTM`. Step state is a value-pair: a coarse
  `ECHKIN_STEP_STAT_C_NAME` (Completed / In Progress / Not Needed / Not Offered / Filtered / Not Started)
  plus a finer `STEP_ACTION_C_NAME` (Completed / Verified / Updated / Skipped) — both lists are values
  *observed in one specimen*, not the full category tables; the rollup likewise shows
  Completed / In Progress / Not Started / Not Yet Available.
- **`ECHKIN_STEP_INFO.LINE` is stored as text** (`typeof(LINE)='text'`), so a plain `ORDER BY LINE`
  yields 1, 10, 11, …, 2, 3 — reassemble steps with `ORDER BY CAST(LINE AS INTEGER)` (§17).
- **No appointment *type*, no cancel *reason*, no no-show field.** The PAT_ENC family carries no
  **usable** appointment/visit-type column — the only type-named columns in the family
  (`PAT_ENC_6.HUS_VISIT_TYPE_C_NAME`, an org-specific reporting axis, and
  `PAT_ENC_BILLING_ENC.BILLING_ENC_TYPE_C_NAME`, a billing axis) ship empty here, so a naive
  `pragma` scan for `%TYPE%` finds only decoys; visit type must be *inferred* — see the *encounters*
  guide. For cancellations, the family ships only the **actor** (`APPT_CANC_USER_ID` / `APPT_CANC_USER_ID_NAME`,
  e.g. "MANIX, PATRICIA A") with **no** cancel-reason or no-show category column anywhere in the family.
  Don't expect to know *why* an appt was canceled from these tables.
- **`PAT_ENC_APPT` is thinner than its schema doc (§7).** The doc lists ordinal 4 as
  `DEPARTMENT_ID_EXTERNAL_NAME`, but the TSV ships bare `DEPARTMENT_ID`. Actual columns:
  `PAT_ENC_CSN_ID, LINE, CONTACT_DATE, DEPARTMENT_ID, PROV_START_TIME`. Confirm with
  `pragma_table_info` before querying.
- **`APPT_REQUEST` is stranded here (§41).** It has 22 rows of bare `REQUEST_ID` + blank flags and **no
  column that joins to `PAT_ENC`** in this specimen. Appointment-request → encounter linkage, if any,
  would need a bridge table this export doesn't populate. Treat it as a separate, unjoinable view.

## Recipes

```sql
-- 1) All real appointments (booked into a slot) with time, dept, provider, status
SELECT e.CONTACT_DATE, a.PROV_START_TIME, e.APPT_STATUS_C_NAME,
       dep.DEPARTMENT_NAME, ser.PROV_NAME
FROM PAT_ENC e
JOIN PAT_ENC_APPT a USING (PAT_ENC_CSN_ID)
LEFT JOIN CLARITY_DEP dep ON a.DEPARTMENT_ID = dep.DEPARTMENT_ID
LEFT JOIN CLARITY_SER ser ON e.VISIT_PROV_ID = ser.PROV_ID
WHERE e.APPT_STATUS_C_NAME IS NOT NULL          -- = has a real PROV_START_TIME
ORDER BY CAST(e.PAT_ENC_DATE_REAL AS REAL);     -- never ORDER BY the text date (§18)

-- 2) Scheduled (future / not-yet-completed) vs completed vs canceled
SELECT APPT_STATUS_C_NAME, COUNT(*) n
FROM PAT_ENC
WHERE APPT_STATUS_C_NAME IS NOT NULL
GROUP BY 1 ORDER BY n DESC;

-- 3) eCheck-in steps for one appointment, in order, with what the patient did
SELECT CAST(LINE AS INTEGER) step, INCLUDED_STEP_C_NAME,
       ECHKIN_STEP_STAT_C_NAME, STEP_ACTION_C_NAME, STEP_COMPLETED_UTC_DTTM
FROM ECHKIN_STEP_INFO
WHERE PAT_ENC_CSN_ID = :csn
ORDER BY CAST(LINE AS INTEGER);

-- 4) Which appointments used eCheck-in, and the rollup outcome
SELECT e.CONTACT_DATE, e.APPT_STATUS_C_NAME, e4.ECHKIN_STATUS_C_NAME,
       COUNT(s.LINE) AS n_step_rows
FROM PAT_ENC e
JOIN PAT_ENC_4 e4 USING (PAT_ENC_CSN_ID)
LEFT JOIN ECHKIN_STEP_INFO s USING (PAT_ENC_CSN_ID)
WHERE e4.ECHKIN_STATUS_C_NAME IS NOT NULL
GROUP BY e.PAT_ENC_CSN_ID
ORDER BY CAST(e.PAT_ENC_DATE_REAL AS REAL);

-- 5) Canceled appointments + who canceled them (no reason field exists)
SELECT CONTACT_DATE, APPT_CANC_USER_ID_NAME, CALCULATED_ENC_STAT_C_NAME
FROM PAT_ENC
WHERE APPT_STATUS_C_NAME = 'Canceled'
ORDER BY CAST(PAT_ENC_DATE_REAL AS REAL);

-- 6) Questionnaires attached to upcoming appointments
SELECT q.PAT_ENC_CSN_ID, q.CONTACT_DATE, q.MYC_APPT_QUESR_ID_FORM_NAME,
       q.PAT_APPT_QNR_STAT_C_NAME, q.MYC_QUESR_START_DT
FROM MYC_APPT_QNR_DATA q
ORDER BY CAST(q.PAT_ENC_DATE_REAL AS REAL), CAST(q.LINE AS INTEGER);

-- 7) What did the patient actually DO at check-in? Actions taken (not mere step
--    evaluation) + the allergy/med/problem review outcome
SELECT s.PAT_ENC_CSN_ID, s.INCLUDED_STEP_C_NAME, s.STEP_ACTION_C_NAME,
       r.PAT_ALG_RVW_INFO_C_NAME, r.PAT_MED_RVW_INFO_C_NAME, r.PAT_PROB_RVW_INFO_C_NAME
FROM ECHKIN_STEP_INFO s
LEFT JOIN PAT_REVIEW_DATA r USING (PAT_ENC_CSN_ID)
WHERE s.STEP_ACTION_C_NAME IS NOT NULL          -- row existence ≠ engagement (see gotchas)
ORDER BY s.PAT_ENC_CSN_ID, CAST(s.LINE AS INTEGER);
```

## Open questions / specimen notes

- **eVisit / video-visit are unexercised here.** Every `EVISIT_YN`, `EVISIT_STATUS_C_NAME`, and
  `IS_ON_DEMAND_VV_YN` is NULL across 169 encounters — so the *shape* of those flags (which supplement
  carries them: `EVISIT_*` in `PAT_ENC_5/6/7`, on-demand video in `PAT_ENC_5`) is documented from the
  schema, not exercised against populated rows. On an export with telehealth, expect `EVISIT_YN='Y'`
  to mark asynchronous eVisits and `IS_ON_DEMAND_VV_YN`/telehealth-location flags to mark video visits;
  verify their interplay with `APPT_STATUS` there.
- **`APPT_REQUEST` linkage** to encounters could not be established in this specimen (no FK present).
  Whether another export ships a `REQUEST_ID`→CSN bridge is unconfirmed.
- **Specimen scale:** 23 real appointments (19 Completed, 3 Canceled, 1 future Scheduled on 6/16/2027
  — the §43 "data dated after export" case), 51 appt-skeleton rows without a slot, eCheck-in exercised
  on 13 appointments, no joint (multi-provider) appointments (all `PAT_ENC_APPT.LINE=1`).
