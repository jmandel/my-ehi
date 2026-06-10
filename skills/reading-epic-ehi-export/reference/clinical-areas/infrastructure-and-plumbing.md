# Infrastructure & plumbing — the negative-space field guide

**Scope.** The residue. After every clinical-area guide has claimed its tables, an Epic EHI export still
contains a long tail of populated tables no guide mentions — lookup slices, numbered overflow, placeholder
shells, ID converters, export machinery, configuration echoes, and micro-domains too thin to deserve their
own chapter. In one specimen: **120 tables, ~2,236 rows total** — together smaller than the single audit
ledger (§47). This guide answers the question an analyst actually asks on hitting one: *is this clinically
meaningful, or safe to skip?* The failure mode is asymmetric: skipping a load-bearing table is a **silent
false negative** (the query "works", the answer is wrong), while reading a plumbing table costs only
minutes. So every "skip" verdict below comes with the *mechanism* that makes it skippable, and every
exception with the join that proves it matters.

**Where it sits.** This is not a domain but a residue class, so it has no spine. What it has is a
*gravity well*: in one specimen roughly 70 of the 120 hang from revenue-cycle keys (`TX_ID`,
`HSP_ACCOUNT_ID`, `CLAIM_PRINT_ID`, `BUCKET_ID`, `CLAIM_ID`, `ACCT_ID`, `CVG_ID`, `BDC_ID`) — the billing
module fans one financial event into more child tables than any clinical module does (§12), so its
overflow dominates the long tail. The rest are master-file slices with no patient key at all (§5), and a
handful of per-encounter/per-patient stubs.

**Triage in three moves, before any verdict:**
1. **Anchor** — the first/PK column names the spine the table hangs from (recipe 1).
2. **Shape** — column count, and row count vs. the anchor's population (`_tables` makes this one query).
3. **Census** — per-column fill counts (recipe 2). *A blank column is rarely no-data* — but a table whose
   every non-key column is blank, confirmed by census, is genuinely empty (§39 cuts both ways).

Skip **by mechanism, never by name**: each family below gives the recognition rule, why the family exists,
the verdict, and the named exceptions.

## Family 1 — master-file lookup slices

**Recognition.** Two or three columns: an ID plus a `*NAME`/`*CODE` column; no `PAT_ID`, no CSN, no
dates; row count = the number of distinct records this patient happened to reference. In one specimen:
`CLARITY_RMC` (remit codes), `CLARITY_LLB` (resulting labs), `CLARITY_MOD`, `CLARITY_SA`, `CLARITY_NRG`,
`CL_UB_REV_CODE`, `CL_COL_AGNCY`, `GEO_REGION`, `IP_FREQUENCY`, `CLARITY_EEP`, `CLARITY_FSC`,
`CLARITY_LOT`/`MEDICATION_LOT`, `CLARITY_PRC`, `RX_NDC`, `SMARTTEXT`, `CHRG_TRIG_MTHD`, `V_BIL_ALL`,
`ORG_DETAILS`, `LNC_DB_MAIN` — plus lookup-side numbered supplements trimmed the same way
(`CLARITY_LOC_2`, `CLARITY_EAP_5`, `RX_MED_TWO`). Note the same trim hits the *famous* masters too
(`CLARITY_EMP`, `CLARITY_EAP`, `CLARITY_SER` ship as 2–3-column slices here) — those are documented in
their domains; the residue is just the masters only billing references.

**Why they exist.** §5: every `_ID` column implies a master file; the export ships the referenced rows of
each master, cut down to a name resolver. Usually the referencing table *also* carries the denormalized
`<ID>_<MASTERFILE>_NAME` companion (§6), which makes the slice redundant for display.

**Verdict: skip for browsing, keep for joining.** Mechanism: the slice holds org-catalog content, not
patient events — there is nothing to *read*. But do not delete them: (a) they resolve IDs wherever the §6
companion was dropped (§7 — the export omits some documented companions; test for the sibling column
before assuming), and (b) the slice is *patient-shaped*: which master rows shipped reflects which codes
the record uses, so even "plumbing" leaks the record's outline.

