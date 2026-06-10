# Allergies — Epic EHI field guide

**Scope.** Patient allergy/intolerance list: the coded allergen, type, severity, reaction(s), noted/entry
dates and entering clinician, plus the *governance* layer Epic wraps around allergies — the "No Known
Allergies" flag, per-encounter allergen-review responses (confirm/reject), and the chronological
review-attestation audit.

**Where it sits.** Allergies are **LPL (Problem List master file) records**, not EPT records. The patient
link is indirect: `PATIENT.PAT_ID → PAT_ALLERGIES.PAT_ID → PAT_ALLERGIES.ALLERGY_RECORD_ID → ALLERGY.ALLERGY_ID`.
Recent allergies and every review/audit row also carry an encounter `PAT_ENC_CSN_ID` (see §2). The allergen
itself is a master-file (`CL_ELG` / agent "ELG") record shared across the org.

## Tables

| table | role | rows in specimen | notes |
|---|---|---|---|
| `ALLERGY` | **Spine.** One row per active allergy (PK `ALLERGY_ID`). Carries allergen, type, severity, dates, entering user, certainty/source. | 4 | `ALLERGY_ID` is an LPL id and equals the `PROBLEM_LIST_ALL.PROBLEM_LIST_ID` for that allergy. Only *non-deleted* allergies ship here (see Gotchas). |
| `PAT_ALLERGIES` | **EPT→LPL bridge.** `(PAT_ID, LINE, ALLERGY_RECORD_ID)`. The canonical patient→allergy link — and the only one that retains pointers to deleted allergies. | 5 | More rows than `ALLERGY` — holds deleted/superseded allergy ids too (orphan, see Gotchas). |
| `ALLERGY_REACTIONS` | Reaction values per allergy, `(ALLERGY_ID, LINE, REACTION_C_NAME)`. | 4 | One reaction per allergy here; can be multiple (`LINE` 1..N). The **coded** reaction; free-text reaction comment lives in `ALLERGY.REACTION`. |
| `CL_ELG` | **Allergen master file** (agent/ELG): `(ALLERGEN_ID, ALLERGEN_NAME)`. | 5 | Org-wide allergen dictionary. Holds candidate allergens that were *offered but rejected* during review (e.g. PEANUT OIL here), so it is a superset of the patient's allergens. |
| `ALLERGY_FLAG` | "No Known [Drug] Allergies" checkbox toggle history, `(PAT_ID, LINE, ALRGY_FLAG_YN, …UPD_DTTM)`. | 2 | Append-only toggle log, not a single boolean — read all `LINE`s in time order (see Gotchas). |
| `PAT_REVIEW_ALLERGI` | **Encounter allergen-review responses** from Welcome Kiosk / MyChart: `(PAT_ENC_CSN_ID, LINE, PAT_REVIEW_ELG_ID, PAT_REVIEW_ELG_R_YN, PAT_REVIEW_EXTERNAL)`. | 13 | Per-allergen confirm (`Y`) / reject (`N`) responses at a review; free-text adds via `PAT_REVIEW_EXTERNAL`. This is where allergies are *born and rejected*. |
| `PATIENT_ALG_UPD_HX` | **Allergy-list review audit trail**: one row per review/update event `(PAT_ID, LINE, …USER, …DTTM, ALRG_HX_REV_STAT_C_NAME, ALRG_HX_REV_EPT_CSN)`. | 14 | Chronological "who attested the list and when," each tied to a source CSN. The reviewed *list*, not individual allergens. |
| `PAT_REVIEW_DATA` | **Per-encounter kiosk/MyChart review *summary***: `PAT_REVIEW_ELG_C_YN` = the "do you have any additional allergies?" response, `PAT_ALG_RVW_INFO_C_NAME` = how the allergy review concluded — beside med (`ORD`) and problem (`LPL`) sibling columns. | 169 | One row per encounter contact; joins `PAT_ENC_CSN_ID = PAT_ENC.PAT_ENC_CSN_ID`. The allergy columns are populated only on contacts where a review happened — the per-allergen *detail* for those CSNs is `PAT_REVIEW_ALLERGI`. |

