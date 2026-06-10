# Lab results & observations — Epic EHI field guide

**Scope.** Ordered procedures and their discrete results: lab/micro orders, the analyte-level
component values (numeric + qualitative), reference ranges, abnormal flags, result status, and the
free-text narrative/interpretation that travels with a result (lab interp blocks and radiology reads).
Vitals/flowsheets are a *sibling* domain — see the `vitals-flowsheets` guide; this guide covers
`ORDER_PROC → ORDER_RESULTS` and friends.

**Where it sits.** Every order carries `PAT_ID` (the patient, §1) and a `PAT_ENC_CSN_ID` (the specific
contact where it was placed/resulted, §2). Results hang off the order by `ORDER_PROC_ID`. So the spine is
`PATIENT → PAT_ENC (CSN) → ORDER_PROC → ORDER_RESULTS → component value`.

## Tables

| table | role | rows in specimen | notes |
|---|---|---|---|
| `ORDER_PROC` | **Spine.** One row per ordered procedure (lab, micro, imaging, referral, injection). Header: `DESCRIPTION`, `PROC_ID`, `ORDER_TYPE_C_NAME`, status fields, `PAT_ENC_CSN_ID`, dates. | 42 | 82 cols. Covers ALL order types, not just labs — filter `ORDER_TYPE_C_NAME IN ('Lab','Microbiology')`. |
| `ORDER_RESULTS` | **Spine.** One row per analyte (component) per resulted order line, keyed `(ORDER_PROC_ID, LINE)`. Carries `ORD_VALUE`/`ORD_NUM_VALUE`, reference range, flags, status, `COMPONENT_ID(_NAME)`. | 47 | 55 cols. Only ~10 distinct `ORDER_PROC_ID`s here — most orders have NO result rows (see Gotchas). |
| `ORDER_NARRATIVE` | Line-numbered free text for an order, keyed `(ORDER_PROC_ID, LINE)`. Radiology reads + some lab interpretive blocks (COVID disclaimer). | 465 | The *only* place imaging reads live; no `ORDER_RESULTS` rows exist for imaging. |
| `ORDER_RES_COMMENT` | Multi-line interpretive comments tied to a specific component, keyed `(ORDER_ID, LINE, LINE_COMMENT)`. Reference-range legends, performing-lab footnotes. | 39 | `ORDER_ID` = `ORDER_PROC_ID`; `LINE` = the component's `ORDER_RESULTS.LINE`. |
| `ORDER_PROC_2` | 1:1 supplement (§8): specimen collection/receipt — `SPECIMN_TAKEN_DATE/TIME`, `SPECIMEN_RECV_DATE`, `COLLECTOR_USER_ID_NAME`, `LAST_RESULT_UPD_TM`. | 42 | Left-join on `ORDER_PROC_ID`. |
| `ORDER_PROC_3` | 1:1 supplement: result-routing/review status — `PROV_STATUS_C_NAME`, `RESULT_TYPE_C_NAME`, `RESULT_TRACK_STS_C_NAME`. | 42 | Left-join on `ORDER_ID` (§8 key-name drift — not `ORDER_PROC_ID`). |
| `ORDER_PROC_4` | 1:1 supplement: in-process status timestamps (`IPROC_STATUS_*`). | 42 | Left-join on `ORDER_ID`. |
| `ORDER_PROC_5` | 1:1 supplement: performing-lab + financial/exam detail — `LAST_RSLT_LAB_ID_LLB_NAME` (the lab that produced the result, 11/42 populated), `BILL_AREA_ID_BILL_AREA_NAME`, imaging exam fields. | 42 | Left-join on `ORDER_ID`. |
| `ORDER_PROC_6` | 1:1 supplement: result/chart provenance — `FIRST_FINAL`/`LAST_FINAL` (and `FIRST_CHART`/`LAST_CHART`/`*_CORR`) `_USER_ID_NAME` + `_UTC_DTTM` (who finalized/charted/corrected, and when; 20/42 have a final user). | 42 | Left-join on `ORDER_ID`. |
| `ORDER_REVIEW` | Per-line result review, keyed `(ORDER_ID, LINE)`: `REVIEW_USER_ID_NAME`, `REVIEWED_TIME`, `REVIEW_ACCEPTED_YN`. | 14 | `ORDER_ID` = `ORDER_PROC_ID`. The "provider reviewed/accepted this result" trail; `REVIEW_ACCEPTED_YN` is blank on a not-yet-accepted line. |
| `ORDER_MYC_INFO` | Portal-release flag, keyed `ORDER_PROC_ID`: `RELEASED_YN` — was this result released to the patient portal (MyChart)? | 11 | 1:1 with `ORDER_PROC` *where present* — presence is per released order, most orders have no row (§39). |
| `ORDER_MYC_RELEASE` | Portal-release action trail, keyed `(ORDER_PROC_ID, LINE)`: who released/unreleased (`RELEASE_USER_ID_NAME`), the action (`RELEASE_ACTION_C_NAME`), and the UTC instant (`MYC_REL_UTC_DTTM`, §19). | 11 | Together with `ORDER_MYC_INFO` answers "did/when did the patient see this result in the portal". The `LINE` child shape supports release/unrelease sequences (max `LINE` = 1 here). |
| `RESULT_FOLLOW_UP` | *Encounter-side* result-tracking trail, keyed `(PAT_ENC_CSN_ID, LINE)`: which orders' results were followed up during a contact (often a telephone encounter); `RESULT_ID`. | 5 | Join direction is **inverted** vs. the rest of this domain — it hangs off the encounter and points *at* the order (`RESULT_ID` = `ORDER_PROC_ID`). Complements `ORDER_REVIEW` and `ORDER_PROC_3.RESULT_TRACK_STS_C_NAME`. |
| `PERFORMING_ORG_INFO` | CLIA-style performing-lab attribution, keyed `(ORDER_ID, LINE)`: lab name, director, address, phone, `PERFORMING_ORG_CLIA_NUM`. | 11 | `ORDER_ID` = `ORDER_PROC_ID`; reach a *component's* row via `ORDER_RESULTS.PERFORMING_ORG_INFO_LINE` (see joins). The structured form of the performing-lab footnote that also appears as free text in `ORDER_RES_COMMENT`. |
| `ORDER_IMPRESSION` | Discrete impression/conclusion lines for imaging reads, keyed `(ORDER_PROC_ID, LINE)`: `IMPRESSION`. | 11 | All Imaging here. The conclusion surfaces as structured lines, not only buried in `ORDER_NARRATIVE`. |
| `SPEC_TYPE_SNOMED` | Specimen type as a bare SNOMED code, keyed `(ORDER_ID, LINE)`: `TYPE_SNOMED_CT` (e.g. `119297000`). | 16 | No `_NAME` companion and no SNOMED dictionary shipped (sibling `SPEC_SOURCE_SNOMED` is also code-only) — resolve the code outside the export. |
| `ORD_RSLT_COMPON_ID` | Component-level SNOMED codes, two-level key (§10): `GROUP_LINE` = the component's `ORDER_RESULTS.LINE`, `VALUE_LINE` enumerates multiple codes per component; `COMPON_SNOMED_CT`. | 1 | Same bare-code caveat as the specimen SNOMED tables — no dictionary shipped. `ORDER_RESULTS.COMP_SNOMED_SRC_C_NAME` is its source-flag sibling. Sparse here. |
| `ORDER_DX_PROC` | Indication diagnoses for the order, keyed `(ORDER_PROC_ID, LINE)`. Holds `DX_ID` (join `CLARITY_EDG`). | 41 | "Why was this ordered" — e.g. "Preventative health care". No `DX_NAME` companion here. |
| `CLARITY_COMPONENT` | Component master file: `COMPONENT_ID → NAME`. | 24 | **Redundant** — `ORDER_RESULTS.COMPONENT_ID_NAME` already carries the same label (verified 0 mismatches). |
| `OBS_MTHD_ID` | *In this export*, a thin 4-col order/contact index `(ORDER_ID, CONTACT_DATE_REAL, LINE, CONTACT_DATE)` over 9 of the 10 resulted orders (one resulted lab order has no rows here). | 46 | Schema doc says "methods used to perform component test" — the method payload was **stripped** (§7). Coverage of these stripped index tables is partial, not 1:1 with results. |

