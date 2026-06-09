# Build recipe: export shape and quality oddities

This artifact is a hand-curated export-quality register built from `db/ehi.sqlite` plus the raw payload
folders under `raw.unredacted/`. The retained source is `viewmodel.json`; there is no separate `parts/`
pipeline because the output is a small set of verified findings rather than a reusable computation.

## Target schema

```ts
interface ViewModel {
  meta: { title: string; subtitle: string; scope: string };
  summary: string;
  sections: Section[];
  stats: Stat[];
  lanes: Lane[];
  oddities: Oddity[];
  rulebook: Rule[];
  evidence: Record<string, Evidence>;
}

type LaneId = "mechanics" | "clinical" | "boundary";

interface Section {
  id: string;
  title: string;
  narrative: { text: string; cites: string[] }[];
}

interface Stat {
  label: string;
  value: string;
  note: string;
  lane: LaneId;
}

interface Lane {
  id: LaneId;
  title: string;
  thesis: string;
  count: number;
}

interface Oddity {
  id: string;
  lane: LaneId;
  title: string;
  stumper: string;       // failed expectation
  likelyCause: string;   // raw observation or compact mechanism
  whyItMatters: string;  // why the expectation was reasonable
  readerMove: string;    // safer extraction/read rule
  rawChecks: { title: string; rows: string[] }[];
  confidence: "high" | "medium";
  evidenceIds: string[];
  tags: string[];
}

interface Evidence {
  kind: "fact" | "note" | "message";
  who?: string;
  date?: string;
  text?: string;
  quote?: string;
}
```

## Source and abstraction recipe

### Payload/detail gaps

Probe parent/header/index tables against expected child tables or files.

- **Final lab headers without analytes**: start from `ORDER_PROC` rows where `LAB_STATUS_C_NAME` contains
  `Final`, then left join `ORDER_RESULTS` by `ORDER_PROC_ID`. Keep only lab-like descriptions with
  `COUNT(ORDER_RESULTS.ORDER_PROC_ID)=0`; contrast against similar final labs that do have child rows.
- **Document pointer/body gaps**: union `PATIENT_DOCS.DOC_INFO_ID` and `PAT_ENC_DOCS.DOC_INFO_ID`, left join
  `DOC_INFORMATION`, then compare nonblank `DOC_INFORMATION.SCAN_FILE` values with files in
  `raw.unredacted/Media/`.
- **Result sentinel/comment handling**: inspect `ORDER_RESULTS.ORD_NUM_VALUE`, `ORD_VALUE`,
  `RESULT_*_START_LN`, `RTF_*_START_LINE`, and `ORDER_RES_COMMENT`. Classify `9999999` as a sentinel only
  after verifying the textual value lives elsewhere.
- **ORDER_NARRATIVE density**: group `ORDER_NARRATIVE` by `ORDER_PROC_ID`, count blank versus nonblank
  `NARRATIVE`, and compare distinct orders with `ORDER_RESULTS`.
- **Medication supplement shells**: check payload columns in `ORDER_DISP_INFO` and `ORDER_AUTH_INFO`;
  do not treat row count as evidence of fill or authorization detail.

### Join/key traps

Probe plausible joins and record both the failed target and the target that actually matches.

- **Note encounter linkage**: compare `NOTE_ENC_INFO.PAT_ENC_CSN_ID` and `HNO_INFO.PAT_ENC_CSN_ID` against
  `PAT_ENC.PAT_ENC_CSN_ID`; keep this finding about the blank/misleading encounter-link field, not about
  whether a consumer chose to read the external note files.
- **ORDER_DOCUMENTS under-keying**: inspect live columns with `PRAGMA table_info('ORDER_DOCUMENTS')`; compare
  `ORDER_DOCUMENTS.ORDER_ID` to `DOC_LINKED_ORDERS.ORDER_ID`.
- **ORDER_IMAGE_AVAIL_INFO order domain**: left join each `ORDER_ID` to both `ORDER_PROC.ORDER_PROC_ID` and
  `ORDER_MED.ORDER_MED_ID`.
- **Supplement key aliases**: inspect `PAT_ENC_3`, `ORDER_MED_2`, and `ORDER_MED_SIG` live key columns; test
  joins using the actual column names rather than the family-default names.

### Schema/documentation mismatches

Treat schema HTML as a searchable guide, not the column authority.

- Build the live column set from `_tables` plus `pragma_table_info(table_name)` for populated non-internal
  tables.
- Build the documented set from `_schema_column` for the same populated tables.
- Count live-not-documented and documented-not-live columns.
- Find concrete companion-name examples by matching live shorter ID columns to documented absent columns
  with suffixes such as `_PROV_NAME`, `_DX_NAME`, `_PROC_NAME`, `_PAYOR_NAME`, and `_EXTERNAL_NAME`.
- Verify that master lookup tables such as `CLARITY_SER`, `CLARITY_DEP`, `CLARITY_EDG`, and `CLARITY_EAP`
  are populated before saying labels are unavailable.

## Validation

Run:

```bash
jq empty deep-dives/data-oddities/viewmodel.json
bun lib/validate-extract.ts deep-dives/data-oddities/viewmodel.json
bun build deep-dives/data-oddities/index.html --outdir /tmp/data-oddities-dist
bun skills/ehi-deep-dives/scripts/build-site.ts deep-dives /tmp/ehi-site-review
bun skills/ehi-deep-dives/scripts/screenshot.ts /tmp/ehi-site-review/data-oddities /tmp/ehi-data-oddities-top.png 1100 4000 2600
```

The page should read as an export-shape report. Remove any case whose evidence is only "the clinical record
does not include a desired measurement."
