# Questionnaires & assessments — Epic EHI field guide

**Scope.** Patient- and clinician-entered structured forms: MyChart eCheck-in / appointment
questionnaires, Welcome-kiosk questionnaires, questionnaire-bearing MyChart messages, order-entry
questions, and the imaging-safety screening form. Covers the question-master vs answer-instance split,
the form/attempt/answer hierarchy, the delivery channels, and how an answer reaches its encounter.
Screening *instruments* (PHQ-2 etc.) also file into flowsheets — see the cross-reference section and
the vitals-and-flowsheets guide, which documents that path.

**Where it sits.** Four distinct Chronicles ID spaces (§41), none of which join each other directly:

| master file | record | export table | id column |
|---|---|---|---|
| **LQF** | questionnaire *form* (the assembled instrument) | `CL_QFORM1` | `FORM_ID` |
| **LQL** | *question* (one prompt, reusable across forms) | `CL_QQUEST` | `QUEST_ID` |
| **HQA** | *answer instance* (one person filling one form once) | `CL_QANSWER` | `ANSWER_ID` |
| **FRM** | *screening form* (imaging/MRI safety) | `FRM_STATUS` | `SCREENING_FORM_ID` |

The HQA tables carry **no `PAT_ID`, no CSN, and no form id** — the patient/encounter/form links all
come from the *channel* tables around them (§3 parent-chain linkage). A fifth question-like ID space,
**LQH** (Visit Navigator history-template prompts, `CL_LQH`), belongs to the social/history domain,
not here — see "Excluded look-alikes."

## Tables