**Tables to expect but absent/empty here** (name them so an analyst knows to look):
- **`RES_COMPONENT_CMT` / `ORDER_RES_LRR`** and other result-comment variants — not populated in this specimen;
  interpretive text consolidated into `ORDER_RES_COMMENT`.
- A `ZC_RESULT_FLAG` / `ZC_ORDER_STATUS` lookup — **not shipped**; categories arrive pre-resolved as
  `*_C_NAME` (§23). This org ships labels inline, no `ZC_` tables.

## How they join

All verified against rows in this specimen.

- **`ORDER_RESULTS.ORDER_PROC_ID = ORDER_PROC.ORDER_PROC_ID`** — attach components to their order header.
  *47/47 result rows resolve; 0 orphans.* Only 10 of 42 orders have any result rows.
- **`ORDER_PROC.PAT_ENC_CSN_ID = PAT_ENC.PAT_ENC_CSN_ID`** — order → its encounter contact (§2).
  *42/42 orders resolve to a `PAT_ENC` row, 0 unmatched.* This is the tie to the ordering/resulting encounter.
- **`ORDER_RESULTS.PAT_ENC_CSN_ID = ORDER_PROC.PAT_ENC_CSN_ID`** — on a resulted order these are the **same
  CSN** (the result row carries the resulting contact's CSN, which on the "Final result" order equals the
  header's). *Verified identical for all resulted lipid/A1C/BMP orders.* (The order-vs-result CSN *split*
  is between two different `ORDER_PROC` rows — see Gotchas, not between header and result.)
