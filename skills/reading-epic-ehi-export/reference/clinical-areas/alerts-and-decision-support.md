# Alerts & decision support (BPA) — Epic EHI field guide

**Scope.** Clinical-decision-support firings recorded in the chart: BestPractice Advisory / OurPractice
Advisory (BPA/OPA) alert contacts, the criteria that triggered them, the actions taken on them, async
alert chains, and the med-order ↔ alert link (interaction/safety checks at prescribing and med-rec).

**Where it sits.** Each alert is an **ALT master-file record** (`ALERT_ID`), and each *firing/evaluation*
is a **contact** on that record — identified by `(ALERT_ID, CONTACT_DATE_REAL)` (§18) and by a globally
unique **alert CSN** (`ALT_CSN_ID`). Crucially, **no alert table carries `PAT_ID` or an encounter
`PAT_ENC_CSN_ID`** — in a one-patient export that's survivable, but the only structural bridges outward
are `ORDER_MED_ALTCSN` (alert → med order → encounter) and date correlation.

**The headline caveat:** this domain ships as a **key skeleton**. The tables are named "details on the
criteria/actions" but contain *only* identity/key columns — the payload items (which criteria record
matched, what the user chose: accept / override / acknowledge, the override reason, the debug key/value
strings) are **not in the export**. You can establish *that* an advisory fired, *when*, *how many*
criteria it matched, *whether* an action was recorded, and *which med order* drew a check — but not
*which* advisory it was or *what* the user clicked.

## Tables

| table | rows in one specimen | what it carries |
|---|---|---|
| `ALERT_CRITERIA` | 58 | **Spine.** One row per criterion the firing evaluated/matched: `(ALERT_ID, CONTACT_DATE_REAL, LINE)` + `CONTACT_DATE` + `ALT_CSN_ID`. **No criteria-ID column ships** — the row count per contact is the only signal. 14 alert records, 25 firings here. |
| `ALERT_ACTION` | 14 | One row per action seen/taken on a firing, same key shape. **No action-category column ships.** Every action contact is also a criteria contact; 11 of 25 firings have criteria but no action row. All `LINE = 1` here. |
| `ALERT_CRITERIA_DB_KEY` / `_DB_VAL` | 4 + 4 | Debug property-bag *skeleton* for criteria lines: `(ALERT_ID, CONTACT_DATE_REAL, GROUP_LINE, VALUE_LINE)`. `GROUP_LINE` → parent `ALERT_CRITERIA.LINE`; key table and value table are parallel arrays (§10). The key *names* and value *strings* are dropped. |
| `ALERT_ACTION_DB_KEY` / `_DB_VAL` | 6 + 6 | Same property-bag skeleton hung off `ALERT_ACTION` lines. |
| `ALT_BPA_CHAIN_ID` | 11 | Async OPA chain membership: `(ALERT_ID, CONTACT_DATE_REAL, LINE)` → `ALT_CHAIN_ID`. The chain id is itself an ALT CSN (see Gotchas). The one seed table with **no** `CONTACT_DATE` column. |
| `ORDER_MED_ALTCSN` | 4 | **Med-order ↔ alert bridge**: `(ORDER_MED_ID, CONTACT_DATE_REAL, LINE)` → `ALT_CSN_ID`. One row per alert CSN drawn by an order contact (interaction/duplicate/allergy checking at signing or med-rec). The order side, not the ALT side, is the key. |

**Expected but ABSENT in this specimen** (genre tables to look for; querying them errors "no such
table" — absent, not 0 rows, per §7):
- **`ALT_HISTORY` / `ALT_ORDINFO`** — the tables `ORDER_MED_ALTCSN`'s own column doc tells you to join
  ("link this to ALT_HISTORY … to get the alert information"). Not shipped, and not even present in this
  export's `_schema_table` catalog. The advertised join target does not exist (§15 pointer with omitted
  body).