**Named exceptions (load-bearing):**
- **`LNC_DB_MAIN` — the only place LOINC codes live.** `ORDER_RESULTS` ships `COMPON_LNC_ID` but its
  documented `COMPON_LNC_ID_LNC_LONG_NAME` companion is **not shipped** (querying it errors "no such
  column"), and no other shipped column anywhere carries the LOINC *code string* — verified by scanning
  every table's columns for `%LNC_CODE%`/`%LOINC%`. The join `ORDER_RESULTS.COMPON_LNC_ID =
  LNC_DB_MAIN.RECORD_ID` resolves every distinct id (22/22 in one specimen) and is the export's entire
  lab-interoperability mapping (recipe 6). Same resolver serves `ORDER_PROC_4.PROC_LNC_ID`. The
  lab-results guide owns the results; the *standard codes* for them are only here.
- **`CLARITY_LOT`/`MEDICATION_LOT` — vaccine lot resolution.** `IMMUNE.IMM_LOT_NUM_ID` joins
  `CLARITY_LOT.LOT_NUM_ID` (no `_NAME` companion on `IMMUNE` for it). `IMMUNE` also carries a free-text
  `LOT`, so check redundancy per specimen — but lot identity (recall lookups) may resolve only here.
- **`ORG_DETAILS` — names external organizations.** Target of `REFERRAL_CROSS_ORG`, `COVERAGE_2`, and
  `CLM_VALUE_RECORD` organization ids. Companions ship in this specimen, so it's redundant *here* — but
  it is the master behind every "outside org" pointer; verify the companion before discarding.

## Family 2 — numbered supplements of documented bases

**Recognition.** Name = an existing table + a numeric suffix, **in either spelling**: `BASE_2` *or*
`BASE2` (Epic uses both: `ARPB_TRANSACTIONS2` but `HSP_TRANSACTIONS_2`). Same row count as the base, 1:1
on the base's key (§8). Beware near-collisions: `CLAIM_INFO2`, `CLAIM_INFO3`, **and** `CLAIM_INFO_3` are
three distinct tables, all 1:1 with `CLAIM_INFO`. Recipe 4 maps every supplement to its base mechanically.

**Why they exist.** §8 horizontal overflow: Chronicles items beyond the first table's column budget spill
into continuation tables. The split point is arbitrary; a supplement is just columns 100+ of its base.

**Verdict: never read alone — the base's guide owns it.** Mechanism: no supplement has independent
existence; every row presupposes a base row, and its columns mean nothing without the base's context.
Ownership map for the specimen's residue: `ARPB_TRANSACTIONS2/3`, `HSP_TRANSACTIONS_2/3`,
`HSP_ACCOUNT_2/3/5`, `ACCOUNT_3`, `ACCOUNT_CONTACT_2`, `CLAIM_INFO2/3/_3`, `SVC_LN_INFO_2/3`,
`CLM_VALUES_3/4/5` → **coverage-and-billing**; `ORDER_MED_3/4/5`, `ORDER_DISP_INFO_2`,
`ORD_DOSING_PARAMS_2` → **medications-and-orders**; `COVERAGE_2/3/5` → **benefits-and-eligibility**;
`TIMEOUT_ANSWERS_2` → **procedures-and-surgeries**; `REFERRAL_3` → **referrals** (already documented
there as the range "`REFERRAL_2`…`REFERRAL_6`" — a literal-name scan misses range notation, which is how
it landed in this residue at all).

**Don't write them off as empty — census first.** In one specimen ~10 of the 27 are blank beyond their
keys (`REFERRAL_3`, `SVC_LN_INFO_3`, `CLM_VALUES_4/5`, `COVERAGE_3/5`, `ACCOUNT_3`, `CLAIM_INFO3/_3`,
`ORDER_DISP_INFO_2`, `TIMEOUT_ANSWERS_2`), but the rest carry axes the base lacks:
- `ARPB_TRANSACTIONS2` is populated on **every** row for outstanding-claim status, and carries statement
  holds + reasons, provider network status; `ARPB_TRANSACTIONS3` has the primary timely-filing deadline.
  Skipping these because "the base is documented" loses the claim-status axis entirely.
- `ORDER_MED_3/4/5` carry the original-prescription block, e-prescribing destination, confidentiality
  flag, and the order-placement **UTC instant** (§19) — the base `ORDER_MED` ships no UTC column at all
  (the other UTC instants live in further supplements, `ORDER_MED_2/6/7`).
- `CLM_VALUES_3` carries the service-facility name/address block on claims; `CLAIM_INFO2` the
  workers'-comp axes; `HSP_ACCOUNT_2/3/5` denial-flag, bad-debt, self-pay and expected-allowed columns.

## Family 3 — placeholder shells (always emitted, payload empty)

**Recognition.** Row count equals an anchor population exactly — one row per encounter, patient,
coverage, account, bucket, or claim — and the census shows only keys and contact dates filled. Some ship
real payload columns that are all-NULL; some ship *only* the keys (`PAT_ENC_CALL_DATA` is literally
CSN + date). Find candidates by row-count match (recipe 3), confirm by census (recipe 2).

**Why they exist.** §46: Chronicles initializes the related group on every contact, so the exporter emits
a row whether or not the module was ever used. One row per encounter ≠ one *event* per encounter.

**Verdict: skip after census, never by name.** Mechanism: all-NULL payload, mechanically confirmed, is
the one case where "blank means no data" is safe (§39's exception, earned by checking). The reason you
must not skip by *name*: these are the *specialty-module* surfaces. In one specimen the shells include
`OPH_EXAM_DATA` (ophthalmology — its visual-acuity columns exist, all NULL), `HOMUNCULUS_PAT_DATA`
(rheumatology joint exam), `DENT_ORTH_EXAM_NOTES` + `TEETH_REVIEWED` (dental), `AN_RELINK_INFO`
(anesthesia), `PAT_CR_TX_SINGLE` (e-visit card transactions), `PAT_ENC_CALL_DATA` (clinical-call
outcomes) — for a patient who *did* see ophthalmology, the same table is the data, and dismissing it
class-wide is exactly the silent false negative this guide exists to prevent. Patient-level shells:
`TEETH_REVIEWED`, `CLAIMS_DERIVE_PAT_FLAGS`; coverage-level: `CVG_AP_CLAIMS`, `COVERAGE_MISC_COMMENTS`
(whose own schema description admits it "should not be extracted unless there are attached comments" —
it was anyway); billing-side (account/bucket/claim/remit): `HSP_BKT_ADDTL_REC`, `CLP_NY_MEDICAID_INFO`
(a state-specific form block), `CL_RMT_PRV_SUP_INF` (one per remittance record), `HSP_ACCT_BILL_DRG`,
`ACCOUNT_CONS_SP_SA_BILL`; master-side:
`CLARITY_EPM_OT`/`CLARITY_EPP_OT` (one config flag each, NULL here).

## Family 4 — ID crosswalks, converters & pointer lists

**Recognition.** Anchor key + `LINE` + a single `*_ID` payload column, nothing else (§9 vertical
sub-list where *the list itself is the payload*). Nothing to read; the row **is** a relationship.

**Why they exist.** Chronicles stores related-record memberships as multiple-response items; the export
flattens each into its own table rather than inlining the list.

**Verdict: skip for reading, essential for joining — and three are traps if skipped.**
- **`PAT_UCN_CONVERT` — the migration stitch.** Marks which notes on which contacts were converted for
  UCN (IntraConnect's Unique Contact Number — the cross-instance contact identity). In one specimen: 76
  notes across 38 of 169 contacts, every `LINKED_UCN_NOTES_ID` resolving in `HNO_INFO` — and there fully
  *redundant* (each note's own `PAT_ENC_CSN_ID` already matches; recipe 7 is the check). But this table
  is the only explicit ledger of the conversion: in an export from a merged/migrated instance, the
  note↔contact linkage for **pre-migration contacts** may survive only here. Looks like noise; is the
  key for old contacts. Run recipe 7 before discarding, not after.
- **`HSP_CLP_CMS_TX_PIECES` / `HSP_CLP_UB_TX_PIECES` / `CLP_NON_GRP_TX_IDS` — claim-line ↔ transaction
  crosswalk.** The only bridge from a printed claim line back to the `HSP_TRANSACTIONS` rows composing
  it (3/3 `TX_ID`s resolve in one specimen). Without it, "which charges are on this claim line" is
  unanswerable.
- **`IP_ORD_UNACK_PLAC` — one column, two ID spaces.** `ORD_UNACK_PLACE_ID` lists orders never
  acknowledged after placement; in one specimen its 37 ids split 21 into `ORDER_PROC` and 16 into
  `ORDER_MED` — a §41 hazard packed into a single column (joining against only one master silently drops
  half). Reaches the encounter via `INPATIENT_DATA_ID → IP_DATA_STORE.EPT_CSN`. The acknowledgment state
  exists nowhere on the `ORDER_*` tables themselves; nearest guide: order-lifecycle-details.
- The mechanical rest: `HSP_ACCT_CHG_LIST`/`_ADJ_LIST`/`_PYMT_LIST` (account → its transaction lists),
  `HSP_BKT_ADJ_TXS`/`HSP_BKT_PAYMENT` (bucket → transactions), `HSP_BKT_NAA_HX_HTR`, `HSP_CLP_DIAGNOSIS`
  + `HSP_ACCT_EXTINJ_CD` (claim/account → `DX_ID`, resolve via `CLARITY_EDG`), `HSP_TX_AUTH_INFO`
  (transaction → coverage id; auth payload empty here), and `DOCS_FOR_HOSP_ACCT` — whose one
  `LINKED_DCS_ID` resolves **nowhere** in the export (0/1 in `DOC_INFORMATION`): a §15/§32 dangling
  pointer, the membership preserved while the referenced body was left out of scope (recipe 8).

## Family 5 — export/ETL machinery

**Recognition.** `V_EHI_*` names (§47) whose descriptions talk about the *export*, not the patient
("Placeholder view… marked as both static and dynamic", "supports extracting rich text format (RTF)
data"); also the `CM_LOG_OWNER_ID` / `CM_CT_OWNER_ID` columns that ride along on many tables
(Community Connect ownership stamps, NULL in a single-org export).

**Why they exist.** The EHI exporter drives itself with helper views — filters that scope which records
to pull — and ships them alongside the data they scoped.

**Verdict: safe to skip — content fully derivable.** Mechanism, verified: `V_EHI_ORD_LINKED_PATS` is
exactly the `ORDER_PROC` id set with `PAT_ID` attached (42/42 join `ORDER_PROC`, 0 join `ORDER_MED`);
`V_EHI_CLM_FILTER_STATIC` is the `CLAIM_INFO` id set with `PAT_ID` (it scopes claim RTF extraction).
Both restate joins the base tables already support. One genre-level caveat: in a multi-patient/proxy
export these patient-scoping views would be the cheapest record-to-patient map — derivable still, but
not worthless. Contrast with the `V_EHI_REG_ITEM_AUDIT_*` views, which look like machinery and are a
**data** family (see record-access-audit) — classify `V_EHI_*` by *content*, not prefix.

## Family 6 — org-configuration echoes

**Recognition.** A handful of rows describing the institution's setup; no patient key; names like
"settings", "details", "activity".

**Why they exist.** Some patient-record items point at configuration records, and the export ships the
pointed-at config rows like any other master reference.

**Verdict: skip unless asking "why did the system behave that way."** `REPORT_SETTINGS` (19 rows of HST
settings names) is the lookup behind `COMMUNICATION_PREFERENCES.COMMUNICATION_CONCEPT_ID` — it tells you
which communication concepts the org defines (the patient's choices live in communication-preferences's
tables). `REPORT_DETAILS` resolves `DOC_INFORMATION.COMM_ORIG_LRP_ID` (which report template produced a
summary-of-care document). `ADV_ACTIVITY_DATA` names a Hyperspace activity configuration. All three have
shipped `_NAME` companions on their referencing side in one specimen — redundant, but they explain
behavior, not health.

## Family 7 — genuine micro-domains (too thin for their own guide)

Each is real data, one sentence each, with the guide that should adopt it. The starred ones are the
load-bearing surprises.

**Guarantor/account identity (→ coverage-and-billing, demographics):**
- ★ **`GUAR_ADDR_HX`** — guarantor address *change history* with change date and source: the §35
  current-state collapse means `ACCOUNT`/`PATIENT` keep only today's address; a prior address survives
  **only here** (and possibly in the §38 audit ledger's window). Two rows here outrank whole empty tables.
- `ACCT_ADDR` — current billing address as `LINE`-numbered lines (§9); `HSP_ACCT_EARSTADDR` — the
  guarantor address *as of the hospital-account contact* (a §34-style point-in-time snapshot);
  `ACCOUNT_CREATION` — who/when created the guarantor account (§37); `CVG_SUBSCR_ADDR`,
  `PAT_CVG_FILE_ORDER` — subscriber address and coverage filing order (→ benefits-and-eligibility).

**Collections & denials (→ coverage-and-billing):**
- ★ **`HSP_ACCT_CL_AG_HIS`** — collection-agency history: date, change type, agency (companion name
  ships; master is `CL_COL_AGNCY`), account balance at transfer. The only place "this account went to
  collections" is recorded; status columns elsewhere don't say it.
- ★ **`HSP_BDC_DENIAL_DATA`** (+ `HSP_BDC_PAYOR`, `HSP_BDC_RECV_TX`) — line-level denial detail (EOB
  line, billed/allowed/paid/denied amounts, CPT) under the documented BDC denial records: *what* was
  denied and by how much, where the base records only that a denial exists.
- ★ Remit reasons: `HSP_PMT_LINE_REMIT`, `HSP_PMT_REMIT_DETAIL`, `HSP_TX_RMT_CD_LST`, `SVC_PMT_HISTORY` —
  the payer's stated reason codes per payment line (`*_REMIT_CODE_ID` + shipped companion; master
  `CLARITY_RMC`); the "why insurance paid less" text patients actually ask about.
- Not-allowed-amount audit: `HSP_TX_NAA_DETAIL` (step-by-step calculation trace), `HSP_BKT_NAA_ADJ_HX`,
  `HSP_BKT_NAA_TX_TYP` — how contractual write-offs were computed.

**Claim composition (→ coverage-and-billing):** `HSP_CLAIM_PRINT` + `HSP_CLAIM_DETAIL1` (claim-print
record + mailing/amount block; sibling `HSP_CLAIM_DETAIL2` exists outside this residue), `HSP_CLP_REV_CODE`
(UB revenue-code lines), `CLP_OCCUR_DATA` + `HSP_ACCT_OCUR_HAR` (occurrence codes/dates),
`HSP_ACCT_CLAIM_HAR` (admission-type/source for claims), `CODE_INT_COMB_LN` (code-integration combined
service lines), `HSP_ACCT_SBO` (single-billing-office balances), `HSP_TX_DIAG` (transaction diagnoses →
`CLARITY_EDG`), `TX_NDC_INFORMATION` (NDC billed on a transaction), `CHARGE_CONTEXT_INFO` (charge-trigger
timestamp per order), `HSP_ACCT_ATND_PROV` (attending on the hospital account → providers-and-care-teams).

**Clinical strays:** `IMM_ADMIN_GROUPS_FT` — free-text vaccine-group names from *external* sources
(§44; reconciled outside immunizations, → immunizations guide); `ORD_MED_USER_ADMIN` — user-entered
administration instructions, free text per order (its own description admits the content duplicates the
admin-instruction columns, → medications-and-orders); `ALERT_ACTION_DB_VAL` / `ALERT_CRITERIA_DB_VAL` —
BPA debug detail rows, but only the §10 two-level keys ship (no debug-value column exists even in the
documented schema): the rows mark *that* debug detail existed without carrying it
(→ alerts-and-decision-support).

## Recipes

All tested against one specimen via `q.ts`. Everything is TEXT — `CAST` before comparing (§17).

```sql
-- 1) Anchor census: which spine does the long tail hang from? (first documented column per table)
SELECT c.column_name AS anchor, COUNT(*) AS n_tables
FROM _schema_column c
JOIN _tables t ON t.table_name = c.table_name          -- shipped tables only
JOIN (SELECT table_name, MIN(CAST(ordinal AS INT)) AS o
      FROM _schema_column GROUP BY table_name) f
  ON f.table_name = c.table_name AND CAST(c.ordinal AS INT) = f.o