- **`ORDER_RESULTS.COMPONENT_ID = CLARITY_COMPONENT.COMPONENT_ID`** — analyte code → name. Rarely needed:
  `COMPONENT_ID_NAME` is already on the result row (0 mismatches across 47 rows).
- **`ORDER_RES_COMMENT.ORDER_ID = ORDER_PROC_ID` AND `ORDER_RES_COMMENT.LINE = ORDER_RESULTS.LINE`** —
  interpretive comment lines attach to a *specific component*; order text by `CAST(LINE_COMMENT AS INT)`.
  *Verified: order 1165205279 LINE 4 (LDL, CALCULATED) → 6 comment lines spelling out the LDL legend.*
- **`ORDER_NARRATIVE.ORDER_PROC_ID = ORDER_PROC.ORDER_PROC_ID`**, reassemble with
  `ORDER BY CAST(LINE AS INT)` (LINE is text; without the cast it sorts 1,10,11,…,2 — §9). *Verified: COVID
  order 439060614 reassembles to the full PCR disclaimer; MRI order 439060613 to the radiologist read.*
- **`ORDER_DX_PROC.DX_ID = CLARITY_EDG.DX_ID`** → `DX_NAME` for the ordering indication. *Verified: lipid
  order 1165205279 → DX 192858 = "Preventative health care".*
- **`ORDER_PROC_2` left-joins on `ORDER_PROC_ID`; `ORDER_PROC_3/4/5/6` key on `ORDER_ID`** — same id, different
  column name (§8 key-name drift); joining all supplements on one name silently fails. All five are 1:1 (§8),
  42/42 here, for collection/review/lab/provenance detail.
- **`ORDER_RESULTS.PERFORMING_ORG_INFO_LINE` → `PERFORMING_ORG_INFO(ORDER_ID, LINE)`** (`ORDER_ID` =
  `ORDER_PROC_ID`) — per-component performing-lab attribution (name, director, address, CLIA number).
  *41/47 result rows carry the pointer; 41/41 resolve.* The inline shortcut is
  `ORDER_RESULTS.RESULTING_LAB_ID_LLB_NAME` (§6 `_NAME` companion); the order-level rollup is
  `ORDER_PROC_5.LAST_RSLT_LAB_ID_LLB_NAME`.
- **`ORDER_MYC_INFO` / `ORDER_MYC_RELEASE` join `ORDER_PROC` on `ORDER_PROC_ID`** — portal-release flag +
  action trail. *11/11 resolve for each.* Presence is per released order, not per `ORDER_PROC` row.
- **`RESULT_FOLLOW_UP.RESULT_ID = ORDER_PROC.ORDER_PROC_ID`** and
  **`RESULT_FOLLOW_UP.PAT_ENC_CSN_ID = PAT_ENC.PAT_ENC_CSN_ID`** — note the inverted direction: the row
  hangs off the *follow-up encounter* and points at the order. *5/5 resolve on both keys.*

## Unstructured tie-back

This domain *contains* unstructured material; here is how each piece reassembles:

- **Result narrative** lives in `ORDER_NARRATIVE(ORDER_PROC_ID, LINE, NARRATIVE)` — one physical text line
  per row, blank lines preserved (§11). It is the **sole** home of imaging/radiology reads (no structured
  `ORDER_RESULTS` rows for imaging) and of some lab interpretive blocks (COVID PCR disclaimer). Concatenate
  in `CAST(LINE AS INT)` order.
