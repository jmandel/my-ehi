# Demographics — Epic EHI field guide

**Scope.** Who the patient *is*: the `PATIENT` master record and its numbered supplements — name/aliases, sex/gender, birth, race/ethnicity, language, religion, contact info (address/phone/email — the PHI core), identifiers (PAT_ID vs MRN vs external IDs), living status, PCP and primary-location pointers, MyChart enrollment. Care-team/PCP *history*, providers, and referrals are covered in their own guide; this one stays on the person.

**Where it sits.** This is the root of the export. `PATIENT.PAT_ID` is the patient master-file (EPT) key that nearly every clinical table back-links to (§1). Demographics has no CSN of its own — it is the one-row-per-patient hub the encounter graph (CSN, §2) hangs off of.

## Tables

| table | role | rows in specimen | notes |
|---|---|---|---|
| `PATIENT` | spine: base demographic record | 1 | 85 cols. Name, address, phone, email, `BIRTH_DATE`, `SEX_C_NAME`, `SSN`, `PAT_MRN_ID`, `ETHNIC_GROUP/RELIGION/LANGUAGE _C_NAME`, `PAT_STATUS_C_NAME`, `DEATH_DATE`, `CUR_PCP_PROV_ID`, `CUR_PRIM_LOC_ID`. One row per patient. |
| `PATIENT_2` | supplement (1:1 on `PAT_ID`) | 1 | 55 cols. Birth city/state, citizenship, maiden name, comm method, employer address, advance-directive review, `MED_HX_NOTE_ID` (empty here). |
| `PATIENT_3` | supplement | 1 | 65 cols. Ambulatory status, pediatric birth metrics. Mostly empty for an adult. |
| `PATIENT_4` | supplement | 1 | 72 cols. **`GENDER_IDENTITY_C_NAME`, `SEX_ASGN_AT_BIRTH_C_NAME`, `PAT_LIVING_STAT_C_NAME`** (the authoritative alive/deceased — see gotchas), veteran status. |
| `PATIENT_5` | supplement | 1 | 47 cols. `BIRTH_COUNTY_C_NAME` and more sparse overflow. |
| `PATIENT_6` | supplement | 1 | 3 cols. `SEX_FOR_MELD_C_NAME` (clinical-scoring sex). |
| `PATIENT_RACE` | race, `LINE`-multiple | 1 | `(PAT_ID, LINE, PATIENT_RACE_C_NAME)`. Race is multi-valued → child rows, not a column (§7). |
| `PATIENT_ALIAS` | alternate names, `LINE`-multiple | 2 | `(PAT_ID, LINE, ALIAS)` — e.g. `MANDEL,JOSH` / `MANDEL,JOSHUA`. Display/search aliases, not legal names. |
| `IDENTITY_ID` | external IDs, `LINE`-multiple | 3 | `(PAT_ID, LINE, IDENTITY_ID, IDENTITY_TYPE_ID, ..._ID_TYPE_NAME)`. One row per external identifier (EPI/MRN/IHS). |
| `IDENTITY_ID_TYPE` | lookup for the above | 3 | `(ID_TYPE, ID_TYPE_NAME)`. Resolves the type code to a label. |
| `PAT_ADDRESS` | street address lines, `LINE`-multiple | 1 | `(PAT_ID, LINE, ADDRESS)`. Multi-line street; **PHI**. |
| `PAT_EMAILADDRESS` | emails, `LINE`-multiple | 2 | `(PAT_ID, LINE, EMAIL_ADDRESS)`. **PHI**. |
| `PAT_ADDR_CHNG_HX` | address history | 2 | Effective-dated prior addresses with `ADDR_CHNG_SOURCE_C_NAME`. Current row has NULL `EFF_END_DATE`. |
| `PAT_PRIM_LOC` | primary-location history | 1 | `(PAT_ID, LINE, LOC_ID, EFF_DATE, TERM_DATE)`. The over-time version of `PATIENT.CUR_PRIM_LOC_ID`. |
| `PAT_PCP` | PCP/care-team history | 2 | Effective-dated PCP eras. Detailed in the *providers* guide; the *current* PCP is also cached on `PATIENT.CUR_PCP_PROV_ID`. |
| `PATIENT_MYC` | MyChart enrollment status | 1 | `MYCHART_STATUS_C_NAME` (Activated), `MYPT_ID`, demographic self-verify date `DEM_VERIF_DT`. |
| `PATIENT_DOCS` | patient↔document links | 41 | `(PAT_ID, LINE, DOC_INFO_ID)`. Links scanned/registration docs (resolve in the imaging/media domain). |
| `PATIENT_MISC_COMMENTS` | free-text registration comments | 1 | Holds e.g. `MARITAL_STAT_C_CMT` (a *comment*, not the coded marital status). |
| `CLARITY_SER` | provider master (lookup) | 36 | `(PROV_ID, PROV_NAME, EXTERNAL_NAME)` — resolves `CUR_PCP_PROV_ID`. Only 3 cols in this export (no credential/specialty). |
| `CLARITY_LOC` | location master (lookup) | 6 | `(LOC_ID, LOC_NAME)` — resolves `CUR_PRIM_LOC_ID` / `PAT_PRIM_LOC.LOC_ID`. **Not** `CLARITY_DEP`. |

