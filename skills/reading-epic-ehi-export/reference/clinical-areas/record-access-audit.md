# Record access & audit trail — Epic EHI field guide

**Scope.** The field-level change ledger of the patient registration record (EPT) and its visit/hospital
billing accounts (HAR): who/what/when changed each item, with before/after values. This is typically the
**single largest table in an EHI export by row count** (§47) — and, as shown below, almost all of that bulk
is mechanical fan-out, not information. It is a *change* audit, **not** an *access* log: nothing here says
who *viewed* the chart (see Gotcha 5).

**Where it sits.** Chronicles keeps an item-level audit trail on registration master files. The export does
not ship the underlying audit tables; instead it materializes `V_EHI_REG_ITEM_AUDIT_*` views (§47), one per
audited master file, flattened to one row per (audit event, changed line, **mapped Clarity column**). The
EPT view carries `PAT_ID` directly (§1) and a `CHANGED_PAT_ENC_CSN_ID` when the changed item lives on an
encounter contact (§2); the HAR view carries `HSP_ACCOUNT_ID`.

## Tables

| table | role | rows in specimen | notes |
|---|---|---|---|
| `V_EHI_REG_ITEM_AUDIT_EPT` | **Spine.** Patient-record audit events. Documented key `(ITEM_AUDIT_ID, LINE)` — but see Gotcha 2. | 6,477 — the biggest table in this export, ~10× the runner-up | Instant (UTC + local), `PAT_ID`, `CHANGED_PAT_ENC_CSN_ID`, `CHANGED_DATA_ELEMENT` (a literal `'TABLE.COLUMN'` string), `CHANGED_ITEM_NAME`, `CHANGED_LINE`/`CHANGED_SUB_LINE`, `OLD_VALUE_EXTERNAL`/`NEW_VALUE_EXTERNAL`, `USER_ID`(+`_NAME`). The §38 anchor pattern. |
| `V_EHI_REG_ITEM_AUDIT_HAR` | Same shape for visit-account (HAR) records: `HSP_ACCOUNT_ID` instead of `PAT_ID`/CSN. | 42 | In an outpatient specimen the audited accounts are **professional-billing visit accounts** that join `ARPB_VISITS`, *not* `HSP_ACCOUNT` — see Gotcha 6. |

**Documented siblings, not shipped here** (same self-describing shape, one per master file; the exporter
emits a view only when that masterfile has audit rows in scope — expect them in richer exports, §7):
`V_EHI_REG_ITEM_AUDIT_CVG` (coverage), `_EAR` (guarantor), `_BEN` (benefits), `_CLM` (claim), `_FNC`/`_FNT`
(financial assistance case/tracker), `_OYO` (communication preferences), `_RLA` (patient relationships);
plus `V_EHI_AUDIT_RT_HSB_ITEMS` (hospital-billing document audit) and `V_EHI_AUDIT_TAG` (appeals/grievances).
So "the audit giant" is a *family*: registration-side history that current-state tables collapsed away (§35)
may survive only in whichever of these views ships.

**Related but distinct:** dozens of domain-specific `*_AUDIT`/`*_HIST` tables (e.g. `REFERRAL_HIST`,
`PAT_ENC_ADMIT_DX_AUDIT` — 1 row here) are who/when/why lifecycle logs for *their own* record type (§31,
§37), each with bespoke columns. The `V_EHI_REG_ITEM_AUDIT_*` family is different in kind: generic,
self-describing (the row *names* the column it changed), and registration-scoped. Those tables are covered
in their domain guides, not here.

## Anatomy of the ledger (read this before querying)

Three nested levels, all in one flat table:

1. **Event** (`ITEM_AUDIT_ID`): one save/filing action — one user, one instant, one target record. In one
   specimen: 39 EPT events and 4 HAR events. Verified: `CAST(ITEM_AUDIT_ID AS INT)` increases monotonically
   with the audit instant, so it is the safe chronological sort key (the instants are `M/D/YYYY h:mm:ss AM`
   text and sort lexically — §17).
2. **Changed item line** (`LINE` within the event): one audited Chronicles item change —
   `CHANGED_ITEM_NAME` (the Chronicles item's name, e.g. `APPT STATUS`), `CHANGED_LINE` (which line of a
   multiple-response item), `OLD_VALUE_EXTERNAL` → `NEW_VALUE_EXTERNAL`.
