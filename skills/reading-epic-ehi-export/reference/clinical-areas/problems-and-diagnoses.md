# Problems & diagnoses — Epic EHI field guide
**Scope.** The patient's **problem list** (chronic/active conditions tracked over time) and **encounter
diagnoses** (the dx coded on each visit), the two clinician/patient **review** channels that attest to the
list, and the **diagnosis master file** (`CLARITY_EDG`) every `DX_ID` resolves through.

**Where it sits.** Problems live on the **LPL** (Problem List) master file, keyed by `PROBLEM_LIST_ID`,
tied to the patient by `PAT_ID` (via `PROBLEM_LIST_ALL` / `PAT_PROBLEM_LIST`). Encounter diagnoses
(`PAT_ENC_DX`) are keyed to a visit by `PAT_ENC_CSN_ID` and back-link to a problem by `DX_LINK_PROB_ID`.
Both sides name a diagnosis by `DX_ID` → `CLARITY_EDG`.

## Tables

| table | role | rows in specimen | notes |
|---|---|---|---|
| `PROBLEM_LIST` | **Spine.** Current state of every problem ever on the list (active, resolved, deleted all persist). One row per `PROBLEM_LIST_ID`. | 5 | Carries `DX_ID`, `DESCRIPTION` (blank in this specimen — name comes from `CLARITY_EDG`), `NOTED_DATE`/`NOTED_END_DATE` (fuzzy onset), `RESOLVED_DATE`, `DATE_OF_ENTRY` (last edit), `PROBLEM_STATUS_C_NAME`, `CHRONIC_YN`, `SHOW_IN_MYC_YN`, `OVERVIEW_NOTE_ID`, `PROBLEM_CMT`. |
| `PAT_PROBLEM_LIST` | The patient's ordered **pointer list** — which LPL ids appear on the chart, in display order. | 5 | `(PAT_ID, LINE, PROBLEM_LIST_ID)`. Includes resolved problems (not "active-only"). |
| `PROBLEM_LIST_ALL` | Generic **index of every LPL record** for the patient, of any type. | 56 | `RECORD_TYPE_C_NAME` partitions: Problem List, Immunization, Allergy, **System**. Maps each `PROBLEM_LIST_ID`→`PAT_ID`. `HX_SOURCE_ID` (type-7→type-1 link) NULL here. |
| `PROBLEM_LIST_HX` | **Change-audit / version history** of each problem, one `LINE` per edit. | 6 | `(PROBLEM_LIST_ID, LINE)`. `HX_STATUS_C_NAME`, `HX_DATE_OF_ENTRY` (effective) vs `HX_ENTRY_INST` (instant), `HX_ENTRY_USER_ID`, `HX_PROBLEM_EPT_CSN` (the encounter the edit happened in), `HX_PROBLEM_ID` (= the `DX_ID`). |
| `PROB_UPDATES` | Over-time **single-response contact log** for ALL LPL records (shared master). | 60 | `(PROBLEM_LIST_ID, CONTACT_DATE_REAL)`. `CONTACT_SERIAL_NUM` = LPL contact serial (NOT a patient CSN). `EPT_CSN` is the patient-encounter link (NULL here). 9 of 60 rows are the 5 problems; the rest belong to immunizations/allergies/system records. |
| `PAT_ENC_DX` | **Encounter (visit) diagnoses** — one row per dx on each visit's level-of-service. | 48 | `(PAT_ENC_CSN_ID, LINE)`. `DX_ID`, `PRIMARY_DX_YN`, `DX_CHRONIC_YN`, `DX_LINK_PROB_ID` (back-link to a problem). 18 distinct `DX_ID`s across 27 CSNs. |
| `CLARITY_EDG` | **Diagnosis master file (EDG).** `DX_ID` → `DX_NAME` (+ `PAT_FRIENDLY_TEXT`). | 44 | The universal lookup for every `DX_ID` in the export. **No ICD-10 column** in this specimen (see Gotchas). `PAT_FRIENDLY_TEXT` present but empty here. |
| `PROB_LIST_REVIEWED` | **Clinician "Mark as Reviewed"** — current single attestation. | 1 | `PAT_ID`, `PROB_LIST_REV_DATE`/`_TIME`, reviewer, `PROB_REV_EPT_CSN`. |
| `PROB_LIST_REV_HX` | Historical clinician review events. | 9 | `(PAT_ID, LINE)`. `PROB_LIST_REV_HX_DT`, reviewer, `PROB_LIST_REV_CSNHX` (encounter of the review). |
| `PAT_REVIEW_PROBLEM` | **Patient-entered** problem review (MyChart / Welcome Kiosk). | 12 | `(PAT_ENC_CSN_ID, LINE)`. `PAT_REVIEW_LPL_ID` (the problem confirmed), `PAT_REVIEW_LPL_R_YN` (Y=still have it), `PAT_REV_LPL_EXTERN` (free-text problem the patient typed). |

