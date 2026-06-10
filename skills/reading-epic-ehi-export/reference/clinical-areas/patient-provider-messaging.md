# Patient–provider messaging (MyChart) — Epic EHI field guide

**Scope.** MyChart secure messages between the patient and their care team: the message header/master
file (`MYC_MESG`), the two body stores (RTF `MYC_MESG_RTF_TEXT` and plain-text `MSG_TXT`), reply
threading, the encounter the conversation is filed against, message routing/in-basket, and the
structured message subtypes (questionnaire submissions, medication-renewal requests, appointment
requests/cancellations, system/template notifications). Covers how to reconstruct a conversation and
read each body.

**Where it sits.** A MyChart message is **filed against a `PAT_ENC` contact** by `PAT_ENC_CSN_ID`
(a message/telephone encounter — see `encounters-and-visits.md`), and every row carries the patient
`PAT_ID`. The thread *is* an encounter; that CSN is the bridge to the rest of the chart (§2). Provider/
staff parties resolve through `CLARITY_SER`; departments through `CLARITY_DEP`.

## Tables

| table | role | rows in specimen | notes |
|---|---|---|---|
| `MYC_MESG` | **Spine.** One row per message send (each direction is its own record). PK `MESSAGE_ID`. Carries `PARENT_MESSAGE_ID`, `PAT_ENC_CSN_ID`, `PAT_ENC_DATE_REAL`, `TOFROM_PAT_C_NAME`, `FROM_USER_ID(_NAME)`/`TO_USER_ID(_NAME)`, `SUBJECT`, `INBASKET_MSG_ID`, `PROV_ID`, `DEPARTMENT_ID`, plus subtype FKs. | 116 | 52 cols. `MESSAGE_ID` is the universal key and best chronological sort (§ Gotchas). |
| `MYC_MESG_RTF_TEXT` | RTF body, line-chunked: `(MESSAGE_ID, LINE, RTF_TXT)`. Per Epic doc "Replaces item 100" and holds **only the current message** (no appended quote chain). | 669 | Bodies for the **90 newer** messages (avg ~7 lines each); reassemble `ORDER BY CAST(LINE AS INT)` + `group_concat`. |
| `MSG_TXT` | Plain-text body, line-chunked: `(MESSAGE_ID, LINE, MSG_TXT)`. | 435 | Bodies for the **26 older** messages (avg ~17 lines). This is the variant that **appends** prior replies as `----- Message -----` quote blocks. |
| `PAT_MYC_MESG` | Encounter↔message bridge (patient side): `(PAT_ENC_CSN_ID, LINE) → MYCHART_MESSAGE_ID`, with `PAT_ENC_DATE_REAL`/`CONTACT_DATE`. | 86 | One row per CSN-bearing message; `LINE` orders messages within an encounter. |
| `MSG_ROUTING_PAT_ENC` | In-basket routing log per message-encounter: `(PAT_ENC_CSN_ID, LINE, PAT_ID, CONTACT_DATE, CM_CT_OWNER_ID)`. One LINE per routing hop/recipient. | 177 | More rows than messages — logs every hop (up to 14 LINEs/CSN). `CM_CT_OWNER_ID` empty here. |
| `MYC_MESG_CHILD` | Forward reply edge: `(MESSAGE_ID, LINE, CHILD_MSG_ID)` — the inverse of `PARENT_MESSAGE_ID`. | 44 | Lets one message point to **multiple** replies (the thread is a tree, not a list). |
| `MYC_MESG_QUESR_ANS` | Links a Questionnaire-Submission message to questionnaire-answer id(s): `(MESSAGE_ID, LINE, QUESR_ANS_ID)`. | 21 | Same `QUESR_ANS_ID` can attach to 2 messages (duplicate-submission burst). Target HQA record **not** in this export (see Open questions). |
| `MYC_MESG_CNCL_RSN` | Free-text appointment-cancellation comment, line-chunked: `(MESSAGE_ID, LINE, CANCEL_REASON)`. | 6 | One 6-line block here naming the lab appt to cancel. |
| `MYC_MESG_ORD_ITEMS` | Order(s) referenced by a Medication-Renewal-Request message: `(MESSAGE_ID, LINE, REN_REQ_ORDER_ID, REN_REQ_FILL_SOURCE_C_NAME)`. | 3 | Pairs with `MYC_MESG.RQSTD_PHARMACY_ID(_PHARMACY_NAME)`. |
| `PAT_ENC_THREADS` | Telephone/message encounter ↔ in-basket thread: `(PAT_ENC_CSN_ID, CONTACT_DATE, THREAD_ID)`. One row per **encounter** (not per message). | 169 | `THREAD_ID` populated on only **27** rows (the in-basket-threaded telephone encounters). `THREAD_ID` is its own id space — **does not** match `MESSAGE_ID` or `INBASKET_MSG_ID`. |
| `IB_MESSAGES_5` | Single-column (`MSG_ID`) supplement of the In-Basket message master. | 97 | Provider-side queue ids; **31 of 85** `MYC_MESG.INBASKET_MSG_ID` values match here (partial). Base `IB_MESSAGES` and other supplements absent. |