Supporting contact tables (a relationship/contact, not the patient): `PAT_RELATIONSHIP_LIST` (+`_HX`), `PAT_REL_PHONE_NUM`, `PAT_REL_EMAIL_ADDR`, `PAT_RELATIONSHIP_ADDR`, `PAT_REL_LANGUAGES`. See the *providers/care-team* guide.

**Expected but absent / empty in this specimen:** there is **no `MARITAL_STATUS_C_NAME`** anywhere in the real `PATIENT` family (the column the schema *doc* leads you to expect simply isn't materialized — see gotchas). `PATIENT_2.MED_HX_NOTE_ID` is empty. Pediatric columns in `PATIENT_3` are blank for an adult. There are **no `ZC_` lookup tables** at all (categories ship pre-resolved — §13).

## How they join

Every join below was run against this specimen.

- **`PATIENT` ⨝ `PATIENT_2..6` on `PAT_ID`** — 1:1, each supplement has exactly 1 row and 1 distinct `PAT_ID` (verified all six = 1 row). Left-join the stack to reconstruct the full demographic record (§6). Gender identity and sex-assigned-at-birth live in `PATIENT_4`, *not* the base.
- **`PATIENT.PAT_ID` = child `PAT_ID`** for every `PATIENT_RACE`, `PATIENT_ALIAS`, `IDENTITY_ID`, `PAT_ADDRESS`, `PAT_EMAILADDRESS`, `PAT_PCP`, `PAT_ADDR_CHNG_HX`, `PAT_PRIM_LOC`, `PATIENT_MYC`, `PATIENT_DOCS` (the universal demographic spoke, §1).
- **`IDENTITY_ID.IDENTITY_TYPE_ID` = `IDENTITY_ID_TYPE.ID_TYPE`** — resolves the external-ID type (EPI / MRN MAPL / IHS). The denormalized `IDENTITY_TYPE_ID_ID_TYPE_NAME` companion already carries the label, so the explicit join is optional (§4).
- **`PATIENT.PAT_MRN_ID` = the `IDENTITY_ID` row whose type is `MRN%`** — verified `APL######` on both sides. `PAT_MRN_ID` is the single display MRN; `IDENTITY_ID` is the full list of external identifiers (§1, §15).
- **`PATIENT.CUR_PCP_PROV_ID` = `CLARITY_SER.PROV_ID`** → `144590` → `RAMMELKAMP, ZOE L`. Same join resolves `PAT_PCP.PCP_PROV_ID`.
- **`PATIENT.CUR_PRIM_LOC_ID` = `CLARITY_LOC.LOC_ID`** → `1700801` → `CLN MAC ASSOCIATED PHYSICIANS LLP`. **This is a *location*, not a department** — joining to `CLARITY_DEP` returns a blank name (the IDs happen to be in different spaces). `PAT_PRIM_LOC.LOC_ID` uses the same `CLARITY_LOC` join.
- **`PATIENT_DOCS.DOC_INFO_ID` = `DOC_INFORMATION.DOC_INFO_ID`** — partial: 14 of 41 links resolve in `DOC_INFORMATION` here; the rest point at imaging/media records handled in that domain. Don't assume every patient-doc link resolves in one table.

## Unstructured tie-back

Demographics is almost entirely structured. The thin links out:

- `PATIENT_DOCS.DOC_INFO_ID` → `DOC_INFORMATION` / media — scanned registration & ROI documents (full join in the imaging/media guide).
- `PATIENT_2.MED_HX_NOTE_ID` → an HNO meds-history note (**empty in this specimen**, so unverified here; present as a hook).
- `PATIENT_MISC_COMMENTS` and the `*_CMT` columns hold short free text inline (no HNO indirection).
- The top-level visit-summary PDF and the ROI cover letter restate name/DOB/PCP/address in human-readable form — useful as a cross-check, but they are renderings of these same rows, not a separate source.

## Gotchas & quirks (chased to *why*)

1. **Alive/Deceased: use `PATIENT_4.PAT_LIVING_STAT_C_NAME`, not `PATIENT.PAT_STATUS_C_NAME`.** Both read `Alive` here, but Epic's *own* schema doc for `PAT_STATUS_C_NAME` warns: "many patient creation workflows do not populate this item, so many alive patients could have blank statuses… use `PATIENT_4.PAT_LIVING_STAT_C` instead." **Mechanism:** `PAT_STATUS` (EPT 102) is a manually-set legacy item; `PAT_LIVING_STAT` is *computed from the chart* and also returns `Not A Patient` for test/non-real records. **Handle:** treat `PAT_LIVING_STAT_C_NAME` as authoritative; corroborate death with a non-null `PATIENT.DEATH_DATE` (empty here).

2. **Marital status is documented but not exported here.** A top-down analyst expects `MARITAL_STATUS_C_NAME` on `PATIENT`; querying it errors `no such column`, and it is absent from all six `PATIENT*` tables. **Mechanism:** §5 (schema doc is aspirational) compounded by an org export choice — UnityPoint did not configure that item into the EHI extract. The only marital traces are `PATIENT_MISC_COMMENTS.MARITAL_STAT_C_CMT` (a free-text comment) and `V_EHI_COVERAGE_SUBS.SUBSCRIBER_MARITAL_STATUS_C_NAME` (the insurance *subscriber*, who may not be the patient). **Handle:** do not assume marital status is recoverable; if needed, read the comment field and caveat it heavily.

3. **Identity is layered: `PAT_ID` ≠ MRN ≠ external IDs.** `PAT_ID` (`Z#######`) is the internal Chronicles EPT key — opaque, the join axis, never shown to patients. `PAT_MRN_ID` (`APL######`) is the one display MRN. `IDENTITY_ID` is the *full* list of external identifiers, each typed (EPI enterprise id `E#######`, MRN-MAPL `APL######`, IHS `########`). **Mechanism:** a person can carry many facility MRNs across a health system while keeping one `PAT_ID` (§1); the MRN you display is just one row of `IDENTITY_ID`. **Handle:** join on `PAT_ID`; display `PAT_MRN_ID`; treat anything in `IDENTITY_ID` as an external/issuer-specific code, not a join key.

4. **Multiple-MRN-per-person & multiple-people:** in this specimen there is exactly one `PATIENT` row, but the *model* supports many. `IDENTITY_ID` already shows multiple identifiers for one person; a larger export (or a merged chart) can carry several MRN rows. **Mechanism:** Epic's enterprise master index lets one EPT (`PAT_ID`) accumulate facility MRNs; merges fold them under one `PAT_ID`. **Handle:** never count distinct MRNs as distinct patients — count distinct `PAT_ID`.

5. **The `PATIENT` SER/LOC foreign keys ship as *bare ids* — their `_NAME` companions are deliberately dropped.** The schema doc lists `CUR_PCP_PROV_ID_PROV_NAME` and `CUR_PRIM_LOC_ID_LOC_NAME`; the real table ships only `CUR_PCP_PROV_ID` and `CUR_PRIM_LOC_ID`. **Mechanism:** §4/§5 — provider/location masters "may be hidden in a public view," so Epic omits the resolved-name companion for SER/LOC foreign keys, leaving the raw id. **Handle:** join `CUR_PCP_PROV_ID`→`CLARITY_SER` and `CUR_PRIM_LOC_ID`→`CLARITY_LOC` yourself; querying the documented `_NAME` column errors.

6. **Sex/gender are spread across three tables and three columns.** `PATIENT.SEX_C_NAME` (legal/administrative sex), `PATIENT_4.SEX_ASGN_AT_BIRTH_C_NAME` and `PATIENT_4.GENDER_IDENTITY_C_NAME`, and `PATIENT_6.SEX_FOR_MELD_C_NAME` (a clinical-scoring sex) are *distinct concepts*, not duplicates. All read `Male` here, but they can diverge. **Mechanism:** Epic models legal sex, SOGI (sexual-orientation/gender-identity), and clinical-calculation sex as separate items because they serve different downstream uses. **Handle:** pick the column that matches your purpose; don't collapse them, and pull all from the supplement stack.

7. **Race is a child list; ethnicity is a single column.** `PATIENT_RACE` is `LINE`-multiple (a patient can have several race rows, §7), while `ETHNIC_GROUP_C_NAME` is a lone column on `PATIENT`. **Mechanism:** US-standard demographics treat race as multi-select and Hispanic/Latino ethnicity as a separate single axis. **Handle:** aggregate `PATIENT_RACE` rows; read ethnicity from the base table.

8. **Categories are pre-resolved labels with no codes recoverable.** Zero `ZC_` tables and zero bare `_C` columns exist; everything is `_C_NAME` inline (§13). **Mechanism:** this org's export emits the human label and drops the integer code + lookup table. **Handle:** read the `_C_NAME` string directly; the underlying numeric category code is *not* available here.

## Recipes

```sql
-- 1. The full demographic snapshot (one row), assembled from the supplement stack.
--    PHI columns (name/SSN/address/phone/email) omitted on purpose — add only if you need them.
SELECT p.PAT_ID, p.PAT_MRN_ID, p.BIRTH_DATE, p.SEX_C_NAME,
       p4.GENDER_IDENTITY_C_NAME, p4.SEX_ASGN_AT_BIRTH_C_NAME,
       p.ETHNIC_GROUP_C_NAME, p.LANGUAGE_C_NAME, p.RELIGION_C_NAME,
       p4.PAT_LIVING_STAT_C_NAME AS living_status, p.DEATH_DATE
FROM PATIENT p
LEFT JOIN PATIENT_4 p4 USING (PAT_ID);

-- 2. Race (multi-valued).
SELECT PAT_ID, LINE, PATIENT_RACE_C_NAME FROM PATIENT_RACE ORDER BY LINE;

-- 3. All external identifiers with their type label.
SELECT i.LINE, i.IDENTITY_ID, i.IDENTITY_TYPE_ID_ID_TYPE_NAME AS id_type
FROM IDENTITY_ID i ORDER BY i.LINE;

-- 4. Current PCP and primary location, resolved to names (do the join yourself — no _NAME companion).
SELECT s.PROV_NAME AS current_pcp, l.LOC_NAME AS primary_location
FROM PATIENT p
LEFT JOIN CLARITY_SER s ON s.PROV_ID = p.CUR_PCP_PROV_ID
LEFT JOIN CLARITY_LOC l ON l.LOC_ID  = p.CUR_PRIM_LOC_ID;

-- 5. Current vs prior address (history), newest = NULL EFF_END_DATE.
SELECT LINE, CITY_HX, ZIP_HX, ADDR_CHNG_SOURCE_C_NAME, EFF_START_DATE, EFF_END_DATE
FROM PAT_ADDR_CHNG_HX ORDER BY LINE;

-- 6. MyChart enrollment + when the patient last self-verified demographics.
SELECT MYCHART_STATUS_C_NAME, MYPT_ID, DEM_VERIF_DT FROM PATIENT_MYC;
```

## Open questions / specimen notes

- **Specimen identity (no direct identifiers):** one patient, one `PAT_ID`, male, English-speaking, White, Not Hispanic or Latino, religion None, `Alive`, no death date; MyChart `Activated`, demographics self-verified late 2025. Current PCP and primary location resolve cleanly via the joins above. SSN, full street address, phones, and emails are present **in clear text** — never emit these.
- `PATIENT_DOCS` carries 41 document links but only 14 resolve in `DOC_INFORMATION`; the remainder belong to the imaging/media domain — confirm the full resolution there before reporting a document count.
- `PATIENT_2.MED_HX_NOTE_ID` is empty here, so the patient→meds-history-note link is documented but unverified against real data in this specimen.
- `CLARITY_SER` ships only 3 columns (no credential/specialty/type) — provider attributes are carried per-context elsewhere, not centrally. Whether that minimalism is genre-wide or a small-specimen artifact is open (see the providers guide).
- The `IHS`-typed identifier (`########`, type code 14) has an unclear issuer in a UnityPoint (Wisconsin) setting; origin unconfirmed and likely org-specific.
