# Immunizations — Epic EHI field guide

**Scope.** Administered vaccines (the patient's shot history), their disease-level components, and the
forecast/recommendation engine ("what's due next"). Allergies and health-maintenance topics are *adjacent*
domains with their own guides; this guide is vaccines only.

**Where it sits.** Two parallel models. The **EPT/clinical** model (`IMMUNE`) is a per-dose ledger reached
from the patient via `PAT_IMMUNIZATIONS` (PAT_ID→IMMUNE_ID) and ties to encounters via `IMMUNE.IMM_CSN`→
`PAT_ENC.PAT_ENC_CSN_ID`. The **DXR/registry** model (`IMM_ADMIN` + `_COMPONENTS` + `IMM_DUE`) is a
reconciled composite *document* keyed by `DOCUMENT_ID`/`CONTACT_DATE_REAL` and carries **no PAT_ID at all** —
in a single-patient export it is implicitly this patient's. The two models describe the same real shots from
different subsystems.

## Tables

| table | role | rows in specimen | notes |
|---|---|---|---|
| `IMMUNE` | **Spine (EPT side):** per-dose ledger, PK `IMMUNE_ID` | 19 | Carries order/charge/encounter linkage (`ORDER_ID`, `IMM_CHARGE_REC_ID`, `IMM_CSN`), `IMMUNZATN_ID`→masterfile, status (all `Given` here), `IMM_HISTORIC_ADM_YN`, `EXTERNAL_ADMIN_C_NAME`. **No PAT_ID column.** |
| `PAT_IMMUNIZATIONS` | Patient→IMMUNE bridge (`PAT_ID`, `LINE`, `IMMUNE_ID`) | 21 | The *only* path from patient to `IMMUNE`. More bridge rows than `IMMUNE` rows → orphan lines (see gotchas). |
| `IMMUNE_HISTORY` | Change-audit / versions of `IMMUNE` (§31), PK `(IMMUNE_ID, LINE)` | 30 | `HX_`/`HIST_`-flavored columns (`IMM_TYPE_HIST_ID`, `IMMNZTN_HX_DATE`…); `LINE` increments per edit. 19 immunizations → 30 versions. |
| `IMM_ADMIN` | **Spine (DXR side):** administered-vaccine snapshots, PK `(DOCUMENT_ID, CONTACT_DATE_REAL, LINE)` | 124 | **NOT 124 shots** — cumulative re-extractions of a composite document (see gotchas). Registry metadata: VFC, funding, lot, manufacturer, route/site, schedule validity, `IMM_REFERENCE_ID`. No PAT_ID. |
| `IMM_ADMIN_COMPONENTS` | Disease-antigen breakdown of each administration, PK `(DOCUMENT_ID, CONTACT_DATE_REAL, LINE)` | 118 | Joins to `IMM_ADMIN` on `IMM_REFERENCE_ID`. One Tdap → Pertussis + Td component rows, each with its own ACIP-schedule validity. |
| `IMM_DUE` | Forecast / "due next" snapshots, PK `(DOCUMENT_ID, CONTACT_DATE_REAL, LINE)` | 114 | 21 re-forecasts at successive contact dates; one row per due vaccine family with due/earliest date and next dose #. |
| `CLARITY_IMMUNZATN` | Immunization-TYPE masterfile (`IMMUNZATN_ID`→`NAME`) | 21 | Only 2 columns. Shared id space across `IMMUNE.IMMUNZATN_ID`, `IMM_ADMIN.IMM_TYPE_ID`, `IMM_ADMIN_COMPONENTS.IMM_COMP_GROUP_ID`, `IMM_DUE.IMM_DUE_TYPE_ID`. |
| `IMM_ADMIN_GROUPS` / `_FT` | Multi-response "Vaccine Group" item (I DXR 4220), PK adds `GROUP_LINE`/`VALUE_LINE` | 4 / 4 | Sparse; only Influenza group appears, for the 2018 contacts. |
| `IMMNZTN_LAST_REVIEW` | "Immunizations section last reviewed by/when" | 1 | **All review fields NULL** here — the section was never formally attested (contrast the rich allergy-review audit). |
| `IMM_ADMIN_REACTION_TYPE` / `_RCTN_TYPE_FT` | Post-administration reaction logging | NOT LOADED (empty TSV) | In schema docs, so expect it; adverse-reaction type per administration. No reactions for this patient → no SQLite table. |
| `IMM_ADMIN_COMBINATIONS` / `_FT` | Combination-vaccine modeling | NOT LOADED (empty TSV) | In schema docs only. How a combo product maps to its constituent immunization records. |
| `IMM_DUE_REASON` / `_FT` | Why a vaccine is forecast as due | NOT LOADED (empty TSV) | In schema docs only. Reason codes/text behind an `IMM_DUE` row — would explain catch-up vs booster forecasts if populated. |
| `IMMUNE_REVIEW` | Per-review log of who/when reviewed the immunizations section | NOT LOADED | In schema docs only — the multi-row companion to the single-row `IMMNZTN_LAST_REVIEW`. |
| `IMM_HM_SEQ_NUM` | Health-maintenance sequence number per administration | NOT LOADED | In schema docs only; per its description, the LPL (Problem List) records that satisfied a Health Maintenance topic — the cross-domain HM hook. |

## How they join

All joins below were run and row-counts confirmed against this specimen.

- **Patient → EPT ledger:** `PAT_IMMUNIZATIONS.IMMUNE_ID = IMMUNE.IMMUNE_ID`, filtered by `PAT_ID`. 21 bridge
  rows join to 19 `IMMUNE` rows (2 bridge lines are orphans, see gotchas). **`IMMUNE` has no `PAT_ID`** — this
  bridge is the only patient path (§1, §3).
- **EPT ledger → encounter:** `IMMUNE.IMM_CSN = PAT_ENC.PAT_ENC_CSN_ID` (§2). 14/19 rows have an `IMM_CSN`;
  the rest (MyChart-entered / external) have none. **The encounter's `CONTACT_DATE` is the *entry/review*
  visit, not when the shot was given** — e.g. three historical shots share CSN dated 11/7/2024 while their
  `IMMUNE_DATE`s span 2021–2024.
- **EPT ledger → audit:** `IMMUNE_HISTORY.IMMUNE_ID = IMMUNE.IMMUNE_ID`, replay by `LINE` (§31, §35).
- **DXR administration → components:** `IMM_ADMIN.IMM_REFERENCE_ID = IMM_ADMIN_COMPONENTS.IMM_REFERENCE_ID`
  **AND** `DOCUMENT_ID` **AND** `CONTACT_DATE_REAL` (the components belong to a specific snapshot). 118
  component rows all join. **Do not match `IMM_REFERENCE_ID` with a string literal** — see the 0x7F gotcha;
  column-to-column joins are unaffected.
- **DXR/EPT → type masterfile:** `*.{IMM_TYPE_ID | IMMUNZATN_ID | IMM_COMP_GROUP_ID | IMM_DUE_TYPE_ID} =
  CLARITY_IMMUNZATN.IMMUNZATN_ID` (§5). One shared masterfile across all four tables; every populated id
  resolves. A denormalized `_NAME` companion (`IMM_TYPE_ID_NAME`, `IMMUNZATN_ID_NAME`, `IMM_DUE_TYPE_ID_NAME`)
  sits beside each id, so you usually don't *need* the join for display (§6).
- **DXR administration → vaccine groups:** `IMM_ADMIN_GROUPS.GROUP_LINE = IMM_ADMIN.LINE` within the same
  `(DOCUMENT_ID, CONTACT_DATE_REAL)` snapshot — the outer ordinal of the §10 `GROUP_LINE`/`VALUE_LINE` pair
  indexes the administration line. `_FT` pairs 1:1 with `_GROUPS` on the full four-part key
  `(DOCUMENT_ID, CONTACT_DATE_REAL, GROUP_LINE, VALUE_LINE)`.
- **`IMMUNE_ID`s live in the LPL (Problem List) master id space.** `PROBLEM_LIST_ALL` carries
  `RECORD_TYPE_C_NAME = 'Immunization'` rows whose `PROBLEM_LIST_ID` equals `IMMUNE_ID` (19/19 here, with
  `PAT_ID`) — a second patient-linkage path, and the reason general-patterns §13's LPL breakdown includes
  immunizations. The orphan bridge `IMMUNE_ID`s are absent there too, so the soft-delete hole is consistent
  across both views.
- **DXR document is NOT a scanned-media document.** The immunization `DOCUMENT_ID`s (`37763216`, …) do **not**
  appear in `DOC_INFORMATION` (keyed `DOC_INFO_ID`) or `DOC_LINKED_PATS` — verified 0 matches. "DXR document
  masterfile" is its own id space, distinct from the Media/scanned-document space (§41).

## Unstructured tie-back

n/a for RTF/Media — no `Rich Text/*.RTF` or `Media/*` file is referenced by any immunization table.
`IMM_NOTES`/`IMM_NOTES_RAW_DATA` are **not patient free-text** — on the master document's rows they carry a
constant system provenance note ("Historical - Not administered in Epic") and its raw HL7 form, a
caret-delimited coded element from the NIP001 information-source code system (HL7 RXA-9). That is the closest
thing to standardized source-of-information provenance in the export — read it before concluding provenance is
absent, and don't mistake a hundred-plus populated "notes" for clinical commentary. Human-entered text lives
**inline** in paired `_FT` / `FREE_TEXT` columns instead of separate notes (§25): `IMM_TYPE_FREE_TEXT`
(e.g. brand/vial text), `IMM_VALID_RSN_FT` and `IMM_COMP_VALID_RSN_FT` (free-text schedule-validity
explanations like "the client's age and vaccination history allowed for certain doses in the series to be
skipped" — in this specimen only the component-level `IMM_COMP_VALID_RSN_FT` is populated, on 3 rows; the
admin-level twin is empty, but both are candidates per §25 coded-beside-free-text), `IMM_DUE_TYPE_FT`
(e.g. "Td" when the coded id is blank), `IMM_GIVEN_BY_FT`, `IMM_MANUF_FREE_TEXT`. The only cross-domain
hook to the rest of the chart is the encounter CSN on `IMMUNE.IMM_CSN`.

## Gotchas & quirks (chased to *why*)

1. **`IMM_ADMIN` row count wildly overstates shots — it's re-extracted snapshots, not events.**
   *Observe:* 124 rows but only 18–19 real vaccinations. *Mechanism:* immunizations in the DXR model are one
   **composite Document** that Epic **re-extracts on every contact** that touches immunizations, producing a
   snapshot keyed by `CONTACT_DATE_REAL`. Line counts generally grow but are **NOT strictly cumulative** —
   mid-stream contacts can capture only a partial set (in this specimen a 6-line snapshot is followed by 2-
   and 3-line ones before counts climb to 18), so a snapshot is what *that contact's extraction touched*, not
   always the whole record. This is pattern §34 (per-contact re-snapshot) applied to a document.
   *Handle:* take the **latest `CONTACT_DATE_REAL`** of the master document as the truth only after confirming
   it is also the fullest — profile per-snapshot line counts first (here latest = max-count). Never `COUNT(*)`
   over all of `IMM_ADMIN`. Use `ORDER BY CAST(CONTACT_DATE_REAL AS REAL)` — the text `CONTACT_DATE` sorts
   lexically and lies (§17).

2. **There is more than one DXR document — outside-pharmacy records sit in their own documents.**
   *Observe:* `IMM_ADMIN` has three `DOCUMENT_ID`s (here `37763216` with 118 rows/15 snapshots, plus two
   small documents of 5 and 1 rows). *Mechanism:* the small documents are **externally-sourced**
   administrations captured as separate DXR documents before/while being reconciled into the master document.
   But the external markers differ per document: one small document carries retail-pharmacy `IMM_LOCATION`
   strings (here `CVS #04930`, `WALGREENS #06130`); the other has **no `IMM_LOCATION` at all** and is
   identifiable as external only by its populated
   `IMM_EXTERNAL_IDENTIFIER` / non-numeric `IMM_REFERENCE_ID` (see the 0x7F gotcha). The master document
   *repeats* the location strings on its reconciled copies — and re-renders them (`WALGREENS #06130` vs
   `Walgreens 06130` for the same store), so `IMM_LOCATION` is neither a discriminator for external
   documents nor a stable key for the pharmacy. `IMM_DUE` uses only the master document.
   *Handle:* anchor "the immunization record" on the master document (the one with the most snapshots), but
   don't assume a single `DOCUMENT_ID` — group/inspect by `DOCUMENT_ID` first.

3. **`IMM_REFERENCE_ID` carries an embedded `0x7F` (DEL) byte — literal string matches silently fail.**
   *Observe:* `LENGTH(IMM_REFERENCE_ID)` returns 17 for a value that displays as 16 digits; `WHERE
   IMM_REFERENCE_ID = '6647463431000071'` returns **0 rows**. *Mechanism:* `0x7F` is an Epic internal
   subscript delimiter (between a left and right id part) that leaked verbatim into the export; JSON/console
   rendering hides it. *Handle:* **column-to-column joins are fine** (both sides carry the same byte — the
   118-row component join works). For a literal filter, strip it: `WHERE REPLACE(IMM_REFERENCE_ID, char(127),
   '') = '6647463431000071'`. `hex()` reveals the `7F`. *Exception:* externally-sourced rows can carry the
   interface-assigned identifier **verbatim** in `IMM_REFERENCE_ID` (alphanumeric, possibly with non-ASCII
   bytes, no `0x7F`) — the `0x7F` pattern marks internally-minted ids only.

4. **EPT count (19) ≠ DXR reconciled count (18) — a genuine duplicate the registry collapsed.**
   *Observe:* `IMMUNE` lists 19 doses; the latest `IMM_ADMIN` snapshot lists 18. *Mechanism:* the 10/8/2018
   flu shot appears **twice** in `IMMUNE` — once as "INFLUENZA, INACTIVATED, QUADRIVALENT…" (`IMMUNZATN_ID`
   40890686) and once as "INFLUENZA, UNSPECIFIED FORMULATION" (40821) — a raw per-dose ledger that kept both
   the specific and the unspecified-formulation entry; the DXR reconciliation de-duplicated to one. The two
   models also *normalize formulation names differently* (a "FLUARIX IIV4" dose on the EPT side shows as the
   generic quadrivalent on the DXR side). *Handle:* if you need a clean de-duplicated history use the **latest
   `IMM_ADMIN` snapshot**; if you need order/charge/encounter linkage use `IMMUNE` and expect occasional dup.

5. **`IMM_DUE` "due dates" in the deep past are not errors — they're birth-anchored catch-up dates.**
   *Observe:* in the latest forecast, MMR due 10/26/1983, Varicella 10/26/1995, HepB 10/26/2001 — decades ago.
   *Mechanism:* the forecast engine computes the *age* at which each vaccine was first recommended and anchors
   the due date to **date of birth**; a vaccine never received shows a due date in the patient's childhood
   (catch-up), while a received series shows a **forward** booster date (Td due 2/5/2029, earliest 2/5/2024).
   *Handle:* read a past due date as "overdue / never received," a future one as "next booster forecast." Don't
   treat past dates as data corruption.

6. **Type IDs mix small internal codes with CVX-looking codes — both are masterfile keys, not a CVX flag.**
   *Observe:* `IMM_TYPE_ID`/`IMMUNZATN_ID` values range from `9`, `38`, `61`, `64`, `93` up to `90674`,
   `91320`, `40890686`. *Mechanism:* these are **`CLARITY_IMMUNZATN` masterfile record IDs** (schema labels
   `IMM_TYPE_ID` literally "External immunization type ID"); some local entries got low IDs, CVX-aligned ones
   got 9xxxx. The magnitude carries no semantic meaning. *Handle:* always resolve via `CLARITY_IMMUNZATN` (or
   the `_NAME` companion); never infer CVX-ness from the id size. Note the two models can assign *different*
   ids to the same shot (HepA: `IMM_ADMIN` id 38 "HEPATITIS A ADULT" vs `IMMUNE` id 85 "HEPATITIS A (HAVRIX)").
   **There is no CVX (or any standardized vaccine code) anywhere in this export** — `CLARITY_IMMUNZATN` has only
   `IMMUNZATN_ID`+`NAME`, and no immunization table has a CVX column. The *only* external standardized code is an
   NDC on `IMMUNE` (`NDC_NUM_ID_NDC_CODE`, e.g. `58160-909-52`), and it is populated on just 1 of 19 rows here.
   A CVX crosswalk must be built from outside the export (map by name, or via NDC where present).

7. **`IMM_DUE_TYPE_ID` can be blank with the real label only in `_FT`.** *Observe:* an `IMM_DUE` row with
   empty `IMM_DUE_TYPE_ID` carries `IMM_DUE_TYPE_FT = "Td"`. *Mechanism:* the forecast item wasn't matched to a
   masterfile record, so Epic stores the free-text label (§25). Note `IMM_DUE_TYPE_FT` is a **full parallel
   label** populated on *every* row here (§25 coded-beside-free-text), not only where the id is blank — which
   is why the COALESCE works. *Handle:* `COALESCE(IMM_DUE_TYPE_ID_NAME, IMM_DUE_TYPE_FT)` when listing due
   vaccines.

8. **Component `LINE` ≠ administration `LINE`.** *Observe:* the Tdap at admin `LINE 3` joins to component
   rows at `LINE 3` and `LINE 4`. *Mechanism:* each table line-numbers its own list independently; the join
   key is `IMM_REFERENCE_ID` (+ document + contact-date), **not** `LINE`. *Handle:* never join components on
   `LINE`.

## Recipes

```sql
-- 1. The clean, de-duplicated administered-vaccine history (DXR latest snapshot = truth).
WITH master AS (                                   -- the master (most-snapshotted) document
       SELECT DOCUMENT_ID FROM IMM_ADMIN
       GROUP BY DOCUMENT_ID ORDER BY COUNT(*) DESC LIMIT 1),
     latest AS (                                   -- ITS latest snapshot (same computed id, not a literal)
       SELECT MAX(CAST(CONTACT_DATE_REAL AS REAL)) AS v FROM IMM_ADMIN
       WHERE DOCUMENT_ID = (SELECT DOCUMENT_ID FROM master))
SELECT IMM_DATE, IMM_TYPE_ID_NAME AS vaccine, IMM_STATUS_C_NAME AS status, IMM_LOCATION
FROM IMM_ADMIN
WHERE DOCUMENT_ID = (SELECT DOCUMENT_ID FROM master)
  AND CAST(CONTACT_DATE_REAL AS REAL) = (SELECT v FROM latest)
ORDER BY IMM_DATE;
```

```sql
-- 2. The EPT-side ledger for THIS patient, with the entry/review encounter date.
SELECT i.IMMUNE_DATE, i.IMMUNZATN_ID_NAME AS vaccine, i.IMMNZTN_STATUS_C_NAME AS status,
       i.EXTERNAL_ADMIN_C_NAME AS source, i.IMM_CSN, e.CONTACT_DATE AS review_enc_date
FROM PAT_IMMUNIZATIONS pi
JOIN IMMUNE i        ON pi.IMMUNE_ID = i.IMMUNE_ID
LEFT JOIN PAT_ENC e  ON i.IMM_CSN   = e.PAT_ENC_CSN_ID
WHERE pi.PAT_ID = 'Z#######'                       -- <-- your PAT_ID
ORDER BY i.IMMUNE_DATE;
```

```sql
-- 3. Decompose multivalent vaccines into disease components + ACIP validity (latest snapshot).
WITH master AS (
       SELECT DOCUMENT_ID FROM IMM_ADMIN
       GROUP BY DOCUMENT_ID ORDER BY COUNT(*) DESC LIMIT 1)
SELECT a.IMM_DATE, a.IMM_TYPE_ID_NAME AS vaccine,
       c.IMM_COMP_GROUP_FT AS disease, c.IMM_COMP_SCHED_VALID_YN AS valid,
       c.IMM_COMP_VALID_RSN_FT AS reason
FROM IMM_ADMIN a
JOIN IMM_ADMIN_COMPONENTS c
  ON a.IMM_REFERENCE_ID = c.IMM_REFERENCE_ID       -- column-join: 0x7F byte cancels out
 AND a.DOCUMENT_ID      = c.DOCUMENT_ID
 AND a.CONTACT_DATE_REAL = c.CONTACT_DATE_REAL
WHERE a.DOCUMENT_ID = (SELECT DOCUMENT_ID FROM master)
  AND CAST(a.CONTACT_DATE_REAL AS REAL) =
      (SELECT MAX(CAST(CONTACT_DATE_REAL AS REAL)) FROM IMM_ADMIN
       WHERE DOCUMENT_ID = (SELECT DOCUMENT_ID FROM master))
ORDER BY a.LINE, c.LINE;
```

```sql
-- 4. What is the patient due for? (latest forecast snapshot; coalesce id-name with free text)
SELECT COALESCE(IMM_DUE_TYPE_ID_NAME, IMM_DUE_TYPE_FT) AS due_vaccine,
       IMM_DUE_DUE_DATE, IMM_DUE_EARLIEST_DT, IMM_DUE_NEXT_DOSE
FROM IMM_DUE
WHERE CAST(CONTACT_DATE_REAL AS REAL) =
      (SELECT MAX(CAST(CONTACT_DATE_REAL AS REAL)) FROM IMM_DUE)
ORDER BY CAST(LINE AS INT);
```

```sql
-- 5. Find orphan patient-bridge lines (a deleted/superseded immunization).
SELECT pi.LINE, pi.IMMUNE_ID
FROM PAT_IMMUNIZATIONS pi
LEFT JOIN IMMUNE i ON pi.IMMUNE_ID = i.IMMUNE_ID
WHERE i.IMMUNE_ID IS NULL;
```

## Open questions / specimen notes

- **Orphan bridge lines.** `PAT_IMMUNIZATIONS` LINE 7/8 point at `IMMUNE_ID`s (71612083, 71612085) that have
  **no `IMMUNE` row** — soft-deleted/superseded doses whose detail wasn't extracted (§32). Detail is not
  recoverable from `IMMUNE_HISTORY` (keyed only on surviving `IMMUNE_ID`s).
- **No formal review attestation.** `IMMNZTN_LAST_REVIEW` is all-NULL except `PAT_ID` — unlike allergies,
  immunizations were never attested in this chart. Genre note: the table exists to hold reviewer/instant/CSN
  when the section *is* attested.
- **Provenance columns mostly empty — with two exceptions.** `IMM_VFC_ELIGIBILITY_STATUS_C_NAME`,
  `IMM_FUNDING_SOURCE_C_NAME`, `IMM_EXT_ADMIN_C_NAME`, `IMM_FILTER_RSN_C_NAME`, `IMM_EVENT_IDENT` are all blank
  here — they are the fields to check on an export that *does* pull from a state registry. But
  `IMM_EXTERNAL_IDENTIFIER` **is** populated on externally-sourced document rows, and on such a row
  `IMM_REFERENCE_ID` equals the external identifier verbatim (the interface-assigned id replaces the internal
  subscripted id) — this is the external-provenance marker the other columns lack. And
  `IMM_NOTES`/`IMM_NOTES_RAW_DATA` carry NIP001 information-source provenance (see Unstructured tie-back).
- **Specimen shape (illustrative, not genre):** 18 distinct administered vaccines 2017–2025 (annual Influenza
  in several formulations; a multi-dose COVID series; a 2/5/2019 travel cluster Tdap/Typhoid/HepA), one
  duplicate flu entry on the EPT side, 21 forecast snapshots, 0 recorded reactions. Provider names are fine to
  surface (e.g. given-by clinicians); IDs/MRN are not.
