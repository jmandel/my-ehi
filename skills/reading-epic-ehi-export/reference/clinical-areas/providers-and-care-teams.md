# Providers & care teams — Epic EHI field guide

**Scope.** The reference masters that turn an opaque id into a human: providers (`CLARITY_SER`),
users/staff (`CLARITY_EMP`), departments (`CLARITY_DEP`), plus the patient-facing care-team structures
(PCP history, per-encounter treatment team). This is the domain you come back to whenever *any* table
anywhere shows a `*_PROV_ID`, `*_USER_ID`, or `*_DEPARTMENT_ID` and you need the name behind it.

**Where it sits.** Pure reference/lookup, joined *into* almost everything. A provider id resolves through
`CLARITY_SER`; a user (who created/edited a row) through `CLARITY_EMP`; a department through
`CLARITY_DEP`. Encounter-level pointers (`PAT_ENC.VISIT_PROV_ID`, `DEPARTMENT_ID`) and patient-level
pointers (`PATIENT.CUR_PCP_PROV_ID`) are the bridges from the chart to these masters.

## Tables

| table | role | rows in specimen | notes |
|---|---|---|---|
| `CLARITY_SER` | **Provider (SER) master** — resolves every provider id | 36 | Cols: `PROV_ID`, `PROV_NAME` ("LAST, FIRST MI"), `EXTERNAL_NAME` (display "First Last"). No specialty/credential column at all. Includes sentinel rows (see Gotchas). |
| `CLARITY_EMP` | **User/staff (EMP) master** — resolves `*_USER_ID` (who did an action) | 106 | Cols: `USER_ID`, `NAME`. `USER_ID` is an alphanumeric login (`RAMMELZL`, `ALG006`) plus a few numeric/system accounts. |
| `CLARITY_DEP` | **Department (DEP) master** | 16 | Cols: `DEPARTMENT_ID`, `DEPARTMENT_NAME` (internal), `EXTERNAL_NAME` (patient-facing). |
| `CLARITY_DEP_4` | DEP supplement (1:1 on `DEPARTMENT_ID`) | 16 | Holds `DEP_TYPE_C_NAME` (Internal/External), `MED_REC_STYLE_C_NAME`. Note the family skips `_2`/`_3` — only `_4` ships (see §8). |
| `PAT_PCP` | **PCP / care-team history over time** (patient-level) | 2 | Line-numbered. `PCP_PROV_ID`→SER, `PCP_TYPE_C_NAME`, `SPECIALTY_C_NAME`, `EFF_DATE`/`TERM_DATE`, plus `RELATIONSHIP_C_NAME` + `OTHER_*` free-text fields for non-Epic care-team members (present but unpopulated in one specimen; a `PCP_ADDRESS_ID` ships too). |
| `TREATMENT_TEAM` | **Per-encounter care-team members** | 11 | Keyed by CSN. `TR_TEAM_ID`→SER provider, `TR_TEAM_REL_C_NAME` (role: Consulting Physician, Nurse Practitioner…), `TR_TEAM_SPEC_C_NAME`, `TR_TEAM_BEG/END_DTTM` (M/D/YYYY **text**, and the table carries no `*_DATE_REAL` — order chronologically via the `PAT_ENC` join, see Recipe 3 and §17). One row per team member per contact. |
| `REFERRAL_SOURCE` | Referring-provider lookup (REF master) | 6 | `REFERRING_PROV_ID` + `REFERRING_PROV_NAM` (truncated name). In this specimen REF ids **equal** SER `PROV_ID`s. |
| `HSP_ATND_PROV` | Hospital attending-of-record over a stay | 2 | `PROV_ID`→SER, `ATTEND_FROM/TO_DATE`, keyed by CSN. |
| `HSP_ACCT_OTHR_PROV` | Other providers on a hospital account, role-typed | 17 | `OTHER_PROV_ID`→SER, `OTH_PRV_ROLE_C_NAME` (empty here). Keyed by `HSP_ACCOUNT_ID`. |
| `EPT_CARE_TEAMS` | **Longitudinal patient care-team** ("Provider Care Team" master) | **absent** | Documented but **not shipped** — the export materializes only populated tables (no 0-row tables exist in the DB), so a `SELECT` errors "no such table"; the shape here is from `_schema_column`. Keyed by CSN, points to a `CARE_TEAMS_ID` (a Care-Team **group** id — a *different* id space from SER, not a provider). Would hold named provider-care-teams when configured. |
| `CLARITY_LWS` / `CLARITY_LWS_3` | Workstation/kiosk masters | 1 / 1 | Not providers — resolves `*_LWS_ID` columns (where an action happened: `DOC_INFORMATION.SCAN_LWS_ID`, `PAT_ENC_7.MEDS_REQUEST_LWS_ID`; the schema doc's `*_LWS_ID_WORKSTATION_NAME` companions are dropped, §7). `CLARITY_LWS` carries only the id — the display name lives in `CLARITY_LWS_3.KIOSK_DISPLAY_NAME`, joined `WORK_STATION_2_ID = WORKSTATION_ID` (key-name drift, §8). Listed so you don't confuse them with people. |

## How they join

All joins below were run against this specimen and returned the stated rows.

- **Any provider id → name:** `<anything>.<X>_PROV_ID = CLARITY_SER.PROV_ID` → `PROV_NAME` / `EXTERNAL_NAME`.
  Verified `PATIENT.CUR_PCP_PROV_ID` (`144590`) → `RAMMELKAMP, ZOE L`; `PAT_ENC.VISIT_PROV_ID`,
  `PAT_PCP.PCP_PROV_ID`, `TREATMENT_TEAM.TR_TEAM_ID`, `HSP_ATND_PROV.PROV_ID`,
  `HSP_ACCT_OTHR_PROV.OTHER_PROV_ID`, `REFERRAL_SOURCE.REFERRING_PROV_ID` all resolve through the **same**
  `CLARITY_SER`. In one specimen ~50 populated tables carried a provider-id column (different
  prefixes — `BILLING_PROV_ID`, `AUTHRZING_PROV_ID`, `ORD_PROV_ID`, `ATTEND_PROV_ID`, `REFERRING_PROV_ID`,
  `PERFORMING_PROV_ID`, `SUP_PROV_ID`, …); **every `*_PROV_ID` resolved 100% to `CLARITY_SER.PROV_ID`**
  (master-file FK convention, §5) **except one trap**: `ORDER_PROC.DEPT_REF_PROV_ID` holds `CLARITY_DEP`
  department ids despite its `_PROV_ID` suffix (Epic's referred-to-department-*or*-provider field — a
  column-label-lie, §24; verify the target master before trusting the suffix). The column *prefix* tells
  you the provider's *role* in that row; the master is almost always the same. And don't inventory provider
  columns by substring-matching `PROV_ID`: the suffix convention has false positives —
  `PROV_IDENTIFIER` (claims/remit) is a transmitted external identifier (§27), not a SER key — and false
  negatives — `ADDITIONAL_EM_CODE.EM_CODE_BILPROV_ID` *is* a SER FK without the standard suffix.
- **Any user id → name:** `<anything>.<X>_USER_ID = CLARITY_EMP.USER_ID` → `NAME`. Verified
  `REFERRAL_HIST.CHANGE_USER_ID` (`BUDZBANL`, `JED402`, …) → staff names; `ORDER_MED.ORD_CREATR_USER_ID`
  (`RAMMELZL`, `MBS403`) → names. `*_USER_ID` = *who performed an action* (created/edited/signed);
  `*_PROV_ID` = *the clinical actor of record*. Different question, different master (§41). This join is
  the sturdier of the two: in one specimen all 155 `*_USER_ID` columns across populated tables resolved
  100% through `CLARITY_EMP`, no exceptions — unlike `*_PROV_ID` with its `DEPT_REF_PROV_ID` trap above.
- **Any department id → name:** `<anything>.<X>DEPARTMENT_ID = CLARITY_DEP.DEPARTMENT_ID` →
  `DEPARTMENT_NAME` / `EXTERNAL_NAME`. Verified `PAT_ENC.DEPARTMENT_ID` (`1700801002` →
  "MAC APL INTERNAL MEDICINE"). 29 populated tables carry a department FK under varied prefixes
  (`POSTING_DEPARTMENT_ID`, `PERFORMING_DEPT_ID`, `REFD_TO_DEPT_ID`, …); all resolve to `CLARITY_DEP`.
- **PCP, point-in-time vs current:** `PATIENT.CUR_PCP_PROV_ID` is the *current* PCP (single value).
  `PAT_PCP` is the *history* — line-numbered, `EFF_DATE`/`TERM_DATE`, the row with NULL `TERM_DATE` is
  current (see §36/effective-dating). Verified: line 1 DHILLON (termed 8/28/2022), line 2 RAMMELKAMP
  (no term) — and `CUR_PCP_PROV_ID` = the line-2 provider. They agree, but the base column won't show you
  the *prior* PCP; `PAT_PCP` does.
- **Care team for a visit:** `TREATMENT_TEAM.PAT_ENC_CSN_ID = PAT_ENC.PAT_ENC_CSN_ID`, then
  `TR_TEAM_ID → CLARITY_SER`. This is the per-contact member list (with role/specialty), distinct from the
  single `VISIT_PROV_ID` rendering provider on `PAT_ENC` (see §2 CSN, §9 LINE child rows).
- **Referring provider on a referral:** `REFERRAL.REFERRING_PROV_ID = REFERRAL_SOURCE.REFERRING_PROV_ID`
  → name. In this specimen those ids equal SER ids, so `CLARITY_SER` resolves them too; do not rely on that
  coincidence across orgs (see the referrals guide).

## Unstructured tie-back

Provider/user masters carry no free text themselves. They appear *inside* other domains' unstructured
material as the actor: a note's author resolves via `NOTE_ENC_INFO.AUTH_LNKED_PROV_ID → CLARITY_SER`; a
MyChart message's provider via `MYC_MESG.PROV_ID → CLARITY_SER` and its routing user via the `*_USER_ID`
columns → `CLARITY_EMP`; a referral note's author via `REFERRAL_NOTES.NOTE_USER_ID → CLARITY_EMP`. So when
you reassemble a note or message, you resolve *who wrote it* through these masters. The masters themselves
are not the unstructured corpus — they are the name dictionary the corpus points at.

## Gotchas & quirks (chased to *why*)

1. **Provider ids and user ids are two different ID spaces for the *same human*.** Aaron Gilmour is
   `CLARITY_SER.PROV_ID = 599471` *and* `CLARITY_EMP.USER_ID = ALG006` — same person, two ids, because Epic
   models a *provider of care* (SER, "Service/Resource") separately from a *system user* (EMP, the login
   that touched a record). **Mechanism:** a `*_PROV_ID` answers "who is the clinical actor of record"; a
   `*_USER_ID` answers "which login performed this keystroke." They are minted by different master files
   and **do not join to each other**. **Handling:** resolve `*_PROV_ID` through `CLARITY_SER`,
   `*_USER_ID` through `CLARITY_EMP` — never cross them. (This is §41 made concrete; tell SER ids from EMP
   ids by shape: SER `PROV_ID` is almost always **numeric** (35/36 here), EMP `USER_ID` is almost always
   an **alphanumeric login** (100/106 here).)

2. **SER provider `_PROV_NAME` companions are deliberately *dropped*, but EMP `_NAME` companions ship.**
   The schema doc promises a denormalized name next to every provider id (`VISIT_PROV_ID_PROV_NAME`,
   `CUR_PCP_PROV_ID_PROV_NAME`, …). **They are not in the data** — querying them errors "no such column"
   (verified missing on `PAT_ENC`, `PATIENT`, `REFERRAL`, `ORDER_PROC`). **Mechanism:** `CLARITY_SER` is
   flagged as possibly hidden in a public view, so the export omits the SER-resolved name projection and
   leaves only the bare `*_PROV_ID`. The *user* master has no such restriction, so EMP name companions
   **do** materialize and **are** populated — e.g. `ORDER_MED.ORD_CREATR_USER_ID_NAME` = "RAMMELKAMP, ZOE
   L" sits right beside `ORD_CREATR_USER_ID` = `RAMMELZL`; `REFERRAL_HIST.CHANGE_USER_ID_NAME` likewise.
   **Handling:** for providers, **always join `CLARITY_SER` yourself**; for users, you can usually read the
   inline `*_USER_ID_NAME` (but `CLARITY_EMP` is the fallback). This asymmetry refines patterns §6/§7 — the
   "inconsistently materialized" companions are *systematically* absent for SER and *present* for EMP.

3. **The master's own key column is renamed vs its schema doc.** `_schema_column` lists `CLARITY_SER`
   ordinal 1 as `PROV_ID_PROV_NAME`, but the real column is plain `PROV_ID`. The rename is specific to SER
   (`CLARITY_DEP`'s and `CLARITY_EMP`'s docs match their real columns) — consistent with Gotcha 2's
   hidden-view mechanism applying only to SER.
   **Mechanism:** the doc documents the master under its public-view (name) projection; the export ships
   the raw-key form. **Handling:** confirm with `PRAGMA table_info` (§7) — the real cols are
   `PROV_ID/PROV_NAME/EXTERNAL_NAME` (SER) and `DEPARTMENT_ID/DEPARTMENT_NAME/EXTERNAL_NAME` (DEP).

4. **Sentinel / placeholder "providers" and "departments" inflate the masters.** `CLARITY_SER` carries
   non-human routing rows: `199995` "PROVIDER, NOT IN SYSTEM", `8800099` "GENERIC EXTERNAL DATA PROVIDER",
   `E1011` "MYCHART, GENERIC PROVIDER", `3724611` "MAC LAB APL". `CLARITY_DEP` carries `1` "INITIAL DEPT"
   and `8` "GENERIC EXTERNAL DATA DEPARTMENT". **Mechanism:** Epic must attribute *every* row to *some*
   provider/department; when the real one is unknown, external (imported outside data), or system-
   generated, it points at a seeded sentinel. The `GENERIC EXTERNAL DATA *` pair specifically tags data
   **imported from outside the Epic instance** — when you see `8800099`/`8`, the encounter/result came from
   an outside source, not this org's clinicians. **Handling:** exclude/flag these when counting "real"
   providers or visits; treat `8800099`/`8` as an "external origin" marker (§44). In this specimen
   `GENERIC EXTERNAL DATA PROVIDER` is the visit provider on 5 encounters and `MAC LAB APL` on 6 (lab
   contacts) — both legitimately not a person.

5. **`199995` is the *one* id that collides across SER and EMP.** It exists as both
   `CLARITY_SER.PROV_ID` and `CLARITY_EMP.USER_ID`, both "PROVIDER, NOT IN SYSTEM." **Mechanism:** the
   "not in system" placeholder is seeded into *both* masters with the same number. **Handling:** don't take
   this single collision as evidence the id spaces are unified — it's the lone exception (every other id
   appears in only one master), and it's a sentinel, not a person.

