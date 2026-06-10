# Social determinants & SmartData — Epic EHI field guide

**Scope.** Epic's generic typed key-value clinical-data stores and what rides on them in an EHI export:
the **SmartData element** mechanism (SDI-keyed values filed by SmartForms/SmartTools — documented in the
schema but typically *unshipped*), and the **SDD "Social Drivers Data"** store that *does* ship —
per-domain social-determinants-of-health (SDOH) screening: domain catalog, screening events, computed
concern level, and the instrument interpretation.

**Where it sits.** `SDD_DATA` is its own master file (the schema calls each row a "social driver data
record", `.1` id `SDOH_DATA_ID`): **one record per (patient, SDOH domain)**, carrying `PAT_ID` directly —
one of the few clinical tables that doesn't need a parent walk (§1, §3). Each screening event is a
**contact** on that record: `SDD_ENTRIES` keys `(SDOH_DATA_ID, CONTACT_DATE_REAL, LINE)` (§18 decimal
contact dates, §9 LINE rows). SDD is a *derived* layer — the raw answers are documented elsewhere
(social history, flowsheet questionnaires) and SDD records Epic's per-domain risk interpretation of them.

## The generic mechanism first: key → master meaning; entries → values + context

Epic has two stores built on the same "generic element" idea. Read any specimen in this order:

1. **SmartData elements (the fully generic store).** `SMRTDTA_ELEM_DATA` holds the metadata of one filed
   value: `ELEMENT_ID` — "the SmartData identifier (SDI)" — names *what* the datum means; `CONTEXT_NAME`
   ("Patient", "Episode", …) plus `RECORD_ID_VARCHAR`/`CONTACT_SERIAL_NUM`/`PAT_LINK_ID` name *where it
   attaches*; `CUR_VALUE_USER_ID`/`CUR_VALUE_DATETIME` the who/when. The **value itself lives apart**: the
   classic `SMRTDTA_ELEM_VALUE` table is not even in this export's schema catalog — the export's value
   carrier is the view `V_EHI_SMRTDTA_ELEM_VAL_EXT` (`HLV_ID, LINE, SMRTDTA_ELEM_VALUE,
   SMRTDTA_ELEM_VALUE_EXTERNAL, COLUMN_DESCRIPTOR`), which pre-renders typed values (category title,
   record name, ISO date/time strings) and, for record-pointer values, tells you which table/column the
   raw id joins to (`COLUMN_DESCRIPTOR`). The id that resolves an element's **human meaning** is
   `ELEMENT_ID` → **`CLARITY_CONCEPT.CONCEPT_ID`** — the schema-documented element/concept master whose
   doc reads "The SmartData identifier, such as MEDCIN#4104" with a `NAME` column for the element's
   display name (§5). In this specimen `CLARITY_CONCEPT` is **schema-documented but not shipped**, as is
   the whole value family (`SMRTDTA_ELEM_DATA`, `_AUTH`, `_SYNOPTIC`, `_EPISODE_GRP`, `_FIN_ASST_CAS`,
   `_INFERT_CYCLE`, `_RESULT_CNCT`, `V_EHI_SMRTDTA_ELEM_VAL_EXT`, plus the history layer `ELEM_VAL_PREV`
   / `V_EHI_ELEM_VAL_PREV_EXT` / `_CMT` / `_CAPTION`) — querying any of them errors "no such table"
   (§7: absent ≠ empty; verified). When the value tables ship without the concept master, the
   namespaced SDI string in `ELEMENT_ID` (e.g. `EPIC#…`, `MEDCIN#…`) is all the meaning you get. Expect
   the family populated in exports from orgs that use SmartForms heavily.
2. **SDD (the SDOH-specialized store, shipped here).** Same shape, domain-keyed: the *element id* is the
   SDOH **domain** (`SDD_DATA.DOMAIN_C_NAME`, a pre-resolved category, §23); the *instrument* that
   produced an entry is `SDD_ENTRIES.ENTRY_DOM_CONFIG_ID`, resolved by the **shipped** master
   `SDOH_DOM_CONFIG_INFO` (`DOM_CONFIG_ID → RECORD_NAME / DISPLAY_NAME`, e.g. "Patient Health
   Questionnaire-2 (PHQ-2)", "AUDIT-C - Flowsheets", "Tobacco Use - Patient History" — record names
   often double as provenance labels, but not every config carries the source suffix). The *value* is split across the normalized concern axis on the entry
   (`ENTRY_CONCERN_LVL_C_NAME`) and the instrument-vocabulary interpretation in
   `V_EHI_SDD_ENTRY_INTERPRETATION` (§47: the view is the only carrier — the base table ships no
   interpretation column).

## Tables

| table | rows in one specimen | what it carries |
|---|---|---|
| `SDD_DATA` | 22 | **Spine.** One row per (patient, SDOH domain): `SDOH_DATA_ID` (PK), `PAT_ID`, `DOMAIN_C_NAME`, `CONCERNS_PRESENT_YN` (current-state rollup, §35), `RECORD_STATUS_C_NAME` (soft-delete flag, NULL = active, §32/§39). All 22 domains instantiated; only 5 ever screened here (see Gotchas). |
| `SDD_ENTRIES` | 21 | **Screening events.** `(SDOH_DATA_ID, CONTACT_DATE_REAL, LINE)` per documentation of need/risk: `ENTRY_DOM_CONFIG_ID` (instrument), `ENTRY_CONCERN_LVL_C_NAME`, `ENTRY_EFFECTIVE_UTC_DTTM`, `ENTRY_PAT_ENC_CSN_ID` (§2, often NULL — see Gotchas), `ENTRY_USER_ID`(+`_NAME`). |
| `V_EHI_SDD_ENTRY_INTERPRETATION` | 19 | **The interpretation** (§47 export view): `(SDOH_DATA_ID, CONTACT_DATE_REAL, LINE) → ENTRY_INTERPRETATION_EXTERNAL` — the scoring-rule output in the instrument's own vocabulary. Partial: fewer rows than `SDD_ENTRIES` (see Gotchas). |
| `SDOH_DOM_CONFIG_INFO` | 3 | **Instrument/config master** (close sibling, added): `DOM_CONFIG_ID → RECORD_NAME, DISPLAY_NAME`. Ships only the configs actually referenced by this patient's entries (3 distinct ids here = the 3 rows). |

**Investigated and deliberately excluded:**
- `SMRTDTA_ELEM_DATA` + 6 bridge tables + the value/history views + `CLARITY_CONCEPT` — the generic
  SmartData store; schema-documented, **not shipped** in this specimen (described above so you
  recognize it elsewhere).
- `SOCIAL_HX`, `PAT_SOCIAL_HX_DOC`, `SOCIAL_ADL_HX` — the raw SDOH *answers* (per-encounter snapshots);
  covered in [histories-family-social-medical](histories-family-social-medical.md). Cross-linked below.
- `OR_PNDS` — has an `ELEMENT_ID` column but it's the Perioperative Nursing Data Set, a different id
  namespace entirely; a `LIKE '%ELEMENT_ID%'` sweep will surface it — skip it.

## How they join

All verified against rows in this specimen.

- **Patient → domains:** `SDD_DATA.PAT_ID = PATIENT.PAT_ID` (direct, no bridge).
- **Domain → screening events:** `SDD_ENTRIES.SDOH_DATA_ID = SDD_DATA.SDOH_DATA_ID`; order by
  `CAST(CONTACT_DATE_REAL AS REAL)` (§17, §18). Verified: all 21 entries resolve to 5 of the 22 domains.
- **Entry → interpretation:** `V_EHI_SDD_ENTRY_INTERPRETATION` on the full compound key
  `(SDOH_DATA_ID, CONTACT_DATE_REAL, LINE)` — the view's own description mandates all three. **LEFT
  JOIN**: 19 of 21 entries have a row here (the misses are exactly the entries with NULL
  `ENTRY_DOM_CONFIG_ID`).
- **Entry → instrument:** `SDD_ENTRIES.ENTRY_DOM_CONFIG_ID = SDOH_DOM_CONFIG_INFO.DOM_CONFIG_ID`.
  Verified: all 3 distinct config ids resolve. The schema doc promises a denormalized
  `ENTRY_DOM_CONFIG_ID_RECORD_NAME` on `SDD_ENTRIES`; the TSV ships only the bare id (§7 flavor b, §6) —
  you must make this join yourself.
- **Entry → encounter:** `SDD_ENTRIES.ENTRY_PAT_ENC_CSN_ID = PAT_ENC.PAT_ENC_CSN_ID` (§2). Verified: all
  8 non-NULL CSNs resolve. The other 13 entries have it NULL — that is *not* "undocumented" (see Gotchas).
- **Entry → social-history snapshot (tobacco-type instruments):** `SDD_ENTRIES.ENTRY_PAT_ENC_CSN_ID =
  SOCIAL_HX.PAT_ENC_CSN_ID` — note this is the history's **snapshot CSN**, not its `HX_LNK_ENC_CSN`
  source CSN (§34). Verified: all 8 CSN-bearing tobacco entries (of 11 patient-history-sourced) match a
  `SOCIAL_HX` snapshot with the same contact date — and 0 match on `HX_LNK_ENC_CSN`, confirming which CSN
  it is; the 3 CSN-less tobacco entries need the date route.
- **Entry → flowsheet questionnaire (PHQ-2/AUDIT-C-type instruments):** no key ships; the tie is the
  **same-day flowsheet row** for the instrument's score (`IP_FLWSHT_MEAS.FLO_MEAS_ID_DISP_NAME` like
  'PHQ-2%Score%' / 'AUDIT-C Score'). Verified: every depression entry's contact date has matching PHQ-2
  Total Score measurements; the single alcohol entry matches a same-day AUDIT-C Score row. Recipe 4 shows
  the date-normalized join (see [vitals-and-flowsheets](vitals-and-flowsheets.md) for the flowsheet side).