**Expected but EMPTY / absent in this specimen** (still standard Epic allergy tables to look for):
- **No `ZC_ALLERGY_REACTION` / `ZC_ALLERGY_SEVERITY` / `ZC_*` lookups at all** — this export ships **zero**
  `ZC_` tables; every category is pre-resolved to `_C_NAME` inline (genre variation, see general-patterns §23).
- **No `ALLERGY_HX` / `ALLERGY_*` version table.** There is no row-version (audit) history of an individual
  allergy record here; the closest things are `PATIENT_ALG_UPD_HX` (list-level attestation audit) and the
  `PAT_REVIEW_ALLERGI` review log. Deleted-allergy *detail* is not recoverable (orphan, see Gotchas).
- `ALLERGY.REACTION` (free-text reaction comment), `ALLERGY_CERTAINTY_C_NAME`, `ALLERGY_SOURCE_C_NAME`,
  `ALRGY_DLET_RSN_C_NAME`, `ALRGY_DLT_CMT`, `CONTRA_EXP_DT` — all **NULL** in this specimen (the schema
  documents them; this org/patient just didn't populate them).
- **Other allergy surfaces the schema documents but this specimen doesn't ship:** `ALT_ALLERGY_REACT`
  (reaction snapshot captured when a drug-allergy *alert* fires, keyed `ALT_ID`/`ALT_CSN_ID`), and the
  surgical-case snapshots — `OR_CASE`/`OR_LOG` allergy flags (`LATEX_ALLERGIC_YN`, `PAT_ALLERGIES_YN`) and
  `OR_CASE_ALLRGY_TXT` (free-text allergy-list snapshot per case). `TIMEOUT_ANSWERS` *does* ship here but
  its `ALLERGIES_REVW_C_NAME` is NULL. Look for these in surgical/alert-heavy exports.
- **Decoy:** `ORDER_MED.EXT_ELG_SOURCE_ID`/`EXT_ELG_MEMBER_ID` — "ELG" there means external pharmacy-benefit
  *eligibility*, not the ELG allergen master. A `LIKE '%ELG%'` column sweep will surface them; skip them.

## How they join

All verified against rows in this specimen.

- **Patient → allergies (the canonical path):** `PAT_ALLERGIES.PAT_ID = PATIENT.PAT_ID` and
  `PAT_ALLERGIES.ALLERGY_RECORD_ID = ALLERGY.ALLERGY_ID`. `ALLERGY` has **no `PAT_ID` column**, so you need a
  bridge. Verified: 4 of 5 `PAT_ALLERGIES` rows resolve to `ALLERGY`; LINE 1
  (`30689231`) is an orphan. (`PROBLEM_LIST_ALL` with `PAT_ID` + `RECORD_TYPE_C_NAME = 'Allergy'` — recipe 6 —
  reaches the same *surviving* allergy ids, but not the orphaned deleted-allergy stub.)
- **Allergy → reactions:** `ALLERGY_REACTIONS.ALLERGY_ID = ALLERGY.ALLERGY_ID`, ordered by `LINE`
  (§9 LINE child rows). Coded reaction is `REACTION_C_NAME` (all "Hives" here).
- **Allergy → allergen master:** `ALLERGY.ALLERGEN_ID = CL_ELG.ALLERGEN_ID`. Verified: all 4 resolve. But
  the name is **already denormalized** onto the row as `ALLERGY.ALLERGEN_ID_ALLERGEN_NAME` (§6), so you
  rarely need this join for display — use `CL_ELG` only to enumerate candidate allergens (e.g. PEANUT OIL).
- **Allergy → LPL master file:** `ALLERGY.ALLERGY_ID = PROBLEM_LIST_ALL.PROBLEM_LIST_ID`. Verified: the 4
  allergy ids are exactly the 4 `PROBLEM_LIST_ALL` rows with `RECORD_TYPE_C_NAME = 'Allergy'`. This is the
  shared-master-file mechanism (see Gotchas).
- **Allergy → encounter (recent only):** `ALLERGY.ALLERGY_PAT_CSN = PAT_ENC.PAT_ENC_CSN_ID` (§2 CSN, renamed
  per §4). Verified:
  only the newest allergy (`58599837`, noted 7/14/2020) carries a CSN; the three 2018 allergies have it NULL.
- **Review responses → encounter:** `PAT_REVIEW_ALLERGI.PAT_ENC_CSN_ID = PAT_ENC.PAT_ENC_CSN_ID`. Verified:
  all 3 review encounters resolve (`PAT_REVIEW_ALLERGI.CONTACT_DATE` matches `PAT_ENC.CONTACT_DATE`).
- **Review responses → allergen:** `PAT_REVIEW_ALLERGI.PAT_REVIEW_ELG_ID = CL_ELG.ALLERGEN_ID` (name also
  denormalized as `PAT_REVIEW_ELG_ID_ALLERGEN_NAME`). Verified all 5 distinct ids resolve, including the
  rejected PEANUT OIL.
- **Review-audit → encounter:** `PATIENT_ALG_UPD_HX.ALRG_HX_REV_EPT_CSN = PAT_ENC.PAT_ENC_CSN_ID`. Verified:
  all 9 distinct CSNs resolve to encounters.
- **Current review state lives on the patient record**, denormalized onto the PATIENT supplement stack
  (§8 supplements, §35 current-state collapse): `PATIENT_2.ALRGY_REV_STAT_C_NAME`/`ALRGY_UPD_INST`,
  `PATIENT_3.ALRG_LAST_UPDA_DTTM`, `PATIENT_4.ALRGY_REV_EPT_CSN`. Verified: `PATIENT_4.ALRGY_REV_EPT_CSN`
  equals the newest `PATIENT_ALG_UPD_HX` line's `ALRG_HX_REV_EPT_CSN`. Read the PATIENT_* columns for "now,"
  the `_HX` for the trail.

## Unstructured tie-back

Largely **n/a** — allergies are self-contained structured rows; no `Rich Text/*.RTF` or `Media/*` files
reference them in this specimen. The human-entered text that exists is held **inline** in columns, not in a
separate note:
- `PAT_REVIEW_ALLERGI.PAT_REVIEW_EXTERNAL` — free-text allergen a patient typed at the kiosk/MyChart when
  no coded allergen fit (here: "Peanut (diagnostic)", the seed of allergy `58599837`).
- `ALLERGY.REACTION` — free-text reaction comment (the *coded* reactions are in `ALLERGY_REACTIONS`); NULL here.
- `ALLERGY.ALRGY_DLT_CMT` — free-text delete comment when an allergy is removed; NULL here.

The tie to the rest of the chart is the **encounter CSN**: every review/audit row, and recent allergies,
carry a `PAT_ENC_CSN_ID` you can join to `PAT_ENC` and onward to that visit's notes/orders.

## Gotchas & quirks (chased to *why*)

1. **`SEVERITY_C_NAME` is NOT the severity — it's the allergy *type*.** Every allergy shows
   `SEVERITY_C_NAME = 'Allergy'`, which looks like a severity but reads as nonsense. *Why:* the schema doc is
   explicit — `SEVERITY_C_NAME` is "the allergy **type** category … the field called *TYPE* in the Allergy
   module" (systemic/topical/intolerance vs allergy). The **real severity** is a *different* column,
   `ALLERGY_SEVERITY_C_NAME` (= "High" here). The two columns sit adjacent with deceptively swapped meaning.
   *Handle:* report severity from `ALLERGY_SEVERITY_C_NAME`; treat `SEVERITY_C_NAME` as the allergy/intolerance
   *type*. Classic mislabel — confirm by reading the schema description, not the column name.

2. **Reaction is coded in `_C_NAME` but the schema tells you to "join the ZC table" that doesn't exist.**
   `ALLERGY_REACTIONS.REACTION_C_NAME` doc says "the integer category value … link to the associated ZC
   lookup table to display names." *Why:* this export pre-resolves all categories to `_C_NAME` labels and
   ships **no `ZC_` tables at all** (general-patterns §23 — the big genre variation). *Handle:* read the label
   straight off `REACTION_C_NAME`; do not look for a `ZC_ALLERGY_REACTION`. The underlying integer code is
   *not recoverable* from this export.

3. **`PAT_ALLERGIES` has more rows than `ALLERGY` — the extra is a hard-deleted allergy.** Here LINE 1
   (`ALLERGY_RECORD_ID = 30689231`) has no matching `ALLERGY` row and no `PROBLEM_LIST_ALL` row either.
   *Why:* `ALLERGY` ships only *current/active* allergies (`ALRGY_STATUS_C_NAME` is "Active" for all 4); when
   an allergy is deleted/superseded, the EPT→LPL *pointer* in `PAT_ALLERGIES` persists but the LPL detail
   record is dropped from the export — Chronicles' usual soft-delete (general-patterns §32) but with the
   *detail* suppressed, leaving only the stub. *Handle:* always `LEFT JOIN PAT_ALLERGIES → ALLERGY` and expect
   orphans; an unresolved `ALLERGY_RECORD_ID` means a removed allergy whose specifics aren't in this export.

4. **`ALLERGY_FLAG` has a "Y" row even though the patient has 4 allergies.** Two rows, both at the same
   instant (8/9/2018 2:44 PM): LINE 1 `ALRGY_FLAG_YN = Y`, LINE 2 `= N`. *Why:* this is the **toggle history**
   of the "No Known [Drug] Allergies" checkbox, append-only — it captured the box being checked then
   unchecked as the first real allergies were entered. It is not a current-state boolean. *Handle:* take the
   **last `LINE`** as the current NKA state (`N` = the patient *does* have known allergies); never read LINE 1
   alone.

5. **Allergies are LPL records sharing one master file with problems and immunizations.** `ALLERGY_ID` is an
   LPL (Problem-List) id; the same id appears in `PROBLEM_LIST_ALL` with `RECORD_TYPE_C_NAME = 'Allergy'`,
   right alongside `'Problem List'`, `'Immunization'`, and `'System'` rows. *Why:* in Chronicles the **LPL**
   master file backs the problem list *and* allergies *and* the clinical immunization ledger (`IMMUNE_ID`s
   also appear in `PROBLEM_LIST_ALL` as `'Immunization'`). `PAT_ALLERGIES`' own schema doc says it "provides a
   link from the Patient (EPT) based tables to the Problem List (LPL) based tables." *Handle:* don't be
   surprised that `PROBLEM_LIST_ALL` (56 rows here) dwarfs the 5-row problem list — it's the union of three
   domains. Filter by `RECORD_TYPE_C_NAME` to get just allergies.

6. **The genesis of an allergy lives in the review log, not in `ALLERGY`.** The newest allergy "PEANUT
   (DIAGNOSTIC)" was *created* at the 7/14/2020 review: in `PAT_REVIEW_ALLERGI` (CSN 829213099) the coded
   PEANUT OIL (`5064`) got `PAT_REVIEW_ELG_R_YN = N` (rejected) and a separate `LINE` with **no** allergen id
   but `PAT_REVIEW_EXTERNAL = 'Peanut (diagnostic)'` and `R_YN = Y` (free-text add). That free-text add
   becomes `ALLERGY 58599837` / `CL_ELG 49007`. *Why:* MyChart/kiosk allergen review lets a patient reject a
   suggested coded allergen and type a free-text one; the kiosk row is the provenance, the `ALLERGY` row is
   the result. *Handle:* to explain *why* an allergen is/ isn't on the list, read `PAT_REVIEW_ALLERGI`
   (per-allergen Y/N + free text) and `PATIENT_ALG_UPD_HX` (who attested, when) — not `ALLERGY` alone.

7. **`PATIENT_ALG_UPD_HX.ALRG_UPDT_TIME` shows date `1/1/1900`.** *Why:* it's a **time-only** column on
   Epic's time epoch (1/1/1900) — only the clock part is meaningful (general-patterns §20). The real instant
   is the companion `ALRG_UPDT_DTTM` (proper date+time). *Handle:* use `ALRG_UPDT_DTTM`; ignore the 1900 date.

8. **Two date columns on `ALLERGY` mean different things.** `DATE_NOTED` is the **effective** date the
   patient made the allergy known (renders at 12:00 AM — calendar, §19); `ALRGY_ENTERED_DTTM` is the **instant**
   it was keyed in (real wall-clock), and per its doc reflects the *most recent edit*, not first entry.
   *Handle:* use `DATE_NOTED` for clinical onset/"noted," `ALRGY_ENTERED_DTTM` for the audit instant.
   `ALLERGY` also carries `ALLERGY_NOTED_DATE_ACCURACY_C_NAME`, a precision qualifier for `DATE_NOTED`
   (the accuracy-flagged-date pattern, general-patterns §21): here "Exact Date" on the 7/14/2020 allergy and
   **blank** on the three 2018 ones. A blank means precision was *never recorded*, so render `DATE_NOTED`
   with that caveat rather than as a guaranteed-exact onset.

## Recipes

```sql
-- 1) Current allergy list with allergen, type, severity, reaction(s), who/when noted.
SELECT a.ALLERGY_ID,
       a.ALLERGEN_ID_ALLERGEN_NAME              AS allergen,
       a.SEVERITY_C_NAME                        AS type,        -- NB: "type", not severity
       a.ALLERGY_SEVERITY_C_NAME                AS severity,
       group_concat(r.REACTION_C_NAME, '; ')    AS reactions,
       a.DATE_NOTED, a.ENTRY_USER_ID_NAME       AS noted_by
FROM PAT_ALLERGIES pa
JOIN ALLERGY a            ON a.ALLERGY_ID = pa.ALLERGY_RECORD_ID   -- inner join drops deleted orphans
LEFT JOIN ALLERGY_REACTIONS r ON r.ALLERGY_ID = a.ALLERGY_ID
WHERE pa.PAT_ID = (SELECT PAT_ID FROM PATIENT LIMIT 1)
GROUP BY a.ALLERGY_ID
-- DATE_NOTED is 'M/D/YYYY 12:00:00 AM' *display text* (general-patterns §17, §19 — calendar date
-- rendered at midnight; the parse below ignores the time part), so a raw ORDER BY sorts
-- lexically (7/14/2020 before 8/9/2018). There is no *_DATE_REAL here; parse to YYYYMMDD to
-- sort chronologically (ALRGY_ENTERED_DTTM is text too — don't sort on it either).
ORDER BY printf('%s-%02d-%02d',
    substr(a.DATE_NOTED, instr(a.DATE_NOTED,'/')+instr(substr(a.DATE_NOTED, instr(a.DATE_NOTED,'/')+1),'/')+1, 4),         -- YYYY
    CAST(substr(a.DATE_NOTED, 1, instr(a.DATE_NOTED,'/')-1) AS INT),                                                        -- M
    CAST(substr(substr(a.DATE_NOTED, instr(a.DATE_NOTED,'/')+1), 1, instr(substr(a.DATE_NOTED, instr(a.DATE_NOTED,'/')+1),'/')-1) AS INT));  -- D

-- 2) Spot deleted/superseded allergies (EPT pointer with no LPL detail).
SELECT pa.LINE, pa.ALLERGY_RECORD_ID
FROM PAT_ALLERGIES pa
LEFT JOIN ALLERGY a ON a.ALLERGY_ID = pa.ALLERGY_RECORD_ID
WHERE a.ALLERGY_ID IS NULL;            -- orphan = removed allergy, detail not exported

-- 3) Current "No Known Allergies" state (last toggle wins).
SELECT ALRGY_FLAG_YN, ALRGY_FLG_UPD_BY_ID_NAME, ALRGY_FLAG_UPD_DTTM
FROM ALLERGY_FLAG
WHERE PAT_ID = (SELECT PAT_ID FROM PATIENT LIMIT 1)
ORDER BY CAST(LINE AS INT) DESC LIMIT 1;

-- 4) Per-encounter allergen review responses (confirm/reject + free-text adds), with the visit.
SELECT pr.PAT_ENC_CSN_ID, pr.CONTACT_DATE,
       coalesce(pr.PAT_REVIEW_ELG_ID_ALLERGEN_NAME, pr.PAT_REVIEW_EXTERNAL) AS allergen,
       pr.PAT_REVIEW_ELG_R_YN AS response   -- Y=confirm, N=reject, NULL=shown without a recorded
                                            -- response (§39: blank TSV cells load as NULL, not '')
FROM PAT_REVIEW_ALLERGI pr
ORDER BY pr.PAT_ENC_CSN_ID, CAST(pr.LINE AS INT);

-- 5) Allergy-list attestation audit (who reviewed the list, when, at which encounter).
SELECT LINE, ALRG_UPDT_DTTM, ALRG_UPDT_USER_ID_NAME AS reviewer,
       ALRG_HX_REV_STAT_C_NAME AS status, ALRG_HX_REV_EPT_CSN AS csn
FROM PATIENT_ALG_UPD_HX
ORDER BY CAST(LINE AS INT);

-- 6) Allergies as LPL records, shown next to problems & immunizations they share the master file with.
SELECT RECORD_TYPE_C_NAME, COUNT(*) AS n
FROM PROBLEM_LIST_ALL
WHERE PAT_ID = (SELECT PAT_ID FROM PATIENT LIMIT 1)
GROUP BY RECORD_TYPE_C_NAME;           -- 'Allergy' rows here == ALLERGY.ALLERGY_ID set
```

## Open questions / specimen notes

- **Specimen:** 4 active allergies (Tree Nut, Sulfa antibiotics, Penicillins entered 8/9/2018 by Tracy
  Ireland; Peanut diagnostic added 7/14/2020 by Mary Picone), **all** type "Allergy", severity "High",
  reaction "Hives" — uniformity is this patient, not the genre. 14 review-attestation events
  2018→2025. `ALLERGY_CERTAINTY_C_NAME`, `ALLERGY_SOURCE_C_NAME`, free-text `REACTION`, and all delete
  columns are NULL here, so their value domains couldn't be observed from data.
- The orphan `PAT_ALLERGIES` LINE 1 (`30689231`) is absent from `ALLERGY` **and** `PROBLEM_LIST_ALL` — the
  deleted allergy's detail appears genuinely suppressed from this export, with no recoverable history table.
- `PAT_REVIEW_ALLERGI` rows with a **NULL** `PAT_REVIEW_ELG_R_YN` (blank in the TSV — §39; e.g. the 4/23/2025
  review, CSN 1127808563) appear to record allergens *shown* without a recorded Y/N response — likely a
  review opened but not answered. Unconfirmed whether NULL ever means "implicitly confirmed."
- Whether `ALLERGY_SEVERITY_C_NAME` admits values other than "High"/"Low"/"Unspecified" (and whether an
  allergy can be an intolerance via `SEVERITY_C_NAME`) is not observable from a 4-row, all-"Allergy"/"High"
  specimen — treat both category domains as open.
