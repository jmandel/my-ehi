# Communication preferences — Epic EHI field guide

**Scope.** How (and whether) the system is allowed to contact the patient: the per-concept channel
matrix ("for New Test Results: Email + Text + Push; for appointment letters: MyChart"), the
appointment-notification opt-in flags, and the generic person-preference satellite. This is *consent
to a channel per purpose* — the channel **addresses** themselves (phone numbers, emails) live in
*demographics*, and the MyChart channel's actual message traffic lives in *patient-provider-messaging*.

**Where it sits.** All four tables are slices of one **OYO (Communication Preferences) master-file
record** — its own ID space, one record per person. None of them carries `PAT_ID`; the patient reaches
it through a pointer column, `PATIENT_4.PREFERENCES_ID` (§3 parent-chain via the PATIENT supplement
stack, §8). The same OYO file also serves non-patient holders: a guarantor points at a record via
`ACCOUNT_2.PREFERENCE_ID` and a MyChart proxy via `PAT_MYC_PRXY_ACSS.PROXY_PREFERENCES_ID` (see
gotcha 2). The "concept" being configured is an **HST (setting) record** — org-level configuration
like "New Test Results" or "Prescription Ready," not patient data.

## Tables

| table | role | rows in one specimen | notes |
|---|---|---|---|
| `COMMUNICATION_PREFERENCES` | concept list: one `LINE` per communication concept configured on the record (§9) | 19 | `(PREFERENCES_ID, LINE, COMMUNICATION_CONCEPT_ID, …_SETTING_NAME)`. Just the concept enumeration — despite the table doc's "concepts **and preferred media**," no media column ships here (§7); media are in the APRV child. |
| `COMM_PREFERENCES_APRV` | **approved media per concept** — the actual channel matrix (§10) | 40 | `(PREFERENCES_ID, GROUP_LINE, VALUE_LINE, APRV_MEDIA_C_NAME)`. Extract of related multiple-response item OYO-104; `GROUP_LINE` aligns to the concept `LINE`. |
| `COMM_PREF_ADDL_ITEMS` | 1:1 scalar satellite: appointment-notification opt-ins, reminder offset, daily-digest settings | 1 | One row per OYO record, keyed `PREFERENCES_ID`. `APPT_NOTIF_{SCHEDULED,CHANGED,CANCELED,MISSED}_YN`, `APPT_REMDR_OFFSET_C_NAME`, `USE_DAILY_DIGEST_YN`/`DAILY_DIGEST_TM`, `AUTO_ADD_TO_WAITLIST_YN`, `RSLT_DAILY_DIGEST_YN`. Mostly NULL here (§46). |
| `PERSON_PREFERENCES` | 1:1 generic person-preference satellite | 1 | Two columns: `PERSON_PREFERENCE_ID` (= the same OYO id) + `TZ_DIFF_ALERT_YN` (time-zone-difference popup; NULL here). A near-empty always-emit companion (§46) — its doc says it holds person preferences *other than* communication ones; in this specimen's schema that is one flag. |

**Documented but NOT shipped in this specimen** (§7 — expect "no such table," not zero rows):
- `V_EHI_REG_ITEM_AUDIT_OYO` — the **field-level change audit for the OYO record** (§38/§47):
  who flipped which channel, old/new value, UTC+local instants, keyed by `PREFERENCES_ID`. Its
  schema doc ships (13 columns) but the view itself does not. Consequence: in such an export the
  entire domain is **current-state only with no timestamps anywhere** (see gotcha 5).
- `PAT_MYC_PRXY_ACSS` — MyChart proxy access, whose `PROXY_PREFERENCES_ID` is the proxy's own OYO
  pointer. Documented, absent here (no proxies on this account).

## How they join

All verified against real keys in one specimen (a single OYO record).

- **Patient → preference record:** `PATIENT_4.PREFERENCES_ID = COMMUNICATION_PREFERENCES.PREFERENCES_ID`.
  This is the only patient link — no OYO table has `PAT_ID` (§1/§3).
- **Concept list:** `(PREFERENCES_ID, LINE)` child rows (§9). `COMMUNICATION_CONCEPT_ID` is the HST
  record id; its §6 denormalized name companion is oddly suffixed `_SETTING_NAME` (HST is the
  *settings* master file). **No HST master table ships**, so the inline name is the only resolution —
  the id alone is a dead end.
- **Concept → approved media:** `COMM_PREFERENCES_APRV.PREFERENCES_ID = cp.PREFERENCES_ID AND
  CAST(GROUP_LINE AS INT) = CAST(cp.LINE AS INT)`, then one channel per `VALUE_LINE` (§10 two-level
  key). Verified: every `GROUP_LINE` lands on an existing concept `LINE` (40/40 rows; lines 2–19),
  with one concept line owning zero media rows (see gotcha 3).