WHERE CAST(t.n_rows AS INT) BETWEEN 1 AND 200          -- the long tail; tune the cutoff
GROUP BY 1 HAVING COUNT(*) >= 4 ORDER BY 2 DESC;

-- 2) Column-population census for ANY suspect table (two steps).
--    Step 1 generates one SELECT per column; paste the output back, drop the final UNION ALL, run.
SELECT 'SELECT ''' || name || ''' AS col, COUNT(NULLIF(TRIM("' || name || '"),'''')) AS n_filled '
       || 'FROM OPH_EXAM_DATA UNION ALL' AS gen
FROM pragma_table_info('OPH_EXAM_DATA');
--    Shell iff only key/date columns have n_filled > 0. (COUNT(NULLIF(TRIM(c),'')) counts
--    non-NULL, non-empty — robust whether blanks shipped as NULL or '' , §39.)

-- 3) Placeholder-shell candidates: row count == anchor count (here: encounters).
--    Candidates only — confirm each with recipe 2 before skipping (PAT_ENC_2…_8 match too, and
--    most carry payload; in one specimen this returns ~20 tables — this guide's 6 shells plus
--    other guides' encounter supplements and stubs, about half of which also census empty).
SELECT t.table_name, t.n_rows, t.n_columns, substr(s.description,1,60) AS d
FROM _tables t JOIN _schema_table s USING (table_name)
WHERE CAST(t.n_rows AS INT) = (SELECT CAST(n_rows AS INT) FROM _tables WHERE table_name='PAT_ENC')
  AND t.table_name <> 'PAT_ENC'
ORDER BY t.table_name;
--    Repeat with PATIENT / COVERAGE / ACCOUNT / HSP_ACCOUNT as the anchor for the other levels.

-- 4) Map every numbered supplement to its base (handles BASE_2 and BASE2 spellings).
SELECT s.table_name AS supplement, b.table_name AS base, s.n_rows AS supp_rows, b.n_rows AS base_rows
FROM _tables s JOIN _tables b
  ON length(b.table_name) < length(s.table_name)
 AND substr(s.table_name, 1, length(b.table_name)) = b.table_name
 AND TRIM(substr(s.table_name, length(b.table_name)+1), '_0123456789') = ''