EMPTY / sparse in this specimen, named so you expect them: `MYC_MESG.RECORD_STATUS_C_NAME` (the
soft-delete/revoke sentinel "Soft deleted") is **NULL on all 116 rows** — no revoked messages here;
`MYC_MESG.RELATED_MESSAGE_ID` (used to re-open a closed thread by starting a new chain) is **empty**;
`MYC_MESG.PAT_HX_QUESR_ID` / `HX_QUESR_*` (the questionnaire-context FKs the schema doc ties to
questionnaire messages) are **empty on every row** — the questionnaire link is via `MYC_MESG_QUESR_ANS`,
not these columns.

Master/lookup joins — **two distinct id spaces**: the message **parties** `FROM_USER_ID`/`TO_USER_ID`
are alphanumeric MyChart/EMP **user** ids (e.g. `TJC322`, `MYCHARTG`) → `CLARITY_EMP.USER_ID`
(display `CLARITY_EMP.NAME`) — they are **not** in `CLARITY_SER` (18/18 and 4/4 resolve in EMP, 0 in SER).
The **provider** `PROV_ID` is a numeric SER id → `CLARITY_SER.PROV_ID`/`PROV_NAME` (all 12 resolve);
`DEPARTMENT_ID` → `CLARITY_DEP.DEPARTMENT_ID`/`DEPARTMENT_NAME` (all 5); `RQSTD_PHARMACY_ID` → pharmacy.
The two **party** ids carry denormalized `_NAME` companions (`FROM_USER_ID_NAME`/`TO_USER_ID_NAME`, §4),
so you rarely need the master for display; **`PROV_ID` and `DEPARTMENT_ID` have no inline `_NAME` companion** —
resolve those through the master file. (Cross-ref general-patterns §6/§41 on namespace-dependent id resolution.)

## How they join

All joins below were run against the specimen and the row math stated is what came back.

- **Message → its body.** `MYC_MESG.MESSAGE_ID = MYC_MESG_RTF_TEXT.MESSAGE_ID` (newer) **or**
  `= MSG_TXT.MESSAGE_ID` (older), 1:many over `LINE`. The two stores **partition the 116 messages with
  zero overlap and zero gaps** (26 plain + 90 RTF = 116). You must check **both** tables to retrieve
  every body. Reassemble with `group_concat(... ORDER BY CAST(LINE AS INT))` (§8 line-chunked text).
- **Reply threading (two equivalent edges).** `MYC_MESG.PARENT_MESSAGE_ID = MYC_MESG.MESSAGE_ID`
  (self-join; root has empty parent) **and** `MYC_MESG_CHILD.MESSAGE_ID → parent`,
  `MYC_MESG_CHILD.CHILD_MSG_ID → MYC_MESG.MESSAGE_ID` (the forward inverse). All 44 child rows match a
  parent pointer exactly. 44 of 116 messages carry a parent. **The graph is a tree, not a chain** — one
  message had 2 children here.
