---
name: reading-epic-ehi-export
description: >-
  Read, load, and make sense of an Epic "EHI Export" — the thousands-of-TSV-tables-plus-schema-HTML
  dump a patient receives from an Epic-based health system (folders named EHITables, EHITables Schema,
  Rich Text, Media). Use this whenever you are handed such an export, or any folder of Epic Clarity/
  Chronicles-style tables (PAT_ENC, ORDER_MED, HNO_INFO, ZC_/CLARITY_ master files, *_HX history tables,
  CSN/PAT_ID identifiers), or when a task involves loading one into SQLite, mapping its schema, finding
  the clinical notes/messages, or interpreting Epic's data-modeling conventions (CSN contacts,
  *_DATE_REAL dates, _C_NAME categories, base+supplement tables, denormalized _NAME companions). The
  foundational skill of a two-skill tower; the ehi-deep-dives skill builds on it.
---

# Reading an Epic EHI export

An **EHI Export** is what an Epic-based health system hands a patient who requests their full electronic
health information: a near-raw dump of Epic's underlying database. You get **thousands of tab-separated
tables** (one `.tsv` per Chronicles/Clarity table), a matching **HTML schema file per table**, and
folders of **unstructured material** — RTF clinical notes, MyChart secure messages, and scanned media.
It is faithful, enormous, sparsely populated, and almost entirely undocumented for a lay reader. This
skill is how you walk into one cold and come out understanding it.

This file is the **method and the map**. The genre's grammar lives in two reference layers you load on
demand:

- **`reference/patterns/general-patterns.md`** — the modeling conventions that recur in *every* Epic
  export (CSN contacts, `*_DATE_REAL` time, master-file IDs, base+supplement assembly, `_C_NAME`
  categories, denormalized `_NAME` companions, effective-vs-instant time, history/audit tables,
  status/soft-delete/sentinel encodings). Read this first; it pays for itself in every table you touch.
