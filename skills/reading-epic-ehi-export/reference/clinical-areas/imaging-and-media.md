# Imaging, radiology & scanned media — Epic EHI field guide

**Scope.** Two intertwined territories: (1) **imaging orders** (`ORDER_PROC` rows of type `Imaging`:
MRI/CT/XR/CT-angio) with their radiologist read, accession number, and PACS/RIS sign-off workflow; and
(2) the **document/media pipeline** — every scanned or imported file that ships in `raw/Media/`, how the
on-disk filename joins back to the chart, and the two independent engines (DCS scans vs HB letters) that
produce those files. Imaging *result narratives* live in `ORDER_NARRATIVE` (covered briefly here; the
`lab-results` guide owns the order→result spine).

**Where it sits.** Imaging orders are `ORDER_PROC` rows carrying `PAT_ID` (§1) and `PAT_ENC_CSN_ID` (the
ordering contact, §2). Scanned documents carry `PAT_ID` via `DOC_LINKED_PATS`/`DOC_PT_ID` and tie to an
encounter via `PAT_ENC_DOCS`/`DOC_CSN_REFS`; imaging *images* additionally tie to the placer order via
`DOC_LINKED_ORDERS`. Spine: `PATIENT → PAT_ENC (CSN) → ORDER_PROC` for the order; `Media file →
DOC_INFORMATION.SCAN_FILE → {patient, CSN, order}` for the scan.

## Tables