- **`ACTIVE_ASYNC_BPAS`** — the missing chain→encounter bridge: schema-doc'd as
  `(PAT_ENC_CSN_ID, LINE, ACTIVE_ASYNC_ALERTS)` whose values per its doc "correlate to those stored in
  Async Chain ID (I ALT 2005)", i.e. `ALT_BPA_CHAIN_ID.ALT_CHAIN_ID`. Were it shipped, chains would resolve to
  encounters; here they don't.
- **`MYC_USER_VIEWED_ALERT`** (who viewed an alert in MyChart), **`ALT_ALLERGY_REACT`** (reaction
  snapshot when a drug-allergy alert fires), **`BPA_TRGR_RSH_STUDY` / `BPA_FUP_RSH_STUDY`** (research-study
  triggers/follow-ups, among the few schema-doc'd alert tables that carry resolved payload columns like
  `BPA_TRGR_RSH_STAT_C_NAME`; **`ALERT_GENOMIC_INDICATORS`** is another, with a resolved
  indicator-name column), **`IP_ALERT_DICT`/`IP_ALERT_AUDIT_ITM`** (inpatient unit alerts),
  **`MAR_ADMIN_ALERT`** (barcode-scanning override alerts at med administration).

**Investigated and excluded** (close names, different domains):
- `CAREPLAN_ENROLLMENT_INFO` — ships (4 rows) and has an `ALERT_CSN_ID` column ("OurPractice Advisory
  ALT CSN used to enroll the patient in the care plan"), but it is NULL on every row here; the table belongs to the
  care-plan domain. The column is the genre's one shipped example of downstream records pointing back at
  the alert CSN that created them (siblings: `CL_PATEDU_*.{POINT,TITLE,TOPIC}_ALT_CSN_ID`,
  `PAT_VB_CARE_GAP_ACTION.VB_CARE_GAP_ALERT_CSN_ID` — all unshipped here).
- `MED_CVG_ALERTS*` / `MED_CVG_ALTERNATIVES` — pharmacy-benefit *coverage* "alerts" (formulary
  messaging), not CDS firings; only `MED_CVG_ALTERNATIVES` ships (1 row).
- `ORD_SPECIALTY_SIGNATURES` — surfaces in a `LIKE '%ALT%'` sweep only because "speci**ALT**y" matches.
  Decoy.

## How they join

All verified against this specimen.

- **Firing identity.** A firing = one ALT contact: `(ALERT_ID, CONTACT_DATE_REAL)` ⇔ exactly one
  `ALT_CSN_ID` (verified: no `ALT_CSN_ID` maps to two contacts, none repeats). Use either as the firing
  key; `ALT_CSN_ID` is the one other tables reference.
- **Criteria ↔ actions:** `ALERT_ACTION.(ALERT_ID, CONTACT_DATE_REAL)` ⊆
  `ALERT_CRITERIA.(ALERT_ID, CONTACT_DATE_REAL)` — verified 0 action rows without criteria rows, and
  their `ALT_CSN_ID`s agree. LEFT JOIN from criteria.
- **Criteria/action → debug bag:** `*_DB_KEY.GROUP_LINE = parent.LINE` (with `ALERT_ID`,
  `CONTACT_DATE_REAL`) — verified 0 orphans on both sides. `*_DB_KEY.(…, GROUP_LINE, VALUE_LINE)` =
  `*_DB_VAL.(…, GROUP_LINE, VALUE_LINE)` exactly (set-difference both ways = 0): the Nth key pairs with
  the Nth value (§10 two-level keys) — except both payload columns are dropped (see Gotchas).
- **Chain membership:** `ALT_BPA_CHAIN_ID.(ALERT_ID, CONTACT_DATE_REAL)` → the firing;
  `ALT_CHAIN_ID` groups firings into an async chain. All 11 chain rows here sit on contacts that also
  have `ALERT_ACTION` rows.
- **Med order → alert:** `ORDER_MED_ALTCSN.ORDER_MED_ID = ORDER_MED.ORDER_MED_ID` (4/4 resolve), then
  `ORDER_MED.PAT_ENC_CSN_ID` → `PAT_ENC` gives the encounter. The `CONTACT_DATE_REAL` here is the
  **ORD record's own contact** (orders are multi-contact too), not the ALT's — in this specimen it
  precedes `ORDERING_DATE` by two days on all three orders involved.
- **Alert → encounter: there is no key.** Correlate by `CONTACT_DATE` against `PAT_ENC.CONTACT_DATE`
  (recipe 3), or go through `ORDER_MED_ALTCSN` for the med-check subset. Two of six alert days here have
  **no encounter at all** — asynchronous/background firings, the population `ALT_BPA_CHAIN_ID` exists to
  track (though only one of the two no-encounter firings here carries a chain row — chain membership is
  evidence of async, not a requirement).

## Unstructured tie-back

**None.** No `Rich Text/*` or `Media/*` file references an ALT record, and the tables carry no free-text
columns (the override-comment and debug-value strings that would qualify are precisely the dropped
payload). The only narrative trace of an advisory may be incidental mentions inside visit notes (HNO),
reachable via date correlation only.

## Gotchas & quirks (chased to *why*)

1. **"Details on the criteria/actions" tables contain no details.** `ALERT_CRITERIA` ships 5 columns —
   all keys + `CONTACT_DATE` + `ALT_CSN_ID`; same for `ALERT_ACTION`. *Why:* in Chronicles the ALT
   contact holds parallel multi-line items (criteria record IDs pointing at the BPA build, action
   categories like accept/override, override reasons); the EHI extract *defines* these tables with only
   the row scaffolding — the export's own `_schema_column` lists nothing else, so it's an
   export-definition exclusion, not a blank-column artifact (§39 does not apply: there is no column to
   be empty). The row *positions* survive without their bodies — §15's mechanism applied to columns,
   §46-style always-emitted skeletons. *Handle:* treat row counts and key topology as the data. Do not
   hunt for `CRITERIA_ID` or an action `_C_NAME`; they aren't there.

2. **The DB_KEY/DB_VAL pair is a generic property-bag — decoded, then gutted.** Shape: per
   criteria/action line (`GROUP_LINE`), an ordered list (`VALUE_LINE`) of debug key/value pairs; key
   *names* live in `_DB_KEY`, value *strings* in `_DB_VAL`, matched positionally on the full 4-part key
   (§10). *Why:* Chronicles stores two parallel multi-response items ("debug keys", "debug values") used
   by BPA troubleshooting (e.g. which lookback window, which med class matched). The export keeps both
   tables' keys (verified perfectly parallel, 1:1) but drops both payload columns. *Handle:* the only
   readable signal is *how many* debug pairs a line had, and *which* lines warranted debug context at
   all — in one specimen, only 3 of 14 alerts have any.

3. **No `PAT_ID`, no `PAT_ENC_CSN_ID`, anywhere in the domain (§1, §3).** The ALT tables reach the
   patient only because the whole export is one patient; they reach an encounter not at all. *Why:* ALT
   is its own master file; its patient/encounter items weren't included, and the schema-doc'd bridges
   (`ACTIVE_ASYNC_BPAS` on the encounter side, `ALT_HISTORY` on the alert side) aren't shipped.
   *Handle:* date-correlate (recipe 3) and use `ORDER_MED_ALTCSN` where applicable; state the link as
   inferred, not keyed.

4. **`ALT_CSN_ID` is a CSN — but not an encounter CSN (§4, §41).** It is "unique across all alerts in
   the system": the ALT contact serial, a different counter from `PAT_ENC_CSN_ID`. Joining it to
   `PAT_ENC` returns nothing. *Why:* every Chronicles contact gets a CSN in its master file's space;
   the column name pattern collides. *Handle:* `ALT_CSN_ID` joins only alert-side tables and the
   `*_ALT_CSN_ID` / `ALERT_CSN_ID` pointer columns scattered on downstream records.

5. **`ORDER_MED_ALTCSN`'s alert CSNs resolve to *nothing else in the export* — by population, not by
   bug.** 0 of 4 `ALT_CSN_ID`s appear in `ALERT_CRITERIA`/`ALERT_ACTION`, yet three of the four sit
   numerically inside the CSN range of the BPA firings around the same visit (one shared ALT counter;
   the fourth — the earliest — simply predates every exported BPA firing). *Why:* med-safety checks
   (interaction/duplicate/allergy at order signing and at med-rec — here one signed prescription and two
   "Historical Med" reconciliation entries) are ALT contacts of a different flavor whose detail lives in
   items/tables not exported (`ALT_ORDINFO`, `ALT_HISTORY`); the BPA criteria/action items simply aren't
   populated on them. *Handle:* `ORDER_MED_ALTCSN` is a **pointer-only** record (§15): it proves a check
   fired on that order and gives you the order/encounter context — expect no alert-side detail row.

6. **One alert record, many firings — re-evaluation mints `.01/.02…` contacts (§18).** One alert here
   has five contacts in a single day, each with its own `ALT_CSN_ID`, as the BPA re-evaluated during the
   workflow. *Why:* Chronicles appends a contact per evaluation; `CONTACT_DATE_REAL`'s decimal suffix
   distinguishes same-day contacts. *Handle:* count *firings* by `ALT_CSN_ID` (or the contact pair), not
   by `ALERT_ID` — 14 vs 25 here. No alert spans multiple days in this specimen, but nothing prevents it.

7. **`ALT_CHAIN_ID` equals the firing's own `ALT_CSN_ID` — chains of length one.** Verified 11/11.
   *Why:* an async OPA chain is identified by the CSN of the contact that started it; a follow-up
   evaluation in the same chain would carry the *first* contact's CSN as its chain id. Every chain here
   started and ended in one firing, so id = own CSN. *Handle:* group by `ALT_CHAIN_ID` to assemble
   chains; rows sharing a chain id across different `(ALERT_ID, CONTACT_DATE_REAL)` are the multi-step
   case this specimen doesn't exhibit. Presence of a chain row at all marks the firing as
   asynchronous-capable (background OPA), consistent with chain rows appearing on days with no encounter.

8. **A missing `ALERT_ACTION` row ≠ "ignored", and a present one ≠ "accepted".** 11 of 25 firings have
   criteria but no action row. *Why:* the action item records what the alert framework logged (follow-up
   taken, acknowledged, criteria action) — silent/background evaluations and unanswered displays log
   nothing; and with the action-category column dropped (gotcha 1), a present row tells you *something*
   was recorded, never *what*. *Handle:* report `has_action` as a boolean of "a recorded response
   exists"; the accept/override/acknowledge distinction is **not recoverable from this export**.

## What a patient can and cannot learn here

- **Can:** how often decision support fired around their care (25 firings across 6 days in one
  specimen), that firings cluster on visit/med-rec days, that some run asynchronously on non-visit days,
  that specific med orders (including historical meds entered at reconciliation) drew safety checks, and
  that clinicians recorded responses to some firings.
- **Cannot:** which advisory it was ("why did the chart nag about X"), what threshold matched, or
  whether the clinician accepted or overrode it. Those live in the unshipped payload/tables; an
  override's *effects* may still surface elsewhere (med changes, orders, care-plan enrollments with
  `ALERT_CSN_ID` back-pointers in richer exports).