- **`reference/clinical-areas/`** — one field guide per clinical domain. Each names the tables, the joins,
  the gotchas, and how the notes/messages tie back. Read the one for the domain you're working in — the
  full annotated index of all 18 guides is in [Modeling patterns and clinical-area guides](#modeling-patterns-and-clinical-area-guides)
  below (one line each: filename + what it covers).

> **One specimen ≠ the genre.** Everything here is written for *anyone's* Epic export, not one person's.
> As you learn, constantly separate **genre** facts (true of Epic EHI exports in general — keep them in a
> skill) from **specimen** facts (true only of the export in front of you — keep them in generated
> artifacts). When this skill states a number, it's illustrative; verify against your own export.

---

## The method — your way of working

This is the engine. The two reference layers above are just this method already run on the schema and the
tables. When the export surprises you, come back here.

### 1. Move top-down × bottom-up, constantly

Hold two questions in your head at once and let them argue.

- **Top-down:** *What should an export like this contain?* A health record has encounters, problems,
  meds, labs, vitals, notes, messages, allergies, immunizations, demographics, coverage, billing. Before
  opening a file, predict which tables must exist and what columns they'd carry.
- **Bottom-up:** *What does this file actually show me?* Open the table, read real rows, read the schema
  HTML, and see what's truly there.

The discoveries live in the **gap** between the two. You expect a `marital status` column on the patient
table and it isn't there (top-down miss → a specimen/genre fact about what this org exports). You open a
table you didn't predict (`PROBLEM_LIST_ALL` with 56 rows for a 5-problem patient) and the row count
forces a question (bottom-up surprise → problems, immunizations, and allergies share one master file).
Neither direction alone finds these; the oscillation does.

### 2. Explain *why*, not just *what* (the rule that decays first)

When a value, table, or join looks quirky, **that is a signal to dig, not to paper over.** Form a
hypothesis about *why the system produces this shape* — what Epic/Chronicles is doing underneath — and
test it against more rows until the mechanism is clear. A pattern you can explain mechanistically is one
the next analyst can trust; a pattern you only described from the surface will mislead them.

Worked example. A lab result row shows `ORD_NUM_VALUE = 9999999` — an absurd measurement. *What* says
"the value is 9,999,999." *Why* asks: a numeric column can't hold "NONREACTIVE", so Epic must need a
sentinel for non-numeric results. Test it: every row with `ORD_NUM_VALUE = 9999999` has a qualitative
string in `ORD_VALUE` ("NONREACTIVE", ">90", "Negative"). Mechanism found: **9999999 is a sentinel
meaning "the real value is the text in `ORD_VALUE`."** Now you can trust it everywhere, and you'd never
average that column without filtering the sentinel. That's the difference between a guide and a trap.

### 3. Specimen vs. genre — ask it every single time

Every fact you learn gets sorted: does this belong to **Epic EHI exports in general** (→ skill) or **only
this export** (→ generated artifact)? The discipline is what keeps the skills portable. "Patient
encounters are keyed by `PAT_ENC_CSN_ID`" is genre. "This patient has 169 encounters from 2018–2025" is
specimen. A subtle one: "this export ships `_C_NAME` labels and **no** `ZC_` code tables" turned out to
be a per-org *export configuration* choice, not a universal — so it's a genre *variation* to flag, not a
specimen fact and not a flat rule. When unsure which bucket, say so in the guide.

### 4. Use the skills while you write them; friction is the real work

These reference files are not documents you file and revisit at the end — they are the **instructions
your sub-agents operate under right now.** Hand a workflow the current draft of the relevant guide, have
its agents actually follow it, and require them to report exactly where it failed: what table was
missing, which join didn't hold, which instruction was ambiguous, which pattern frayed. Those **friction
reports** — not the lead's impressions — are the raw material for the next revision. Developing, using,
and refining a guide are one loop, not three phases.

### 5. Workflows are the default unit of work

A large export defeats solo reading: 590 populated tables, 25k rows, hundreds of notes and messages. You
cover it by **fanning sub-agents across it and synthesizing what they bring back** — never by the lead
skimming a few tables and writing from memory. The reusable orchestration **shapes** (syntax-independent,
so they outlive any one tool):

- **Fan-out reading.** Split the surface (tables by domain, notes by date, a wide table by column
  family) across many agents that read in parallel and each return a structured finding. Use for
  inventory, domain mapping, and any "read all of X" sweep. *The whole discovery pass is this shape.*
- **Adversarial verification.** For each claim a reader makes ("payments match charges via TX_ID"), spawn
  an independent skeptic prompted to *refute* it against real rows. Keep the claim only if refutation
  fails. Use before any load-bearing join or number goes into a guide or a deep dive.
- **Loop-until-dry.** For unknown-size discovery (how many quirks does this domain have?), keep spawning
  finders until N consecutive rounds surface nothing new. Simple "top-K" passes miss the tail.
- **Judge panel.** When readings compete (which table is the authoritative current med list?), generate
  several independent answers and have judges score them against the data, then synthesize the winner.
- **File output + schema response.** Pick the channel by the kind of output. *Large data* (a full
  normalized dataset, a drafted guide) → **write it to a file**, because a schema response is bounded by
  what the agent can transcribe inline and silently truncates; the return is then just a receipt (path,
  counts). *Judgement* (findings, a verdict, friction) → a **file or a rich schema response**, whichever
  fits — but it is a first-class deliverable: **capture it and use it, never let it evaporate** with the
  workflow result. The lead orchestrates from the receipts, reconciles the files, and always reads the
  judgement.

Match the shape to the question; compose them. The lead **orchestrates and synthesizes** — poses the
question, fans the agents, reconciles the returns — and resists the pull to just do it solo, because
that's where the coverage and the learning quietly vanish.

---

## Mapping the schema

How to go from a folder of thousands of files to a working understanding. Concrete, and portable to any
export.

### What you're holding

A typical Epic EHI export folder contains:

| Folder / file | What it is |
|---|---|
| `EHITables/*.tsv` | The data. One tab-separated file per Chronicles/Clarity table. **Most are empty** — only the tables relevant to this patient are populated (in one specimen, 590 of 5,411 had any rows). |
| `EHITables Schema/*.htm` | One HTML doc per table: description, primary key, and per-column name/type/discontinued/description. This is Epic's own documentation — your Rosetta Stone. |
| `Rich Text/*.RTF` | Clinical notes, as RTF. Filenames encode the note (HNO) id. |
| `Media/` | Scanned/imported images and PDFs (with an `_INDEX.HTML`). |
| top-level PDFs | An ROI cover letter, a `readme.PDF` (generic Epic orientation), and often print-renderings (a visit-summary abstract, outside reports). |

The TSV dialect (stable across exports, and documented at <https://open.epic.com/EHITables>): **tab-
delimited, CRLF line endings, no field quoting.** Free text never contains a raw newline or tab — long
text is chunked into **line-numbered child rows** (a `LINE` column) instead — so row-per-physical-line
parsing is safe. Every value is text; empty cells are empty strings (load them as NULL).

### Step 1 — Load everything into SQLite

SQLite is the query substrate for the whole project. The loader is portable (no specimen-specific
assumptions) and lives in `scripts/`:

```bash
bun scripts/load-ehi-sqlite.ts  <rawDir> [db/ehi.sqlite]   # TSVs → one SQLite table each
bun scripts/load-schema-docs.ts <rawDir> [db/ehi.sqlite]   # schema HTML → queryable metadata
```

This gives you the data plus three **catalog tables** that make the schema itself queryable — the single
biggest force-multiplier for understanding an export:

- `_tables(table_name, n_rows, n_columns, source_file)` — which tables actually have data.
- `_schema_table(table_name, description)` — Epic's one-paragraph description of every table.
- `_schema_column(table_name, ordinal, column_name, data_type, discontinued, is_pk, description)` —
  the per-column documentation (tens of thousands of rows). Grep the *meaning* of any column in SQL.

Then query with the bundled read-only helper (in this skill's `scripts/`): `bun scripts/q.ts "<SQL>"`
(JSON) or `--table` (aligned). It reads `./db/ehi.sqlite` by default — set `EHI_DB=/path/to/ehi.sqlite` to
point elsewhere. Copy it next to your DB (e.g. a project `lib/`) if a shorter path is convenient.

### Step 2 — Inventory by reading the catalog, not by `ls`

Start from what's populated and what it means:

```sql
-- The substantive tables, biggest first, with Epic's description:
SELECT t.n_rows, t.table_name, substr(s.description,1,120)
FROM _tables t LEFT JOIN _schema_table s USING(table_name)
ORDER BY t.n_rows DESC;

-- Find every table for a domain by searching descriptions AND names:
SELECT table_name, n_rows FROM _tables JOIN _schema_table USING(table_name)
WHERE description LIKE '%immuniz%' OR table_name LIKE 'IMM%';
```

**Crucial caveat — trust the data's columns, not the schema doc's.** The schema HTML lists the
*aspirational* column set; the actual TSV/SQLite columns can differ (some denormalized `_NAME` companions
aren't materialized; an id column documented as `VISIT_PROV_ID_PROV_NAME` ships as bare `VISIT_PROV_ID`).
Always confirm real columns with `PRAGMA table_info('THE_TABLE')` before writing a query. The schema-doc
*coverage* can even change between DB builds, so a per-table doc-count in someone's notes is a snapshot, not
an invariant. And don't assume a supplement family's size — enumerate it (`SELECT table_name FROM _tables
WHERE table_name LIKE 'PATIENT%'`), since a record may have `_2.._6`, not the `_2.._4` you guessed.

**Second crucial caveat — everything is stored as TEXT, so `CAST` before you order or aggregate.** Numeric
ids, `LINE`, and the `*_DATE_REAL` floats all have TEXT affinity and sort *lexically*. `ORDER BY`/`MIN`/
`MAX`/range filters lie unless you `CAST(... AS INTEGER/REAL)` (general-patterns §17). This is the single
most common source of "the data looks wrong" — see the date example in the quickstart below.

### Step 3 — Locate the unstructured material with fan-out

The notes, messages, and media are where the clinical story lives. Map them at scale (the join paths are
subtle — see the `clinical-notes-and-documents`, `patient-provider-messaging`, and `imaging-and-media`
guides, indexed in `reference/clinical-areas/README.md`):

- **Notes**: the rich-text body lives **only** at `Rich Text/<NOTE_ID>...RTF` — there is no DB body column.
  Tie a note to its encounter via **`HNO_INFO.PAT_ENC_CSN_ID`** (often NULL — many notes have no encounter
  link). Do **not** use `NOTE_ENC_INFO.PAT_ENC_CSN_ID` (it is all-NULL; that table links by its own
  `CONTACT_SERIAL_NUM`). Plain-text notes are in `HNO_PLAIN_TEXT`; **imaging "results" are narrative-only**
  in `ORDER_NARRATIVE` (no `ORDER_RESULTS` rows). The filename carries an inverted-date contact key
  (general-patterns §22).
- **Messages**: `MYC_MESG` / `MYC_MESG_RTF_TEXT` (new) and `MSG_TXT` (older, split by build-era) ↔
  `PAT_MYC_MESG` / `MSG_ROUTING_PAT_ENC`; a shared encounter `CSN` is the thread key.
- **Media**: `Media/*` ↔ `DOC_INFORMATION.SCAN_FILE` (the on-disk filename is the join key) ↔ patient /
  encounter / order — plus a second pipeline for billing letters (`HSP_ACCT_LETTERS.NOTE_ID`).

Note that some domains have **no** note/media tie-back at all — their "unstructured" content is inline
free-text columns (allergies, social history) or absent (vitals). Don't hunt for RTF where there is none.
Don't sample three files by hand — fan a sub-agent across each corpus to characterize types, date span,
and linkage, then synthesize.

### Step 3 quickstart — the first 15 minutes on a new export

1. Run both loaders → `db/ehi.sqlite`.
2. `SELECT count(*) FROM _tables` and the "biggest tables" query above — get the shape.
3. Read `reference/patterns/general-patterns.md` — internalize CSN, `*_DATE_REAL`, `_C_NAME`,
   base+supplement, `_NAME` companions.
4. Find the patient and the time span: the `PATIENT` table; then `SELECT min/max` over an encounter
   date — **but order by `CAST(*_DATE_REAL AS REAL)`, not the text date, which sorts lexically and lies.**
5. Open the right clinical-area guide for your task and go.

---

## Modeling patterns and clinical-area guides

**Read `reference/patterns/general-patterns.md` first** — the genre's grammar (CSN contacts, `*_DATE_REAL`,
`_C_NAME` categories, base+supplement assembly, everything-is-TEXT, soft-deletes, sentinels …), each pattern
with its mechanism and a traced example. Every clinical-area guide assumes it and cites it by `§`.

Then open the guide for your domain. Each names the tables, the verified joins, the gotchas chased to *why*,
how the unstructured material ties back, and ready-to-run SQL — all under `reference/clinical-areas/`:

*The clinical core* — start with **encounters**, the hub every other domain joins back to:
- `encounters-and-visits.md` — `PAT_ENC` + the `_2..8` supplement stack, the CSN contact model, assembling one logical visit, inferring encounter *type*. **Learn this first.**
- `appointments-and-scheduling.md` — `PAT_ENC_APPT`, eCheck-in, appointment status vs the encounter rollup, video/eVisit flags.
- `problems-and-diagnoses.md` — `PROBLEM_LIST`(+`_ALL`/`_HX`), `PAT_ENC_DX`, `DX_ID`→`CLARITY_EDG`, clinician- vs patient-review channels, soft-delete.
- `histories-family-social-medical.md` — `FAMILY_HX`(+pedigree), `SOCIAL_HX`, `SURGICAL_HX`, `MEDICAL_HX`; the per-encounter re-snapshot design, the two-CSN split.
- `medications-and-orders.md` — the `ORDER_MED` family, prescription lifecycle, `PAT_ENC_CURR_MEDS`, the med-vs-order id spaces, a true current-med list.
- `lab-results.md` — `ORDER_PROC`→`ORDER_RESULTS` (value cluster + `9999999` sentinel, ranges, flags), `ORDER_NARRATIVE`, the status matrix.
- `vitals-and-flowsheets.md` — `IP_FLOWSHEET_ROWS`/`IP_FLWSHT_MEAS` + `V_EHI_FLO_MEAS_VALUE` (value lives only in the view), packed BP, PHQ-2.
- `allergies.md` — `ALLERGY`(+`_REACTIONS`), LPL master sharing, label-lies on `SEVERITY_C_NAME`, inline free-text, the dangling-pointer delete.
- `immunizations.md` — the administered record (`IMMUNE`/`IMM_ADMIN`), components, due/forecast, the DXR document-masterfile origin.
- `health-maintenance.md` — the `HM_*` tables, status-over-time, forecasting, links to immunizations/screening (sparse in many ambulatory exports).
- `procedures-and-surgeries.md` — procedures as `ORDER_PROC` orderables (`ORDER_TYPE_C_NAME`, not a "proc class"), `SURGICAL_HX`, why OpTime is absent.
- `imaging-and-media.md` — imaging orders + the `Media/` pipeline (`DOC_INFORMATION.SCAN_FILE` is the file-to-chart key), DICOM placeholders, extension-lies.

*Unstructured & narrative:*
- `clinical-notes-and-documents.md` — the HNO family, `Rich Text/*.RTF` (filename = note id + inverted-date key), note-type coalescing, how a note reaches its encounter (`HNO_INFO.PAT_ENC_CSN_ID`, often NULL).
- `patient-provider-messaging.md` — `MYC_MESG`/`MYC_MESG_RTF_TEXT`/`MSG_TXT`, threads keyed by shared CSN, the two body stores split by build-era.

*People, places & money:*
- `demographics.md` — `PATIENT`(+ supplements), identity (`PAT_ID` vs MRN), the alive-status trap, the PHI to avoid emitting.
- `providers-and-care-teams.md` — `CLARITY_SER`/`CLARITY_EMP`/`CLARITY_DEP` as the universal id-resolution layer (~51 tables depend on it), the SER-vs-EMP split.
- `referrals.md` — the ~20 `REFERRAL*` tables, status over time, the order↔referral bridge (`ORDER_PROC_2.REFERRAL_ID`), internal vs external.
- `coverage-and-billing.md` — PB (`ARPB_*`/ETR) vs HB (`HSP_*`/HAR), the charge/payment/adjustment triad + matching, claims/EOB/remittance, the universal invoice key, the void→reverse→rebill saga, gross-vs-net by reason.

When a guide steers you wrong, that's a friction report — fix the guide. These are living documents.