| table | role | rows in specimen | notes |
|---|---|---|---|
| `ORDER_PROC` | **Spine.** One row per ordered procedure; imaging orders are `ORDER_TYPE_C_NAME='Imaging'`. Carries `DESCRIPTION`, `PROC_ID`, `RADIOLOGY_STATUS_C_NAME`, `ORDER_STATUS_C_NAME`, dates, `PAT_ENC_CSN_ID`. | 42 (9 Imaging) | 82 cols. Shared with labs/referrals — always filter on `ORDER_TYPE_C_NAME`. |
| `ORDER_NARRATIVE` | **The radiologist's read.** Line-numbered free text keyed `(ORDER_PROC_ID, LINE)`. The *only* home for imaging report text — imaging has **no `ORDER_RESULTS` rows**. | 465 | Reassemble `ORDER BY CAST(LINE AS INT)`; many blank padding lines (in one specimen ~90% of lines are blank — recipe 2's `TRIM` filter is load-bearing, not cosmetic). |
| `DOC_INFORMATION` | **Media spine.** One row per scanned/imported/e-signed document (DCS master). `SCAN_FILE` = the on-disk `raw/Media/` filename — *the* file→chart join key. Also `DOC_INFO_TYPE_C_NAME`, `DOC_DESCR`, `DOC_CSN`, `DOC_HNO_ID`, `DOC_RFL_ID`. | 22 | 79 cols. Not every referenced doc has a row here (see Gotchas). `DOC_DESCR` is blank for 9/22 rows — fall back to `DOC_INFO_TYPE_C_NAME` (populated for every row) for a usable label: `COALESCE(NULLIF(DOC_DESCR,''),DOC_INFO_TYPE_C_NAME)`. |
| `DOC_INFORMATION_2` | 1:1 supplement (§8) keyed `DOCUMENT_ID`: overflow document attributes. | 22 | **Key-name drift** (§8): the supplement's key is `DOCUMENT_ID`, not the base's `DOC_INFO_ID` — left-join `DOC_INFORMATION_2.DOCUMENT_ID = DOC_INFORMATION.DOC_INFO_ID`. |
| `DOC_INFO_DICOM` | DICOM study/series companion, keyed `DOCUMENT_ID (= DOC_INFO_ID)`. 36 DICOM tag columns beside the key. | 22 | **Mostly empty** here — only `STUDY_INST_UID`/`SERIES_INSTANCE_UID` populate (2 rows); all other tags blank (see Gotchas). |
| `DOC_LINKED_PATS` | Doc → patient crosswalk for EHI export. `DOCUMENT_ID`, `LINE`, `LINKED_PAT_ID`. | 22 | All rows = the one `PAT_ID`. |
| `DOC_LINKED_PAT_CSNS` | Doc → encounter-CSN crosswalk. `DOCUMENT_ID`, `LINE`, `LINKED_PAT_ENC_CSN_ID`. | 5 | Only docs filed under a contact get a row. |
| `DOC_CSN_REFS` | Doc → contact references "by contact serial number" (per schema). Same shape/content as `DOC_LINKED_PAT_CSNS` here. | 5 | `DOCUMENT_ID`, `LINE`, `CSN_REFERENCE`. Redundant with the above in this specimen. |
| `DOC_LINKED_ORDERS` | **Image → placer order.** Ties an imaging document to its `ORDER_PROC`. `DOC_INFO_ID`, `LINE`, `ORDER_ID`. | 2 | `ORDER_ID = ORDER_PROC.ORDER_PROC_ID`. Only the two External Radiology images. |
| `PAT_ENC_DOCS` | Encounter → document index. `PAT_ENC_CSN_ID`, `LINE`, `DOC_INFO_ID`, `PAT_ID`, `PAT_ENC_DATE_REAL`, plus an `ADT_CONTACT_YN` flag. | 12 | References 12 docs; only 3 resolve to `DOC_INFORMATION` (see Gotchas). |
| `PATIENT_DOCS` | Patient-level document index. `PAT_ID`, `LINE`, `DOC_INFO_ID`. | 41 | Only 14 of 41 resolve to `DOC_INFORMATION`. |
| `HSP_ACCT_LETTERS` | **The *other* media engine.** Hospital-billing correspondence letters, keyed `NOTE_ID`. Ties `LTR_*.PDF` files to a guarantor `ACCOUNT_ID`. | 2 | Joins via `NOTE_ID` to `HNO_INFO`/`NOTE_ENC_INFO`, **not** `DOC_INFORMATION`. |
| `ORDER_RAD_READING` | Reading radiologist per order: `ORDER_PROC_ID`, `LINE`, `PROV_ID`, `READING_DT`, `READ_UTC_DTTM`. | 4 | `PROV_ID → CLARITY_SER.PROV_NAME`. |
| `RIS_SGND_INFO` | RIS report sign-off: `ORDER_PROC_ID`, `SIGNED_PROV_ID`, `SIGNED_DATE/TM`, `SIGNED_UTC_DTTM`. | 4 | Who/when the read was signed. |
| `FINALIZE_PHYSICIAN` | Who marked the study **Final** and when: `FINALIZE_PROV_ID`, `FINALIZING_INS_DTTM`, `FINALIZING_INST_UTC_DTTM`. Bare `ORDER_ID` = the parent `ORDER_PROC_ID` (joins directly, unlike the per-instance satellites). | 4 | Third voice of the read→sign→finalize triplet — in one specimen it mirrors `RIS_SGND_INFO` exactly (same orders, same provider). Schema doc names a `FINALIZE_PROV_ID_PROV_NAME` companion but only the bare id ships (§6/§7) — resolve via `CLARITY_SER`. |
| `ORDER_MODALITY_TYPE` | Modality category per imaging order: `ORDER_ID`, `LINE`, `MODALITY_TYPE_C_NAME`; bare `ORDER_ID` = the parent `ORDER_PROC_ID` (joins directly). | 4 | The **only structured modality in the export** — pre-resolved `_C_NAME`, no `ZC_` lookup (§23), and `DOC_INFO_DICOM.MODALITY` is blank (gotcha 4). Beware: the schema-table *description* says "anatomical regions," but the payload is the modality type — §24 label-lies at table-description level. |
| `ORDER_RAD_ACC_NUM` | **Accession number** per order: `ORDER_PROC_ID`, `LINE`, `ACC_NUM` (e.g. `H237948`). | 12 | Keyed on a per-instance/specimen order id — **10 of 12 rows are Labs, 1 Microbiology, only 1 Imaging** (and that row's `ACC_NUM` is just the order id repeated). Accession here is largely a lab/specimen construct; the flagship imaging orders get **none** on a naive `ORDER_PROC_ID` join — bridge to the parent via `ORDER_INSTANTIATED` (see joins/Gotchas). |
| `ORDER_IMAGE_AVAIL_INFO` | PACS image-availability flag/time: `ORDER_ID`, `IMG_AVAIL_YN`, `IMG_AVAIL_DTTM`, `IMAGE_LOCATION_C_NAME`. | 11 | "Images are available in PACS as of …". Its `ORDER_ID` is the **per-instance/child** order id — 10 of 11 do **not** resolve to a parent `ORDER_PROC.ORDER_PROC_ID` (they sit a few ids off the imaging order, e.g. `1034471696/97` near `1034471692`); only `1025926289` matches directly. |
| `ORDER_INSTANTIATED` | **Parent → per-instance bridge.** `ORDER_ID` = the standing/parent order, `INSTNTD_ORDER_ID` = the instantiated per-instance child; *both* sides are real `ORDER_PROC` rows. | 11 | The missing link for the per-instance order-id spine: `ORDER_RAD_ACC_NUM.ORDER_PROC_ID = INSTNTD_ORDER_ID` walks an instance accession up to its parent order (see joins/Gotchas). Does **not** rescue `ORDER_IMAGE_AVAIL_INFO`'s unresolved ids. |
| `ORDER_RAD_STUDY` | RIS study-activity audit: `ORDER_PROC_ID`, `STUDY_MODE_C_NAME`, `USER_ID(_NAME)`, `STUDY_CHAR_CNT`. | 2 | Dictation/transcription activity, not clinical content. |
| `ORDER_DOCUMENTS` | Thin order↔contact-date index over orders that produced a document. `ORDER_ID`, `CONTACT_DATE(_REAL)`, `LINE`. | 4 | Bridges an order to the contact(s) on which its docs were filed. |
| `READING_ACTIVITIES` | RIS reading-workflow activity id per order: `READING_ADV_ACT_ID` + companion `READING_ADV_ACT_ID_ADV_ACTIVITY_NAME` (long-form §6 suffix — a literal `_NAME` lookup misses it). | 1 | Workflow metadata (e.g. "UPH RIS … DICTATION_PALETTE"). |

**Tables to expect but empty/placeholder here** (name them so an analyst knows to look):
- **`DOC_INFO_DICOM`** is present with 22 rows but is a near-empty *placeholder* — see Gotchas.
- **`RAD_THERAPY_*`** (`RAD_THERAPY_ASSOC_COURSE` 62 rows, `RAD_THERAPY_EPISODE_INFO` 1) concern
  **radiation-oncology therapy courses**, a different domain from diagnostic imaging; not covered here.
- No `ZC_DOC_INFO_TYPE` / `ZC_RADIOLOGY_STATUS` lookups — categories ship pre-resolved as `*_C_NAME` (§23).

## How they join

All verified against rows in this specimen.

- **`DOC_INFORMATION.SCAN_FILE` = the literal filename in `raw/Media/`** — the canonical Media→chart join.
  *Verified: `SCAN_FILE='IX-prd-3342771002.JPG'` → `DOC_INFO_ID 419619806` "X-RAY CHEST 2 VIEWS".* This is
  the §14-equivalent for media: the on-disk name IS the foreign key (cf. notes' `Rich Text/<HNO>.RTF`).
- **`DOC_INFORMATION.DOC_INFO_ID` = `DOC_INFORMATION_2.DOCUMENT_ID` = `DOC_INFO_DICOM.DOCUMENT_ID` =
  `DOC_LINKED_PATS.DOCUMENT_ID` = `DOC_LINKED_ORDERS.DOC_INFO_ID` = `DOC_CSN_REFS.DOCUMENT_ID` =
  `PAT_ENC_DOCS.DOC_INFO_ID` = `PATIENT_DOCS.DOC_INFO_ID`** — the DCS document id ties every satellite
  together. *Verified all 22 `DOC_INFORMATION` ids appear in `DOC_LINKED_PATS`.*
- **`DOC_LINKED_ORDERS.ORDER_ID = ORDER_PROC.ORDER_PROC_ID`** — image → placer order.
  *Verified: 419619806 → 1025926282 "XR CHEST 2 VIEWS"; 424322398 → 1034471692 "CT ANGIOGRAPHY NECK".*
- **`PAT_ENC_DOCS.PAT_ENC_CSN_ID` / `DOC_LINKED_PAT_CSNS.LINKED_PAT_ENC_CSN_ID` /
  `DOC_CSN_REFS.CSN_REFERENCE` = `PAT_ENC.PAT_ENC_CSN_ID`** — the contact a doc was filed under (§2).
  *Verified: all 5 linked CSNs (921952141, 922942674, 1076628498, 1081584508, 922943112) resolve to a
  `PAT_ENC` row.* (The discovery report claimed these CSNs were absent from `PAT_ENC`; that was wrong — they
  are present.)
- **`DOC_LINKED_PATS.LINKED_PAT_ID = PATIENT.PAT_ID`** — doc → patient (§1). *All 22 = the one `PAT_ID`.*
- **`HSP_ACCT_LETTERS.NOTE_ID = HNO_INFO.NOTE_ID = NOTE_ENC_INFO.NOTE_ID`** — the billing-letter PDFs join
  through the **notes (HNO) engine**, never `DOC_INFORMATION`. *Verified: both `NOTE_ID`s (3899651265,
  5656893840) exist in `HNO_INFO` and `NOTE_ENC_INFO`; neither appears in `DOC_INFORMATION`.*
  `HSP_ACCT_LETTERS.ACCOUNT_ID` = the guarantor account.
- **`ORDER_NARRATIVE.ORDER_PROC_ID = ORDER_PROC.ORDER_PROC_ID`** — the radiology read text. *Verified: CT
  angio 1034471692 reassembles to the full "History/Technique/Findings/Impression" report.* **Key column is
  `ORDER_PROC_ID`, not `ORDER_ID`** (the discovery report and some schema notes call it `ORDER_ID`).
- **`ORDER_RAD_READING.ORDER_PROC_ID` / `RIS_SGND_INFO.ORDER_PROC_ID` = `ORDER_PROC.ORDER_PROC_ID`** — these
  two read/sign-off satellites *do* key to the parent imaging order. *Verified: order 1034471692 → reading &
  sign-off prov `8800099` ("GENERIC EXTERNAL DATA PROVIDER") at `7/30/2024 8:04 PM`; all 4 reading rows and
  all 4 sign-off rows are Imaging orders.* `FINALIZE_PHYSICIAN.ORDER_ID` (bare name, same §5/§6 drift) and
  `ORDER_MODALITY_TYPE.ORDER_ID` also equal the parent `ORDER_PROC_ID` and join directly.
- **`ORDER_RAD_ACC_NUM.ORDER_PROC_ID` and `ORDER_IMAGE_AVAIL_INFO.ORDER_ID` do NOT key to the parent imaging
  order** — they live on a **per-instance/specimen order-id spine**. *Verified: of `ORDER_RAD_ACC_NUM`'s 12
  rows, 10 join to Labs and 1 to Microbiology; the only Imaging join (`1025926289`) has `ACC_NUM` = the order
  id itself. `ORDER_IMAGE_AVAIL_INFO`: 10 of 11 `ORDER_ID`s don't resolve in `ORDER_PROC` at all (they sit a
  few ids off the imaging order, e.g. `1034471696/97` ≈ `1034471692`).* So accession here is largely a
  lab/specimen construct: **inspect `ORDER_TYPE` before attributing an accession to imaging, and do not
  conclude "imaging has no accession" from the naive `ORDER_PROC_ID` join** — the imaging accession lives on
  the per-instance spine, not the parent. Note the bare-`ORDER_ID` column name on
  `ORDER_IMAGE_AVAIL_INFO`/`ORDER_DOCUMENTS`/`DOC_LINKED_ORDERS`/`READING_ACTIVITIES` (§5/§6 family drift);
  for `DOC_LINKED_ORDERS`/`ORDER_DOCUMENTS` the value equals `ORDER_PROC_ID`, but for `ORDER_IMAGE_AVAIL_INFO`
  it is the per-instance id.
- **`ORDER_INSTANTIATED` is the bridge from the per-instance spine back to the parent**: `ORDER_ID` = the
  standing/parent order, `INSTNTD_ORDER_ID` = the instantiated per-instance child, and both resolve in
  `ORDER_PROC`. Join `ORDER_RAD_ACC_NUM.ORDER_PROC_ID = ORDER_INSTANTIATED.INSTNTD_ORDER_ID` to walk an
  instance accession up to a *different* parent order — *verified: 10 of 12 accession rows bridge this way,
  including the lone imaging accession child (`1025926289`) up to its imaging parent.* It does **not** explain
  `ORDER_IMAGE_AVAIL_INFO`'s unresolved ids: those appear in *neither* `ORDER_INSTANTIATED` column nor
  `ORDER_PARENT_INFO` — those child orders were simply never exported as rows anywhere, so no exported bridge
  exists for them.
- **`ORDER_RAD_READING.PROV_ID = CLARITY_SER.PROV_ID` → `PROV_NAME`** — the reading radiologist (§5).

## Unstructured tie-back

This domain **is** largely the unstructured material; here is how each piece reassembles and reattaches:

- **Radiology report text** → `ORDER_NARRATIVE` lines, `ORDER BY CAST(LINE AS INT)` (§9/§11), concatenated.
  Attaches to the order by `ORDER_PROC_ID`; the order attaches to its encounter by `PAT_ENC_CSN_ID`.
- **Scanned images/PDFs** → the byte stream is the file in `raw/Media/<SCAN_FILE>`; the *metadata* is the
  `DOC_INFORMATION` row. Reattach via `SCAN_FILE`, then to patient/CSN/order through the satellites above.
- **Billing-letter PDFs** (`LTR_*`) → bytes in `raw/Media/`; metadata via `HSP_ACCT_LETTERS.NOTE_ID` →
  `HNO_INFO`/`NOTE_ENC_INFO` (the same machinery the `notes-documents` guide describes). Filename encodes
  it: `LTR_PRD_<deptId>_<NOTE_ID>.PDF`.
- **Referral attachments** → `DOC_INFORMATION` rows whose `DOC_HNO_ID` points at an `HNO_INFO` note (e.g.
  Referral Attachment doc 274661092 → `DOC_HNO_ID 3441333955`, present in `HNO_INFO`).
- **Top-level print PDFs** (`raw/*.PDF`): the `MANDEL_*.PDF` "Chart Documents" abstract and
  `D-PRD-<id> Radiology MRI.PDF` are export-time print-renderings, **not** rows. They re-present the same
  scans as page images. *Verified: the MRI PDF's embedded id `1252065769` appears in **no** table and in
  **no** TSV — it is a loose artifact with no structured back-link.* `readme.PDF` and the ROI cover letter
  are export-process artifacts (orientation + the request letter), also rowless.

## Gotchas & quirks (chased to *why*)

1. **`SCAN_FILE` has three flavors — only one is an actual file.** Of 14 non-null `SCAN_FILE` values: 10
   are real filenames present on disk; 3 are **bare numeric DCS storage IDs** (`251561956`, `254112907`,
   `258017835`) that are *not* media filenames and have no file; 1 is a real-looking filename that is
   **referenced but missing** (`IX-prd-3342771001.PDF`). *Mechanism:* `SCAN_FILE` is the DCS attachment
   handle. When the exporter writes the blob to `Media/` it overwrites the handle with the exported
   filename; when it does **not** export the blob (here, the Physician Order / Health Screening / Therapy
   Scan — which appear only as page-images inside the `MANDEL_*.PDF` abstract) the handle stays the raw
   internal id. *Handle:* treat `SCAN_FILE LIKE '%.%'` as "has a file"; bare-id rows mean "metadata only,
   blob not in this export." Always cross-check `raw/Media/` (or `_INDEX.HTML`, which lists exactly the 12
   exported files) before assuming a file exists.