## Recipes

```sql
-- 1) Inventory: one row per alert firing, with criteria count, action flag, chain id.
SELECT c.ALERT_ID, c.CONTACT_DATE_REAL, c.ALT_CSN_ID, c.CONTACT_DATE,
       COUNT(*)                      AS n_criteria,
       MAX(a.ALT_CSN_ID IS NOT NULL) AS has_action,     -- recorded response exists (kind unknown)
       b.ALT_CHAIN_ID                AS async_chain_id  -- non-null = async OPA chain member
FROM ALERT_CRITERIA c
LEFT JOIN ALERT_ACTION a
       ON a.ALERT_ID = c.ALERT_ID AND a.CONTACT_DATE_REAL = c.CONTACT_DATE_REAL
LEFT JOIN ALT_BPA_CHAIN_ID b
       ON b.ALERT_ID = c.ALERT_ID AND b.CONTACT_DATE_REAL = c.CONTACT_DATE_REAL
GROUP BY c.ALERT_ID, c.CONTACT_DATE_REAL
ORDER BY CAST(c.CONTACT_DATE_REAL AS REAL), CAST(c.ALERT_ID AS INT);   -- §17: CAST before ordering

-- 2) Med orders that drew an alert, with order/encounter context.
SELECT oma.ORDER_MED_ID, oma.ALT_CSN_ID,
       om.ORDERING_DATE, om.ORDER_CLASS_C_NAME, om.ORDERING_MODE_C_NAME,
       om.PAT_ENC_CSN_ID,
       CASE WHEN oma.ALT_CSN_ID IN (SELECT ALT_CSN_ID FROM ALERT_CRITERIA)
            THEN 'detail exported' ELSE 'pointer only' END AS alert_detail
FROM ORDER_MED_ALTCSN oma
LEFT JOIN ORDER_MED om ON om.ORDER_MED_ID = oma.ORDER_MED_ID
ORDER BY CAST(oma.ALT_CSN_ID AS INT);     -- expect 'pointer only' (gotcha 5)

-- 3) Date-correlate firings with chart activity (the only alert->encounter "join").
SELECT c.CONTACT_DATE,
       COUNT(DISTINCT c.ALT_CSN_ID) AS alert_firings,
       (SELECT COUNT(*) FROM PAT_ENC pe  WHERE pe.CONTACT_DATE  = c.CONTACT_DATE) AS encounters_that_day,
       (SELECT COUNT(*) FROM ORDER_MED om WHERE om.ORDERING_DATE = c.CONTACT_DATE) AS med_orders_that_day
FROM ALERT_CRITERIA c
GROUP BY c.CONTACT_DATE
ORDER BY CAST(c.CONTACT_DATE_REAL AS REAL);   -- 0-encounter days = async/background firings

-- 4) Property-bag skeleton: which criteria/action lines carried debug context, and how much.
SELECT side, ALERT_ID, CONTACT_DATE_REAL, GROUP_LINE, COUNT(*) AS n_kv_pairs
FROM (
  SELECT 'criteria' AS side, ALERT_ID, CONTACT_DATE_REAL, GROUP_LINE FROM ALERT_CRITERIA_DB_KEY
  UNION ALL
  SELECT 'action', ALERT_ID, CONTACT_DATE_REAL, GROUP_LINE FROM ALERT_ACTION_DB_KEY
)
GROUP BY side, ALERT_ID, CONTACT_DATE_REAL, GROUP_LINE
ORDER BY side, CAST(CONTACT_DATE_REAL AS REAL);
```