6. **Provider credential/title is per-*encounter*, not a property of the provider.** `CLARITY_SER` has
   **no** credential, specialty, or title column. The title you see ("MD", "DO", "DNP", "OT", "ARRT")
   lives on `PAT_ENC.VISIT_PROV_TITLE_NAME`. The *same* provider shows different/blank titles across
   encounters — RAMMELKAMP appears as "MD" on 8 contacts and blank on 19. **Mechanism:** the title is the
   credential *as rendered for that contact*, captured on the encounter, not centralized on the SER record
   (which has no place for it in this export). Specialty is likewise scattered: `PAT_PCP.SPECIALTY_C_NAME`,
   `REFERRAL.PROV_SPEC_C_NAME`, `TREATMENT_TEAM.TR_TEAM_SPEC_C_NAME`. **Handling:** to label a provider's
   role/credential, pull it from the *context* row (encounter / PCP / treatment-team / referral), not from
   `CLARITY_SER`. There is no single authoritative specialty for a provider here.

7. **NULL provider *and* NULL department travel together on non-face-to-face contacts.** ~56% of
   `PAT_ENC` rows (95/169) have NULL `VISIT_PROV_ID` **and** NULL `DEPARTMENT_ID`. **Mechanism:** these are
   MyChart messages, telephone, and system/automated contacts (§43) — real CSNs with no rendering
   provider or department because nobody "saw" the patient in a place. **Handling:** don't read NULL as
   missing data or filter these as broken; they're a contact *type*. When you need a provider for them,
   look at `MYC_MESG.PROV_ID` / the message routing, not `PAT_ENC`.