## Unstructured tie-back

**None directly** — no `Rich Text/*.RTF` or `Media/*` file references SDD records, and SDD itself carries
no free text. The narrative around an SDOH answer lives on the *source* surfaces: `SOCIAL_HX`'s inline
`*_COMMENT` columns and the `PAT_SOCIAL_HX_DOC` line-chunked blob (§11) — see the histories guide — and
flowsheet `MEAS_COMMENT`. Reach them via the entry's CSN or same-day instrument rows as above.

## Gotchas & quirks (chased to *why*)

1. **"SDD" is the Social Drivers Data master file, not the SmartData element store — a name collision.**
   Epic folklore reads "SDD" as SmartData; this export's `SDD_*` schema docs say "social driver data
   record" throughout. *Why:* two different Chronicles masters; the SmartData store surfaces as
   `SMRTDTA_*` tables, which in this specimen are schema-documented but unshipped — `SELECT` errors
   "no such table" (§7: unshipped means absent, not 0 rows). *Handle:* don't hunt for generic SmartForm
   data in `SDD_*`; check `_tables` (not just the schema doc) for `SMRTDTA_%` before promising
   SmartData content.

2. **`CONCERNS_PRESENT_YN = 'N'` does NOT mean "screened negative".** All 22 domain rows say `N`, but 17
   of them have **zero** entries — the patient was never screened for those domains. *Why:* `SDD_DATA`
   instantiates a row per configured domain (§46 always-emit placeholders), and the rollup column —
   "checks the most recent entry across all sources" — defaults to `N` when there is nothing to check
   (§35 current-state collapse; §39 a blank is not evidence of assessment). *Handle:* gate every
   "no concerns" claim on `EXISTS (SELECT 1 FROM SDD_ENTRIES …)`; report never-screened domains
   separately (recipe 1).