- **Imaging conclusions** also surface as discrete lines in `ORDER_IMPRESSION(ORDER_PROC_ID, LINE, IMPRESSION)`
  (all 11 rows here are Imaging) — the radiologist's "IMPRESSION:" block as structured lines rather than only
  embedded in the full `ORDER_NARRATIVE` read. Reassemble the same way (`CAST(LINE AS INT)` order).
- **Interpretive comments** (reference-range legends, performing-lab footnotes like eGFR address blocks)
  live in `ORDER_RES_COMMENT.RESULTS_CMT`, line-exploded by `LINE_COMMENT`, attached to a component LINE.
  The performing-lab footnote also exists in *structured* form — `PERFORMING_ORG_INFO` via
  `ORDER_RESULTS.PERFORMING_ORG_INFO_LINE` (see joins) — prefer that for attribution queries.
- **Per-component free text** can also sit in `ORDER_RESULTS.COMPONENT_COMMENT` (sparsely used here).
- The `ORDER_RESULTS.RESULT_VAL_START_LN/END_LN` columns are line-pointer slots into a result text blob;
  **empty in this specimen**. `RESULT_CMT_START_LN/END_LN` **are** populated — on exactly the components
  that have `ORDER_RES_COMMENT` rows, so they work as a has-comment flag (the pointer indexes the comment
  block in Chronicles' result-text item). The comment text itself still lives only in `ORDER_RES_COMMENT`
  (§15 pointer survives, body elsewhere); don't try to dereference the pointer into a blob.
- **No RTF/Media file** in `raw/` is referenced by these result tables. RTF clinical notes belong to the
  notes (HNO) domain. (One imaging read in `ORDER_NARRATIVE` duplicates a top-level MRI PDF in `raw/`, but
  the join key is the order id, not a file.)

## Gotchas & quirks (chased to *why*)

1. **An order count massively overstates resulted labs (the placement-vs-result order split).**
   *Observe:* 42 `ORDER_PROC` rows, 25 of them lab/micro (23 Lab + 2 Microbiology), but only **10 distinct orders** have any
   `ORDER_RESULTS`. A `LIPID PANEL` appears as **two** order rows on the same date — one with blank
   `LAB_STATUS_C_NAME` and zero results (e.g. 439060604, CSN 720803470) and one `LAB_STATUS = 'Final
   result'` *with* the components (439060606, CSN 724628999). *Why:* Epic mints a **placement** order at
   the visit and a separate **result** (collection/performing) order under a different same-day contact;
   the EHI extract keeps the discrete results only on the resulting contact (the doc says it "extracts only
   the last Orders contact for each ORD record"). The two share `PROC_ID` (684), `DESCRIPTION`, and
   `ORDERING_DATE` but are **not** linked by `CHNG_ORDER_PROC_ID` or `PANEL_PROC_ID` (both empty here).
   *Handle:* to count *resulted* labs, count distinct `ORDER_PROC_ID` in `ORDER_RESULTS`, or filter
   `ORDER_PROC` to `LAB_STATUS_C_NAME = 'Final result'`; to dedupe placement+result, group by
   `(PROC_ID, ORDERING_DATE)`.

2. **`9999999` is the numeric sentinel for a qualitative result (§25).**
   *Observe:* `ORD_NUM_VALUE = 9999999` on Hep C, H. pylori, COVID-interp, and eGFR `>90`. *Why:* a numeric
   column can't hold "NONREACTIVE" or ">90", so Epic parks a sentinel and puts the real value in `ORD_VALUE`
   (display string) and, for operator/normalized cases, `VALUE_NORMALIZED` (e.g. `>90`). *Handle:* never
   `AVG/MAX(ORD_NUM_VALUE)` without `WHERE ORD_NUM_VALUE <> 9999999`; read `ORD_VALUE` for the human result.
   Note the sentinel is **9999999 even for genuinely qualitative tests** — `ORD_VALUE` is always the truth.

3. **Abnormal flag and in-range flag are complementary, not co-populated.**
   *Observe:* a normal component has `RESULT_IN_RANGE_YN = 'Y'` and an **empty** `RESULT_FLAG_C_NAME`; an
   abnormal one has `RESULT_FLAG_C_NAME = 'High'/'Low'` and a **NULL/empty** `RESULT_IN_RANGE_YN`. They're
   never both set. *Why:* the flag is computed only when a value falls outside the range; in-range is the
   "all clear" boolean for the normal path. *Handle:* "is this abnormal?" =
   `RESULT_FLAG_C_NAME IN ('High','Low')` — don't expect `RESULT_IN_RANGE_YN = 'N'` (it's blank instead).
   Watch a stray literal `'(NONE)'` flag value on one row (Epic's "no flag" placeholder leaking through);
   treat `'(NONE)'`/empty as normal. A **third state** exists: qualitative/no-range components carry
   *neither* (`RESULT_FLAG_C_NAME` blank AND `RESULT_IN_RANGE_YN` NULL) — there is no numeric range to be
   in, so neither the flag nor the all-clear boolean fires (§28 tri-state). Treat neither-set as "not
   flagged", not as missing data. Order-level rollup lives in `ORDER_PROC.ABNORMAL_YN = 'Y'` when any
   component is abnormal.

4. **"Final result" orders with ZERO structured results.**
   *Observe:* five orders here — `COMPREHENSIVE METABOLIC PANEL`, both `CBC WITH DIFFERENTIAL`, `TROPONIN`,
   and one `BASIC METABOLIC PANEL` — are `LAB_STATUS_C_NAME = 'Final result'` in `ORDER_PROC` yet have
   **no** `ORDER_RESULTS` rows and **no** narrative — their numeric values are simply absent from the
   structured export. (A *different* BMP order IS fully resulted: the values-gap and the placement/result
   split of Gotcha #1 can co-occur for the same procedure.) *Why:* these were
   resulted at an external/ED system or on a result contact whose discrete components weren't carried into
   the extract; the header survived, the analytes didn't. *Handle:* don't assume "Final result" ⇒ values
   exist; always `LEFT JOIN ORDER_RESULTS` and check for the gap. Their values may only exist in a note/PDF.

5. **Reference range comes in parsed + raw pairs, and is per-component.**
   *Observe:* `REFERENCE_LOW`/`REFERENCE_HIGH`/`REFERENCE_UNIT` carry the parsed bounds; `RAW_LOW`/`RAW_HIGH`
   /`RAW_REF_VALS` preserve the un-parsed source string; some components (HDL, VLDL) have only a high or
   only a low bound; calculated/ratio components (EGFR `>90`) may have **no** numeric bounds at all and
   instead a textual legend in `ORDER_RES_COMMENT`. *Why:* ranges are component- and lab-specific and
   sometimes one-sided or descriptive. *Handle:* read the parsed columns for comparison, fall back to
   `RAW_*` and `ORDER_RES_COMMENT` for one-sided/descriptive ranges.

6. **Three time flavors on a result; only the instants are real clock times (§19).**
   *Observe:* `RESULT_DATE` always renders at `12:00:00 AM` (effective/contact date). The real moments are
   `COMP_OBS_INST_TM` (specimen observed/collected) and `COMP_ANL_INST_TM` (analyzed); `ORDER_PROC.RESULT_TIME`
   carries the result instant. *Handle:* sort/trend on `CAST(ORD_DATE_REAL AS REAL)` (the float contact key,
   §18) — its `.01` fraction even tells you *which* same-day contact resulted it — and read `COMP_*_INST_TM`
   if you need wall-clock collection/analysis times.

7. **LOINC is present only as an opaque internal id.**
   *Observe:* `COMPON_LNC_ID` (e.g. SODIUM = 21291) is populated on 41/47 rows with
   `COMPON_LNC_SRC_C_NAME = 'Reported'`, but the human LOINC code/long-name companion documented in the
   schema was **not exported** (§7). *Handle:* you cannot recover the actual LOINC (`2951-2`) from this
   export; key off `COMPONENT_ID(_NAME)` instead, which is reliable.

## Recipes

```sql
-- 1) All resulted lab components with value, range, flag, and resulting encounter — newest first.
SELECT op.DESCRIPTION, r.COMPONENT_ID_NAME,
       r.ORD_VALUE, r.REFERENCE_LOW, r.REFERENCE_HIGH, r.REFERENCE_UNIT,
       COALESCE(NULLIF(r.RESULT_FLAG_C_NAME,''),'(normal)') AS flag,
       r.RESULT_DATE, r.PAT_ENC_CSN_ID
FROM ORDER_RESULTS r
JOIN ORDER_PROC op ON op.ORDER_PROC_ID = r.ORDER_PROC_ID
ORDER BY CAST(r.ORD_DATE_REAL AS REAL) DESC, op.DESCRIPTION, CAST(r.LINE AS INT);

-- 2) Trend one analyte over time, sentinel-safe and correctly sorted.
SELECT r.RESULT_DATE, r.ORD_VALUE, r.ORD_NUM_VALUE
FROM ORDER_RESULTS r
WHERE r.COMPONENT_ID_NAME = 'HEMOGLOBIN A1C'
  AND r.ORD_NUM_VALUE <> 9999999          -- drop qualitative sentinel rows before any math
ORDER BY CAST(r.ORD_DATE_REAL AS REAL);

-- 3) Just the abnormal results.
SELECT op.DESCRIPTION, r.COMPONENT_ID_NAME, r.ORD_VALUE,
       r.RESULT_FLAG_C_NAME, r.REFERENCE_LOW, r.REFERENCE_HIGH, r.RESULT_DATE
FROM ORDER_RESULTS r
JOIN ORDER_PROC op ON op.ORDER_PROC_ID = r.ORDER_PROC_ID
WHERE r.RESULT_FLAG_C_NAME IN ('High','Low');

-- 4) Reassemble an order's narrative report (imaging read or lab interp block).
SELECT GROUP_CONCAT(NARRATIVE, char(10)) AS report
FROM (SELECT NARRATIVE FROM ORDER_NARRATIVE
      WHERE ORDER_PROC_ID = :order_proc_id
      ORDER BY CAST(LINE AS INT));

-- 5) Attach a component's interpretive comment legend (e.g. cholesterol/LDL ranges).
SELECT c.RESULTS_CMT
FROM ORDER_RES_COMMENT c
WHERE c.ORDER_ID = :order_proc_id AND c.LINE = :component_line
ORDER BY CAST(c.LINE_COMMENT AS INT);

-- 6) Find orders that say "Final result" but carry no structured values (the gap in Gotcha #4).
SELECT op.ORDER_PROC_ID, op.DESCRIPTION, op.LAB_STATUS_C_NAME
FROM ORDER_PROC op
LEFT JOIN ORDER_RESULTS r ON r.ORDER_PROC_ID = op.ORDER_PROC_ID
WHERE op.ORDER_TYPE_C_NAME IN ('Lab','Microbiology')
  AND op.LAB_STATUS_C_NAME = 'Final result'
GROUP BY op.ORDER_PROC_ID
HAVING COUNT(r.LINE) = 0;

-- 7) Was this result released to the patient portal, by whom, and when?
SELECT op.DESCRIPTION, mi.RELEASED_YN,
       mr.RELEASE_ACTION_C_NAME, mr.RELEASE_USER_ID_NAME, mr.MYC_REL_UTC_DTTM
FROM ORDER_PROC op
LEFT JOIN ORDER_MYC_INFO mi    ON mi.ORDER_PROC_ID = op.ORDER_PROC_ID
LEFT JOIN ORDER_MYC_RELEASE mr ON mr.ORDER_PROC_ID = op.ORDER_PROC_ID
WHERE op.ORDER_PROC_ID = :order_proc_id
ORDER BY CAST(mr.LINE AS INT);   -- LINE sequences release/unrelease actions
```

## Open questions / specimen notes

- **Where do the missing CMP/CBC/Troponin/BMP numerics live?** In this specimen they're absent from structured
  results and narrative entirely (likely resulted at an external/ED system whose discrete components weren't
  carried). May appear only in a clinical note or top-level PDF. Specimen-specific; verify per export.
- **`RESULT_SUB_IDN`** is `'1'` on essentially every result row here (46/47, one NULL); it's the
  sub-identifier slot for multi-specimen/multi-organism micro results. Trivial in this record — but in a
  heavier micro/culture export expect it to enumerate organisms/specimens, with
  `ORGANISM_SNOMED_CT`/`ORGANISM_QUANTITY` columns becoming meaningful.
- **`OBS_MTHD_ID` and the method payload** were stripped to a bare index here (§7) — a reminder the exported
  column set is a subset of the schema doc.
- **Specimen scope:** labs span 8/9/2018 → 12/4/2025; resulted analytes are limited to lipid panel, BMP,
  A1C, Hep C Ab, H. pylori stool Ag, and COVID PCR. Abnormals seen: triglycerides High, BUN/CO2/VLDL High,
  HDL Low; A1C 5.4 → 5.5 (normal). These are illustrative, not genre facts.