8. **`EXTERNAL_NAME` (the patient-facing display column) goes *blank* on external-origin rows whose
   internal name is populated.** In `CLARITY_SER` the lone blank-`EXTERNAL_NAME` row is `3724611`
   "MAC LAB APL"; in `CLARITY_DEP` it is `8` "GENERIC EXTERNAL DATA DEPARTMENT" — exactly the external/lab
   rows from Gotcha 4, where `PROV_NAME`/`DEPARTMENT_NAME` carries the name but the patient-facing column is
   empty. (Most sentinels still *do* have an `EXTERNAL_NAME` — `199995`, `8800099`, `E1011` all populate
   it — so this is an external-origin quirk, not a sentinel-wide rule.) **Handling:** when you project a
   display name off `EXTERNAL_NAME` (as Recipe 4 does for department), wrap it
   `COALESCE(NULLIF(EXTERNAL_NAME,''), PROV_NAME)` / `COALESCE(NULLIF(EXTERNAL_NAME,''), DEPARTMENT_NAME)`
   or those external-origin contacts render nameless.

## Recipes

```sql
-- 1. Resolve ANY provider id to a name (drop the sentinels)
SELECT PROV_ID, PROV_NAME, EXTERNAL_NAME
FROM CLARITY_SER
WHERE PROV_ID NOT IN ('199995','8800099','E1011','3724611')   -- placeholders
ORDER BY PROV_NAME;

-- 2. PCP history: who was the PCP and when (current = NULL TERM_DATE)
SELECT pp.LINE, s.PROV_NAME, pp.SPECIALTY_C_NAME,
       pp.EFF_DATE, pp.TERM_DATE,
       CASE WHEN pp.TERM_DATE IS NULL THEN 'CURRENT' ELSE 'past' END AS state
FROM PAT_PCP pp
LEFT JOIN CLARITY_SER s ON s.PROV_ID = pp.PCP_PROV_ID
ORDER BY CAST(pp.LINE AS INT);

-- 3. Care-team members per encounter (role + specialty), newest first
-- TR_TEAM_BEG/END_DTTM are M/D/YYYY text — never ORDER BY them raw (§17);
-- TREATMENT_TEAM has no *_DATE_REAL, so sort via the encounter spine.
SELECT tt.CONTACT_DATE, s.PROV_NAME,
       tt.TR_TEAM_REL_C_NAME AS role, tt.TR_TEAM_SPEC_C_NAME AS specialty
FROM TREATMENT_TEAM tt
JOIN PAT_ENC e ON e.PAT_ENC_CSN_ID = tt.PAT_ENC_CSN_ID
LEFT JOIN CLARITY_SER s ON s.PROV_ID = tt.TR_TEAM_ID
ORDER BY CAST(e.PAT_ENC_DATE_REAL AS REAL) DESC;

-- 4. Rendering provider + department + title per visit (encounter spine)
SELECT e.PAT_ENC_CSN_ID, e.CONTACT_DATE,
       s.PROV_NAME AS visit_provider, e.VISIT_PROV_TITLE_NAME AS title,
       COALESCE(NULLIF(d.EXTERNAL_NAME,''), d.DEPARTMENT_NAME) AS department   -- EXTERNAL_NAME blank on external-origin depts (Gotcha 8)
FROM PAT_ENC e
LEFT JOIN CLARITY_SER s ON s.PROV_ID = e.VISIT_PROV_ID
LEFT JOIN CLARITY_DEP d ON d.DEPARTMENT_ID = e.DEPARTMENT_ID
WHERE e.VISIT_PROV_ID IS NOT NULL          -- skip message/phone/system contacts
ORDER BY CAST(e.PAT_ENC_DATE_REAL AS REAL);

-- 5. Resolve who *edited* a record (user master, not provider)
SELECT rh.CHANGE_USER_ID, COALESCE(rh.CHANGE_USER_ID_NAME, e.NAME) AS edited_by
FROM REFERRAL_HIST rh
LEFT JOIN CLARITY_EMP e ON e.USER_ID = rh.CHANGE_USER_ID
GROUP BY rh.CHANGE_USER_ID;

-- 6. Flag rows that came from OUTSIDE the Epic instance (external sentinels)
SELECT 'enc' AS src, count(*) FROM PAT_ENC WHERE VISIT_PROV_ID='8800099' OR DEPARTMENT_ID='8';
```