3. **The interpretation lives only in the `V_EHI_` view — and the view is *partial*.** The base
   `SDD_ENTRIES` ships no interpretation column; `V_EHI_SDD_ENTRY_INTERPRETATION` is the mandatory
   companion (§47, same shape as flowsheet values). But it has fewer rows than `SDD_ENTRIES` (19 vs 21
   here): entries whose `ENTRY_DOM_CONFIG_ID` is NULL get no interpretation row. *Why:* the
   interpretation is the *output of the instrument's scoring rule*; no instrument config → nothing to
   externalize. *Handle:* always LEFT JOIN the view on all three key columns; a miss means
   "no instrument-scored interpretation", not a bad join.

4. **Interpretation text is raw config output — trailing whitespace and per-instrument vocabularies.**
   In this specimen one instrument emits a label with a trailing space; another emits a differently-worded
   label for the same normalized concern level. *Why:* `ENTRY_INTERPRETATION_EXTERNAL` echoes whatever string the
   org's scoring rule produces (§25: coded value beside free-ish text) — it is display text, not a
   category. *Handle:* `TRIM()` before comparing/grouping; use `ENTRY_CONCERN_LVL_C_NAME` as the
   normalized cross-domain axis (its observed labels also drift from the schema doc's "low, medium, high"
   wording — §23/§24, read it as a label, not a fixed enum).