- **Scalar satellites:** `COMM_PREF_ADDL_ITEMS.PREFERENCES_ID` and
  `PERSON_PREFERENCES.PERSON_PREFERENCE_ID` both equal the same OYO id, 1:1 with the record — a
  *topical* horizontal split of one master record (same mechanism as §8 numbered supplements, but
  named by subject instead of numbered).
- **Other holders:** `ACCOUNT_2.PREFERENCE_ID` (guarantor; NULL on both guarantor rows here) and
  `PAT_MYC_PRXY_ACSS.PROXY_PREFERENCES_ID` (proxy; table unshipped here) point into the same
  `PREFERENCES_ID` space.

## Gotchas & quirks (chased to *why*)

1. **No `PAT_ID`, no CSN, anywhere in the domain.** Filtering these tables by patient directly is
   impossible. *Why:* OYO is a free-standing person-preference master file; the *holder* points at it,
   not vice versa (§3). *Handle:* anchor every query at `PATIENT_4.PREFERENCES_ID`.
2. **Not every OYO record is the patient's.** Guarantors (`ACCOUNT_2.PREFERENCE_ID`) and MyChart
   proxies (`PAT_MYC_PRXY_ACSS.PROXY_PREFERENCES_ID`) own OYO records in the same id space. In a
   one-patient export with proxy or guarantor records present, `COMMUNICATION_PREFERENCES` could hold
   **multiple** `PREFERENCES_ID`s. *Why:* communication preferences attach to the *person being
   contacted*, and Epic contacts proxies/guarantors too. *Handle:* never `SELECT *` and assume one
   record; join from the holder's pointer.
3. **A concept line with zero `COMM_PREFERENCES_APRV` rows means "no channel approved," not missing
   data.** In one specimen exactly one of 19 concepts had no media rows. *Why:* OYO-104 is a related
   multiple-response item grouped under the concept; when the patient turns every channel off, that
   group has no values, and a valueless group emits **no rows** in the extract — the §39 corollary
   where absence of child rows *is* the encoding of "none." *Handle:* LEFT JOIN from the concept list
   (recipe 1); an empty media list is a real opt-out signal worth surfacing.