Peripheral (history sections that carry diagnoses but belong to the *History* domain — cross-reference
only): `MEDICAL_HX` (past medical hx, carries `DX_ID`), `FAMILY_HX` (`FAM_MEDICAL_DX_ID`, NULL here),
`SURGICAL_HX`. Re-snapshotted per encounter (§19); covered in the history guide.

## How they join

All joins below were run against the specimen and returned the stated rows.

- **Problem → diagnosis name:** `PROBLEM_LIST.DX_ID = CLARITY_EDG.DX_ID`. Resolves a problem to its
  `DX_NAME`. ⚠ The schema doc names the column `DX_ID_DX_NAME` (the denormalized companion); the TSV ships
  the **bare `DX_ID`** — the `_DX_NAME` companion was dropped in this export (see §5, and Gotchas below).
- **Problem ↔ its facets** via `PROBLEM_LIST_ID`: `PROBLEM_LIST` = `PROBLEM_LIST_HX` = `PROB_UPDATES` =
  `PROBLEM_LIST_ALL` = `PAT_PROBLEM_LIST`. The LPL record id ties the current-state row to its version
  history, contact log, type index, and the chart's pointer list. (All 5 problem ids match across all five
  tables.)
- **Problem version → encounter of the edit:** `PROBLEM_LIST_HX.HX_PROBLEM_EPT_CSN =
  PAT_ENC.PAT_ENC_CSN_ID`. E.g. neck-pain (112347430) `LINE 2` was Resolved at CSN `1028744231`.
- **History row → diagnosis:** `PROBLEM_LIST_HX.HX_PROBLEM_ID = CLARITY_EDG.DX_ID` (the `HX_PROBLEM_ID`
  *is* the DX_ID — verified equal to the base `PROBLEM_LIST.DX_ID` for all 5 problems).
- **Encounter dx → diagnosis name:** `PAT_ENC_DX.DX_ID = CLARITY_EDG.DX_ID` (again bare `DX_ID`, doc says
  `DX_ID_DX_NAME`).
- **Encounter dx → problem-list problem:** `PAT_ENC_DX.DX_LINK_PROB_ID = PROBLEM_LIST.PROBLEM_LIST_ID`.
  This is the bridge between visit-level coding and the problem list. In the specimen 16 of 48 enc-dx rows
  carry the back-link, pointing at 2 problems (GERD 30694847, post-concussion 90574164).
- **Problem → overview note:** `PROBLEM_LIST.OVERVIEW_NOTE_ID = HNO_INFO.NOTE_ID` (verified: note
  6400440669 on the pollen-food allergy problem exists in `HNO_INFO`). (see §3 master-file IDs)
- **Review events → encounter:** `PROB_LIST_REV_HX.PROB_LIST_REV_CSNHX` and
  `PAT_REVIEW_PROBLEM.PAT_ENC_CSN_ID` are encounter CSNs; they overlap (the same visit can carry both a
  clinician review and a patient review — e.g. CSN 1028744231, 1076261941).

(see §2 CSN/contacts, §6 base+supplement, §7 LINE child rows, §10 `*_DATE_REAL`, §20 current-vs-version)

## Unstructured tie-back

- **Problem overview note:** `PROBLEM_LIST.OVERVIEW_NOTE_ID` → `HNO_INFO.NOTE_ID` → RTF body in
  `Rich Text/<id>.RTF` / plain text in `HNO_PLAIN_TEXT`. A **preview** of that note is cached inline in
  `PROBLEM_LIST.PROBLEM_CMT` (and `PROBLEM_LIST_HX.HX_COMMENT`) — the opening ~255 chars, truncated (§23).
  Go to the HNO for full text. In this specimen only the two 2025 allergy problems carry an
  `OVERVIEW_NOTE_ID` (6400440667, 6400440669); the older problems have none.