- **Message → encounter (the thread bridge).** `MYC_MESG.PAT_ENC_CSN_ID = PAT_ENC.PAT_ENC_CSN_ID`:
  **all 86** CSN-bearing messages resolve to a real `PAT_ENC` contact, but across only **42 distinct
  CSNs** — i.e. **multiple messages share one CSN, so grouping by CSN = grouping by thread** (§2 CSN).
  `PAT_MYC_MESG.MYCHART_MESSAGE_ID = MYC_MESG.MESSAGE_ID` and `PAT_MYC_MESG.PAT_ENC_CSN_ID =
  MYC_MESG.PAT_ENC_CSN_ID` are 86/86 consistent — `PAT_MYC_MESG` is the same bridge from the patient/
  encounter side.
- **Message → routing/in-basket.** `MSG_ROUTING_PAT_ENC.PAT_ENC_CSN_ID = MYC_MESG.PAT_ENC_CSN_ID`
  (30 of its 52 CSNs are message CSNs; the rest route non-MyChart in-basket items). `MYC_MESG.INBASKET_MSG_ID
  = IB_MESSAGES_5.MSG_ID` ties a message to the provider's in-basket entry (**partial: 31/85**).
- **Subtype joins.** Questionnaire: `MYC_MESG.MESSAGE_ID = MYC_MESG_QUESR_ANS.MESSAGE_ID` (21/21).
  Renewal: `MYC_MESG.MESSAGE_ID = MYC_MESG_ORD_ITEMS.MESSAGE_ID` + `MYC_MESG.RQSTD_PHARMACY_ID(_PHARMACY_NAME)`.
  Cancellation: `MYC_MESG.MESSAGE_ID = MYC_MESG_CNCL_RSN.MESSAGE_ID`.
- **Telephone-encounter thread.** `PAT_ENC_THREADS.PAT_ENC_CSN_ID = MYC_MESG.PAT_ENC_CSN_ID` (42 of
  169 encounter rows are message encounters). `PAT_ENC_THREADS.THREAD_ID` is a **separate** in-basket
  thread id (27 populated) and does **not** join to `MESSAGE_ID`/`INBASKET_MSG_ID` — treat it as a
  marker that "this telephone encounter was threaded to another user," not a message key.
- **Party / department.** `FROM_USER_ID`/`TO_USER_ID → CLARITY_EMP.USER_ID` (alphanumeric MyChart/EMP
  user ids — 18/18 and 4/4 resolve in EMP, 0 in SER); `PROV_ID → CLARITY_SER.PROV_ID` (numeric SER id,
  12/12); `DEPARTMENT_ID → CLARITY_DEP.DEPARTMENT_ID` (5/5) (`PROV_ID` set on 99/116, `DEPARTMENT_ID` on 100/116).

## Unstructured tie-back

**This domain IS the unstructured material.** The message prose never lives in the `MYC_MESG` header —
it is reassembled from the line-chunked body stores:

- **Newer messages → `MYC_MESG_RTF_TEXT.RTF_TXT`** (RTF). `group_concat` the lines in `LINE` order, then
  strip RTF control words. Per Epic's doc this store holds only the **current** message (no quoted
  history), so each body is just that one note.
- **Older messages → `MSG_TXT.MSG_TXT`** (plain text). Same reassembly, but this variant **appends the
  prior replies** as `----- Message -----` quote blocks, so one row's body may contain the whole chain.
- **Two RTF dialects signal author.** Patient-typed bodies use a minimal Arial header
  `{\rtf1\ansi\deflang1033\ftnbj…}` (53 of the 90 RTF messages); provider/system/letter-template bodies
  use Epic headers `{\rtf1\epic…}` / `{\rtf1\sstecf…}`. Some template bodies begin with a literal
  `\*Unknown;` sentinel (4 messages here — a letter-template artifact, not patient text).
- **Workflow-specific free text is split out further:** `MYC_MESG_CNCL_RSN.CANCEL_REASON` (cancellation
  comments) and `MYC_MESG_QUESR_ANS.QUESR_ANS_ID` (questionnaire answers — content lives outside this
  area). Renewal order links are in `MYC_MESG_ORD_ITEMS`.
