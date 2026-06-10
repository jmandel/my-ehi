# Histories: family, social, medical — Epic EHI field guide
**Scope.** The patient-reported **histories** captured in the chart's History activity: **family history**
(`FAMILY_HX` conditions + `FAMILY_HX_STATUS` the relatives/pedigree), **social history** (`SOCIAL_HX`
tobacco/alcohol/sexual/SDOH + `SOCIAL_ADL_HX` activities-of-daily-living Q&A), **past medical history**
(`MEDICAL_HX`) and **past surgical history** (`SURGICAL_HX`). These are the "Hx" sections a nurse/provider
reviews at a visit — distinct from the active **problem list** (see `problems-and-diagnoses.md`), which
they border on but model differently.

**Where it sits.** Every history row is keyed to an encounter contact by `PAT_ENC_CSN_ID`, and indirectly
to the patient through that encounter's `PAT_ID`. **Crucial:** that `PAT_ENC_CSN_ID` is a dedicated
**history-review contact** spun off the visit (same day, fraction `.01`/`.02`), *not* the office-visit CSN
itself — the real visit is in `HX_LNK_ENC_CSN` (see Gotchas). The histories are **re-snapshotted every
encounter the section is reviewed** (§34), so the same facts repeat across many CSNs.

## Tables

Spine (the five history sections), then the supporting review/index tables.