ORDER BY s.table_name;
--    supp_rows = base_rows confirms 1:1 (§8). A "supplement" with no base row here is overflow
--    of a table the export didn't ship — treat like §7 schema-doc-only.

-- 5) Find the lookup slices: tiny column count, a NAME/CODE column, big or small alike.
SELECT t.table_name, t.n_rows, c.names
FROM _tables t
JOIN (SELECT table_name, group_concat(column_name) AS names, COUNT(*) AS nc
      FROM _schema_column GROUP BY table_name) c USING (table_name)
WHERE c.nc <= 3 AND (c.names LIKE '%NAME%' OR c.names LIKE '%CODE%')
ORDER BY CAST(t.n_rows AS INT) DESC;

-- 6) The LOINC exception in action: standard codes for this record's lab results.
SELECT l.LNC_CODE, l.LNC_LONG_NAME, COUNT(*) AS n_results
FROM ORDER_RESULTS r JOIN LNC_DB_MAIN l ON l.RECORD_ID = r.COMPON_LNC_ID
GROUP BY 1, 2 ORDER BY n_results DESC;

-- 7) Is PAT_UCN_CONVERT redundant in THIS export? (run before discarding it)
SELECT COUNT(*) AS stitched_notes,
       COUNT(DISTINCT u.PAT_ENC_CSN_ID) AS converted_contacts,
       SUM(CASE WHEN h.PAT_ENC_CSN_ID = u.PAT_ENC_CSN_ID THEN 1 ELSE 0 END) AS already_linked_in_hno