5. **SDD is a derived layer; the raw answers live elsewhere — source wins for content, SDD for risk.**
   Instrument `RECORD_NAME`s often name their pipeline ("… - Patient History", "… - Flowsheets" —
   though not always: one config here is named for the instrument alone, so treat the suffix as a hint,
   not a contract):
   patient-history-sourced entries mirror `SOCIAL_HX` snapshots (CSNs match), questionnaire-sourced ones
   mirror same-day flowsheet score rows. *Why:* Epic's SDOH feature aggregates documentation filed
   through other workflows and stores only the computed concern per domain. *Handle:* for *what the
   patient answered* (smoking status, drinks/week, PHQ-2 item scores) read `SOCIAL_HX` / flowsheets —
   they win on content; for *whether Epic considers the domain a current concern and how each screening
   scored*, SDD wins. Expect double-representation, not conflict; if they appear to disagree, check
   `ENTRY_EFFECTIVE_UTC_DTTM` — SDD may lag or backfill (gotcha 7).

6. **A NULL `ENTRY_PAT_ENC_CSN_ID` does not mean the screening lacked an encounter.** Here *all*
   flowsheet-sourced entries (depression, alcohol) have NULL CSN and NULL user, while
   patient-history-sourced ones mostly carry both; one NULL-CSN entry even falls on a day with several
   local encounters. *Why:* the CSN records where the *SDD entry* was filed; entries materialized by
   background evaluation of flowsheet data (or received from outside documentation) aren't filed "in" an
   encounter, so the column stays empty (§39). *Handle:* reach the visit context through the source
   surface (same-day flowsheet row → its encounter; `SOCIAL_HX` snapshot) rather than requiring
   `ENTRY_PAT_ENC_CSN_ID`.

7. **`ENTRY_EFFECTIVE_UTC_DTTM` can postdate `CONTACT_DATE` by months or years.** Several entries carry
   an effective instant long after their contact date — including two entries whose effective instants
   are the *same second*, dated years after their contacts. *Why:* §19 — `CONTACT_DATE` is the effective
   (calendar) date of the screening; the UTC column is the instant the entry *became active in SDD*,
   which for backfills (a domain config turned on later, recomputation over historical documentation)
   is the processing moment, not the care moment. *Handle:* order and reason by `CONTACT_DATE_REAL`;
   treat clusters of identical effective instants as batch backfill markers, and expect entries whose
   *only* honest date is the contact date.