## Open questions / specimen notes

- **Specimen shape:** 14 ALT records, 25 firings on 6 days (late 2024–late 2025); criteria lines per
  firing are mostly 2 (one alert evaluates 6); actions max one `LINE` per firing; all 11 chain rows are
  single-member chains. 4 med-order alert pointers across 3 orders (1 signed outpatient prescription, 2
  historical-med entries at one med-rec encounter).
- **Whether the skeleton-only shape is universal** or an org/version choice can't be settled from one
  specimen — but since the export's own schema catalog defines `ALERT_CRITERIA`/`ALERT_ACTION` with only
  key columns, expect the same elsewhere; richer payload would arrive via *other* tables
  (`BPA_TRGR_RSH_STUDY`, `ALT_ALLERGY_REACT`, downstream `*_ALT_CSN_ID` back-pointers), all absent here.
- **Multi-contact chains unobserved.** The claim that a chain's members share the first contact's CSN as
  `ALT_CHAIN_ID` follows from the id-equals-own-CSN observation plus the column's "links contacts in a
  chain" doc, but no multi-member chain exists here to confirm.
- **`ALERT_ACTION.LINE > 1` unobserved** (multiple actions on one firing), as is an alert record
  re-contacted across days.
- **The `ORDER_MED_ALTCSN.CONTACT_DATE_REAL` ≠ ordering date** offset (order-record contact two days
  before `ORDERING_DATE` on all three orders here) fits the multi-contact-ORD reading but the exact
  contact semantics (refill request vs pre-visit creation) are not verifiable from this export.