- **Free-text on rows:** `PAT_ENC_DX.ANNOTATION` / `.COMMENTS` (clinician's free text on a visit dx),
  `PAT_REVIEW_PROBLEM.PAT_REV_LPL_EXTERN` (patient-typed problem name). These are self-contained strings,
  not pointers to a note.
- Encounter diagnoses themselves appear in **visit-summary RTF/print renderings** under the encounter's
  CSN; reassemble via `PAT_ENC_DX.PAT_ENC_CSN_ID` (see the encounters and notes-documents guides).

## Gotchas & quirks (chased to *why*)

1. **Encounter dx and problem-list dx are coded with DIFFERENT, more-specific `DX_ID`s for the same
   condition — the bridge is `DX_LINK_PROB_ID`, not `DX_ID`.**
   *Observe:* the GERD problem's `DX_ID` is `70859` "Gastroesophageal reflux disease", but the encounters
   code it as `1181154` "GERD, esophagitis presence not specified" **and** `1620157` "GERD, unspecified
   whether esophagitis present" — three different `DX_ID`s, one condition. Joining problems to encounter
   dx **on `DX_ID` silently misses most of the history** (only 1 of 18 encounter `DX_ID`s overlaps the 5
   problem `DX_ID`s).
   *Why:* the problem list holds a clean clinical concept; visit coding pulls the **billable/specific**
   ICD-10-flavored term for that day. Epic keeps them as separate EDG entries and threads them with
   `DX_LINK_PROB_ID` (enc-dx → `PROBLEM_LIST_ID`), set when the clinician links a visit dx to a problem.
   *Handle:* to find "every encounter that addressed problem X," filter `PAT_ENC_DX.DX_LINK_PROB_ID = X`,
   **not** `DX_ID`. To name a problem, go through `CLARITY_EDG` on the problem's own `DX_ID`.

2. **`CLARITY_EDG` carries no ICD-10/SNOMED code — only a name.** *Observe:* its only columns are `DX_ID`,
   `DX_NAME`, `PAT_FRIENDLY_TEXT`; there is **no `ICD` table anywhere** in the export (`%ICD%`, `EDG_%`
   return zero tables). *Why:* this org's export ships the EDG record-name level only; the ICD-10 mapping
   tables (`EDG_CURRENT_ICD10` etc.) were not included — a per-org export-configuration choice (§13-style
   variation). *Handle:* you can render and group diagnoses by `DX_NAME`/`DX_ID`, but you **cannot derive
   an ICD-10 code** from this specimen. Don't promise codes you can't produce. (Check `EDG_*` on a new
   export before assuming the same.)

3. **The schema doc's `DX_ID_DX_NAME` companion does not ship — the column is bare `DX_ID`.** *Observe:*
   `_schema_column` lists ordinal-2 `DX_ID_DX_NAME` for `PROBLEM_LIST`, `PAT_ENC_DX`, and even
   `CLARITY_EDG` (ordinal 1), but `PRAGMA table_info` shows bare `DX_ID`. A query on `DX_ID_DX_NAME` fails
   "no such column." *Why:* §5 set-difference — the resolved-name companion was configured out. *Handle:*
   always `PRAGMA table_info` first; join to `CLARITY_EDG` for the name. (Note: `ENTRY_USER_ID_NAME` *is*
   materialized on `PROBLEM_LIST`, so companion-dropping is per-column, not table-wide.)

4. **`PROBLEM_LIST` ships resolved/deleted problems too — presence ≠ current.** *Observe:* the neck-pain
   problem has `PROBLEM_STATUS_C_NAME='Resolved'` and a `RESOLVED_DATE`, yet exports in full and still
   appears in `PAT_PROBLEM_LIST` (LINE 3). *Why:* Chronicles soft-deletes (§18) — Active→Resolved→Deleted
   all persist; the status column carries the lifecycle. *Handle:* filter `PROBLEM_STATUS_C_NAME='Active'`
   for the live list. In this specimen the only statuses present are Active (4) and Resolved (1); "Deleted"
   would also appear here if present.

5. **`PROBLEM_LIST.DATE_OF_ENTRY` is the *last* edit, not the origin — use `PROBLEM_LIST_HX` for who/when
   first.** *Observe:* the base row's entry date/user reflect the resolve edit; `PROBLEM_LIST_HX LINE 1`
   shows the original Active entry (earlier, often a different clinician). E.g. neck-pain `LINE 1` = Active
   entered 7/2/2024 by EVERTON; `LINE 2` = Resolved 11/7/2024 by RAMMELKAMP. *Why:* §20 current-state
   collapse — the base table is "now"; `_HX` replays every edit. *Handle:* go to `_HX` for provenance.
   Note only the problem that *changed status* (neck-pain) has 2 HX lines; never-edited problems have a
   single Active line, so HX line-count ≠ encounter count.

6. **`PROB_UPDATES` and `PROBLEM_LIST_ALL` are the *whole LPL master*, not just problems.** *Observe:*
   `PROBLEM_LIST_ALL` has 56 rows for a 5-problem patient (Problem List 5, Immunization 19, Allergy 4,
   System 28); `PROB_UPDATES` has 60 rows but only 9 belong to the 5 problems. *Why:* problems,
   immunizations, allergies, and internal "System" records **share one Chronicles master file (LPL)**, so
   the generic index/contact-log tables span all of them. *Handle:* when working problems, **filter
   `PROBLEM_LIST_ID IN (SELECT PROBLEM_LIST_ID FROM PROBLEM_LIST)`** (or `PROBLEM_LIST_ALL` where
   `RECORD_TYPE_C_NAME='Problem List'`) before counting. Naive `COUNT(*)` over these tables wildly
   overstates problems.

7. **`PROB_UPDATES.CONTACT_SERIAL_NUM` is NOT a patient encounter CSN.** *Observe:* values like `43855015`
   sit beside an `EPT_CSN` column that is NULL. *Why:* the LPL master has its **own** contact serials
   (record-update contacts), distinct from the patient-encounter (EPT) CSN space (§24 two ID spaces). The
   `.01`/`.02` fractional `CONTACT_DATE_REAL` on the same day (§10) are sequential LPL contacts, not
   visits. *Handle:* use `EPT_CSN` (when populated) to reach the patient encounter; treat
   `CONTACT_SERIAL_NUM` as opaque LPL bookkeeping. **Sub-gotcha:** unlike most effective dates,
   `PROB_UPDATES.CONTACT_DATE` shows a real wall-clock time for fractional contacts (`.01` → 11:10 AM),
   mirroring the instant rather than rendering at midnight — don't rely on §11's "always midnight" here.

8. **Two review channels with different authority — clinician vs patient.** *Observe:*
   `PROB_LIST_REVIEWED`/`PROB_LIST_REV_HX` (clinician "Mark as Reviewed") vs `PAT_REVIEW_PROBLEM`
   (patient confirms via MyChart/kiosk). *Why:* they answer different questions — *was the list
   clinically attested* vs *did the patient agree they still have these*. *Handle:* don't conflate. The
   patient channel has two sub-shapes: `PAT_REVIEW_LPL_ID` set ⇒ confirming an **existing** problem
   (`_R_YN` Y/N); `PAT_REVIEW_LPL_ID` NULL with `PAT_REV_LPL_EXTERN` filled ⇒ a **new free-text problem
   the patient typed** that isn't on the list yet (e.g. "Post concussion syndrome" before it was added).

## Recipes

```sql
-- 1) Current (active) problem list with names, onset, chronicity, in display order
SELECT pp.LINE, p.PROBLEM_LIST_ID, e.DX_NAME, p.NOTED_DATE, p.CHRONIC_YN, p.SHOW_IN_MYC_YN
FROM PAT_PROBLEM_LIST pp
JOIN PROBLEM_LIST p USING (PROBLEM_LIST_ID)
LEFT JOIN CLARITY_EDG e ON p.DX_ID = e.DX_ID
WHERE p.PROBLEM_STATUS_C_NAME = 'Active'
ORDER BY pp.LINE;

-- 2) Full lifecycle of one problem (who entered/resolved it, in which encounter)
SELECT h.LINE, h.HX_STATUS_C_NAME, h.HX_DATE_OF_ENTRY, h.HX_ENTRY_INST,
       h.HX_ENTRY_USER_ID_NAME AS editor, h.HX_PROBLEM_EPT_CSN AS encounter_csn
FROM PROBLEM_LIST_HX h
WHERE h.PROBLEM_LIST_ID = 112347430        -- a problem id from PROBLEM_LIST
ORDER BY h.LINE;

-- 3) Every encounter that ADDRESSED a given problem (bridge on DX_LINK_PROB_ID, not DX_ID)
SELECT d.PAT_ENC_CSN_ID, d.CONTACT_DATE, d.DX_ID, e.DX_NAME AS coded_as, d.PRIMARY_DX_YN
FROM PAT_ENC_DX d
JOIN CLARITY_EDG e ON d.DX_ID = e.DX_ID
WHERE d.DX_LINK_PROB_ID = 30694847         -- the PROBLEM_LIST_ID
ORDER BY CAST(d.PAT_ENC_DATE_REAL AS REAL);

-- 4) Encounter diagnoses for one visit, primary first
SELECT d.LINE, d.DX_ID, e.DX_NAME, d.PRIMARY_DX_YN, d.DX_CHRONIC_YN, d.DX_LINK_PROB_ID
FROM PAT_ENC_DX d
JOIN CLARITY_EDG e ON d.DX_ID = e.DX_ID
WHERE d.PAT_ENC_CSN_ID = 1098684634
ORDER BY (d.PRIMARY_DX_YN <> 'Y'), d.LINE;

-- 5) Clinician-review history of the problem list (was it attested, and where)
SELECT LINE, PROB_LIST_REV_HX_DT AS reviewed_on,
       PRBLST_REVUSRHX_ID_NAME AS reviewer, PROB_LIST_REV_CSNHX AS encounter_csn
FROM PROB_LIST_REV_HX
ORDER BY LINE;

-- 6) Problem overview note (preview inline + full text via HNO)
SELECT p.PROBLEM_LIST_ID, e.DX_NAME, p.OVERVIEW_NOTE_ID,
       substr(p.PROBLEM_CMT, 1, 80) AS preview
FROM PROBLEM_LIST p
LEFT JOIN CLARITY_EDG e ON p.DX_ID = e.DX_ID
WHERE p.OVERVIEW_NOTE_ID IS NOT NULL;       -- then read Rich Text/<OVERVIEW_NOTE_ID>.RTF
```

## Open questions / specimen notes

- **Specimen counts (illustrative):** 5 problems (4 Active, 1 Resolved, 0 Deleted); 18 distinct encounter
  diagnoses over 27 CSNs; 44 diagnoses in `CLARITY_EDG`; 9 clinician reviews 2018→2025; 12 patient-review
  rows. Only 2 problems (GERD, post-concussion) are ever linked from encounter dx.
- **Sparse columns in this specimen:** `PROBLEM_LIST.DESCRIPTION`, `PROBLEM_LIST_HX.HX_DESCRIPTION`,
  `CLASS_OF_PROBLEM_C_NAME`, `PROBLEM_TYPE_C_NAME`, `PRIORITY_C_NAME`,
  `DIAG_START_DATE`/`DIAG_END_DATE`, staging columns (`STAGE_ID`, `PROB_STAGE_STATUS_C_NAME`),
  `PAT_FRIENDLY_TEXT`, and `PROBLEM_LIST_ALL.HX_SOURCE_ID` are all empty/NULL here. They exist on the
  schema and may populate in oncology/staged-condition records on other exports — don't assume they're
  always blank. In particular `DESCRIPTION`/`HX_DESCRIPTION` are blank for every row, so never display
  them as the problem label — always resolve the name through `DX_ID` → `CLARITY_EDG.DX_NAME`.
- **Fuzzy onset:** `NOTED_DATE`/`NOTED_END_DATE` form a [start,end] pair (§12). Here, when both are set
  they're equal (exact date); the oldest problem (GERD) has `NOTED_END_DATE` NULL. A year-only onset would
  show Jan 1..Dec 31.
- **`HX_SOURCE_ID` unused:** the documented type-7-history → type-1-problem link in `PROBLEM_LIST_ALL` is
  NULL throughout this specimen, so the mechanism couldn't be traced against rows here.