2. **Index tables reference far more documents than `DOC_INFORMATION` exports.** `PAT_ENC_DOCS` (12),
   `PATIENT_DOCS` (41), and `DOC_LINKED_PATS` together name **58 distinct document ids**, but only **22**
   have a `DOC_INFORMATION` row. *Mechanism:* the encounter/patient document *indexes* are exported wholesale
   (they're tiny pointer rows), but the document *bodies/metadata* are exported selectively — many docs are
   omitted (other patients' docs on a shared encounter, suppressed content types, or docs the ROI scope
   excluded). *Handle:* a `DOC_INFO_ID` in `PAT_ENC_DOCS`/`PATIENT_DOCS` that does not resolve in
   `DOC_INFORMATION` is **expected**, not a broken join — it means "this chart had a document there, but its
   content wasn't included." Left-join and tolerate NULLs.

3. **The `.TIF` extension lies — they're JPEG.** `IX-prd-3540546502.TIF` and `IX-prd-4153368154.TIF` are
   JFIF/JPEG byte streams (confirmed by `file(1)`), not TIFF. *Mechanism:* the export preserves the
   *original stored filename/extension* from the source scanning system, which mislabeled the codec. *Handle:*
   sniff the magic bytes / use `file(1)`; never trust the media extension. (Same caution applies to any
   `.PDF` that might actually be an image, etc.)

4. **`DOC_INFO_DICOM` is a structural placeholder, but not *entirely* empty.** All 22 rows exist; of the 36
   DICOM tag columns beside the `DOCUMENT_ID` key, 34 (MODALITY, STUDY_DATE, ACCESSION, pixel geometry…) are
   blank on every row. But the **two External
   Radiology images** (X-ray chest, CT angio neck) *do* carry a `STUDY_INST_UID` and `SERIES_INSTANCE_UID`.
   *Mechanism:* Epic always emits the DICOM companion row per document; it populates the study/series UIDs
   when the image arrived with PACS identity, but the rich tag set stays empty because the images were
   delivered as flat downsampled rasters (faxed/scanned JPEG), not full DICOM objects. *Handle:* presence of
   the table ≠ presence of DICOM data; check the specific columns you need are non-empty. (The discovery
   report's claim that *all* DICOM columns are empty is slightly wrong — the two UID columns populate.)

5. **The imaging "images" are thumbnails, not diagnostic-resolution.** The chest-XR and CT-angio JPEGs are
   ~150×120–150 px, 2.5–3.7 KB. *Mechanism:* these are preview rasters Epic stored from an *outside* imaging
   feed (reading provider `8800099` = "GENERIC EXTERNAL DATA PROVIDER"), not the originating modality output.
   The diagnostic content lives in the **read** (`ORDER_NARRATIVE`), not the pixels. *Handle:* for clinical
   meaning read the narrative; treat the image file as a low-res reference only.

6. **Two independent pipelines feed `raw/Media`, sharing no key.** (a) **DCS scans/imports** →
   `DOC_INFORMATION.SCAN_FILE` (prefixes `IX-`, `D-`, `R_DOC_`). (b) **Hospital-billing letters** →
   `HSP_ACCT_LETTERS.NOTE_ID` → HNO engine (prefix `LTR_`). The `LTR_` files are **absent from
   `DOC_INFORMATION` entirely**. *Mechanism:* correspondence letters are generated by the notes/letter
   engine against a guarantor account, a different subsystem than document imaging/scanning (§41, two id
   spaces). *Handle:* to resolve a Media file, branch on prefix — `LTR_*` → `HSP_ACCT_LETTERS`; everything
   else → `DOC_INFORMATION.SCAN_FILE`. (And note: `LTR_` letters may be addressed to a *guarantor* about a
   *dependent* — the named addressee is not necessarily the export's patient.)

7. **Filename prefix encodes document genre (Epic DCS naming).** `IX-` = imported imaging/scanned result;
   `D-` = a scanned/uploaded Document (e.g. referral attachment); `R_DOC_` = a Released-document /
   authorization PDF generated by the MyChart ROI workflow; `LTR_` = a billing/correspondence Letter. `prd`/
   `PRD` = the production Epic instance. *Handle:* the prefix predicts both the join path (gotcha 6) and the
   `DOC_INFO_TYPE_C_NAME`, useful for triaging a folder of files before touching SQL.

8. **Imaging orders have NO `ORDER_RESULTS` rows.** The order→discrete-result spine that labs use is empty
   for imaging; the entire result is the free-text read in `ORDER_NARRATIVE`. *Mechanism:* radiology results
   are reported as a narrative report, not discrete analytes. *Handle:* do not left-join imaging orders to
   `ORDER_RESULTS` expecting values; go to `ORDER_NARRATIVE`. (See the `lab-results` guide.)

## Recipes

```sql
-- 1) All imaging orders with status, ordering date, and whether a read narrative exists.
SELECT op.ORDER_PROC_ID, op.ORDERING_DATE, op.DESCRIPTION,
       op.ORDER_STATUS_C_NAME, op.RADIOLOGY_STATUS_C_NAME,
       COUNT(onr.LINE) AS narrative_lines
FROM ORDER_PROC op
LEFT JOIN ORDER_NARRATIVE onr ON onr.ORDER_PROC_ID = op.ORDER_PROC_ID
WHERE op.ORDER_TYPE_C_NAME = 'Imaging'
GROUP BY op.ORDER_PROC_ID
ORDER BY CAST(op.PAT_ENC_DATE_REAL AS REAL);

-- 2) Reassemble one radiology report (read) in order.
SELECT GROUP_CONCAT(NARRATIVE, char(10)) AS report
FROM (SELECT NARRATIVE FROM ORDER_NARRATIVE
      WHERE ORDER_PROC_ID = '1034471692'        -- CT ANGIO NECK
        AND TRIM(COALESCE(NARRATIVE,'')) <> ''
      ORDER BY CAST(LINE AS INT));

-- 3) Imaging order -> reading radiologist + sign-off. (These two satellites DO key to the
--    parent ORDER_PROC_ID.) NOTE: accession (ORDER_RAD_ACC_NUM) and PACS-availability
--    (ORDER_IMAGE_AVAIL_INFO) live on a per-instance/specimen order-id spine, so a naive
--    join on op.ORDER_PROC_ID returns NULL for the flagship images — see Gotchas, don't
--    add them here expecting an accession. To reach an accession, bridge through
--    ORDER_INSTANTIATED: oran.ORDER_PROC_ID = oi.INSTNTD_ORDER_ID AND oi.ORDER_ID = op.ORDER_PROC_ID.
SELECT op.ORDER_PROC_ID, op.DESCRIPTION,
       rr.PROV_ID, ser.PROV_NAME AS reading_prov, rr.READ_UTC_DTTM,
       sg.SIGNED_UTC_DTTM
FROM ORDER_PROC op
LEFT JOIN ORDER_RAD_READING rr  ON rr.ORDER_PROC_ID = op.ORDER_PROC_ID
LEFT JOIN CLARITY_SER ser       ON ser.PROV_ID = rr.PROV_ID
LEFT JOIN RIS_SGND_INFO sg      ON sg.ORDER_PROC_ID = op.ORDER_PROC_ID
WHERE op.ORDER_TYPE_C_NAME = 'Imaging';

-- 4) Every exported Media file -> chart, all the way to the order (when imaging).
SELECT di.SCAN_FILE, di.DOC_INFO_TYPE_C_NAME,
       COALESCE(NULLIF(di.DOC_DESCR,''), di.DOC_INFO_TYPE_C_NAME) AS doc_label,  -- DESCR blank for 9/22
       lp.LINKED_PAT_ID, cs.LINKED_PAT_ENC_CSN_ID AS csn,
       lo.ORDER_ID, op.DESCRIPTION AS order_descr
FROM DOC_INFORMATION di
LEFT JOIN DOC_LINKED_PATS     lp ON lp.DOCUMENT_ID = di.DOC_INFO_ID
LEFT JOIN DOC_LINKED_PAT_CSNS cs ON cs.DOCUMENT_ID = di.DOC_INFO_ID
LEFT JOIN DOC_LINKED_ORDERS   lo ON lo.DOC_INFO_ID = di.DOC_INFO_ID
LEFT JOIN ORDER_PROC          op ON op.ORDER_PROC_ID = lo.ORDER_ID
WHERE di.SCAN_FILE LIKE '%.%'             -- real filenames only (excludes bare-id rows)
ORDER BY di.DOC_INFO_ID;

-- 5) The OTHER media engine: billing-letter PDFs -> guarantor account + sending user.
SELECT l.NOTE_ID, l.LETTER_SENT_DATE, l.LET_CREATE_USER_ID_NAME, l.ACCOUNT_ID
FROM HSP_ACCT_LETTERS l;
-- on-disk file is LTR_PRD_<dept>_<NOTE_ID>.PDF; metadata also in HNO_INFO/NOTE_ENC_INFO via NOTE_ID.

-- 6) Reconcile: which referenced documents were NOT exported with a DOC_INFORMATION row?
SELECT DISTINCT ped.DOC_INFO_ID, ped.PAT_ENC_CSN_ID
FROM PAT_ENC_DOCS ped
LEFT JOIN DOC_INFORMATION di ON di.DOC_INFO_ID = ped.DOC_INFO_ID
WHERE di.DOC_INFO_ID IS NULL;            -- pointer rows whose document body/metadata wasn't included
```

## Open questions / specimen notes

- **Missing file:** `IX-prd-3342771001.PDF` (DOC 419619805, "ECG- 12 LEAD WITHOUT RHYTHM", type *External
  Cardiology Imaging*) is named in `DOC_INFORMATION.SCAN_FILE` but is absent from `raw/Media/` and from
  `_INDEX.HTML`. A genuine export gap — whether suppressed by content type, a zero-byte source, or an export
  error is unresolved. *Specimen-specific.*
- **`DOC_CSN_REFS` vs `DOC_LINKED_PAT_CSNS`** carry identical (DOCUMENT_ID, CSN) pairs in this specimen.
  Their schema descriptions differ slightly ("references … by contact serial number" vs "linked … for EHI
  Export"); whether they can diverge (e.g. a doc referenced from a contact other than the one it's filed
  under) is not observable here.
- **DICOM richness:** in a specimen where imaging arrives as true DICOM objects, would `DOC_INFO_DICOM`'s
  MODALITY/pixel-geometry/accession columns populate and full-resolution pixels be exported? Here only
  study/series UIDs populate and only thumbnails ship. *Cannot resolve from this specimen.*
- **`PROV_ID 8800099` = "GENERIC EXTERNAL DATA PROVIDER"** appears as both reader and signer for the
  outside-fed images — a placeholder identity for externally-sourced reads, not a real radiologist. The
  named radiologist, if any, is inside the `ORDER_NARRATIVE` text, not the structured `PROV_ID`.
- **Facility-MRN note:** the abstract/MRI print PDFs carry a *facility* MRN distinct from the export's Epic
  master `PAT_ID` and org MRN — the same person across UnityPoint facilities (§1). Display from the right
  identifier for the right facility.