4. **`GROUP_LINE` is the parent's `LINE`, not an independent counter.** Joining APRV to the concept
   table on anything else (or ignoring `GROUP_LINE` and zipping by row order) cross-wires channels to
   the wrong concepts. *Why:* §10 — a related group's first key is the owning item's line number, so
   `GROUP_LINE` starts wherever the first concept *with values* sits (here it starts at 2, because
   line 1's group is empty). *Handle:* always `GROUP_LINE = cp.LINE`; order media by `VALUE_LINE`.
5. **Current state only — no who/when in the whole domain.** None of the four shipped tables has a
   user or audit-instant column (`DAILY_DIGEST_TM` is datetime-*typed* but is a preference *value* —
   the clock time the user wants a digest — not a change timestamp); the preference matrix is a §35
   current-state collapse. *Why:* the change
   history lives in the OYO registration-item audit, exported as `V_EHI_REG_ITEM_AUDIT_OYO`
   (§38/§47) — documented but not shipped in this specimen, and the shipped `V_EHI_REG_ITEM_AUDIT_EPT`
   giant covers EPT items only, not OYO. *Handle:* report preferences as "as of export"; if the OYO
   audit view ships in your export, that's where old/new values and instants are.
6. **Category labels are pre-resolved; codes are gone (§23).** `APRV_MEDIA_C_NAME` ships display
   labels (observed domain in one specimen: `Mail`, `Email`, `Text message`, `Push Notification`,
   `MyChart`); that specimen ships no `ZC_` lookups at all, so the underlying integer
   category is unrecoverable there — §23: check *your* export for `ZC_` tables before assuming
   either way. The matrix spans both *notification* channels and *delivery* preferences (e.g. a
   letter-delivery concept whose approved medium is `Mail` or `MyChart` — paperless flag in effect).
7. **Two preference systems coexist (§41-flavored).** The OYO matrix is per-*concept*; separately the
   EPT record carries a single legacy "Preferred Communication Method" —
   `PATIENT_2.COMM_METHOD_C_ZC_COMM_METHOD_NAME` (a §6 companion whose name embeds the ZC table name,
   `COMM_METHOD_C` + `ZC_COMM_METHOD` + `NAME`) — plus `PATIENT_4.PAT_NO_COMM_PREF_C_NAME` (*why* the
   patient has no outreach preference). Both live on the EPT registration supplements — the
   *demographics* guide's domain (see it for the EPT stack). *Handle:* for
   "how do I reach this patient about X," read the OYO matrix; the EPT method is a one-value
   registration field, not purpose-specific.
8. **NULL `_YN` here leans "No" — per column docs, not §28 default.** `AUTO_ADD_TO_WAITLIST_YN` and
   `TZ_DIFF_ALERT_YN` docs explicitly state `'N' or NULL` mean off; the appointment-notification
   flags were stored as explicit `N` in one specimen. *Handle:* treat NULL as "not opted in" for
   these specific flags (the doc says so), while remembering §28's general warning that NULL usually
   means *unanswered*.

## Recipes

```sql
-- 1) The channel matrix: every communication concept with its approved media.
--    LEFT JOIN so all-channels-off concepts still appear (gotcha 3).
SELECT cp.LINE,
       cp.COMMUNICATION_CONCEPT_ID              AS concept_id,
       cp.COMMUNICATION_CONCEPT_ID_SETTING_NAME AS concept,
       group_concat(ap.APRV_MEDIA_C_NAME, ', ') AS approved_media   -- NULL = none approved
FROM PATIENT_4 p4
JOIN COMMUNICATION_PREFERENCES cp ON cp.PREFERENCES_ID = p4.PREFERENCES_ID
LEFT JOIN COMM_PREFERENCES_APRV ap
       ON ap.PREFERENCES_ID = cp.PREFERENCES_ID
      AND CAST(ap.GROUP_LINE AS INT) = CAST(cp.LINE AS INT)
WHERE p4.PAT_ID = (SELECT PAT_ID FROM PATIENT LIMIT 1)
GROUP BY cp.LINE
ORDER BY CAST(cp.LINE AS INT);
-- group_concat order is not VALUE_LINE order; the set, not the sequence, is the signal.

-- 2) Concepts the patient has fully opted out of (no approved channel at all).
SELECT cp.COMMUNICATION_CONCEPT_ID_SETTING_NAME AS concept_with_no_channel
FROM COMMUNICATION_PREFERENCES cp
LEFT JOIN COMM_PREFERENCES_APRV ap
       ON ap.PREFERENCES_ID = cp.PREFERENCES_ID
      AND CAST(ap.GROUP_LINE AS INT) = CAST(cp.LINE AS INT)
WHERE ap.VALUE_LINE IS NULL;

-- 3) The scalar satellites: appointment-notification opt-ins + person preferences, one row.
SELECT p4.PREFERENCES_ID,
       ai.APPT_NOTIF_SCHEDULED_YN, ai.APPT_NOTIF_CHANGED_YN,
       ai.APPT_NOTIF_CANCELED_YN,  ai.APPT_NOTIF_MISSED_YN,
       ai.APPT_REMDR_OFFSET_C_NAME, ai.RSLT_DAILY_DIGEST_YN,
       pp.TZ_DIFF_ALERT_YN
FROM PATIENT_4 p4
LEFT JOIN COMM_PREF_ADDL_ITEMS ai ON ai.PREFERENCES_ID        = p4.PREFERENCES_ID
LEFT JOIN PERSON_PREFERENCES   pp ON pp.PERSON_PREFERENCE_ID  = p4.PREFERENCES_ID
WHERE p4.PAT_ID = (SELECT PAT_ID FROM PATIENT LIMIT 1);
```

## Unstructured tie-back

**None.** No notes, RTFs, or media files reference the OYO record; everything in this domain is
coded. The nearest free-text neighbors are contact-window comments on `OTHER_COMMUNCTN`
(*demographics* guide) and the message bodies the MyChart channel actually delivers
(*patient-provider-messaging* guide).

## Open questions / specimen notes

- **Specimen shape:** one OYO record, 19 concept lines, 40 approved-media rows; the satellites are
  one row each and mostly NULL; both guarantor `ACCOUNT_2.PREFERENCE_ID` slots are NULL. Counts are
  illustrative only.
- **Concept vocabulary breadth.** The 19 HST concepts observed (messages, letters, test results,
  prescriptions, billing events, scheduling tickets, health-maintenance reminders, bulk
  communication, …) are one org's enabled set; the HST master doesn't ship, so the full concept
  catalog — and whether concept ids are Epic-released or org-minted — can't be confirmed from an
  export.
- **"Preferred" vs "approved" media.** The base table's description promises preferred media; only
  the *approved* list (OYO-104) is extracted. Whether Chronicles holds a separate ranked-preference
  item that simply isn't exported is unobservable here.
- **The audit gap is specimen-specific in principle.** `V_EHI_REG_ITEM_AUDIT_OYO` is in the schema
  docs, so some exports presumably ship it; until you see one, treat preference history as
  unrecoverable.
- **Proxy/guarantor OYO records unobserved.** With `PAT_MYC_PRXY_ACSS` unshipped and guarantor
  pointers NULL, multi-record behavior of this domain (gotcha 2) is asserted from schema docs, not
  data.