3. **Mapped column** (`CHANGED_DATA_ELEMENT`): the *same* `(ITEM_AUDIT_ID, LINE)` repeats once per Clarity
   `TABLE.COLUMN` the changed item is published to. One item can map to several tables (an appointment
   department change emits rows for both `PAT_ENC.DEPARTMENT_ID` and `PAT_ENC_APPT.DEPARTMENT_ID`), and —
   the killer — the contact-serial-number item maps to **~305 columns**, one for every Clarity table keyed
   by `PAT_ENC_CSN_ID`. The inverse also occurs: two items (admit *date* and admit *time*) both map to the
   single column `HSP_ACCOUNT.ADM_DATE_TIME` (§20's split date/time, seen from the Chronicles side).

Values are **external** (display) renderings, pre-resolved like a `_C_NAME` (§23): category changes read as
titles (`Scheduled` → `Arrived`), booleans as `Yes`/`No` (§28), and record-pointer items as
`DISPLAY NAME [12345]` — name and id packed in one string. A first-fill shows `OLD_VALUE_EXTERNAL` NULL
(§39: it loaded as NULL, meaning "no prior value").

## How they join

All verified against rows in this specimen.

- **EPT audit → patient:** `V_EHI_REG_ITEM_AUDIT_EPT.PAT_ID = PATIENT.PAT_ID` (single patient here; in a
  proxy/multi-patient export filter on it).
- **EPT audit → encounter:** `CHANGED_PAT_ENC_CSN_ID = PAT_ENC.PAT_ENC_CSN_ID`. Verified: all 22 distinct
  CSNs resolve. NULL CSN = a **patient-level** item (rows changing `PATIENT.*` columns carry no contact),
  not a broken link (§39).
- **Actor → user master:** `USER_ID = CLARITY_EMP.USER_ID`. Verified 13/13 distinct EPT users and all HAR
  users resolve, including the system actors (see Gotcha 5). `USER_ID_NAME` is the denormalized companion
  (§6); its doc warns the name "may be hidden."
- **HAR audit → visit account:** `HSP_ACCOUNT_ID = ARPB_VISITS.PB_VISIT_ID` (3/3 here), then
  `ARPB_VISITS.PRIM_ENC_CSN_ID → PAT_ENC` ties the account edit back to the visit. The naive
  `HSP_ACCOUNT_ID = HSP_ACCOUNT.HSP_ACCOUNT_ID` join resolves **0/3** in this specimen — Gotcha 6.
- **Self-description → the rest of the export:** `CHANGED_DATA_ELEMENT` is itself a foreign key *into the
  schema*: split on `'.'` and you can join the table name against `_tables`/`_schema_column` to read what
  the changed column means. Only 63 of the 308 Clarity tables named here are actually shipped in this
  export (Gotcha 1).
- **EPT ↔ HAR:** no key joins them, but the two views draw `ITEM_AUDIT_ID` from **one shared sequence**
  (zero id overlap, yet one registration save mints adjacent ids — an EPT event and a HAR event one apart,
  same instant, same user). Same-instant/same-user events across the two views are one workflow action.

## Unstructured tie-back

**None.** No RTF/Media file references this domain, and the ledger carries no free-text comment column. The
closest thing to narrative is `OLD/NEW_VALUE_EXTERNAL`, which can contain whatever text the changed item
held — treat those columns as potentially PHI-dense (addresses, names, phone numbers may pass through them
as old/new values even though this specimen's window only caught scheduling and billing items).

## Gotchas & quirks (chased to *why*)

1. **98.9% of the giant is one item.** 6,405 of 6,477 EPT rows have `CHANGED_ITEM_NAME = 'CONTACT SERIAL
   NUMBER'` — 21 contact-creation events × ~305 mapped columns each. *Why:* assigning a CSN to a new
   contact is one Chronicles item change, but the view fans it across every Clarity table that publishes
   `PAT_ENC_CSN_ID` (§12 fan-out at industrial scale; the §38/§47 "audit giant" is mostly this). The
   mapping is mechanical enough that the view even lists **itself**
   (`V_EHI_REG_ITEM_AUDIT_EPT.CHANGED_PAT_ENC_CSN_ID`) as a changed element, and names ~245 tables that
   aren't shipped in the export at all. *Handle:* always exclude `CHANGED_ITEM_NAME = 'CONTACT SERIAL
   NUMBER'` (or group to events) before counting "changes"; the real ledger here is 72 rows — 50 distinct
   `(event, LINE)` changes across 27 of the 39 events. A raw `COUNT(*)` measures plumbing, not edits.

2. **The documented PK `(ITEM_AUDIT_ID, LINE)` is not unique.** Up to 305 rows share one key pair,
   differing only in `CHANGED_DATA_ELEMENT`. *Why:* the schema doc describes the *base* audit tables
   (`REG_ITEM_AUDIT_EPT` + `REG_ITEM_AUDIT_LINES_EPT`, which the view doc says to use "if not in the EHI
   context" — neither is shipped, nor even cataloged here, §7). The view multiplies event-header × line ×
   item-to-column mapping into one flat table. *Handle:* the working key is `(ITEM_AUDIT_ID, LINE,
   CHANGED_DATA_ELEMENT)`; to see each change once, `GROUP BY ITEM_AUDIT_ID, LINE`.

3. **`CHANGED_LINE = 0` rows are line-count bookkeeping, not values.** They read like `0` → `1` and look
   like nonsense data. *Why:* for a multiple-response item (§9), Chronicles audits the *number of lines* as
   change line 0 and each line's value as line 1..N — adding the first coverage to an account's coverage
   list emits both a `0`→`1` count row and a NULL→value row. *Handle:* filter `CAST(CHANGED_LINE AS INT) >
   0` for value history; read line-0 rows only to detect list growth/shrinkage.

4. **The ledger covers a trailing window, not the life of the record.** In one specimen, an 8-year-old
   record has audit events spanning only the final ~9 months before the export, touching 22 of 169
   encounter contacts; the oldest surviving event is itself a routine monthly batch job. *Why:* Chronicles
   registration audit data is purgeable on an org-configured retention schedule; what you get is whatever
   survived purge at export time (a §32 exception: this is the one place where things *don't* persist
   forever). *Handle:* absence of an audit row never means "this field never changed" — it usually means
   the change predates the window. Establish the window first (recipe 5) before interpreting silence.

5. **It logs *changes*, not *access* — and many actors aren't people.** No table in the export records who
   *viewed* the record (no access-log table exists here); Epic's access log is a separate system patients
   must request separately. What you do get per change: `USER_ID`/`USER_ID_NAME` — and that's all (no
   workstation, no department context, no reason). Expect heavy system traffic: in this specimen `CLARITY
   ETL` owns ~47% of rows (the §38 bulk-load signature; nightly/monthly jobs that create administrative
   contacts, §43), plus `MYCHARTBGUSER` (a service account acting *on behalf of* patient MyChart activity —
   e.g. e-checkin; not a staff member touching the chart), a scheduling batch user, and Epic's built-in
   user id `1`. *Why:* every write path — interactive, interface, batch — files through the same audit.
   *Handle:* for "which humans touched my record," filter out the service accounts; for "did anyone look,"
   this export cannot answer.

6. **`V_EHI_REG_ITEM_AUDIT_HAR.HSP_ACCOUNT_ID` may not join `HSP_ACCOUNT`.** Here 0/3 audited account ids
   exist in `HSP_ACCOUNT` (whose 4 rows occupy a different id range entirely) — but 3/3 join
   `ARPB_VISITS.PB_VISIT_ID`. *Why:* the HAR master file backs **both** hospital accounts and
   professional-billing *visit* accounts (the view's own description says "visit account record audit
   events"); the Clarity `HSP_ACCOUNT` table materializes only the hospital-billing kind, while PB visit
   accounts land in `ARPB_VISITS` (§41: one masterfile, two Clarity surfaces). The column name lies about
   its scope (§24). *Handle:* resolve `HSP_ACCOUNT_ID` against *both* `ARPB_VISITS.PB_VISIT_ID` and
   `HSP_ACCOUNT.HSP_ACCOUNT_ID`, then walk `PRIM_ENC_CSN_ID` (or HAR's own encounter links) to the visit.

7. **Don't double-count: one item ↔ many columns, two items ↔ one column, and cosmetic diffs.** A single
   department change appears twice (PAT_ENC + PAT_ENC_APPT); admit date and admit time are *separate audit
   lines* both naming `HSP_ACCOUNT.ADM_DATE_TIME`; and because values are display renderings, a row can
   show a formatting-only "change" (e.g. a copay display re-rendered with vs without decimal places, the
   amount itself unchanged). *Why:* the item→column
   map reflects Clarity's denormalization, and "external value" means "as currently formatted," not "as
   stored." *Handle:* count changes at `(ITEM_AUDIT_ID, LINE)` granularity keyed by `CHANGED_ITEM_NAME`;
   treat old=new-after-normalization rows as no-ops.

8. **`LINE` gaps mean changes you can't see.** A HAR event here runs LINE 1, 2, 4, 6… — lines 3 and 5 are
   simply absent. *Why (inferred):* the view emits a line only when the changed item maps to a Clarity
   column in the export's extract; items without a mapping are skipped but keep their line numbers.
   *Handle:* a gap in `LINE` is the shadow of an additional change whose content wasn't exported — don't
   renumber, and don't assume the visible lines are the whole event.

9. **Two instants per row, and neither sorts as text.** `AUDIT_INSTANT_UTC_DTTM` vs
   `AUDIT_INSTANT_LOCAL_DTTM` differ by 5 or 6 hours depending on DST (§19's dual-instant pattern — the
   §38 example's "5h apart" is seasonal). Both are `M/D/YYYY` text: `MIN()`/`MAX()`/`ORDER BY` on them lie
   lexically (§17). *Handle:* order and window on `CAST(ITEM_AUDIT_ID AS INT)` (verified monotonic with
   time); display the local instant; use UTC when correlating with other UTC-suffixed columns.

## Recipes

```sql
-- 1) Event-level digest: every registration save on my record (who, when, what, which visit).
SELECT CAST(ITEM_AUDIT_ID AS INT)                AS event_id,
       MIN(AUDIT_INSTANT_LOCAL_DTTM)             AS at_local,
       USER_ID_NAME                              AS who,
       CHANGED_PAT_ENC_CSN_ID                    AS csn,        -- NULL = patient-level item
       COUNT(DISTINCT LINE)                      AS n_changes,
       GROUP_CONCAT(DISTINCT CHANGED_ITEM_NAME)  AS items
FROM V_EHI_REG_ITEM_AUDIT_EPT
GROUP BY ITEM_AUDIT_ID, USER_ID_NAME, CHANGED_PAT_ENC_CSN_ID
ORDER BY event_id;                                -- id order == time order (gotcha 9)

-- 2) Substantive changes only: collapse the column fan-out, drop CSN stamps and line-count rows.
SELECT CAST(ITEM_AUDIT_ID AS INT) AS event_id,
       AUDIT_INSTANT_LOCAL_DTTM   AS at_local,
       USER_ID_NAME               AS who,
       CHANGED_PAT_ENC_CSN_ID     AS csn,
       CHANGED_ITEM_NAME          AS item,
       MIN(CHANGED_DATA_ELEMENT)  AS one_mapped_column,
       OLD_VALUE_EXTERNAL, NEW_VALUE_EXTERNAL
FROM V_EHI_REG_ITEM_AUDIT_EPT
WHERE CHANGED_ITEM_NAME <> 'CONTACT SERIAL NUMBER'
  AND CAST(CHANGED_LINE AS INT) > 0              -- gotcha 3
GROUP BY ITEM_AUDIT_ID, LINE                     -- gotcha 2: one row per actual change
ORDER BY event_id, CAST(LINE AS INT);

-- 3) Reconstruct one field's history over time (here: appointment status; works for any
--    'TABLE.COLUMN' the ledger names — address, PCP, coverage items appear the same way).
SELECT AUDIT_INSTANT_LOCAL_DTTM AS at_local, USER_ID_NAME AS who,
       CHANGED_PAT_ENC_CSN_ID   AS csn,
       OLD_VALUE_EXTERNAL       AS old_value, NEW_VALUE_EXTERNAL AS new_value
FROM V_EHI_REG_ITEM_AUDIT_EPT
WHERE CHANGED_DATA_ELEMENT = 'PAT_ENC.APPT_STATUS_C'
ORDER BY CAST(ITEM_AUDIT_ID AS INT), CAST(LINE AS INT);

-- 4) "Who touched my record?" — every actor across both ledgers, first/last touch.
WITH ev AS (
  SELECT DISTINCT ITEM_AUDIT_ID, USER_ID_NAME, AUDIT_INSTANT_LOCAL_DTTM FROM V_EHI_REG_ITEM_AUDIT_EPT
  UNION
  SELECT DISTINCT ITEM_AUDIT_ID, USER_ID_NAME, AUDIT_INSTANT_LOCAL_DTTM FROM V_EHI_REG_ITEM_AUDIT_HAR
)
SELECT USER_ID_NAME AS who, COUNT(*) AS n_events,
       (SELECT AUDIT_INSTANT_LOCAL_DTTM FROM ev e2 WHERE e2.USER_ID_NAME = e.USER_ID_NAME
         ORDER BY CAST(ITEM_AUDIT_ID AS INT) LIMIT 1)      AS first_touch,
       (SELECT AUDIT_INSTANT_LOCAL_DTTM FROM ev e2 WHERE e2.USER_ID_NAME = e.USER_ID_NAME
         ORDER BY CAST(ITEM_AUDIT_ID AS INT) DESC LIMIT 1) AS last_touch
FROM ev e GROUP BY USER_ID_NAME ORDER BY n_events DESC;

-- 5) Establish the audit window before interpreting silence (gotcha 4).
SELECT (SELECT AUDIT_INSTANT_LOCAL_DTTM FROM V_EHI_REG_ITEM_AUDIT_EPT
         ORDER BY CAST(ITEM_AUDIT_ID AS INT) LIMIT 1)        AS earliest_event,
       (SELECT AUDIT_INSTANT_LOCAL_DTTM FROM V_EHI_REG_ITEM_AUDIT_EPT
         ORDER BY CAST(ITEM_AUDIT_ID AS INT) DESC LIMIT 1)   AS latest_event,
       (SELECT COUNT(DISTINCT CHANGED_PAT_ENC_CSN_ID) FROM V_EHI_REG_ITEM_AUDIT_EPT) AS contacts_audited,
       (SELECT COUNT(*) FROM PAT_ENC)                        AS contacts_total;

-- 6) Visit-account (HAR) edits tied back to the visit they bill for.
SELECT h.AUDIT_INSTANT_LOCAL_DTTM AS at_local, h.USER_ID_NAME AS who,
       h.HSP_ACCOUNT_ID, v.PRIM_ENC_CSN_ID AS visit_csn,
       h.CHANGED_ITEM_NAME AS item,
       h.OLD_VALUE_EXTERNAL, h.NEW_VALUE_EXTERNAL
FROM V_EHI_REG_ITEM_AUDIT_HAR h
LEFT JOIN ARPB_VISITS v ON v.PB_VISIT_ID = h.HSP_ACCOUNT_ID   -- gotcha 6; also try HSP_ACCOUNT
GROUP BY h.ITEM_AUDIT_ID, h.LINE
ORDER BY CAST(h.ITEM_AUDIT_ID AS INT), CAST(h.LINE AS INT);
```

**What a patient can actually learn from this domain:** which staff and system accounts *modified* the
registration/billing side of the record and exactly when (to the second); the before/after of each touched
field (appointment status walks, department assignments, pharmacy preference, copay display, coverage/
guarantor attachment on a visit account, meds-review attestation instants); and when each recent encounter
contact was created vs when it occurred. What it cannot tell you: who *read* the chart, anything outside
the retention window, and changes to clinical (non-registration) records — those live in each domain's own
`_HX`/`*_AUDIT` tables, or nowhere.

## Open questions / specimen notes

- **Specimen shape:** 6,477 EPT rows = 39 events (21 of them contact creations) over ~9 months; 42 HAR rows
  = 4 events on 3 PB visit accounts; 13 distinct actors in EPT (a 14th — Epic's built-in user id `1` —
  appears only in HAR), ~47% of rows by `CLARITY ETL`. The window's edits
  are all scheduling/registration/billing items — no demographic (address/PCP/name) change happened to be
  captured, so their exact `CHANGED_ITEM_NAME`/element spellings are unobserved here (they would surface as
  `PATIENT.*`-mapped elements with NULL CSN).
- **Retention mechanism inferred, not documented.** The ~9-month window and the batch-job event at its edge
  point to an org-configured audit purge, but no schema doc in the export states the policy. Treat the
  window as an empirical property of each specimen (recipe 5).
- **`LINE`-gap semantics inferred** (gotcha 8): consistent with unmapped/unexported items, but the base
  `REG_ITEM_AUDIT_LINES_*` tables aren't shipped to confirm what the missing lines held.
- **The sibling views are unobserved.** `_CVG`, `_EAR`, `_BEN`, `_CLM`, `_FNC`, `_FNT`, `_OYO`, `_RLA`,
  `V_EHI_AUDIT_RT_HSB_ITEMS`, `V_EHI_AUDIT_TAG` are schema-documented but absent here; whether absence
  means "no audited changes survived" vs "masterfile not in scope for this patient" can't be distinguished
  from one specimen.
- **True hospital-account auditing unobserved.** All audited HARs here are PB visit accounts; whether a
  hospital account's edits would emit ids joining `HSP_ACCOUNT` (as expected from gotcha 6's mechanism) is
  unverified in this outpatient-heavy record.
- Whether `MYCHARTBGUSER` rows can be confidently attributed to *this patient's* own MyChart actions (vs
  any background MyChart processing) is plausible from timing but unproven from columns alone.