8. **`RECORD_STATUS_C_NAME` is NULL on every row here — that's "active".** *Why:* the schema doc says "SDD
   only supports soft deleted records" (§32): the column exists to mark soft-deletion, and the empty TSV
   cell loads as NULL (§39). *Handle:* `WHERE RECORD_STATUS_C_NAME IS NULL OR RECORD_STATUS_C_NAME NOT
   LIKE '%Delet%'` if you want to be defensive; never require a populated status.

## Recipes

```sql
-- 1) SDOH domain dashboard: screened vs never-screened, current rollup, last screening.
SELECT d.DOMAIN_C_NAME,
       d.CONCERNS_PRESENT_YN,                       -- rollup; meaningless when n_entries = 0 (gotcha 2)
       COUNT(e.SDOH_DATA_ID)                    AS n_entries,
       date('1840-12-31', '+' || CAST(MAX(CAST(e.CONTACT_DATE_REAL AS REAL)) AS INT) || ' days')
                                                AS last_screened   -- §18 decimal date → ISO
FROM SDD_DATA d
LEFT JOIN SDD_ENTRIES e ON e.SDOH_DATA_ID = d.SDOH_DATA_ID
WHERE d.PAT_ID = (SELECT PAT_ID FROM PATIENT LIMIT 1)
GROUP BY d.SDOH_DATA_ID
ORDER BY n_entries DESC, d.DOMAIN_C_NAME;

-- 2) Full screening history: domain, instrument, normalized concern, instrument interpretation.
SELECT d.DOMAIN_C_NAME, e.CONTACT_DATE,
       c.RECORD_NAME                          AS instrument,      -- bare id only; join required (§6/§7)
       e.ENTRY_CONCERN_LVL_C_NAME             AS concern,
       TRIM(v.ENTRY_INTERPRETATION_EXTERNAL)  AS interpretation,  -- TRIM: raw config text (gotcha 4)
       e.ENTRY_PAT_ENC_CSN_ID, e.ENTRY_USER_ID_NAME
FROM SDD_ENTRIES e
JOIN SDD_DATA d                ON d.SDOH_DATA_ID = e.SDOH_DATA_ID
LEFT JOIN SDOH_DOM_CONFIG_INFO c ON c.DOM_CONFIG_ID = e.ENTRY_DOM_CONFIG_ID
LEFT JOIN V_EHI_SDD_ENTRY_INTERPRETATION v               -- LEFT: view is partial (gotcha 3)
       ON v.SDOH_DATA_ID = e.SDOH_DATA_ID
      AND v.CONTACT_DATE_REAL = e.CONTACT_DATE_REAL
      AND v.LINE = e.LINE
ORDER BY CAST(e.CONTACT_DATE_REAL AS REAL), d.DOMAIN_C_NAME;

-- 3) Tie a patient-history-sourced entry back to its SOCIAL_HX snapshot (the raw answers).
SELECT e.CONTACT_DATE, e.ENTRY_CONCERN_LVL_C_NAME,
       h.TOBACCO_USER_C_NAME, h.SMOKING_TOB_USE_C_NAME, h.HX_LNK_ENC_CSN
FROM SDD_ENTRIES e
JOIN SDD_DATA d  ON d.SDOH_DATA_ID = e.SDOH_DATA_ID AND d.DOMAIN_C_NAME = 'Tobacco Use'
JOIN SOCIAL_HX h ON h.PAT_ENC_CSN_ID = e.ENTRY_PAT_ENC_CSN_ID   -- snapshot CSN, §34
ORDER BY CAST(e.CONTACT_DATE_REAL AS REAL);

-- 4) Tie a flowsheet-sourced entry to its same-day questionnaire score row (no key ships;
--    normalize both sides to ISO dates: §18 on the SDD side, M/D/YYYY parse on the flowsheet side).
WITH dep AS (
  SELECT e.*, date('1840-12-31', '+' || CAST(e.CONTACT_DATE_REAL AS INT) || ' days') AS iso_date
  FROM SDD_ENTRIES e
  JOIN SDD_DATA d ON d.SDOH_DATA_ID = e.SDOH_DATA_ID AND d.DOMAIN_C_NAME = 'Depression'
),
fs AS (
  SELECT m.*, printf('%04d-%02d-%02d',
           CAST(substr(m.RECORDED_TIME, instr(m.RECORDED_TIME,'/') +
                instr(substr(m.RECORDED_TIME, instr(m.RECORDED_TIME,'/')+1),'/') + 1, 4) AS INT),
           CAST(substr(m.RECORDED_TIME, 1, instr(m.RECORDED_TIME,'/')-1) AS INT),
           CAST(substr(substr(m.RECORDED_TIME, instr(m.RECORDED_TIME,'/')+1), 1,
                instr(substr(m.RECORDED_TIME, instr(m.RECORDED_TIME,'/')+1),'/')-1) AS INT)) AS iso_date
  FROM IP_FLWSHT_MEAS m
  WHERE m.FLO_MEAS_ID_DISP_NAME LIKE 'PHQ-2%Score%'
)
SELECT dep.iso_date, dep.ENTRY_CONCERN_LVL_C_NAME, COUNT(fs.FSD_ID) AS phq2_score_rows
FROM dep LEFT JOIN fs ON fs.iso_date = dep.iso_date
GROUP BY dep.iso_date ORDER BY dep.iso_date;
-- Values for those score rows live in V_EHI_FLO_MEAS_VALUE (see vitals-and-flowsheets).

-- 5) Entries with no interpretation row (expected for NULL-config entries — gotcha 3).
SELECT e.SDOH_DATA_ID, e.CONTACT_DATE, e.ENTRY_DOM_CONFIG_ID
FROM SDD_ENTRIES e
LEFT JOIN V_EHI_SDD_ENTRY_INTERPRETATION v
       ON v.SDOH_DATA_ID = e.SDOH_DATA_ID
      AND v.CONTACT_DATE_REAL = e.CONTACT_DATE_REAL AND v.LINE = e.LINE
WHERE v.SDOH_DATA_ID IS NULL;
```

