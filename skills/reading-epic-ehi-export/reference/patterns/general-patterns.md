# General-purpose modeling patterns of an Epic EHI export

The genre's grammar. These conventions recur in *every* Epic export, across every clinical domain, so
learning them once saves you from re-deriving them in each table. Read this before the clinical-area
guides — they assume it and cite it by section number.

Each pattern gives the **mechanism** (what Epic/Chronicles is doing underneath — the *why*, so you can
trust it) and a **traced example** (real table/column, structural values only — no patient content). When
a value looks wrong, the answer is almost always one of these, not bad data. Every pattern here was
verified against a real export and several were *corrected* by adversarial re-testing — where a pattern is
known to vary or to have bitten an analyst, it says so.

## Three preconditions that make everything else work

- **Genre vs. specimen vs. variation.** Some patterns are universal (CSN, base+supplement). Others vary by
  the exporting org's configuration — above all **whether categories ship as raw `_C` codes + `ZC_` tables
  or pre-resolved `_C_NAME` labels** (§23). A third kind is a *trap that only shows up when you have the
  right data* (soft-delete looks absent until you find a domain with deletions). Always ask which you're
  looking at; verify on your own export.
- **Everything is TEXT; `CAST` before you order or aggregate (§17).** The loader gives every column TEXT
  affinity — numeric ids, `LINE`, `*_DATE_REAL` floats included. Equality joins work, but `ORDER BY`,
  `MIN`/`MAX`, and range filters sort **lexically** and *lie*. This single fact underlies the date, line,
  and id gotchas below.
- **`PRAGMA table_info` is the truth, the schema HTML is the aspiration (§7).** The doc lists columns that
  may not have shipped, under names that may differ. Confirm real columns before every query.

## Contents

- **A. Identity & linkage:** [1] PAT_ID · [2] CSN/contacts · [3] parent-chain linkage · [4] renamed-CSN · [5] master-file IDs · [6] `_NAME` companions · [7] schema-doc ≠ actual
- **B. Record assembly:** [8] base+supplements · [9] `LINE` child rows · [10] `GROUP_LINE`/`VALUE_LINE` · [11] line-chunked text · [12] one event→many lines · [13] `_ALL` superset tables · [14] filename-as-FK · [15] pointer survives, body omitted · [16] EPISODE
- **C. Time & numbers:** [17] everything-is-TEXT · [18] `*_DATE_REAL` · [19] effective vs instant · [20] split DATE+TIME · [21] fuzzy/accuracy dates · [22] inverted-date sort keys
- **D. Codes, categories & values:** [23] `_C`/`_C_NAME`/`ZC_` · [24] column-label-lies · [25] coded-beside-free-text + sentinel · [26] packed/typed values · [27] parallel identifier systems · [28] `_YN`/`_YNU` · [29] units-in-a-column
- **E. State, lifecycle, history & audit:** [30] status/lifecycle (often a matrix) · [31] `_HX` two meanings · [32] soft-delete · [33] void/reversal pairs · [34] per-encounter re-snapshot · [35] current vs versions · [36] EFF/TERM dimensions · [37] action triplets · [38] field-level change ledger
- **F. Values & nulls:** [39] NULL semantics · [40] preview/cache columns
- **G. Cross-cutting export traits:** [41] two ID spaces · [42] symmetric rows · [43] post-export data · [44] external-origin sentinels · [45] extension/MIME lies · [46] companion-row placeholders · [47] `V_EHI_*` views & the audit giant · [48] in-basket pool parties

---

## A. Identity & linkage to the patient

### 1. `PAT_ID` — the patient master key (but most tables don't carry it)
**Mechanism.** `PAT_ID` is the patient master-file (EPT) key — an opaque token like `Z#######`, the
cleanest patient join *when present*. But it is **not** ubiquitous: in one specimen only ~89 of 590
populated tables carry `PAT_ID` and ~90 carry the encounter CSN; **426 of 590 carry neither** and reach
the patient only by a renamed-CSN column (§4) or a parent-chain join (§3). The human-facing **MRN**
(`PAT_MRN_ID`) lives essentially only on `PATIENT`; the same person can hold different facility MRNs while
keeping one `PAT_ID`. Join on `PAT_ID` where it exists; otherwise walk up.
**Example.** `ORDER_MED.PAT_ID` = `PATIENT.PAT_ID` = `Z#######`; but `ORDER_NARRATIVE`, `IP_FLWSHT_MEAS`,
and most billing tables have no `PAT_ID` column at all.

### 2. `PAT_ENC_CSN_ID` — the Contact Serial Number, and one-encounter-many-contacts
**Mechanism.** The **CSN** is a globally-unique serial for a **contact**, not a "visit." One thing a
patient calls a single visit appears as **several** `PAT_ENC` rows — office visit, nurse contact, billing
contact, lab contact — each its own CSN, often the same day. Child fact tables carry the CSN of the
*specific* contact they belong to. **But "CSN" is generic:** Chronicles mints a contact serial for many
master files, so a `*_CSN_ID`/`CONTACT_SERIAL_NUM` is often *that record's own* serial, not a patient-
encounter CSN, and won't join `PAT_ENC` (§4). And the columns that would group contacts into a logical
visit (`PAT_ENC_2.PARENT_ENC_CSN_ID`, `PAT_ENC_4.ORIG_ENC_CSN`, `PAT_ENC_6.LINKED_ENC_CSN`) **may be 100%
NULL** — then same-day grouping (`FLOOR(CAST(PAT_ENC_DATE_REAL AS REAL))`) is your only handle.
**Example.** One day carries 4 `PAT_ENC` rows with distinct CSNs (`.00/.01/.02/.03`); but
`NOTE_ENC_INFO.PAT_ENC_CSN_ID` is **NULL on all 194 rows** (the note links by its own `CONTACT_SERIAL_NUM`),
so "join the note by its CSN column" silently returns nothing.