| table | role | rows in specimen | notes |
|---|---|---|---|
| `FAMILY_HX` | **Family conditions.** One row per (relative × condition). | 73 | `(PAT_ENC_CSN_ID, LINE)`. `RELATION_C_NAME` (Mother/Brother/…), `MEDICAL_HX_C_NAME` (the **condition as a category**, e.g. "Ovarian cancer"), `MEDICAL_OTHER` (free-text when "Other"), `COMMENTS`, `AGE_OF_ONSET`/`_END`, `FAM_HX_SRC_C_NAME` (Provider/Patient…), `FAM_MED_REL_ID` (→ the relative in `FAMILY_HX_STATUS`), `FAM_MEDICAL_DX_ID` (coded dx — **NULL throughout**), `FAM_RELATION_NAME` (free-text relation used when the picklist relation doesn't fit — empty here). |
| `FAMILY_HX_STATUS` | **The relatives themselves** (vital status + pedigree). One row per relative. | 46 | `(PAT_ENC_CSN_ID, LINE)`. `FAM_STAT_REL_C_NAME`, `FAM_STAT_STATUS_C_NAME` (Alive/Deceased), `FAM_STAT_SEX_C_NAME`, `FAM_STAT_DEATH_AGE`, `FAM_STAT_COD_C_NAME` (cause of death), `FAM_STAT_ID` (relative id within snapshot), `FAM_STAT_FATHER_ID`/`FAM_STAT_MOTHER_ID` (pedigree pointers), `HX_LNK_ENC_CSN` (the visit). |
| `SOCIAL_HX` | **Social history — one wide snapshot per encounter.** | 8 | `PAT_ENC_CSN_ID`, **91 columns**, exactly 1 row per history contact. Tobacco (`TOBACCO_USER_C_NAME`, `SMOKING_TOB_USE_C_NAME`), alcohol (`ALCOHOL_USE_C_NAME` + free-text `ALCOHOL_COMMENT`), sexual (`SEXUALLY_ACTIVE_C_NAME`, `*_PARTNER_YN`, contraception `*_YN`), `YEARS_EDUCATION`, SDOH (`FIN_RESOURCE_STRAIN_C_NAME`, `FOOD_INSECURITY_*`, IPV, transport…), `UNKNOWN_FAM_HX_YN`. |
| `SOCIAL_ADL_HX` | **Activities-of-daily-living Q&A** — tall child of social hx. | 104 | `(PAT_ENC_CSN_ID, LINE)`. `HX_ADL_QUESTION_ID_RECORD_NAME` (e.g. "SOCIAL ADL: EXERCISE", "SEAT BELT/CAR SEAT"), `HX_ADL_RESPONSE_C_NAME`, `HX_ADL_COMMENTS`. **13 templated questions × 8 snapshots = 104**; every response here is "Not Asked" (see Gotchas). |
| `PAT_SOCIAL_HX_DOC` | **Social hx free-text narrative** ("Social Documentation" blob). | 6 | `(PAT_ENC_CSN_ID, LINE)`, `HX_SOCIAL_DOC`. The free narrative (occupation/living situation) — present **only** on snapshots where the section was filed (6 of 8 here), so `LEFT JOIN` from `SOCIAL_HX` and tolerate misses. Line-chunked text (§11): reassemble `ORDER BY CAST(LINE AS INT)` — separate from `SOCIAL_HX`'s inline `*_COMMENT` columns. |
| `MEDICAL_HX` | **Past medical history.** One row per (condition × encounter). | 6 | `(PAT_ENC_CSN_ID, LINE)`. Condition stored as **`DX_ID` → `CLARITY_EDG`** (not a category). `MEDICAL_HX_DATE` (free-text fuzzy onset), `MED_HX_ANNOTATION`. |
| `SURGICAL_HX` | **Past surgical history.** One row per (procedure × encounter). | 8 | `(PAT_ENC_CSN_ID, LINE)`. Procedure stored as **`PROC_ID` → `CLARITY_EAP`** (procedure master, not EDG). `SURGICAL_HX_DATE` (free-text), `SURG_HX_START_DT`/`_END_DT`, `SURG_LATERALITY_C_NAME`, `COMMENTS`/`PROC_COMMENTS`, `HX_LNK_ENC_CSN`. `SURG_HX_ORDER_ID`/`SURGICAL_HX_SRG_CSN` back-link a row to the originating order / surgery-log contact when the hx was auto-filed from a performed procedure (empty in an ambulatory specimen). |
| `PAT_HX_REVIEW` | **The review *event* spine** — one row per attestation instance (who reviewed, when). | 39 | `(PAT_ENC_CSN_ID, LINE_COUNT)`. `HX_REVIEWED_USER_ID(_NAME)` (§6 EMP companion, ships populated), `HX_REVIEWED_DATE` (effective) + `HX_REVIEWED_INSTANT` (audit instant — a §19 pair). One history contact can carry **several** review events (e.g. rooming questionnaire, then navigator review). |
| `PAT_HX_REV_TYPE` | **Which history *sections* were reviewed**, per review event. | 68 | `(PAT_ENC_CSN_ID, GROUP_LINE, VALUE_LINE)`; `GROUP_LINE` is the FK to `PAT_HX_REVIEW.LINE_COUNT`, `VALUE_LINE` enumerates sections within one event. `HX_REVIEWED_TYPE_C_NAME` ∈ {Tobacco, Family, Medical, Surgical, Alcohol, Drug Use, Sexual Activity, Socioeconomic, …}. This is the attestation that **drives** the per-encounter re-snapshot. |
| `PAT_HX_REV_TOPIC` | **Where in the application** each section was reviewed. | 68 | Exact 1:1 sibling of `PAT_HX_REV_TYPE` on `(PAT_ENC_CSN_ID, GROUP_LINE, VALUE_LINE)`. `HX_REVIEWED_HEADER` names the surface — History Navigator section vs. LQH questionnaire / LPG group, with the build record id embedded in the text (can be NULL). Useful to tell rooming-questionnaire review from navigator review. |
| `FAM_HX_PAT_ONLY` | Patient's own family-hx fertility status, 1 row per snapshot. | 8 | `PAT_ENC_CSN_ID`, `FAM_HX_FERT_STAT_C_NAME`, `FAM_HX_FERT_STAT_NOTES`. **Templated but empty** here. |
| `MEDICAL_COND_INFO` | Tiny no-add lookup of medical-condition names. | 2 | `MEDICAL_COND_ID` → `MEDICAL_COND_NAME`. Actually the medication-*indication* condition master — joined by `ORD_INDICATIONS.INDICATIONS_ID` and other `*_MEDICAL_COND_NAME`-companion columns in the orders domain. It lands in this domain by name only; see `medications-and-orders.md`. |

**Standard tables to expect even when sparse** (genre): all of the above ship in essentially every Epic
export; `SOCIAL_ADL_HX`, `FAM_HX_PAT_ONLY`, and the SDOH columns of `SOCIAL_HX` are frequently *templated
but empty* (filed by the encounter form, never answered). A `FAM_HX_PAT_ONLY`-style "patient-only" table and
a `*_REVIEW_*` attestation table accompany each history section. The discrete SDOH *screening* layer — the
`SDD_*` Social Drivers store, which derives from (not duplicates) these `SOCIAL_HX` columns — has its own
guide: `social-determinants-and-smartdata.md`.

## How they join

All joins below were run against the specimen and returned the stated rows.

- **History row → its encounter contact:** `<HX>.PAT_ENC_CSN_ID = PAT_ENC.PAT_ENC_CSN_ID`. Verified all 8
  distinct history CSNs (and the 6 for `MEDICAL_HX`) exist in `PAT_ENC`. **But** this CSN is the *history
  contact*, fraction `.01`/`.02` (see next). (see §2 CSN/contacts, §18 `*_DATE_REAL`)
- **History contact → the actual office visit:** `<HX>.HX_LNK_ENC_CSN = PAT_ENC.PAT_ENC_CSN_ID`. Present on
  `FAMILY_HX_STATUS`, `SOCIAL_HX`, `SURGICAL_HX`. Verified: `HX_LNK_ENC_CSN` is **never** equal to
  `PAT_ENC_CSN_ID` (0/62), always non-null, and always resolves to the **same-day `.00` contact** with the
  *same provider and department* as the history contact. Use this to attribute a snapshot to its visit.
- **Family condition → the relative it's about:** `FAMILY_HX.FAM_MED_REL_ID = FAMILY_HX_STATUS.FAM_STAT_ID`,
  **scoped to the same `PAT_ENC_CSN_ID`**. Verified 73/73 rows match. This is how you attach "Ovarian cancer"
  to "Mother (Alive)". (Discovery missed this join — it's the spine of family hx.) (see §9 LINE child rows)
- **Pedigree (build the family tree):** `FAMILY_HX_STATUS.FAM_STAT_FATHER_ID` / `FAM_STAT_MOTHER_ID` →
  `FAMILY_HX_STATUS.FAM_STAT_ID`, **same CSN**. Verified: Brother's father/mother ids point at the Father/
  Mother rows; Mother's point at the maternal grandparents — a complete 3-generation graph (a §9-style
  self-join within one snapshot's child rows).
- **Medical hx → diagnosis name:** `MEDICAL_HX.DX_ID = CLARITY_EDG.DX_ID`. Bare `DX_ID`; doc says
  `DX_ID_DX_NAME` (§7 schema-doc drift, §6 `_NAME` companions). Verified resolves to "Post concussion syndrome".
- **Surgical hx → procedure name:** `SURGICAL_HX.PROC_ID = CLARITY_EAP.PROC_ID`. Bare `PROC_ID`; doc says
  `PROC_ID_PROC_NAME` (§7). Verified `42500` → "WISDOM TOOTH EXTRACTION". (`CLARITY_EAP` = procedure/EAP
  master — *not* `CLARITY_EDG`.)
- **Which sections were reviewed at a visit:** `PAT_HX_REV_TYPE.PAT_ENC_CSN_ID` (= the history contact CSN);
  `HX_REVIEWED_TYPE_C_NAME` labels each reviewed section. The distinct CSNs line up 1:1 with the snapshot CSNs.
- **Review item → its review event (who/when):** `PAT_HX_REV_TYPE.GROUP_LINE = PAT_HX_REVIEW.LINE_COUNT`,
  **same `PAT_ENC_CSN_ID`** (the schema doc states this FK explicitly; verified 68/68). One contact can hold
  multiple review events (`GROUP_LINE` > 1), so `GROUP BY PAT_ENC_CSN_ID` alone merges distinct attestations.
- **Review item → its application surface:** `PAT_HX_REV_TOPIC` joins `PAT_HX_REV_TYPE` 1:1 on the full
  `(PAT_ENC_CSN_ID, GROUP_LINE, VALUE_LINE)` key (68/68 both directions); `HX_REVIEWED_HEADER` names the
  navigator section or questionnaire the section was reviewed from.

(see §8 base+supplement, §23 `_C_NAME` categories, §34 per-encounter re-snapshot, §31 `_HX` two meanings)

## Unstructured tie-back

These tables are **mostly their own free text** — there is no separate note/HNO per history row. The text
lives inline:
- `FAMILY_HX.COMMENTS` / `MEDICAL_OTHER` — e.g. Mother's thyroid disease `COMMENTS = "s/p thyroidectomy"`;
  `MEDICAL_OTHER` holds the typed condition when the user picks "Other" from the picklist.
- `SOCIAL_HX.ALCOHOL_COMMENT` / `SEX_COMMENT` / `ILLICIT_DRUG_CMT` / `TOB_HX_SMOKE_EXPOSURE_CMT` — the
  free-text counterpart beside each coded `_C_NAME` (§25). E.g. `ALCOHOL_USE_C_NAME = "Yes"` beside
  `ALCOHOL_COMMENT` = "about 3-4 drinks per week".
- **Exception — social hx *does* have a dedicated free-text child table:** the narrative "Social
  Documentation" blob lives in `PAT_SOCIAL_HX_DOC` (`PAT_ENC_CSN_ID`, `LINE`, `HX_SOCIAL_DOC`), joined to
  `SOCIAL_HX` on `PAT_ENC_CSN_ID` and reassembled `ORDER BY CAST(LINE AS INT)`. This is *distinct* from the
  inline `*_COMMENT` columns above — it's the free narrative (e.g. occupation/living situation) rather than a
  per-field note. Present only on snapshots where the narrative was filed (6 of the 8 snapshots in one
  specimen — `LEFT JOIN` and tolerate misses); re-snapshotted like the rest (§34).
- `SOCIAL_ADL_HX.HX_ADL_COMMENTS`, `FAMILY_HX_STATUS.FAM_STAT_COMMENT`, `MEDICAL_HX.MED_HX_ANNOTATION`,
  `SURGICAL_HX.COMMENTS`/`PROC_COMMENTS`, `FAM_HX_PAT_ONLY.FAM_HX_FERT_STAT_NOTES` — present but empty here.

There is **no `OVERVIEW_NOTE_ID`-style HNO link** on these tables (unlike `PROBLEM_LIST`). The clinician's
narrative *about* the histories lives in the encounter's office-visit note (reach it via
`HX_LNK_ENC_CSN` → `HNO_INFO`/`NOTE_ENC_INFO`), not on the history rows.

## Gotchas & quirks (chased to *why*)

1. **The key CSN is a "history contact," not the visit — and `HX_LNK_ENC_CSN` is the visit.**
   *Observe:* `SOCIAL_HX.PAT_ENC_CSN_ID = 724623985` but `HX_LNK_ENC_CSN = 720803470`; the two are never
   equal. *Why:* Epic files history review as its own **contact** in the history master file, on the same
   calendar day as the office visit. The visit is the `.00` contact (`PAT_ENC_DATE_REAL = NNNNN.00`); the
   history contact is the `.01`/`.02` same-day fraction (§18). Both are real `PAT_ENC` rows sharing the day,
   provider, and department. *Handle:* key the histories on `PAT_ENC_CSN_ID` for assembling a snapshot, but
   **join `HX_LNK_ENC_CSN → PAT_ENC` whenever you want the actual visit** (its note, provider title, dept).
   Do *not* expect `FAMILY_HX.PAT_ENC_CSN_ID` to appear in, say, `PAT_ENC_DX` — that visit-level data hangs
   off the `.00` CSN.

2. **Per-encounter re-snapshot inflates every count (§34).** *Observe:* `FAMILY_HX` has 73 rows but the
   patient has only ~12 distinct family facts; `MEDICAL_HX` has 6 rows, all the *same* diagnosis. *Why:* when
   a section is "marked reviewed" (logged in `PAT_HX_REV_TYPE`), Epic **re-files a full fresh copy** of the
   section tagged with that encounter's history CSN. The same facts repeat once per reviewing encounter.
   *Handle:* never `COUNT(*)` these tables as a fact count. For the **current view**, take the snapshot at the
   **latest `PAT_ENC_DATE_REAL`**; the *growth* between snapshots tells you when a fact was added (in this
   specimen FAMILY_HX went 3 → 11 → 12 rows across 2018→2025; "Colon polyps (Brother)" was the 2025 add).

3. **Conditions are stored differently in each history table.** *Observe:* `FAMILY_HX` names a condition with
   `MEDICAL_HX_C_NAME = "Ovarian cancer"` (a **category**), while `MEDICAL_HX` uses `DX_ID = 260690` (an
   **EDG code**) and `SURGICAL_HX` uses `PROC_ID = 42500` (an **EAP procedure code**). *Why:* family history is
   a picklist-driven, often patient-reported list (Epic ships a `FAM_MEDICAL_DX_ID` coded column for it but it
   is **NULL throughout** — the org configured category capture, not coded); medical hx is clinician-curated
   against the diagnosis master; surgical hx against the procedure master. *Handle:* resolve family conditions
   from the inline `_C_NAME` (no `ZC_` table ships, §23); join `MEDICAL_HX.DX_ID → CLARITY_EDG` and
   `SURGICAL_HX.PROC_ID → CLARITY_EAP`. Don't expect `FAMILY_HX` to join to `CLARITY_EDG`.

4. **`SOCIAL_HX` is one wide row; the others are LINE-tall.** *Observe:* `SOCIAL_HX` = exactly 1 row × 91
   columns per encounter; `FAMILY_HX`/`SOCIAL_ADL_HX` = many `LINE` rows per encounter. *Why:* social history
   is a fixed single-instance form (one tobacco status, one alcohol status…), so it's modeled as a wide record
   (§8 shape, no supplements needed here); family/ADL are repeating sub-lists, so they're `LINE` child rows
   (§9). *Handle:* read `SOCIAL_HX` by column; reassemble the others by `ORDER BY CAST(LINE AS INT)`.

5. **Templated-but-empty rows ("Not Asked").** *Observe:* `SOCIAL_ADL_HX` is 104 rows of pure
   `HX_ADL_RESPONSE_C_NAME = "Not Asked"`; `FAM_HX_PAT_ONLY` and most SDOH columns of `SOCIAL_HX` are blank.
   *Why:* the encounter **form template** instantiates all 13 ADL questions (and the patient-only/SDOH fields)
   every snapshot regardless of whether anyone answered them — the row exists because the template fired, not
   because data was captured. *Handle:* filter `HX_ADL_RESPONSE_C_NAME != 'Not Asked'` (and treat blank
   `_C_NAME`/`_YN` as un-asked) before reading clinical content; otherwise you over-report "data."

6. **The coded value and the free text disagree on purpose (§25).** *Observe:* `ALCOHOL_USE_C_NAME = "Yes"`
   with the structured `ALCOHOL_OZ_PER_WK` **empty**, while the real quantity sits in free-text
   `ALCOHOL_COMMENT` ("1-2", "about 3-4 drinks per week" — and the text *changes* across snapshots). *Why:*
   clinicians enter the status as a pick and the amount as a note; the structured numeric is optional and
   often skipped. *Handle:* read the `_C_NAME`/`_YN` for the status flag and the `*_COMMENT` for the detail;
   never assume the numeric column carries the value.

7. **`FAM_STAT_ID` is per-snapshot, but happened to be stable here — still scope joins by CSN.** *Observe:*
   in this specimen Mother is always `FAM_STAT_ID = 2`, Brother always `5`, across all 8 snapshots. *Why:* the
   id is the relative's record id *within a family-hx contact*; Epic re-files the same ids when re-snapshotting
   an unchanged pedigree, so it *looks* stable — but that's not guaranteed across encounters or patients (a
   re-entered pedigree can renumber). The pedigree pointers (`FATHER_ID`/`MOTHER_ID`) and `FAM_MED_REL_ID` are
   only meaningful **within one `PAT_ENC_CSN_ID`**. *Handle:* always include `AND a.PAT_ENC_CSN_ID =
   b.PAT_ENC_CSN_ID` in family-hx self-joins; don't join `FAM_STAT_ID` across snapshots.