FROM PAT_UCN_CONVERT u LEFT JOIN HNO_INFO h ON h.NOTE_ID = u.LINKED_UCN_NOTES_ID;
--    stitched = already_linked → redundant here; any gap → this table is the only stitch.

-- 8) Dangling-pointer check for any pointer list (§15): example DOCS_FOR_HOSP_ACCT.
SELECT COUNT(*) AS rows_, SUM(CASE WHEN i.DOC_INFO_ID IS NULL THEN 1 ELSE 0 END) AS dangling
FROM DOCS_FOR_HOSP_ACCT d LEFT JOIN DOC_INFORMATION i ON i.DOC_INFO_ID = d.LINKED_DCS_ID;
```

## Gotchas & quirks (chased to *why*)

- **"Unmentioned" ≠ "uniform".** The residue spans seven different mechanisms; the only wrong move is one
  verdict for all 120. The shells alone prove it: identical shape (one row per encounter, NULL payload),
  yet each is a specialty module that is *the* data table for some other patient.
- **A supplement can outrank its base for one axis.** `ARPB_TRANSACTIONS2.OUTST_CLM_STAT_C_NAME` is
  populated on every transaction in one specimen; nothing on the base carries claim status. *Why:* the
  §8 split point is column-budget arithmetic, not importance. *Handle:* census the supplements of any
  base you rely on, even when the guide that owns the base never mentions them.
- **Three spellings, three tables: `CLAIM_INFO2` / `CLAIM_INFO3` / `CLAIM_INFO_3`.** All distinct, all
  1:1 with `CLAIM_INFO`. *Why:* Epic added continuation tables in different eras with different naming
  conventions. *Handle:* recipe 4 catches both spellings; never assume `_2` is the only suffix form.
- **The lookup slice is sometimes the only resolver.** The export drops some documented `_NAME`
  companions (§7) — `ORDER_RESULTS`'s LOINC companion here, `CLARITY_SER`'s pattern in referrals. *Why:*
  companions to masters that "may be hidden in a public view" are omitted. *Handle:* before declaring a
  master slice redundant, check the referencing table actually ships the companion column.
- **Pointer lists can outlive their targets.** `DOCS_FOR_HOSP_ACCT` points at a DCS document that isn't
  in the export (0/1 resolves). *Why:* §15/§32 — memberships persist; referenced bodies follow their own
  export scope. *Handle:* a dangling pointer is evidence the record exists outside scope, not corruption.
- **One pointer column may span two ID spaces.** `IP_ORD_UNACK_PLAC.ORD_UNACK_PLACE_ID` resolves partly
  in `ORDER_PROC`, partly in `ORDER_MED` (§41). *Handle:* LEFT JOIN both masters and keep a CASE column
  saying which one hit (recipe in family 4); never report "unresolved" from a single-master join.
- **Shells inflate naive census numbers.** Six tables × one row per encounter ≈ 1,000 of the specimen's
  2,236 residual rows say nothing at all. *Why:* §46 always-emit. *Handle:* count *filled payload
  columns*, not rows, when sizing what's left to understand.

## Tables appendix — one specimen's 120, by family

Rows in one specimen in parentheses. Nothing below is silently dropped from the verdicts above.

**1 · Lookup/master slices (23).** `LNC_DB_MAIN` (27, ★ LOINC codes), `CLARITY_RMC` (12, remit codes),
`RX_MED_TWO` (9, med display names), `CLARITY_LLB` (7, resulting labs), `CLARITY_LOC_2` (6, location
external names), `CLARITY_EAP_5` (64, EAP supplement, keys only), `CLARITY_MOD` (4, billing modifiers),
`CLARITY_SA` (4, service areas), `IP_FREQUENCY` (4, frequency records), `CLARITY_NRG` (3, geographic
areas), `CL_UB_REV_CODE` (2, UB revenue codes), `ORG_DETAILS` (2, ★ external orgs), `CLARITY_EEP` (1,
employer), `CLARITY_FSC` (1, fee schedule), `CLARITY_LOT` (1, ★ lot number), `MEDICATION_LOT` (1, same
lot, med flavor), `CLARITY_PRC` (1, visit type), `RX_NDC` (1, NDC code), `SMARTTEXT` (1, SmartText name),
`CHRG_TRIG_MTHD` (1, charge-trigger method), `CL_COL_AGNCY` (1, collection agency), `GEO_REGION` (1,
region), `V_BIL_ALL` (1, bill areas, §13 `_ALL` superset).

**2 · Numbered supplements (27).** Billing: `ARPB_TRANSACTIONS2` and `ARPB_TRANSACTIONS3` (151, ★ claim
status / timely filing), `HSP_TRANSACTIONS_2` and `HSP_TRANSACTIONS_3` (10), `HSP_ACCOUNT_2`,
`HSP_ACCOUNT_3`, `HSP_ACCOUNT_5` (4), `ACCOUNT_3` (2, empty), `ACCOUNT_CONTACT_2` (34, pay-plan source),
`CLAIM_INFO2` (2, workers'-comp), `CLAIM_INFO3` and `CLAIM_INFO_3` (2, empty), `SVC_LN_INFO_2` (33),
`SVC_LN_INFO_3` (33, empty), `CLM_VALUES_3` (20, service facility), `CLM_VALUES_4` and `CLM_VALUES_5`
(20, empty). Meds: `ORDER_MED_3`, `ORDER_MED_4`, `ORDER_MED_5` (20, ★ e-rx/UTC/confidentiality),
`ORDER_DISP_INFO_2` (20, empty), `ORD_DOSING_PARAMS_2` (62, BSA only). Coverage: `COVERAGE_2` (1, payor
name), `COVERAGE_3` and `COVERAGE_5` (1, empty). Other: `TIMEOUT_ANSWERS_2` (2, empty), `REFERRAL_3`
(10, empty; owned by referrals as the range "`REFERRAL_2`…`REFERRAL_6`").

**3 · Placeholder shells (17).** Per-encounter (169 each): `OPH_EXAM_DATA` (ophthalmology),
`HOMUNCULUS_PAT_DATA` (rheumatology), `DENT_ORTH_EXAM_NOTES` (dental), `AN_RELINK_INFO` (anesthesia),
`PAT_CR_TX_SINGLE` (e-visit card payment), `PAT_ENC_CALL_DATA` (clinical calls). Per-patient:
`TEETH_REVIEWED` (1), `CLAIMS_DERIVE_PAT_FLAGS` (1). Per-coverage: `CVG_AP_CLAIMS` (1),
`COVERAGE_MISC_COMMENTS` (1). Per-account/bucket/claim/remit/master: `HSP_BKT_ADDTL_REC` (19),
`CL_RMT_PRV_SUP_INF` (24), `HSP_ACCT_BILL_DRG` (4), `ACCOUNT_CONS_SP_SA_BILL` (2),
`CLP_NY_MEDICAID_INFO` (1),
`CLARITY_EPM_OT` (1), `CLARITY_EPP_OT` (1).

**4 · Crosswalks & pointer lists (15).** `PAT_UCN_CONVERT` (76, ★ migration stitch), `IP_ORD_UNACK_PLAC`
(37, ★ two ID spaces), `HSP_ACCT_ADJ_LIST` (5), `HSP_BKT_ADJ_TXS` (5), `HSP_ACCT_CHG_LIST` (3),
`HSP_CLP_CMS_TX_PIECES` (3, ★ claim-line↔tx), `HSP_CLP_UB_TX_PIECES` (3, ★), `CLP_NON_GRP_TX_IDS` (3),
`HSP_ACCT_PYMT_LIST` (2), `HSP_BKT_PAYMENT` (2), `HSP_CLP_DIAGNOSIS` (2, dx pointers), `HSP_TX_AUTH_INFO`
(3, coverage id echo), `HSP_BKT_NAA_HX_HTR` (1), `HSP_ACCT_EXTINJ_CD` (1, dx pointer),
`DOCS_FOR_HOSP_ACCT` (1, dangling).

**5 · Export machinery (2).** `V_EHI_ORD_LINKED_PATS` (42, = `ORDER_PROC` ids + `PAT_ID`),
`V_EHI_CLM_FILTER_STATIC` (2, claim RTF filter).

**6 · Config echoes (3).** `REPORT_SETTINGS` (19, HST settings; lookup behind communication concepts),
`REPORT_DETAILS` (1, report template behind a summary-of-care document), `ADV_ACTIVITY_DATA` (1,
Hyperspace activity).

**7 · Micro-domains (33).** Guarantor/coverage identity: `GUAR_ADDR_HX` (2, ★ prior addresses),
`ACCT_ADDR` (2), `ACCOUNT_CREATION` (2), `HSP_ACCT_EARSTADDR` (1), `CVG_SUBSCR_ADDR` (1),
`PAT_CVG_FILE_ORDER` (1). Collections/denials/remits: `HSP_ACCT_CL_AG_HIS` (2, ★ collections),
`HSP_BDC_DENIAL_DATA` (6, ★ denial lines), `HSP_BDC_PAYOR` (6), `HSP_BDC_RECV_TX` (1),
`HSP_PMT_LINE_REMIT` (5, ★ remit reasons), `HSP_PMT_REMIT_DETAIL` (5, ★), `HSP_TX_RMT_CD_LST` (4),
`SVC_PMT_HISTORY` (1), `HSP_TX_NAA_DETAIL` (26), `HSP_BKT_NAA_ADJ_HX` (9), `HSP_BKT_NAA_TX_TYP` (1).
Claim composition: `HSP_CLP_REV_CODE` (23), `HSP_ACCT_CLAIM_HAR` (4), `HSP_ACCT_SBO` (4),
`CODE_INT_COMB_LN` (3), `CLP_OCCUR_DATA` (2), `HSP_TX_DIAG` (2), `HSP_CLAIM_PRINT` (1),
`HSP_CLAIM_DETAIL1` (1), `HSP_ACCT_OCUR_HAR` (1), `HSP_ACCT_ATND_PROV` (1), `TX_NDC_INFORMATION` (1),
`CHARGE_CONTEXT_INFO` (1). Clinical strays: `ORD_MED_USER_ADMIN` (7), `ALERT_ACTION_DB_VAL` (6),
`ALERT_CRITERIA_DB_VAL` (4), `IMM_ADMIN_GROUPS_FT` (4).

## Open questions / specimen notes

- **Specimen shape:** 120 unmentioned populated tables, ~2,236 rows; largest member 169 rows (= the
  encounter count — i.e., the shells); ~70 anchored to revenue-cycle keys; ~1,000 of the rows are
  all-NULL shell rows. The mix will shift with the org's modules (a dental-heavy org's
  `DENT_ORTH_EXAM_NOTES` won't be a shell) but the seven mechanisms are genre-stable.
- **`PAT_UCN_CONVERT` was redundant here** (76/76 already linked in `HNO_INFO`); the claim that it is the
  *only* stitch for pre-migration contacts in merged instances follows from its purpose (UCN conversion)
  but is unobserved in this single-instance specimen — hence recipe 7 as a per-export check rather than
  a blanket verdict.
- **Shell vs. unused-module is undecidable from one specimen.** An all-NULL `OPH_EXAM_DATA` could mean
  "module always emits" (§46) or "exporter ships the table only when the module is licensed." Either
  way the census verdict stands; only the *reason* is ambiguous.
- **`ALERT_*_DB_VAL` ships keys without values.** The shipped — and even the *documented* — schema has
  no debug-value column at all, so whether the values were purged, never extracted, or live in an
  unshipped item is undecidable from this export; no schema doc states the policy.
- **Whether `V_EHI_*` filter views gain content in proxy/multi-patient exports** (becoming the scoping
  map) is inferred from their role, not observed.
- The inventory method itself has a known false positive: tables documented *as a range* in another guide
  (`REFERRAL_2`…`_6`) surface as "unmentioned" under literal-name matching. `REFERRAL_3` is the one such
  case here; if regenerating the residue, match ranges too.