### 3. Parent-chain linkage — most tables reach the patient by walking up
**Mechanism.** Since ~72% of populated tables carry neither `PAT_ID` nor a patient-encounter CSN, you get
to the patient by joining up the record's **parent key** one or more hops until you hit a table that does:
`ORDER_PROC_ID`/`ORDER_ID` (50+ tables), `TX_ID` (billing, ~27), `RECORD_ID` (~22), `REFERRAL_ID` (~19),
`HSP_ACCOUNT_ID` (~19), `IMAGE_ID` (remittance, ~14), `DOCUMENT_ID`, `NOTE_ID`, `COVERAGE_ID`,
`INPATIENT_DATA_ID` (flowsheet hub). Budget for multi-hop joins; don't expect a `PAT_ID` column.
**Example.** `ORDER_NARRATIVE.ORDER_PROC_ID` → `ORDER_PROC` → `PAT_ENC.PAT_ID`;
`IP_FLWSHT_MEAS.FSD_ID` → `IP_FLWSHT_REC.PAT_ID` (the flowsheet *record* carries `PAT_ID`; the measurement
rows don't).

### 4. The CSN hides under domain-specific column names
**Mechanism.** A patient-encounter CSN you *can* join to `PAT_ENC.PAT_ENC_CSN_ID` is frequently carried
under a renamed column, so a literal `PAT_ENC_CSN_ID` search undercounts the linkage and a join written
against that name finds nothing. Recognize any `*_CSN` / `*_ENC_CSN` / `EPT_CSN` / `*_PAT_CSN` as a
candidate encounter CSN — then verify it actually joins (some are the record's own serial, §2).
**Example.** `ALLERGY.ALLERGY_PAT_CSN` → `PAT_ENC.PAT_ENC_CSN_ID` resolves; likewise `IMMUNE.IMM_CSN`,
`IP_DATA_STORE.EPT_CSN`, `PROBLEM_LIST_HX.HX_PROBLEM_EPT_CSN`, and the supplement-internal
`PAT_ENC_3.PAT_ENC_CSN` (no `_ID`).

### 5. Master-file IDs and the foreign-key convention
**Mechanism.** Records reference Epic master files by an `*_ID` column holding that master's key; the
masters are the `CLARITY_*` files (and `ZC_*` when shipped). The **column prefix encodes the role**, the
master is invariant: *any* `*_PROV_ID` (`VISIT_`, `BILLING_`, `AUTHRZING_`, `REFERRING_`, `ATTEND_`, …)
joins `CLARITY_SER.PROV_ID`. Watch the **right master**: providers→`CLARITY_SER`, users→`CLARITY_EMP`,
diagnoses→`CLARITY_EDG`, departments→`CLARITY_DEP`, **locations→`CLARITY_LOC`** (a `*_LOC_ID` joined to
`CLARITY_DEP` silently returns blank — §41), drugs (`MEDICATION_ID`)→`CLARITY_MEDICATION`, orderables
(`PROC_ID`)→`CLARITY_EAP`. IDs are opaque and **not always numeric** — user/provider IDs are often
alphanumeric logins (`RAMMELZL`, `MBS403`).
**Example.** `PAT_ENC.VISIT_PROV_ID` → `CLARITY_SER.PROV_ID` → `PROV_NAME`; `PATIENT.CUR_PRIM_LOC_ID` →
`CLARITY_LOC.LOC_ID` (not `CLARITY_DEP`).

### 6. Denormalized `<ID>_<MASTERFILE>_NAME` companions
**Mechanism.** To spare a join, Epic often exports a **sibling name column** next to a foreign key:
`<COL>_<thing>_NAME` holds the resolved label. Treat the suffix as an **open rule** (`<COL>_<X>_NAME` =
the resolved label for `<COL>`), not a fixed list — one specimen had 578 such columns across dozens of
suffixes (`_PROV_NAME`, `_DX_NAME`, `_PHARMACY_NAME`, `_MODIFIER_NAME`, `_PLAN_NAME`, `_REMIT_CODE_NAME`,
plain `_ID_NAME` for users…). **Materialization is systematic, not random for providers:** `SER`
(`_PROV_NAME`) companions are *always dropped* (the SER master ships only as a hidden view, so you must
join `CLARITY_SER`), while `EMP` user `_NAME` companions *always ship populated* (trust `*_USER_ID_NAME`
inline). Long companion names are **truncated to 32 chars** (`REFERRING_PROV_ID_REFERRING_PROV_NAM`).
**A missing companion never means the name is unavailable — it means you pick the right master by the id's
namespace (§41):** `SER` provider ids (`PROV_ID`, `VISIT_PROV_ID`, `EXT_SVC_PROV_ID`) → `CLARITY_SER.PROV_NAME`;
`EMP`/MyChart user ids (`FROM_USER_ID`/`TO_USER_ID` and other alphanumeric `*_USER_ID`s) → `CLARITY_EMP.USER_ID`;
departments (`DEPARTMENT_ID`) → `CLARITY_DEP.DEPARTMENT_NAME`. Never resolve a user id against the provider
master — `FROM_USER_ID`/`TO_USER_ID` land 18/18 in `CLARITY_EMP` and 0/18 in `CLARITY_SER`.
**Example.** `ORDER_MED.PHARMACY_ID` beside `PHARMACY_ID_PHARMACY_NAME`; `ORD_CREATR_USER_ID` (`RAMMELZL`)
beside populated `ORD_CREATR_USER_ID_NAME`; but `PAT_ENC.VISIT_PROV_ID` ships **no** `_PROV_NAME` companion.

### 7. The schema doc's columns are aspirational — confirm the real ones
**Mechanism.** The `EHITables Schema/*.htm` doc lists the *full logical* column set; the TSV ships only
what was populated/configured, and they disagree in a large fraction of tables (~156 of 590). Flavors:
**(a) adjacent-pair swap** (both `<COL>_ID` and its `_NAME` exist but in opposite order vs the doc);
**(b) set difference** (doc names the resolved `_NAME`, TSV ships only bare `_ID`); **(c) per-column mix**
(one table *drops* `DX_ID_DX_NAME` but *ships* `ENTRY_USER_ID_NAME`). Also: schema-doc *coverage itself*
can change between DB builds (a supplement documented in one load, undocumented in another), so per-table
doc counts in another analyst's notes are snapshots, not invariants.
**Rule.** `PRAGMA table_info('T')` before trusting any column name. `_schema_column` is the doc; pragma is
the data.

---

## B. Record assembly — one logical record from many rows

### 8. Base + numbered supplement tables (horizontal overflow)
**Mechanism.** A master file with more items than one physical table is sharded into a base + numbered
supplements (`PAT_ENC`…`PAT_ENC_8`, `ARPB_TRANSACTIONS`…`_3`, `PATIENT`…`_6`), each **1:1 on the key**
(same row count, more columns); left-join the stack to reconstruct the record. Caveats that bite:
- **Verify before assuming 1:1:** a numbered/suffixed name does **not** prove a supplement.
  `PMT_EOB_INFO_I` (87) and `PMT_EOB_INFO_II` (111) are not a 1:1 pair — they're `(TX_ID, LINE)` **child**
  tables (§9). Rule: equal row count **and** no `LINE` column ⇒ supplement; `LINE` present + unequal ⇒ child.
- **Key-name drift:** `PAT_ENC_3`'s key is `PAT_ENC_CSN` (no `_ID`); `ORDER_MED_2/3/4/5/7` key on
  `ORDER_ID` while the base + `_6` use `ORDER_MED_ID`. Joining all supplements on one name silently fails.
- **Numbering is non-contiguous** (`CLARITY_EAP`, `_3`, `_5` — skips `_2`/`_4`) and uses mixed styles
  (Roman `_I`/`_II`). **The generic key `RECORD_ID`** plays the same role across sibling claim/coverage
  tables.
- **A critical FK can live only on a supplement** (`ORDER_PROC_2.REFERRAL_ID` is the *only* order↔referral
  link) — so `PRAGMA` every `_N` table before concluding a link is absent. **A supplement may ship data
  with no schema doc** (e.g. `SUPPLY_LOT`).
**Example.** `PAT_ENC`…`PAT_ENC_8` each 169 rows, 1:1 on the CSN; `PMT_EOB_INFO_I/_II` are child tables, not
a supplement pair.

### 9. `LINE`-numbered child rows (vertical sub-lists)
**Mechanism.** A repeating sub-list becomes child rows with composite key `(parent_id, LINE)`. Two gotchas
the surface hides: **`LINE` is stored as TEXT**, so `ORDER BY LINE` sorts `1,10,11,2,3…` — you must
`ORDER BY CAST(LINE AS INTEGER)` to reassemble correctly; and **`LINE` is a sparse monotonic ordinal, not
dense 1..N** — an order can run `LINE 1..113` with only 15 rows, so you cannot infer row count from
`MAX(LINE)` and reassembly must tolerate gaps.
**Example.** `PAT_ENC_DX(CSN, LINE 1..5)` = five diagnoses; `ORDER_NARRATIVE` order with `LINE` 1..113 but
15 actual rows.

### 10. Two-level `GROUP_LINE` / `VALUE_LINE` nested keys
**Mechanism.** Beyond the flat `(parent, LINE)`, a recurring family encodes a list-of-lists with a
**two-dimensional ordinal**: `GROUP_LINE` indexes the outer group, `VALUE_LINE` the items within it.
Reassemble ordering on `CAST(GROUP_LINE AS INT), CAST(VALUE_LINE AS INT)`.
**Example.** `IMM_ADMIN_GROUPS(DOCUMENT_ID, GROUP_LINE, VALUE_LINE)`; the same shape in several
`ALERT_*`/`COMM_PREFERENCES_*` tables.

### 11. Line-chunked free text
**Mechanism.** Long free text (note bodies, result narratives, message bodies) is split across many `LINE`
rows — which is *why* the TSV never needs embedded newlines. Reassemble concatenating in
`CAST(LINE AS INTEGER)` order. The same id appears many times, one chunk per row.
**Example.** `ORDER_NARRATIVE(ORDER_PROC_ID, LINE, NARRATIVE)` — note the key is `ORDER_PROC_ID`, **not**
`ORDER_ID`; `HNO_PLAIN_TEXT(NOTE_CSN_ID, LINE, NOTE_TEXT)`; `MYC_MESG_RTF_TEXT(MESSAGE_ID, LINE, RTF_TXT)`.

### 12. One clinical event fanned into many child lines
**Mechanism.** A single real-world event can legitimately produce many rows (infusion rate changes, a
re-asserted history fact, a multiply-published flowsheet score), so raw `COUNT(*)` **overstates** distinct
events. Auto-calculated rows are often **indistinguishable from entered ones except by measure identity**.
**Example.** Eight identical `0.9% NaCl infusion` `ORDER_MED` rows = one IV event; a PHQ-2 item published
under three `FLO_MEAS_ID`s (Numeric + String + Retired) triple-counts if summed naively.

### 13. `_ALL` generic-master superset tables
**Mechanism.** Several Chronicles masters are shared across concepts. The export ships a `<X>_ALL` table
holding **every** record of that master regardless of type (with `PAT_ID` and a `RECORD_TYPE_C_NAME`
discriminator), while the familiar `<X>` table is one filtered (often current-only) slice. Recognize it by
the `_ALL` suffix + a type discriminator + a much higher row count. To enumerate a concept fully you may
need `_ALL`; for just the active slice use the focused table. (Not version history (§35) and not
soft-delete (§32) — one physical master serving many concepts.)
**Example.** `PROBLEM_LIST` (5 current problems) ⊂ `PROBLEM_LIST_ALL` (56), which by `RECORD_TYPE_C_NAME`
holds System(28)/Immunization(19)/Problem(5)/Allergy(4) — the LPL master backs problems, immunizations
**and** allergies. Same shape: `HAR_ALL`, `CLM_ALL`, `EPISODE_ALL`.

### 14. The on-disk filename is the foreign key
**Mechanism.** Two unstructured corpora are joined to the chart **by filename**: a clinical note's body
lives only at `Rich Text/<NOTE_ID>...RTF` (there is no DB body column — see §32 note), and a scanned media
file is reached by `DOC_INFORMATION.SCAN_FILE` = the literal filename in `Media/`. The filename *is* the
join key; treat the file tree as a keyed table.
**Example.** `DOC_INFORMATION.SCAN_FILE = 'IX-prd-3385360490.JPG'` ↔ that file in `Media/`; `Rich Text/`
filenames begin with the `NOTE_ID` found in `HNO_INFO`.

### 15. Pointer rows survive; referenced bodies may be omitted
**Mechanism.** Index/pointer tables can reference more entities than the export materializes — the pointer
row ships but the payload doesn't (a row-level export-scope gap, distinct from schema-doc gaps §7 and
soft-delete §32). Left-join and tolerate NULL targets; don't assume a referenced id resolves.
**Example.** `PAT_ENC_DOCS`/`PATIENT_DOCS` name ~58 document ids but only ~22 have a `DOC_INFORMATION`
body; a `SCAN_FILE` can name a file that wasn't included.

### 16. `EPISODE` — a longitudinal care thread above the encounter
**Mechanism.** An `EPISODE` groups encounters into a named, dated course of care (a grouping level above
the CSN), linked to member encounters via a bridge keyed `(EPISODE_ID, LINE→CSN)`. The `EPISODE` master is
OB/specialty-heavy, so for a non-OB episode nearly all columns are NULL — a clean case of one master
serving many specialties and shipping mostly empty.
**Example.** `EPISODE` "OT Neuro TBI" (Resolved); `ALL_EPISODE_CSN_LINKS` bridges it to its contacts; 40+
pregnancy/transplant columns are NULL.

---

## C. Time & numbers

### 17. Everything is TEXT — `CAST` before ordering, aggregating, or range-comparing
**Mechanism.** Every column has TEXT affinity: numeric ids (`PAT_ENC_CSN_ID`, `DX_ID`), `LINE`, and the
`*_DATE_REAL` floats are all `typeof = 'text'`. Equality joins still work, but `ORDER BY`/`MIN`/`MAX`/`<`
sort **lexically** and lie. This unifies the §9 `LINE` and §18 date warnings: `CAST(... AS INTEGER/REAL)`
any numeric-looking id/line/date before ordering, aggregating, or range-filtering.
**Example.** `MAX(PAT_ENC_CSN_ID)` returns a lexical `'996…'` while the true max is a 10-digit `'1…'`;
`MIN(CAST(PAT_ENC_CSN_ID AS INTEGER))` is correct.

### 18. `*_DATE_REAL` — decimal contact dates
**Mechanism.** Epic stores a logical date as a FLOAT: **integer part = days since the epoch 1840-12-31**,
**two-digit fraction sequences contacts on the same calendar day** (`.00` first, `.01` second…). The
companion `*_DATE`/`CONTACT_DATE` renders only the day (at midnight), so `*_DATE_REAL` is the true sort key
and same-day tiebreaker (after `CAST … AS REAL`, §17). Three caveats: **not every `*_DATE_REAL` is a
contact date** — some are internal attributes constant per entity (a flowsheet `FLO_CNCT_DATE_REAL` is
fixed per measure and decodes to nonsense), so confirm it varies per row and lands near the human date;
**some high-value tables have none** (`ARPB_TRANSACTIONS` ships only text dates — fall back to the L-number
or a sibling table's `*_DATE_REAL`); **an inherited `*_DATE_REAL` is the parent's date**, not the child
event's instant (a notification message carries the future *appointment's* date).
**Example.** `64869` = 2018-08-09; a day with `.00/.01/.02/.03` = four contacts.

### 19. Effective (calendar) dates vs instant (audit) timestamps — read the suffix
**Mechanism.** **Effective** columns (`*_DATE`, `CONTACT_DATE`, `NOTED_DATE`) store a calendar date and
render at `12:00:00 AM` — the clock is meaningless. **Instant** columns store the real moment; the reliable
discriminator is the **suffix**: `_DATE` = effective; **`_DATETIME` / `_DTTM` / `_INST` = instant**
(a `*_DATETIME` carries seconds, e.g. `7:26:31 PM`). Audit tables split **UTC vs local** (offset visible).
Edge case: a *fractional same-day* effective contact column can carry a real wall-clock time
(`PROB_UPDATES.CONTACT_DATE` `.01` → `11:10 AM`).
**Example.** `PROBLEM_LIST_HX.HX_DATE_OF_ENTRY` = "…12:00:00 AM" (effective) vs `HX_ENTRY_INST` = real time;
`ARPB_TX_ACTIONS.ACTION_DATETIME` = a real instant.

### 20. Split `*_DATE` + `*_TIME` with a `1/1/1900` placeholder
**Mechanism.** Some tables store one instant as a **pair**: a `*_DATE` (real day, midnight) and a separate
`*_TIME` sibling holding the clock time stamped onto a dummy date `1/1/1900`. The real moment = date-part
of `*_DATE` + clock-part of `*_TIME`. Reading `*_TIME` alone drops the event into 1900. Detect by sampling:
if a `*_TIME`'s values all start `1/1/1900`, it's the placeholder form (many standalone `*_TIME` columns
instead carry a full real instant — so only when there's a sibling `*_DATE`).
**Example.** `ARPB_TX_CHG_REV_HX.CR_HX_DATE` = `9/1/2022 12:00:00 AM` + `CR_HX_TIME` = `1/1/1900 6:26:00 AM`
→ true `9/1/2022 6:26 AM`.

### 21. Fuzzy / accuracy-flagged dates
**Mechanism.** Imprecise onset dates take two forms: a **`[start,end]` range** (a `NOTED_DATE` +
`NOTED_END_DATE`; "2012" → Jan 1..Dec 31 — *plausible but org-dependent; may never appear if every onset
is exact*), or a separate **accuracy category** declaring precision (`*_DATE_ACCURACY_C_NAME` =
"Exact Date"). Don't conflate generic `*_END_DATE` interval-ends (`FILL_END_DATE`, `EFF_END_DATE`) with
fuzzy-onset companions — most are real interval ends, not fuzz.
**Example.** `ALLERGY.ALLERGY_NOTED_DATE_ACCURACY_C_NAME` = "Exact Date"; `PROBLEM_LIST.NOTED_DATE` =
`NOTED_END_DATE` (exact) on every populated row in one specimen.

### 22. Inverted / complement dates as filesystem & sort keys
**Mechanism.** To sort newest-first, Epic sometimes stores a **complement** of `*_DATE_REAL`
(`constant − DATE_REAL`) as a key — notably embedded in note filenames and in some order-date columns. It
looks like a date but isn't; convert back with the complement constant. When formatting `*_DATE_REAL`
fractions, use `printf('%.2f', …)` — `%g` rounds to 6 sig-figs and corrupts the value (`55955.99`→`55956`).
**Example.** A `Rich Text/` filename's middle number = `121531 − CONTACT_DATE_REAL` and maps to the note's
latest contact; `HNO_ORDERS.ORDER_DAT` carries a similar complement.

---

## D. Codes, categories & values

### 23. `_C` / `_C_NAME` category fields and `ZC_` lookups — the big variation
**Mechanism.** Categories are normally a numeric `<COL>_C` joined to a `ZC_<category>` name table. The EHI
export often **pre-resolves** them: it emits `<COL>_C_NAME` with the label inline and **may ship no `ZC_`
tables at all** (one specimen: 1,850 `_C_NAME` columns, 0 bare `_C`, 0 `ZC_` tables — so the integer codes
are unrecoverable). **Check this first** on a new export: presence of `ZC_` tables and bare `_C` vs
`_C_NAME` decides how you decode. Refinements: a single concept can be split across **multiple parallel
`_C_NAME` columns** that disagree and are each sparse (`COALESCE` across them, don't decode one); a
pre-resolved value can be a placeholder like `'(NONE)'` or blank; and a schema description may **instruct
you to "join the ZC table"** that the export never shipped.
**Example.** `PROBLEM_LIST.PROBLEM_STATUS_C_NAME` = "Active"; note type lives in `NOTE_TYPE_NOADD_C_NAME`
**and** `IP_NOTE_TYPE_C_NAME` **and** `NOTE_ENC_INFO.NOTE_TYPE_C_NAME` (coalesce).

### 24. Column-label-lies — read the description, not the name
**Mechanism.** A column's *name* can misdescribe its contents; the value resolves fine, so nothing errors —
only the schema *description* reveals the truth. When a `_C_NAME` reads as nonsense for its column name,
read the column doc before trusting it.
**Example.** `ALLERGY.SEVERITY_C_NAME` actually holds the allergy **type** (per its schema doc), while
`ALLERGY_SEVERITY_C_NAME` is the real severity.

### 25. Coded value beside free text — and the value cluster
**Mechanism.** Epic stores both a structured value and its free-text counterpart in adjacent columns,
because either may be entered. For numeric results the cluster is wider than two: `ORD_NUM_VALUE` (numeric,
with the **`9999999` sentinel** meaning "no real number — read the text"), `ORD_VALUE` (text), and often
`VALUE_NORMALIZED` / `ORD_RAW_VALUE` (operator results like ">90"). Read across the cluster; filter the
sentinel before averaging/plotting.
**Example.** A qualitative lab: `ORD_VALUE` = ">90", `VALUE_NORMALIZED` = ">90", `ORD_NUM_VALUE` = `9999999`.

### 26. Packed / type-tagged measurement values
**Mechanism.** A measurement's value can be **compound**, and a sibling `VALUE_TYPE_C_NAME` declares how to
read it: "Numeric Type" = a plain number, "Blood Pressure" = a packed `"sys/dia"` string that is *not* a
single number. So even after externalization (§47) the datatype is itself coded. (And a measure's display
*name* can contain demographic words — "…FEMALE" in a ventilator reference calc — that describe the
formula, not the patient.)
**Example.** `V_EHI_FLO_MEAS_VALUE`: `MEAS_VALUE_EXTERNAL` = "142/74", `VALUE_TYPE_C_NAME` = "Blood Pressure"
vs "25.7"/"Numeric Type".

### 27. Parallel identifier systems
**Mechanism.** The same entity can carry an internal Epic id and an externally-transmitted code in
different columns (especially billing). The **transmitted code may be entirely stripped** by export config,
leaving only the internal id + resolved name.
**Example.** Internal `PROC_ID` vs transmitted `PROC_IDENTIFIER` "HC:99213:95"; in some exports the HCPCS/
CPT column is absent everywhere, so only `CLARITY_EAP.PROC_ID`+`PROC_NAME` remain.

### 28. `_YN` / `_YNU` boolean encoding (Y / N / NULL, and tri-state)
**Mechanism.** Booleans are TEXT `'Y'`/`'N'`, not 1/0 — and effectively **tri-state** because the common
value is NULL (unset). So `WHERE flag='N'` misses the NULLs; use `flag='Y'` for true and
`COALESCE(flag,'N')<>'Y'` for the rest. A `*_YNU` suffix is an explicit Yes/No/Unknown flag.
**Example.** `PAT_ENC.OUTGOING_CALL_YN` = 'N'(6)/NULL(163); `HSP_ACCOUNT.CODE_BLUE_YNU` = Y/N/Unknown.

### 29. The unit lives in a column, not in the value
**Mechanism.** Measure values are bare numbers; the unit is a separate column (often
`V_EHI_FLO_MEAS_VALUE.UNITS`, sometimes NULL) or implied by the measure type. Raw values look absurd until
you read the unit — weight in **ounces**, height in **inches**. Carry the unit with the value.
**Example.** Weight `2931.2` is **ounces** (≈183 lb); height `71` is **inches**.

---

## E. State, lifecycle, history & audit

### 30. Status / lifecycle — frequently a *matrix*, not one column
**Mechanism.** State is carried by `*_STATUS_C_NAME` categories and `*_YN` flags, but a record often has
**several independent status axes that diverge**, and a "status-looking" column may be a trap:
- Encounters: `ENC_CLOSED_YN` (manual closure) vs `CALCULATED_ENC_STAT_C_NAME` (derived rollup) — an
  encounter can be calc-Complete yet never closed; don't equate them.
- Labs/orders: `ORDER_STATUS_C_NAME` (order-level) vs `RESULT_STATUS_C_NAME` (component-level) — distinct
  axes; and a status of "Final result" does **not** guarantee result rows exist.
- The table named `ORDER_STATUS` is **not** the med status field (that's `ORDER_MED.ORDER_STATUS_C_NAME`).
- Patient alive/dead: `PATIENT.PAT_STATUS_C_NAME` is often **blank**; the computed living status is
  `PATIENT_4.PAT_LIVING_STAT_C_NAME` (and can read "Not A Patient").
**Example.** Encounter cross-tab: calc-Complete with `ENC_CLOSED_YN` both Y and blank; "Final result" CMP
with zero `ORDER_RESULTS` rows.

### 31. `_HX` has two meanings — classify by column semantics, not the prefix
**Mechanism.** `_HX` is overloaded: **clinical-history** tables hold patient history facts (`FAMILY_HX`,
`SOCIAL_HX`, `SURGICAL_HX`); **change-audit/version** tables hold row versions over time. The old "HX_-
prefixed columns ⇒ audit" heuristic is **unreliable** — `REFERRAL_HIST` (audit) uses `CHANGE_*`/`NEW_*`,
`MEDS_REV_HX` uses `*_REV_*`, `ACCT_HOME_PHONE_HX` has no `HX_` at all, while clinical `SURGICAL_HX` *has*
an `HX_LNK_ENC_CSN`. Classify **semantically**: change/version verbs (`CHANGE`/`REV`/`PREVIOUS`/`NEW`/`OLD`
+ per-edit user+instant) ⇒ audit; clinical nouns ⇒ history. A **third flavor** is a review/attestation log
(one row per "list reviewed at encounter X", keyed by reviewer+CSN) — e.g. `PATIENT_ALG_UPD_HX`,
`PROB_LIST_REV_HX`.
**Example.** `PROBLEM_LIST_HX` (audit, versions of one problem) vs `FAMILY_HX` (history facts) vs
`PROB_LIST_REV_HX` (attestation log).

### 32. Soft-delete / everything-persists (with a dangling-pointer variant)
**Mechanism.** Chronicles rarely deletes; records are marked Resolved/Deleted/Archived and kept, so the
export ships the full lifetime (resolved problems, discontinued meds, voided charges). **Variant:**
sometimes the export *drops the deleted detail row* and leaves only a **dangling bridge id** with no status
flag — detect the deletion by a `LEFT JOIN` miss, not a status read. (Note: a rich-text note body has **no
DB table at all** — `HNO_NOTE_TEXT` isn't exported; the RTF file is the only copy, §14.)
**Example.** `PROBLEM_LIST` keeps a "Resolved" problem with a `RESOLVED_DATE`; but a deleted allergy's
detail is absent from `ALLERGY`, leaving an orphan pointer in `PAT_ALLERGIES`.

### 33. Void / reversal as a *paired* transaction (financial soft-delete)
**Mechanism.** In billing, voiding a charge doesn't flag one row (§32's simple model) — it creates a **new
reversing transaction** and records the linkage in a void/match table; both the original and the reversal
persist with their own ids. To net finances you **pair** them, not filter a flag.
**Example.** `ARPB_TX_VOID` links original `ETR 315026147` to reposted `317236398` (`REPOST_TYPE` =
"Correction"); the original `ARPB_TRANSACTIONS` row still ships with `VOID_DATE` set.

### 34. Per-encounter re-snapshot of histories (and snapshot-CSN vs source-CSN)
**Mechanism.** Family/social/medical/surgical histories are re-filed in full each encounter they're
reviewed, tagged with that encounter's CSN — so facts repeat; take the **latest CSN** for the current view,
and the *growth* between snapshots shows when a fact was added (naive `COUNT` over-counts). A single
snapshot row can carry **two** CSNs: `PAT_ENC_CSN_ID` = where this copy was *filed*, `HX_LNK_ENC_CSN` = the
encounter that *originally created* the fact — they differ row by row.
**Example.** `FAMILY_HX`: 3 rows at an early CSN, 11 at a later one; `FAMILY_HX_STATUS` row filed at a 2024
CSN carries `HX_LNK_ENC_CSN` = a 2022 CSN.

### 35. Current-state collapse vs version history
**Mechanism.** Many domains ship both a current-state table (collapse to "now" = last `_HX` line) and the
`_HX` version table. The base table's `DATE_OF_ENTRY`/editor reflect only the *last* edit — go to `_HX` for
origin. And `_HX` lines accrue only on **change**: a never-edited Active problem has a single line, so `_HX`
line count ≠ review/encounter count.
**Example.** `PROBLEM_LIST.DATE_OF_ENTRY` shows the resolve edit; `PROBLEM_LIST_HX LINE 1` shows the
earlier original entry by a different clinician.

### 36. Effective-dated (`EFF_DATE`/`TERM_DATE`) slowly-changing dimensions
**Mechanism.** A relationship/attribute that changes over time is modeled as `LINE` rows each with a
validity window `EFF_DATE..TERM_DATE` (contiguous, non-overlapping). The **currently-in-effect** row is the
one with **`TERM_DATE` NULL** (open interval); historical rows have a non-null term. Distinct from fuzzy
onset (§21) and per-edit audit (§31). For "current," filter `TERM_DATE IS NULL`; for "true on date D,"
find `EFF_DATE ≤ D < COALESCE(TERM_DATE, ∞)`.
**Example.** `PAT_PCP`: LINE 1 EFF 2018 TERM 2022, LINE 2 EFF 2022 TERM NULL ⇒ LINE 2 is the current PCP.
Same shape: `PAT_PRIM_LOC`, `COVERAGE_MEMBER_LIST.MEM_EFF_FROM_DATE`.

### 37. The who/when/why action triplet
**Mechanism.** When Chronicles records a lifecycle action (delete, void, sign, cosign), it persists a
coupled triplet: `<ACTION>_USER_ID` (+`_NAME`), `<ACTION>_INSTANT_DTTM`, and often `<ACTION>_REASON_C_NAME`
/`_COMMENT`. The row is kept (§32); the triplet tells you who/when/why without a separate audit row.
**Example.** `HNO_INFO.DELETE_USER_ID` + `DELETE_INSTANT_DTTM` (note retained, flagged);
`PAT_ENC_COMM_MGT.COMM_VOID_USER_ID` + `_INSTANT_DTTM` + `_REASON_C_NAME` + `_COMMENT`.

### 38. The self-describing field-level change ledger (`V_EHI_*_AUDIT`)
**Mechanism.** The `V_EHI_*_AUDIT` views are a generic data-change ledger: each row names the changed field
as a literal `'TABLE.COLUMN'` string in `CHANGED_DATA_ELEMENT` with `OLD_VALUE_EXTERNAL`/`NEW_VALUE_EXTERNAL`,
the user, and dual UTC/local instants. It's the export's universal edit log — mine it to reconstruct a
field's history even when its own table has no `_HX`. But it's dominated by ETL/system writes (~47% "CLARITY
ETL" in bulk-load clusters), so treat it as change/access **metadata**, not clinical content, and often the
single largest "table" by row count.
**Example.** `V_EHI_REG_ITEM_AUDIT_EPT`: `CHANGED_DATA_ELEMENT` = "INCOMPLETE_NOTE_EPT.PAT_ENC_CSN_ID",
`NEW_VALUE_EXTERNAL` = a CSN, with UTC vs local instants 5h apart.

---

## F. Values & nulls

### 39. Empty → NULL, and NULL ≠ "no associated data"
**Mechanism.** Empty TSV cells load as SQL NULL (so `IS NULL`/aggregates behave). But a **NULL category is
not proof of absence**: a note with `NOTE_FORMAT_C_NAME` NULL can still have an RTF body; using a NULL
category as a presence filter silently drops real data. Confirm presence by the payload, not a category.
**Example.** `NOTE_FORMAT_C_NAME` NULL on 113/194 contacts, yet 23 of those have an RTF body.

### 40. Denormalized preview / cache columns
**Mechanism.** Epic caches the opening chars of a free-text note into a structured column for preview — a
**truncated copy** (cap is table-specific, not a universal 255, and may include RTF markup). The cache can
be **NULL while the source is populated**, so `COALESCE(cache, source)` and go to the source for full text.
**Example.** `PROBLEM_LIST.PROBLEM_CMT` previews the overview note (full text via `OVERVIEW_NOTE_ID`);
`ORDER_MED.DISPLAY_NAME` is NULL on some rows while `DESCRIPTION`/`CLARITY_MEDICATION.GENERIC_NAME` is set.

---

## G. Cross-cutting export traits

### 41. The same concept can live in two ID spaces
**Mechanism.** Distinct subsystems mint distinct ids for related things; joining across the boundary
silently returns nothing. Canonical instances (all verified): **`ORDER_PROC_ID` vs `ORDER_MED_ID`** (0
overlap — procedure/lab orders vs med orders; result children key `ORDER_PROC_ID`, sig children
`ORDER_MED_ID`); **provider `SER` vs user `EMP`** (the same human is `SER 599471` *and* `EMP ALG006`;
SER≈numeric, EMP≈alphanumeric login); **`*_LOC_ID`→`CLARITY_LOC` vs `DEPARTMENT_ID`→`CLARITY_DEP`**;
**orderable `PROC_ID` (`ORDER_PROC`) vs charge `PROC_ID` (`ARPB_TRANSACTIONS`)** (non-overlapping EAP
records that both resolve through `CLARITY_EAP`); **`MEDICATION_ID` (drug, ERX) vs `ORDER_MED_ID` (order)**.
*Note:* `PAT_ENC_CURR_MEDS.CURRENT_MED_ID` **does** join `ORDER_MED.ORDER_MED_ID` cleanly here (it *is* an
order id) — measure the resolve rate before assuming a bridge is needed.
**Example.** `ORDER_NARRATIVE.ORDER_PROC_ID` joins `ORDER_PROC` 465/465 but `ORDER_MED` 0/465.

### 42. Symmetric / bidirectional rows — and partners outside the export window
**Mechanism.** Some relationship tables store each link in both directions (~2× the logical count). But
**don't assume a clean 2×**: the partner record is often **outside the exported window** (the ETR ledger is
a narrower extract than the claim-history tables), so dedup-by-id under-counts. Anchor counts on the side
that's fully present (e.g. the Charge side), not on a symmetric dedup.
**Example.** `ARPB_TX_MATCH_HX` has 247 rows; ~111 reference a `MTCH_TX_HX_ID` not in the exported
`ARPB_TRANSACTIONS`, so a `TX_ID < MTCH_TX_HX_ID` dedup yields 68, not the naive ~123.

### 43. Data dated *after* the export
**Mechanism.** A snapshot includes future-dated rows: scheduled future appointments, and automated/
administrative contacts (recurring "Nth-of-month" med-refresh or billing jobs) with real CSNs but NULL
provider/department. The **tell** that an empty-looking contact is a real automated contact (not a blank
row) is that it still carries a `PAT_ENC_CURR_MEDS` snapshot and a billing link. Don't read `MAX(date)` as
"last care," and exclude these before counting visits.
**Example.** A `Scheduled` appointment a year past the export; dozens of monthly NULL-dept contacts each
with a 3-med current-meds snapshot.

### 44. External-origin sentinels
**Mechanism.** Data imported from outside Epic (Care Everywhere, outside labs/imaging) is tagged with
**sentinel provider/department ids** — a "GENERIC EXTERNAL DATA PROVIDER" and department `8` ("GENERIC
EXTERNAL DATA DEPARTMENT"). A row flagged external on both is imported, not native; and referred-to/outside
care often appears only as **pointers** (an `EXT_SVC_*` stub or a `REFERRAL_CROSS_ORG` OID), not full records.
**Example.** 5 `PAT_ENC` rows carry the external provider *and* department sentinels — outside imaging/labs.

### 45. The file extension / MIME can lie
**Mechanism.** Media keeps the source system's stored filename and extension, which need not match the
actual codec. Sniff the bytes, don't trust the extension.
**Example.** `IX-prd-3540546502.TIF` is actually JPEG/JFIF data (per `file(1)`).

### 46. Companion-row placeholders (always emit, populate conditionally)
**Mechanism.** Epic emits a structural companion row even when its payload doesn't apply, leaving every
column NULL — presence of the table ≠ presence of data. Recognize the "always-emit-the-companion,
populate-only-when-data-exists" shape.
**Example.** `DOC_INFO_DICOM` ships one row per document but every DICOM column (`STUDY_INST_UID`,
`MODALITY`, accession) is NULL when the image arrived as a flat scan rather than true DICOM.

### 47. `V_EHI_*` export views and the audit giant
**Mechanism.** Tables prefixed `V_EHI_` are views the exporter adds **for the EHI export** —
transformation/convenience layers. Some are **mandatory, not optional**: a flowsheet measurement's value
exists **only** in `V_EHI_FLO_MEAS_VALUE.MEAS_VALUE_EXTERNAL` (joined to `IP_FLWSHT_MEAS` on `FSD_ID,LINE`,
exact 1:1) — the base `IP_FLWSHT_MEAS` ships **no value column at all**. Others (`V_EHI_*_AUDIT`, §38) are
the change-ledger giants. Use the `V_EHI_*` companion wherever a base table's values look absent.
**Example.** `IP_FLWSHT_MEAS` has columns `FLO_MEAS_ID`, `FLO_MEAS_ID_DISP_NAME`, `MEAS_COMMENT` — and no
value; the number is in `V_EHI_FLO_MEAS_VALUE`.

### 48. The in-basket "pool" party model
**Mechanism.** In MyChart/in-basket messaging, the named `FROM_USER`/`TO_USER` party (often a physician) is
frequently **not** the actual author of a reply — a nurse/MA answers from a shared pool, with `ORIGINAL_TO`
recording the re-route. So a party-name column may be the *targeted* user, not the *acting* one (a §6
companion caveat specific to messaging).
**Example.** A message `TO_USER` names the doctor while the reply is authored from the pool; `ORIGINAL_TO`
holds the routing.

---

*Found a pattern this misses, or one that frayed on your export? That's a friction report — add it here
with its mechanism and a traced example. This reference is meant to be exhaustive; help it stay that way.*