## Recipes

```sql
-- 1. CURRENT family history: conditions + the relative + their vital status (latest snapshot only)
WITH latest AS (
  SELECT PAT_ENC_CSN_ID
  FROM FAMILY_HX f
  ORDER BY (SELECT CAST(PAT_ENC_DATE_REAL AS REAL) FROM PAT_ENC e
            WHERE e.PAT_ENC_CSN_ID = f.PAT_ENC_CSN_ID) DESC
  LIMIT 1)
SELECT fh.RELATION_C_NAME, fh.MEDICAL_HX_C_NAME AS condition, fh.COMMENTS,
       fs.FAM_STAT_STATUS_C_NAME AS relative_status, fs.FAM_STAT_DEATH_AGE
FROM FAMILY_HX fh
JOIN FAMILY_HX_STATUS fs
  ON fh.PAT_ENC_CSN_ID = fs.PAT_ENC_CSN_ID AND fh.FAM_MED_REL_ID = fs.FAM_STAT_ID
WHERE fh.PAT_ENC_CSN_ID = (SELECT PAT_ENC_CSN_ID FROM latest)
ORDER BY CAST(fh.LINE AS INT);

-- 2. Build the pedigree (each relative + their parents), latest snapshot
WITH latest AS (SELECT PAT_ENC_CSN_ID FROM FAMILY_HX_STATUS
  ORDER BY (SELECT CAST(PAT_ENC_DATE_REAL AS REAL) FROM PAT_ENC e
            WHERE e.PAT_ENC_CSN_ID = FAMILY_HX_STATUS.PAT_ENC_CSN_ID) DESC LIMIT 1)
SELECT c.FAM_STAT_REL_C_NAME AS relative, c.FAM_STAT_STATUS_C_NAME AS status,
       f.FAM_STAT_REL_C_NAME AS father, m.FAM_STAT_REL_C_NAME AS mother
FROM FAMILY_HX_STATUS c
LEFT JOIN FAMILY_HX_STATUS f
  ON c.PAT_ENC_CSN_ID = f.PAT_ENC_CSN_ID AND c.FAM_STAT_FATHER_ID = f.FAM_STAT_ID
LEFT JOIN FAMILY_HX_STATUS m
  ON c.PAT_ENC_CSN_ID = m.PAT_ENC_CSN_ID AND c.FAM_STAT_MOTHER_ID = m.FAM_STAT_ID
WHERE c.PAT_ENC_CSN_ID = (SELECT PAT_ENC_CSN_ID FROM latest)
ORDER BY CAST(c.LINE AS INT);

-- 3. Past medical & surgical history with names, attributed to a visit date
-- MEDICAL_HX has no HX_LNK_ENC_CSN, so attribute it via its own PAT_ENC_CSN_ID
-- (the history contact); SURGICAL_HX has HX_LNK_ENC_CSN → the .00 office visit.
SELECT 'medical' AS kind, edg.DX_NAME AS item, m.MEDICAL_HX_DATE AS hx_date,
       (SELECT CONTACT_DATE FROM PAT_ENC e WHERE e.PAT_ENC_CSN_ID = m.PAT_ENC_CSN_ID) AS visit
FROM MEDICAL_HX m LEFT JOIN CLARITY_EDG edg ON m.DX_ID = edg.DX_ID
UNION ALL
SELECT 'surgical', eap.PROC_NAME, s.SURGICAL_HX_DATE,
       (SELECT CONTACT_DATE FROM PAT_ENC e WHERE e.PAT_ENC_CSN_ID = s.HX_LNK_ENC_CSN)
FROM SURGICAL_HX s LEFT JOIN CLARITY_EAP eap ON s.PROC_ID = eap.PROC_ID;

-- 4. Social history, current snapshot — status flag beside its free-text detail
SELECT TOBACCO_USER_C_NAME, SMOKING_TOB_USE_C_NAME,
       ALCOHOL_USE_C_NAME, ALCOHOL_COMMENT, SEXUALLY_ACTIVE_C_NAME, YEARS_EDUCATION
FROM SOCIAL_HX
ORDER BY (SELECT CAST(PAT_ENC_DATE_REAL AS REAL) FROM PAT_ENC e
          WHERE e.PAT_ENC_CSN_ID = SOCIAL_HX.PAT_ENC_CSN_ID) DESC
LIMIT 1;

-- 5. Who reviewed which history sections, when, and from which activity (drives the re-snapshot).
-- One review EVENT per (CSN, LINE_COUNT) — a single contact can carry several (GROUP_LINE > 1),
-- e.g. rooming questionnaire then navigator review, so group by the event, not just the CSN.
SELECT r.PAT_ENC_CSN_ID, r.LINE_COUNT, r.HX_REVIEWED_USER_ID_NAME, r.HX_REVIEWED_DATE,
       GROUP_CONCAT(DISTINCT t.HX_REVIEWED_TYPE_C_NAME) AS sections_reviewed,
       GROUP_CONCAT(DISTINCT tp.HX_REVIEWED_HEADER)     AS reviewed_from
FROM PAT_HX_REVIEW r
JOIN PAT_HX_REV_TYPE t
  ON t.PAT_ENC_CSN_ID = r.PAT_ENC_CSN_ID AND CAST(t.GROUP_LINE AS INT) = CAST(r.LINE_COUNT AS INT)
LEFT JOIN PAT_HX_REV_TOPIC tp
  ON tp.PAT_ENC_CSN_ID = t.PAT_ENC_CSN_ID AND tp.GROUP_LINE = t.GROUP_LINE
 AND tp.VALUE_LINE = t.VALUE_LINE
GROUP BY r.PAT_ENC_CSN_ID, r.LINE_COUNT;
```