## Open questions / specimen notes

- **`CLARITY_SER` has no specialty/credential column in this export** (only `PROV_ID/PROV_NAME/
  EXTERNAL_NAME`). Whether that is genre-wide or a thin-specimen artifact is unconfirmed; a larger export
  may ship a SER supplement (`CLARITY_SER_2`) with specialty. Here, specialty/title is only per-context.
- **`EPT_CARE_TEAMS` (the longitudinal "Provider Care Team" table) is documented but not shipped** — the
  export materializes only populated tables, so it is physically absent and a `SELECT` errors "no such
  table" (its shape is recoverable only from `_schema_column`). Its `CARE_TEAMS_ID` is a
  care-team *group* id (a separate master), not a SER provider id — so when populated it would need its own
  resolution (`CARE_TEAMS_ID_RECORD_NAME` carries the team name inline). Per-encounter membership here is
  carried only by `TREATMENT_TEAM`.
- **REF ids == SER ids in this specimen.** `REFERRAL_SOURCE.REFERRING_PROV_ID` values match SER `PROV_ID`s
  exactly, so SER resolves them. The schema treats REF as a distinct master; do not assume the equality
  holds in another org's export.
- **`CLARITY_DEP_4` is the only DEP supplement present** (no `_2`/`_3`) and `DEP_TYPE_C_NAME` is "Internal"
  for all 16 rows here — so the Internal/External distinction is not exercised by this specimen even though
  the `GENERIC EXTERNAL DATA DEPARTMENT` sentinel exists. (Specimen-specific.)
- All counts above (36 providers, 106 users, 16 departments, 169 encounters, 95 NULL contacts) are
  **specimen** illustrations, not genre facts.
</content>
</invoke>