| table | role | rows in one specimen | notes |
|---|---|---|---|
| `CL_QANSWER` | **Spine.** One row per answer record (PK `ANSWER_ID`). | 16 | Nearly bare: creator (populated only when a *clinician* keyed it in), `WORKFLOW_DURATION` (seconds), `FURTHEST_QUESTION_ID` (last question reached), `PARENT_ANSWER_ID` (branching), `IMG_PROC_ORDER_ID`, `ENROLL_ID` (research). No patient, no form, no encounter — see Gotcha 1. |
| `CL_QANSWER_OVTM` | Contact date(s) of each answer record (§18 `CONTACT_DATE_REAL`). | 16 (1:1 here) | The **submission date**, not the appointment date — see Gotcha 4. `INSTANT_OF_ENTRY`/`END_INSTANT` ship NULL here. |
| `V_EHI_HQA_QUEST_ANSWER` | **The answer content** (§47 export view). Key `(ANSWER_ID, LINE)`. | 38 | `QUEST_ANSWER_EXTERNAL` = the answer as the user saw it. Replaces the value column of `CL_QANSWER_QA` — which is *not shipped*, so the per-line question id is gone (Gotcha 2). |
| `CL_QANSWER_ATTEMPT` | Per-answer attempt audit, `(ANSWER_ID, LINE)`. | 12 | `ATTEMPT_START/END_DTTM` (instants, §19), `ATTEMPT_STATUS_C_NAME` (Started/Completed), `ATTEMPT_ANSWER_METHOD_C_NAME` (MyChart / Secure Link Authentication), `ATTEMPT_MYPT_ID` (MyChart account) vs `ATTEMPT_USER_ID` (a staff member answering on the patient's behalf in Hyperspace). |
| `CL_QFORM1` | Form (LQF) master: `FORM_ID`, `FORM_NAME`. | 5 | The schema calls it "the second master table … used along with CL_QFORM," but `CL_QFORM` is **absent** ("no such table") — `CL_QFORM1` is all you get (§7). |
| `CL_QQUEST` | Question (LQL) master: `QUEST_ID`, `QUEST_NAME`. | 11 | Shared by patient questionnaires **and** order-entry questions (`ORD_SPEC_QUEST`) — one dictionary, two consumers. |
| `CL_QQUEST_OVTM` | Question *text* per master-file contact, `(QUEST_ID, CONTACT_DATE_REAL)`. | 48 | `QUESTION` = the prompt the user sees; wording drifts across contacts (Gotcha 6). |
| `MYC_MESG_QUESR_ANS` | **Answer → message bridge**: `(MESSAGE_ID, LINE, QUESR_ANS_ID)`. | 21 | Every patient-submitted answer surfaces as one or two "Questionnaire Submission" MyChart messages. This is the *only* shipped path from an `ANSWER_ID` to a CSN (Gotcha 3). |
| `MYC_APPT_QNR_DATA` | Questionnaires *assigned* to an upcoming appointment (MyChart eCheck-in). Key `(PAT_ENC_CSN_ID, LINE)`. | 20 | Form id + `PAT_APPT_QNR_STAT_C_NAME` lifecycle (Assigned / Started at home / Completed, §30) + `MYC_QUESR_START_DT` (when it opens to the patient). |
| `KIOSK_QUESTIONNAIR` | Same assignment list, surfaced for the Welcome kiosk. Key `(PAT_ENC_CSN_ID, LINE)`; carries `PAT_ID`. | 20 | In this specimen the (CSN, form) pairs are **identical** to `MYC_APPT_QNR_DATA` both directions — two views of one assignment, per channel (Gotcha 9). |
| `QUESR_LST_ANS_INFO` | Patient-level "most recent submission per form": `(PAT_ID, LINE)` → form id, CSN, instant. | 4 | §35 current-state collapse; handy form→encounter shortcut, latest only. |
| `QUESR_TEMP_ANSWERS` | **Unsubmitted** (partial) questionnaire answers per patient. | 1 | `QUESR_TMP_ANSWER_ID` is a real `CL_QANSWER.ANSWER_ID`; `QUESR_TMP_ROOT_ID` names the form. The flag that explains an answer record with no content (Gotcha 11). |
| `PAT_ENC_QNRS_ANS` | Per-encounter appointment-questionnaire answer list — *in name only*. | 1 | Ships **without** the answer-id column its own description promises; just `(PAT_ENC_CSN_ID, LINE, CONTACT_DATE)` (Gotcha 5). |
| `FRM_STATUS` | Screening-form (FRM) status + who/when audit, `(SCREENING_FORM_ID, LINE)`. | 2 | The MRI-safety screening form attached to imaging orders via `ORDER_PROC_4.SCREENING_FORM_ID`. Content siblings `FRM_SAFETY` / `FRM_IMP_SAFETY` (proceed decision, implant MRI-safety detail) are documented but **absent** here. |
| `ORD_SPEC_QUEST` | Order-entry questions+responses, `(ORDER_ID, LINE)`. | 29 | `ORD_QUEST_ID` → `CL_QQUEST` (29/29 resolve); `ORD_QUEST_RESP` is the response text. The documented `ORD_QUEST_ID_QUEST_NAME` companion is **dropped** — join `CL_QQUEST` yourself (§6/§7). Same LQL dictionary, different (clinician, order-context) channel. |
| `MYC_PATIENT` | `MYPT_ID` → `PAT_ID` (MyChart account ↔ patient). | 1 | Resolves the `*_MYPT_ID` columns here and on flowsheet rows. |

**Documented siblings absent in this specimen** (genre tables to look for; querying them errors
"no such table" — unshipped means absent, not 0 rows): `CL_QANSWER_QA` (per-line question↔answer map —
not even in the schema catalog here), `PAT_ENC_QUESR` (per-encounter Q&A text), `HIST_Q_AND_A`,
`QUESR_PREV_RESP_INFO` (questions skipped because previous responses were still valid),
`FLAGGED_QUESTIONS`, `CL_QANSWER_VERIFY` / `CL_QANSWER_GEN_CMT` / `CL_QANSWER_FAMILY_*`,
`MYC_MESG_QUESR` / `HX_QUESR` (history-questionnaire channel), `ENROLL_QUESR` (research-study
questionnaires), `SRS_RESP_OVER_TM` / `SERIES_ANSWER_ID` (recurring questionnaire *series*),
`SCRFORM_ANS_INFO` (FRM↔HQA bridge), `FRM_SAFETY` / `FRM_IMP_SAFETY`, `IDENTITY_HQA_ID`.

**Excluded look-alikes** (investigated, deliberately out of scope):
- `CL_LQH` — *not* "linked questionnaire history": it is the **Visit Navigator history-template (LQH)
  master** — prompt definitions for social/ADL history rows. Verified: all 104 `SOCIAL_ADL_HX` rows
  resolve `HX_ADL_QUESTION_ID` → `CL_LQH.RECORD_ID`. Belongs with social history, not questionnaires.
- `CL_OTL` / `CL_OTL_2` — **order template** (OTL) master records (procedure/med order descriptions
  used as ordering shortcuts), nothing to do with questionnaires despite landing near them alphabetically.

## How they join

All verified against rows in this specimen.

- **Answer → when:** `CL_QANSWER.ANSWER_ID = CL_QANSWER_OVTM.ANSWER_ID` (1:1 here; the PK admits
  multiple contacts per answer). `CONTACT_DATE_REAL` is the chronological sort key (§17/§18).
- **Answer → content:** `V_EHI_HQA_QUEST_ANSWER.ANSWER_ID = CL_QANSWER.ANSWER_ID`, ordered by
  `CAST(LINE AS INT)`. 15 of 16 answers have lines; the one without is the unsubmitted record flagged
  in `QUESR_TEMP_ANSWERS`.
- **Answer → encounter (the path that actually keys):** `MYC_MESG_QUESR_ANS.QUESR_ANS_ID = CL_QANSWER.ANSWER_ID`,
  `MYC_MESG_QUESR_ANS.MESSAGE_ID = MYC_MESG.MESSAGE_ID`, then read `MYC_MESG.PAT_ENC_CSN_ID` →
  `PAT_ENC`. Verified: all 21 message rows resolve to encounters; 14 of 16 answers are reachable this
  way. The 2 unreachable: the unsubmitted one, and the single clinician-created answer
  (`REC_CREATE_USER_ID` populated) — staff-entered answers never transit MyChart messaging.
- **Answer → attempts:** `CL_QANSWER_ATTEMPT.ANSWER_ID`, ordered by `LINE` (§9). 10 of 16 answers have
  attempts; see Gotcha 10 for why old ones don't.
- **Answer → patient:** there is no direct column. Either walk the message (`MYC_MESG.PAT_ID`) or
  resolve `ATTEMPT_MYPT_ID` → `MYC_PATIENT.PAT_ID` (§3).
- **Assignment → form:** `KIOSK_QUESTIONNAIR.KIOSK_QUEST_ID` / `MYC_APPT_QNR_DATA.MYC_APPT_QUESR_ID` /
  `QUESR_LST_ANS_INFO.QUESR_ANS_FORM_ID` / `QUESR_TEMP_ANSWERS.QUESR_TMP_ROOT_ID` all =
  `CL_QFORM1.FORM_ID` (every form id observed resolves; names also denormalized inline as
  `*_FORM_NAME`, §6).
- **Assignment → encounter:** `KIOSK_QUESTIONNAIR` / `MYC_APPT_QNR_DATA` are keyed by
  `PAT_ENC_CSN_ID` directly (§2) and even carry `PAT_ENC_DATE_REAL` + `CONTACT_DATE` denormalized
  (§18 — an inherited `*_DATE_REAL` is the parent encounter's date).
- **Furthest question:** `CL_QANSWER.FURTHEST_QUESTION_ID` → `CL_QQUEST.QUEST_ID` (10/10 resolve);
  likewise `CL_QANSWER_ATTEMPT.ATTEMPT_FURTHEST_QUESTION_ID`. Note the shipped column is the bare id —
  the documented `_QUEST_NAME` companion is dropped (§6/§7).
- **Screening form (FRM):** `ORDER_PROC.ORDER_PROC_ID = ORDER_PROC_4.ORDER_ID` and
  `ORDER_PROC_4.SCREENING_FORM_ID = FRM_STATUS.SCREENING_FORM_ID` (2/2 — both MRI orders).
- **Order questions:** `ORD_SPEC_QUEST.ORDER_ID = ORDER_PROC.ORDER_PROC_ID`;
  `ORD_QUEST_ID = CL_QQUEST.QUEST_ID` (29/29).
- **Latest submission per form:** `QUESR_LST_ANS_INFO.QUESR_ANS_CSN_ID` → `PAT_ENC` (4/4 resolve).

## Unstructured tie-back

The questionnaire *submission message* carries a rendered transcript: `MYC_MESG_QUESR_ANS.MESSAGE_ID`
→ `MYC_MESG_RTF_TEXT.(MESSAGE_ID, LINE, RTF_TXT)` — line-chunked RTF (§11; 168 chunk rows across the
21 questionnaire messages here). When the structured per-line answers feel ambiguous (Gotcha 2), this
RTF body shows the Q&A as the clinic saw it. `ORD_SPEC_QUEST.ORD_QUEST_RESP` / `ORD_QUEST_CMT` hold
inline free-text responses on the order side. No `Media/*` or on-disk file references this domain.

## Gotchas & quirks (chased to *why*)

1. **`CL_QANSWER` names no patient, no encounter, and no form.** A 16-row spine where almost every
   non-key column is NULL. *Why:* in Chronicles the HQA record does carry those pointers, but the EHI
   table ships only a thin slice; the export expects you to arrive *via a channel* (message,
   assignment list, temp-answer list) rather than from the answer outward (§3). *Handle:* treat
   `ANSWER_ID` as a leaf you reach from `MYC_MESG_QUESR_ANS` / `QUESR_TEMP_ANSWERS` /
   `QUESR_LST_ANS_INFO`, and identify the form by triangulation: `FURTHEST_QUESTION_ID` → the question
   → the form(s) that use it, plus the assignment list for the same CSN.
2. **The per-line question map is gone — answers are positional.** `V_EHI_HQA_QUEST_ANSWER`'s own
   description says to use it "in tandem with CL_QANSWER_QA," but that table is neither shipped nor
   documented here, and the view carries only `(ANSWER_ID, LINE, answer-text)`. *Why:* the view exists
   to externalize the packed answer value (§47), but the question-id column of the underlying QA group
   wasn't carried along — the §41 two-table pairing shipped half. *Handle:* for one-question forms the
   form name suffices. For multi-line answers read them ordered by `CAST(LINE AS INT)` and expect the
   instrument's items in order followed by derived lines — a PHQ-2 answer here is two category-label
   lines then a numeric total line; one answer carries trailing lines whose answer text ships NULL
   (question presented, never answered — §39/§46).
   For ground truth, read the RTF transcript (Unstructured tie-back) or the flowsheet copy (Gotcha 8).
3. **One submission, two CSNs.** A submitted answer maps to one or two "Questionnaire Submission"
   messages — in one specimen, half the bridged answers map to **two** messages with *different*
   `PAT_ENC_CSN_ID`s: one a department-less, appointment-less contact (the MyChart submission event
   itself), the other the real appointment encounter; the rest have a single message that already
   carries the appointment CSN. *Why:* §2
   one-encounter-many-contacts — MyChart files the submission as its own contact, then a second message
   row attaches the answers to the target visit. *Handle:* when you want "the visit this questionnaire
   was for," prefer the message whose CSN has a department/appointment status, or go through the
   assignment tables, which are keyed by the appointment CSN.
4. **The HQA contact date is the submission date, not the visit date.** eCheck-in answers routinely
   show `CL_QANSWER_OVTM.CONTACT_DATE` the day *before* the appointment (attempt instants on those land
   the prior afternoon or evening), and `MYC_APPT_QNR_DATA.MYC_QUESR_START_DT` shows forms opening up to two
   weeks ahead. *Why:* the HQA record's contact is created when the patient answers; the appointment is
   a different record. *Handle:* date-matching answers to encounters is off-by-one-or-more by design —
   use the message-CSN join, never `CONTACT_DATE = CONTACT_DATE`.
5. **`PAT_ENC_QNRS_ANS` promises answer IDs and ships none.** Its description says it "contains the
   Answer ID numbers for … all Appointment Questionnaires," but the exported (and even documented)
   columns are just `(PAT_ENC_CSN_ID, LINE, CONTACT_DATE)` (§7, §24 — read the columns, not the
   blurb). In this specimen its single row marks an encounter for which no answer record is reachable
   in `CL_QANSWER` (the CSN appears in no message bridge or assignment row). *Handle:* treat it as a flag that "this encounter had appointment
   questionnaires," nothing more; count LINEs, then look for the answers via the other channels.
6. **Question wording drifts under a stable `QUEST_ID`.** `CL_QQUEST_OVTM` holds one row per
   *master-file edit contact* of the question (its `CONTACT_DATE_REAL` is the question record's own
   contact, §18 — not a patient encounter), and the `QUESTION` text changes across contacts (wording
   tweaks, option-set rewrites). The surviving contacts may all *postdate* an old answer. *Why:* §35-style
   version history of a slowly-changing master record; the export keeps the contact history it has. *Handle:* to render
   "the question as seen," take the latest contact ≤ the answer's contact date, falling back to the
   earliest available (Recipe 4) — and label it approximate.
7. **Question and form names can disagree with the instrument.** The question used by the "…PHQ2" form
   is named "…PHQ9-DEPRESSION" — org build re-used/renamed records (§24 column-label-lies, applied to
   master-file *names*). *Handle:* identify instruments by id + the assignment-list form name, not by
   substring-matching question names.
8. **Screening instruments double-file: HQA *and* flowsheets.** The same eCheck-in PHQ-2 that exists as
   a `CL_QANSWER` also lands as flowsheet rows on the **appointment** encounter (`IP_FLWSHT_MEAS` rows
   with `MYPT_ID` set, `PAT_REPORTED_STATUS_C_NAME = 'Patient reported, not clinician validated'`,
   items + "PHQ-2 Total Score" rows) — verified for both PHQ-2 encounters here; travel/disease screens
   file to the submission contact instead. *Why:* MyChart questionnaires are configured to chart into
   flowsheet rows so clinicians and reporting see them; the HQA record is the raw submission artifact.
   *Handle:* read scores from the flowsheet path (it has explicit per-item `FLO_MEAS_ID`s and the
   computed total — see vitals-and-flowsheets, gotchas 9–10); use the HQA side for provenance (who,
   when, which attempt, how long).
9. **Two assignment tables, one assignment.** `KIOSK_QUESTIONNAIR` and `MYC_APPT_QNR_DATA` carry
   exactly the same (CSN, form) pairs here, in both directions. *Why:* one underlying per-appointment
   questionnaire list, projected once for the Welcome-kiosk app and once for MyChart eCheck-in.
   `MYC_APPT_QNR_DATA` adds the lifecycle status (§30) and window start; `KIOSK_QUESTIONNAIR` adds
   `PAT_ID`. Assignment ≠ completion: rows with status `Assigned` (including for an appointment dated
   *after* the export — §43) have no answer record. *Handle:* use MYC for status, either for the list.
10. **No attempt rows ≠ no attempt.** Only the newer answers have `CL_QANSWER_ATTEMPT` rows here — the
    cutover falls in late 2023, and the boundary month itself is mixed (same-month answers with and
    without attempt rows); older completed answers have none. *Why:* the attempt audit is a newer mechanism — absence
    reflects when the org/version started recording it, not patient behavior (§39 NULL ≠ no-data,
    applied at table level). Also note `ATTEMPT_STATUS_C_NAME`'s doc says to join `ZC_ST_WKFL_STATUS`,
    but this export ships no `ZC_` tables — the `_C_NAME` label is all you get (§23). "Secure Link
    Authentication" as a method = tokenized eCheck-in link, no MyChart login.
11. **Unsubmitted answers persist as empty shells.** One `ANSWER_ID` exists in `CL_QANSWER` +
    `CL_QANSWER_OVTM` but has zero `V_EHI_HQA_QUEST_ANSWER` lines and zero attempts; `QUESR_TEMP_ANSWERS`
    is what identifies it as a partial submission (with its form id). *Why:* §32 everything-persists —
    the draft answer record is real; its content stays in temp storage that the view doesn't export.
    *Handle:* anti-join the view (or join `QUESR_TEMP_ANSWERS`) before treating every `ANSWER_ID` as a
    completed questionnaire.
12. **FRM is a fourth id space, attached to orders, with its content withheld.** `FRM_STATUS` gives
    only status + who/when for the MRI-safety screening forms; the actual safety Q&A
    (`FRM_SAFETY`, `FRM_IMP_SAFETY`, `SCRFORM_ANS_INFO`) is documented but not shipped (§15 pointer
    survives, body omitted). *Handle:* you can prove a screening form exists for an imaging order and
    when it was created/edited — not what it said.

## Recipes

```sql
-- 1) Inventory: every questionnaire answer, when, furthest question, channel/method.
SELECT a.ANSWER_ID, o.CONTACT_DATE AS submitted_date,
       q.QUEST_NAME              AS furthest_question,
       a.REC_CREATE_USER_ID_NAME AS clinician_creator,      -- non-null = staff-entered
       att.ATTEMPT_ANSWER_METHOD_C_NAME AS method,
       att.ATTEMPT_STATUS_C_NAME       AS last_attempt_status,
       a.WORKFLOW_DURATION             AS seconds_spent
FROM CL_QANSWER a
LEFT JOIN CL_QANSWER_OVTM o ON o.ANSWER_ID = a.ANSWER_ID
LEFT JOIN CL_QQUEST q       ON q.QUEST_ID  = a.FURTHEST_QUESTION_ID
LEFT JOIN CL_QANSWER_ATTEMPT att ON att.ANSWER_ID = a.ANSWER_ID
  AND CAST(att.LINE AS INT) = (SELECT MAX(CAST(LINE AS INT))
                               FROM CL_QANSWER_ATTEMPT x WHERE x.ANSWER_ID = a.ANSWER_ID)
ORDER BY CAST(o.CONTACT_DATE_REAL AS REAL);

-- 2) Answer -> encounter, via the MyChart message bridge (the only shipped path).
SELECT ma.QUESR_ANS_ID AS answer_id, m.PAT_ENC_CSN_ID, pe.CONTACT_DATE,
       d.DEPARTMENT_NAME            -- NULL department = the submission contact, not the visit
FROM MYC_MESG_QUESR_ANS ma
JOIN MYC_MESG m         ON m.MESSAGE_ID = ma.MESSAGE_ID
LEFT JOIN PAT_ENC pe    ON pe.PAT_ENC_CSN_ID = m.PAT_ENC_CSN_ID
LEFT JOIN CLARITY_DEP d ON d.DEPARTMENT_ID   = pe.DEPARTMENT_ID
ORDER BY CAST(ma.QUESR_ANS_ID AS INT), CAST(ma.MESSAGE_ID AS INT);

-- 3) Read one answer's content, in order (positional — see Gotcha 2).
SELECT CAST(LINE AS INT) AS ln, QUEST_ANSWER_EXTERNAL
FROM V_EHI_HQA_QUEST_ANSWER WHERE ANSWER_ID = :answer_id
ORDER BY ln;

-- 4) Question text approximately "as seen" at answer time (latest edit-contact <= answer
--    contact, else earliest surviving — Gotcha 6).
SELECT a.ANSWER_ID, q.QUEST_NAME,
  COALESCE(
    (SELECT o2.QUESTION FROM CL_QQUEST_OVTM o2
     WHERE o2.QUEST_ID = a.FURTHEST_QUESTION_ID
       AND CAST(o2.CONTACT_DATE_REAL AS REAL) <= CAST(ao.CONTACT_DATE_REAL AS REAL)
     ORDER BY CAST(o2.CONTACT_DATE_REAL AS REAL) DESC LIMIT 1),
    (SELECT o2.QUESTION FROM CL_QQUEST_OVTM o2
     WHERE o2.QUEST_ID = a.FURTHEST_QUESTION_ID
     ORDER BY CAST(o2.CONTACT_DATE_REAL AS REAL) LIMIT 1)) AS question_text
FROM CL_QANSWER a
JOIN CL_QANSWER_OVTM ao ON ao.ANSWER_ID = a.ANSWER_ID
LEFT JOIN CL_QQUEST q   ON q.QUEST_ID = a.FURTHEST_QUESTION_ID
WHERE a.FURTHEST_QUESTION_ID IS NOT NULL;

-- 5) What was assigned per appointment, with lifecycle status and the kiosk mirror.
SELECT m.PAT_ENC_CSN_ID, m.CONTACT_DATE,
       m.MYC_APPT_QUESR_ID_FORM_NAME AS form,
       m.PAT_APPT_QNR_STAT_C_NAME    AS status,         -- Assigned / Started at home / Completed
       m.MYC_QUESR_START_DT          AS opens_to_patient,
       k.LINE IS NOT NULL            AS also_on_kiosk
FROM MYC_APPT_QNR_DATA m
LEFT JOIN KIOSK_QUESTIONNAIR k
  ON k.PAT_ENC_CSN_ID = m.PAT_ENC_CSN_ID AND k.KIOSK_QUEST_ID = m.MYC_APPT_QUESR_ID
ORDER BY CAST(m.PAT_ENC_DATE_REAL AS REAL), CAST(m.LINE AS INT);

-- 6) Imaging-safety screening forms attached to orders (FRM id space).
SELECT op.ORDER_PROC_ID, op.DESCRIPTION, op4.SCREENING_FORM_ID,
       f.FRM_STATUS_C_NAME, f.STATUS_AUD_USER_ID_NAME, f.STATUS_AUD_DTTM
FROM ORDER_PROC op
JOIN ORDER_PROC_4 op4 ON op4.ORDER_ID = op.ORDER_PROC_ID
JOIN FRM_STATUS f     ON f.SCREENING_FORM_ID = op4.SCREENING_FORM_ID;

-- 7) Order-entry questions & responses (clinician channel, same LQL dictionary).
SELECT o.ORDER_ID, CAST(o.LINE AS INT) ln, q.QUEST_NAME, o.ORD_QUEST_RESP, o.ORD_QUEST_CMT
FROM ORD_SPEC_QUEST o
LEFT JOIN CL_QQUEST q ON q.QUEST_ID = o.ORD_QUEST_ID
ORDER BY CAST(o.ORDER_ID AS INT), ln;

-- 8) The flowsheet copy of a screening instrument for an appointment (cross-ref
--    vitals-and-flowsheets — this is where the scored result lives).
SELECT m.FLO_MEAS_ID, m.FLO_MEAS_ID_DISP_NAME, v.MEAS_VALUE_EXTERNAL,
       m.PAT_REPORTED_STATUS_C_NAME
FROM PAT_ENC pe
JOIN IP_FLWSHT_REC  r ON r.INPATIENT_DATA_ID = pe.INPATIENT_DATA_ID
JOIN IP_FLWSHT_MEAS m ON m.FSD_ID = r.FSD_ID
JOIN V_EHI_FLO_MEAS_VALUE v ON v.FSD_ID = m.FSD_ID AND v.LINE = m.LINE
WHERE pe.PAT_ENC_CSN_ID = :csn AND m.MYPT_ID IS NOT NULL
ORDER BY CAST(m.LINE AS INT);
```

## Open questions / specimen notes

- **Specimen shape:** 16 answer records (2020–2025) across 5 forms — travel/communicable-disease
  screens, PHQ-2, accident/date-of-onset, veteran status, plus one unsubmitted COVID-vaccine-status
  questionnaire; one clinician-entered answer; 2 MRI-safety screening forms; 29 order-entry question
  rows. All counts illustrative.
- **The clinician-entered answer's form is unidentifiable from structured data** — `REC_CREATE_USER_ID`
  is set but `FURTHEST_QUESTION_ID` is NULL and it has no message; same-day assignments exist (two
  "Started at home") as plausible candidates, but no shipped key binds the answer to one, so only its
  contact date places it. The genre lesson (no form id on HQA) bites hardest on the staff channel.
- **History questionnaires unobserved:** `MYC_MESG.PAT_HX_QUESR_ID` (and the whole `HX_QUESR_*` column
  block) is NULL on all 116 messages, and `HX_QUESR` / `HIST_Q_AND_A` aren't shipped — the
  MyChart-history-questionnaire channel's shape here is schema-doc-only. Likewise `CL_QANSWER.ENROLL_ID`
  (research) and `PARENT_ANSWER_ID` (questionnaire branching) are never populated.
- **`CL_QANSWER.IMG_PROC_ORDER_ID`** ("the ORD that points to this answer") is NULL for all 16, even
  though MRI orders exist — this org tracks imaging screening via FRM, not via order→HQA pointers.
  Population pattern unconfirmed.
- **Kiosk-entered attempts unobserved:** every attempt here is `MyChart` or `Secure Link
  Authentication`; whether Welcome-kiosk completion writes an attempt row (and under what method label)
  can't be confirmed from this specimen.
- **`CL_QANSWER_OVTM` multi-contact answers unobserved** — all 16 are single-contact; the PK allows a
  contact history (e.g., re-edited answers) that this specimen never exercises.