## Open questions / specimen notes

- **`MEDICAL_HX` has no `HX_LNK_ENC_CSN` column** (unlike `SOCIAL_HX`/`SURGICAL_HX`/`FAMILY_HX_STATUS`), so
  its `PAT_ENC_CSN_ID` is the history contact and you cannot back-link to the `.00` visit via a dedicated
  column here — you'd match same-day `.00`/`.01` contacts manually. Whether other exports add the column
  to `MEDICAL_HX` is unconfirmed.
- **No `ZC_` tables ship** (genre variation, §23), so the raw integer codes behind `MEDICAL_HX_C_NAME`,
  `FAM_STAT_STATUS_C`, `HX_ADL_RESPONSE_C`, etc. are not recoverable — only the inline `_C_NAME` labels.
- **`FAM_MEDICAL_DX_ID` is NULL on all 73 family-hx rows** in this specimen — family conditions are captured
  as categories only. An org configured for coded family hx could populate it; check before assuming
  category-only.
- **Specimen-specific** (illustrative, not genre): 8 history snapshots span 2018→2025; family hx grew 3→12
  facts; `MEDICAL_HX` is exclusively "Post concussion syndrome" (×6, starting 2022); `SURGICAL_HX` is
  exclusively "Wisdom tooth extraction" (×8); social hx is a lifelong non-smoker who drinks alcohol; all 13
  `SOCIAL_ADL_HX` questions are "Not Asked" at every visit; `FAM_HX_PAT_ONLY` fertility status is blank.
- `FAMILY_HX_STATUS` carries many rarely-used columns (`FAM_STAT_TWIN`, `FAM_STAT_IDENT_TWIN`,
  `FAM_STAT_ADOPT_C_NAME`, `FAM_STAT_PREG_EPISODE_ID`, `FAM_HX_FERT_STAT_C_NAME`) — all empty here but part
  of Epic's pedigree model; expect them populated for patients with twins/adoption/fertility documentation.