- Message bodies cross-reference the rest of the chart by **subject and narrative**, not by FK: a renewal
  thread's `REN_REQ_ORDER_ID` joins to `ORDER_MED`; a "Message about your results" body discusses lab
  rows; an imaging-question thread precedes a real order. Treat these as narrative wrappers around
  structured events.

## Gotchas & quirks (chased to *why*)

1. **`CREATED_TIME` sorts lexically and lies; `PAT_ENC_DATE_REAL` is missing on 30 rows.**
   *Observe:* `MIN/MAX(CREATED_TIME)` returns `1/2/2020 … 9/7/2020`, absurd for a 2018–2026 corpus.
   *Why:* `CREATED_TIME` is TEXT in `M/D/YYYY` form (§10) so it sorts as strings; and `PAT_ENC_DATE_REAL`
   is only populated on the **86 CSN-bearing** messages (the 30 admin/appointment messages have none).
   *Handle:* sort by **`CAST(MESSAGE_ID AS INTEGER)`** — it is minted monotonically per send and is the
   only key present on all 116 rows. (`MESSAGE_ID` is ~99% time-monotone; see #2 for the exception.)

2. **`CREATED_TIME` (send instant) and `PAT_ENC_DATE_REAL` (linked-encounter date) are different clocks.**
   *Observe:* an "Appointment Reminder" has `CREATED_TIME = 1/2/2020` but `PAT_ENC_DATE_REAL = 65387`
   (= 2020-01-09, the appointment day a week later); sorting the 86 by `PAT_ENC_DATE_REAL` produces 5
   inversions vs `MESSAGE_ID`. *Why:* system/template messages are **filed against the appointment's
   encounter contact**, so their `PAT_ENC_DATE_REAL` is the *appointment* date, not the send date — two
   genuinely different events. *Handle:* use `CREATED_TIME` for "when the message was sent" and
   `PAT_ENC_DATE_REAL`/`PAT_ENC.CONTACT_DATE` for "what encounter it concerns"; don't conflate them.

3. **A thread is reconstructed by CSN for clinical messages, but the 30 admin messages have no CSN.**
   *Observe:* 86 messages group cleanly into 42 CSN-threads; 30 messages (Appointment Request, "Choosing
   a new provider", email-bounce notices, minor-access requests, the original "Message Your Care Team not
   working" thread) have **empty `PAT_ENC_CSN_ID`**. *Why:* only conversations that open a message/
   telephone *encounter* get a CSN; admin/registration workflows don't file an encounter contact.
   *Handle:* group by CSN for clinical threads, but fall back to walking `PARENT_MESSAGE_ID` /
   `MYC_MESG_CHILD` for the no-CSN messages — every reply still shares its parent's CSN (empty or set), so
   the parent chain is the safe universal thread key.

4. **The doctor in `TO_USER_ID_NAME` is usually NOT who replies.** *Observe:* all 62 From-Patient rows
   have NULL `FROM_USER`; 42 name a `TO_USER` (usually RAMMELKAMP, ZOE L), yet To-Patient replies come
   FROM nurses/coordinators/`MYCHART, GENERIC` — Dr. Rammelkamp herself sent only 3 of 54 replies; LOUGH
   (RN) sent 10. *Why:* patient messages are addressed to a provider's **in-basket pool**, and a nurse/MA
   answers on the doctor's behalf; `ORIGINAL_TO` (45 rows) records the re-route off the originally-
   targeted user. *Handle:* read `FROM_USER_ID_NAME` for who actually replied, `TO_USER_ID_NAME`/
   `ORIGINAL_TO` for who it was *aimed* at — they routinely differ.

5. **Body store splits purely by date/ID era, with quote-chain semantics flipping at the boundary.**
   *Observe:* `MSG_TXT` covers `MESSAGE_ID` 7.9M–27.9M (≤ 9/14/2020); `MYC_MESG_RTF_TEXT` covers 33.7M–
   101.7M (≥ 1/21/2021). Zero overlap, zero gaps. *Why:* a mid-build migration replaced the plain-text
   body (Chronicles item 100) with the RTF store that holds only the current message. The older store
   appended `----- Message -----` quote chains; the newer one does not. *Handle:* always query **both**
   stores; when summarizing an old plain-text body, strip the quoted tail or you'll double-count prior
   replies.

6. **`MYC_MESG` is one table for many MyChart workflows; the subtype is signaled by `SUBJECT` + which
   optional FK/child table is populated, not by a type code.** *Observe:* `SUBJECT` buckets include
   "Questionnaire Submission" (21), "Appointment Request" (8), "Medication Renewal Request" (3),
   "Appointment Cancellation Request", plus system "Appointment Reminder/Scheduled/Changed/Rescheduled"
   and "Health Reminder" templates from `MYCHART, GENERIC`. *Why:* MyChart funnels every patient-facing
   workflow through the message file; the structured payload hangs off a subtype-specific FK/child table
   (questionnaire → `MYC_MESG_QUESR_ANS`/`PAT_HX_QUESR_ID`; renewal → `RQSTD_PHARMACY_ID` +
   `MYC_MESG_ORD_ITEMS`; cancel → `MYC_MESG_CNCL_RSN`). *Handle:* branch on `SUBJECT` and the populated
   FK; do not assume a free-text body — many subtypes carry templated text or none (#7). **Note:** in this
   specimen the questionnaire FK is `MYC_MESG_QUESR_ANS` only — `PAT_HX_QUESR_ID` and all `HX_QUESR_*`
   columns are empty despite the schema doc describing them.

7. **"Questionnaire Submission" bodies that say only "Your response has been received." are not broken.**
   *Observe:* newer questionnaire messages have a near-empty body; older ones (2020) embedded the full
   Q&A. *Why:* the answers were externalized to `MYC_MESG_QUESR_ANS.QUESR_ANS_ID` (an HQA record), so the
   body became a stub. They also arrive in **same-second bursts** (3–4 rows in one minute) and occasionally
   as **duplicate consecutive IDs** with identical timestamps. *Handle:* read the answers via the QUESR
   link (where resolvable), and de-dup burst/duplicate submissions before counting.

## Recipes

```sql
-- 1. Every message in true chronological order, with body store and direction.
SELECT CAST(m.MESSAGE_ID AS INTEGER) AS id, m.CREATED_TIME, m.TOFROM_PAT_C_NAME AS dir,
       COALESCE(NULLIF(m.FROM_USER_ID_NAME,''),'(patient)') AS sender,
       m.SUBJECT,
       CASE WHEN EXISTS(SELECT 1 FROM MYC_MESG_RTF_TEXT r WHERE r.MESSAGE_ID=m.MESSAGE_ID) THEN 'RTF'
            WHEN EXISTS(SELECT 1 FROM MSG_TXT t WHERE t.MESSAGE_ID=m.MESSAGE_ID) THEN 'PLAIN'
            ELSE '(no body)' END AS body_store
FROM MYC_MESG m
ORDER BY CAST(m.MESSAGE_ID AS INTEGER);

-- 2. Reassemble a message body (checks BOTH stores; works for any MESSAGE_ID).
SELECT (SELECT group_concat(RTF_TXT, char(10)) FROM
          (SELECT RTF_TXT FROM MYC_MESG_RTF_TEXT WHERE MESSAGE_ID = :mid ORDER BY CAST(LINE AS INT)))
       AS rtf_body,
       (SELECT group_concat(MSG_TXT, char(10)) FROM
          (SELECT MSG_TXT FROM MSG_TXT WHERE MESSAGE_ID = :mid ORDER BY CAST(LINE AS INT)))
       AS plain_body;

-- 3. Reconstruct one conversation as a thread, ordered within the encounter.
--    (Group by CSN for clinical threads; the 30 no-CSN admin messages thread via PARENT_MESSAGE_ID.)
SELECT CAST(m.MESSAGE_ID AS INTEGER) AS id, m.PARENT_MESSAGE_ID AS parent,
       m.TOFROM_PAT_C_NAME AS dir, m.CREATED_TIME,
       COALESCE(NULLIF(m.FROM_USER_ID_NAME,''),'(patient)') AS sender, m.SUBJECT
FROM MYC_MESG m
WHERE m.PAT_ENC_CSN_ID = :csn
ORDER BY CAST(m.MESSAGE_ID AS INTEGER);

-- 4. Thread index: every message-thread (CSN) with its span, size and topic.
SELECT m.PAT_ENC_CSN_ID AS csn, count(*) AS n_msgs,
       MIN(m.CREATED_TIME) AS first_seen, MAX(m.CREATED_TIME) AS last_seen,
       MIN(m.SUBJECT) AS subject
FROM MYC_MESG m
WHERE NULLIF(m.PAT_ENC_CSN_ID,'') IS NOT NULL
GROUP BY m.PAT_ENC_CSN_ID
ORDER BY n_msgs DESC;

-- 5. Who actually answered (pool reality): aimed-at vs replied-by.
SELECT m.TO_USER_ID_NAME AS aimed_at, r.FROM_USER_ID_NAME AS replied_by, count(*) AS n
FROM MYC_MESG m JOIN MYC_MESG r ON r.PARENT_MESSAGE_ID = m.MESSAGE_ID
WHERE m.TOFROM_PAT_C_NAME = 'From Patient' AND r.TOFROM_PAT_C_NAME = 'To Patient'
GROUP BY 1,2 ORDER BY n DESC;

-- 6. Structured subtypes and their child payloads.
SELECT m.MESSAGE_ID, m.SUBJECT,
       (SELECT count(*) FROM MYC_MESG_QUESR_ANS q WHERE q.MESSAGE_ID=m.MESSAGE_ID) AS quesr_links,
       NULLIF(m.RQSTD_PHARMACY_ID_PHARMACY_NAME,'') AS renewal_pharmacy,
       (SELECT count(*) FROM MYC_MESG_ORD_ITEMS o WHERE o.MESSAGE_ID=m.MESSAGE_ID) AS renewal_orders,
       (SELECT count(*) FROM MYC_MESG_CNCL_RSN c WHERE c.MESSAGE_ID=m.MESSAGE_ID) AS cancel_reasons
FROM MYC_MESG m
WHERE m.SUBJECT LIKE '%Questionnaire%' OR m.SUBJECT LIKE '%Renewal%' OR m.SUBJECT LIKE '%Cancellation%';
```

## Open questions / specimen notes

- **`MYC_MESG_QUESR_ANS.QUESR_ANS_ID` does not resolve inside this export.** It points to an HQA
  questionnaire-answer record; the questionnaire-answer tables present here (`QUESR_LST_ANS_INFO`,
  `PAT_ENC_QNRS_ANS`, `MYC_APPT_QNR_DATA`) are keyed by `(PAT_ID, LINE)` / form id, not by `QUESR_ANS_ID`,
  so the 2024+ submission *content* the message body omits is not recoverable here.
- **`IB_MESSAGES_5` is a one-column (`MSG_ID`) stub** and only 31/85 `INBASKET_MSG_ID`s match it; the base
  `IB_MESSAGES` and other supplements are absent, so the provider-side in-basket body/status can't be
  reconstructed.
- **`PAT_ENC_THREADS.THREAD_ID`** (27 populated) is a telephone-encounter in-basket thread id in its own
  space — it joins to neither `MESSAGE_ID` nor `INBASKET_MSG_ID` in this specimen; its target table was
  not found.
- **Specimen counts (illustrative):** 116 messages, 62 From-Patient / 54 To-Patient, span 2018-08 →
  2026-02 (by `MESSAGE_ID`/`PAT_ENC_DATE_REAL`). 86 carry a CSN across 42 threads; 44 are replies; 85 have
  an in-basket id. `RECORD_STATUS_C_NAME` NULL on all rows (no revoked messages). Recurring staff: the PCP
  plus several RNs/coordinators and the system sender "MYCHART, GENERIC". Provider names are fine to quote;
  no direct patient identifiers appear above.