## Open questions / specimen notes

- **Specimen shape:** 22 domain rows, all `CONCERNS_PRESENT_YN = 'N'`; 21 entries across 5 domains
  (most in Tobacco Use and Depression, single entries in Alcohol Use, Internet Access, Educational
  Attainment); 3 instrument configs. Concern levels observed: only "Low Risk" and "Unknown" — what a
  *positive* screen looks like (does `CONCERNS_PRESENT_YN` flip to `Y`? does a "High" entry appear?)
  is unobservable here.
- **The two NULL-config entries (Internet Access, Educational Attainment)** share one effective instant
  years after their contact dates, have no CSN/user, and no interpretation row. Their source pipeline is
  unidentified: the candidate raw-answer columns in `SOCIAL_HX` (`EDU_LEVEL_C_NAME` etc.) are empty in
  this specimen, suggesting a backfill from a surface this export doesn't carry (or carries elsewhere,
  e.g. questionnaire answers). Unresolved.
- **`SDD_ENTRIES.LINE` is 1 on every row here**, so what a multi-LINE contact looks like (the schema
  allows "multiple pieces of information per contact") is unobserved.
- **`V_EHI_SDD_ENTRY_INTERPRETATION` ships no audit/history sibling**, and no `V_EHI_SDD_*_AUDIT` view
  exists — whether SDD edits surface anywhere in the §38 change-ledger family is unknown.
- **The generic SmartData family is entirely unshipped here**, so everything stated about
  `SMRTDTA_ELEM_DATA` / `V_EHI_SMRTDTA_ELEM_VAL_EXT` / `CLARITY_CONCEPT` comes from schema docs (§7) —
  column shapes are confirmed against `_schema_column`, but population patterns (which contexts, how
  `COLUMN_DESCRIPTOR` renders, whether `CLARITY_CONCEPT` ships alongside the values) await a specimen
  that uses SmartForms.
