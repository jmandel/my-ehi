# Understanding an Epic EHI export

You requested your full medical record from a health system that runs **Epic**, and received an **EHI
Export**: a near-raw dump of Epic's database — thousands of tab-separated tables, a schema file for each,
and folders of clinical notes, secure messages, and scanned documents. It is faithful, enormous, and
almost entirely undocumented for a human reader.

This project is a **field guide to that genre**, plus a worked example on one real record. It treats one
person's export as a *specimen* and learns the *species* from it: the durable, portable knowledge lives in
three **skills** that work on *anyone's* Epic export; the things true only of this one record live in
generated artifacts (a loaded database and a set of self-contained deep dives).

> **▶ See it live:** **<https://joshuamandel.com/my-ehi/>** — the landing page links every deep dive
> (each a standalone static app) plus an in-browser **agent harness** that queries the redacted record with
> SQLite-in-the-browser. Everything published there is built from the **redacted** export in this repo.

> **The orienting question, asked relentlessly:** *is this true of the genre, or only of this specimen?*
> Genre facts go in the skills; specimen facts go in the artifacts. That discipline is what keeps the
> skills portable.

---

## The skills

Three portable skills. The core is a **tower**: you **read** an export to understand it, then **build deep
dives** from it (where "abstracting the data" is a step inside building a dive, not a separate skill). A third,
**import-ehi**, is the complementary front-of-pipeline: turn the raw "Requested Record" zip into a *redacted,
same-shape* subset that's safe to commit and publish.

### 1. [`reading-epic-ehi-export`](skills/reading-epic-ehi-export/) — the foundation
Everything you need to walk into an unfamiliar Epic export and actually understand it.
- **The method** (in [`SKILL.md`](skills/reading-epic-ehi-export/SKILL.md)) — the way of working: moving
  between top-down ("what *should* an export contain?") and bottom-up ("what does this file show?"),
  between hypothesis and test, between specimen and genre; and the workflow patterns (fan-out reading,
  adversarial verification, loop-until-dry, judge panels) that let you cover a huge export at scale.
- **Mapping the schema** — how to load every table into SQLite (`scripts/load-ehi-sqlite.ts` +
  `load-schema-docs.ts`), inventory what's actually populated, and locate the unstructured material.
- **Modeling patterns** — the genre's grammar in two layers:
  [`reference/patterns/general-patterns.md`](skills/reading-epic-ehi-export/reference/patterns/general-patterns.md)
  (48 recurring conventions — CSN contacts, `*_DATE_REAL` time, base+supplement tables, `_C_NAME`
  categories, the everything-is-TEXT trap, soft-deletes, audit ledgers, …, each with its *mechanism* and a
  traced example) and
  [`reference/clinical-areas/`](skills/reading-epic-ehi-export/reference/clinical-areas/) (27 module-by-
  module field guides: encounters, problems, meds, labs, vitals, notes, messaging, immunizations,
  allergies, billing, …).

### 2. [`ehi-deep-dives`](skills/ehi-deep-dives/) — build a deep dive (the whole loop)
How to build a deep dive: the bespoke application a domain expert (a clinician, a billing analyst) would
want to *fully understand* one patient's history in an area — narrative-led, interrogable, **not** an
infographic or a dashboard. It's **view-first**, in steps:
1. **Ideate** what the view should show; **2. explore** the record for what supports it (loop until the view
   and how to power it are settled);
2. **abstract the data into one clean *view model*** — structured **and** narrative, in a single JSON the
   app reads (the engine — extract / enrich / synthesize, the clean projection so no raw Clarity leaks,
   computing scores, traceability — is
   [`reference/abstracting-to-the-view-model.md`](skills/ehi-deep-dives/reference/abstracting-to-the-view-model.md));
3. **build** the static React/D3 app on that view model.

Also covers the build mechanics (`bun build` + full-page screenshot verification), clinical-visualization
craft (BP band plots, custom pedigrees, computed risk visuals), a reusable component kit (`components/`),
and the assembly workflows (fan-out, file-output + receipts, adversarial verification).

### 3. [`import-ehi`](skills/import-ehi/) — extract → redact → safe-to-commit
Turn the full-PHI "Requested Record" zip into a **redacted, same-shape** subset you can publish. The pipeline
(`scripts/01`–`05`): unzip into `raw.unredacted/` (gitignored); **discover** identifier values from the known
structured columns and **fuzzy-match-redact** them everywhere (notes included); an **agentic pass** catches the
secrets that live only in free text (a child named in a message, a home address in prose); a **human review
checkpoint** on the term list; then a **positive proof by construction** — re-scan every emitted file (decoding
RTF) for 0 residual, plus an adversarial agentic sweep. Allowlist-only emission (TSV/HTML/RTF/CSS; media
omitted), term hygiene (never redact a category value like `"OTHER"`), and name/date variant expansion. The
queryable SQLite is rebuilt from the redacted `raw/` at publish time, never committed.

---

## How to move through it

**On your own Epic export** (portable — nothing below is specific to this specimen):

```bash
bun skills/reading-epic-ehi-export/scripts/load.ts ./raw ./db/ehi.sqlite   # data + schema docs, one command
bun lib/q.ts "SELECT n_rows, table_name FROM _tables ORDER BY n_rows DESC LIMIT 40"
```

`load.ts` runs both halves — the TSV data tables and the schema-doc catalog (`_schema_table`/
`_schema_column`). Running only the data loader yields a DB that queries fine but silently lacks the
schema docs; the single entrypoint exists so that can't happen.

1. **Read** — open the Reading skill. Internalize the general patterns, then the clinical-area guide for
   whatever you're after. Use fan-out workflows to map at scale, not by hand.
2. **Build a deep dive** — open the Deep-dives skill and work view-first: ideate the view, explore the
   record for what supports it, abstract the data into one clean `deep-dives/<topic>/viewmodel.json`
   (structured + narrative), then `bun build index.html` the co-located static app on it and verify it
   renders (`skills/ehi-deep-dives/scripts/screenshot.ts`).

Using a skill exposes a gap; you fix the skill and go again — one **loop**, not phases. Every guide here was
stress-tested by sub-agents against a real export and corrected from their friction reports.

---

## The payoff: the deep dives (on this specimen)

Built only after the data work, grounded in what's actually in this record (the discovery map and decisions
live in a local-only `artifacts/` directory — gitignored, since it holds raw pre-redaction PHI exhaust). They
live in [`deep-dives/`](deep-dives/), each a standalone static site (`bun build index.html --outdir dist`):

Each is a bespoke static app built **view-first** from a single clean view model (structured data + the
assessment narrative); the spine is the reasoning, every claim drills to a clean source quote, and no raw
export data reaches the screen. **All of them are live at
[joshuamandel.com/my-ehi/](https://joshuamandel.com/my-ehi/)** (individual links below); to run them
locally:

```bash
for d in deep-dives/*/; do ( cd "$d" && bun build index.html --outdir dist ); done   # build each
bun skills/ehi-deep-dives/scripts/serve.ts deep-dives 8088                            # → http://localhost:8088/
```

**Publishing.** `bun skills/ehi-deep-dives/scripts/build-site.ts` assembles every dive into one `site/`
directory using only relative paths, so it serves correctly at a domain root *or* a project subpath. A
GitHub Actions workflow (`.github/workflows/pages.yml`) builds and deploys it to GitHub Pages on every push
to `main` — a project site lands at `https://<user>.github.io/<repo>/` (or `your-domain.com/<repo>/` when a
custom domain is mapped on your user-site repo). Enable it under **Settings → Pages → Source: GitHub
Actions**; no other config is needed.

- **[cardiac-risk](https://joshuamandel.com/my-ehi/cardiac-risk/)** — Stage-1 BP diagnosed once and dropped,
  a worsening lipid trajectory, a heavy family history, and a computed 10-yr ASCVD risk the chart never
  produced (graphical pedigree + risk gauge).
- **[post-concussion](https://joshuamandel.com/my-ehi/post-concussion/)** — a multi-year head-injury course
  on one timeline: a normal MRI vs a persistent syndrome, the nortriptyline dose thread and its documented
  response, the eventual taper.
- **[coverage-billing](https://joshuamandel.com/my-ehi/coverage-billing/)** — how a clinic visit becomes
  money (billed/written-off/paid/owed) and a denied claim reconstructed as a state machine (denial → void →
  reversal → paid rebill).
- **[allergy-atopy](https://joshuamandel.com/my-ehi/allergy-atopy/)** — an evolving atopic profile and what
  component-resolved IgE testing revealed (an oral-allergy-syndrome cross-reactivity pattern a plain list
  can't show).
- **[prevention-self-tracking](https://joshuamandel.com/my-ehi/prevention-self-tracking/)** — eight years of
  a prevention-minded patient: the immunization program, a pre-travel vaccine cluster, screening, and a CGM
  worn despite a normal A1c.

Three more exploratory dives ship on the landing page — **[operational-details](https://joshuamandel.com/my-ehi/operational-details/)**,
**[data-oddities](https://joshuamandel.com/my-ehi/data-oddities/)**, and
**[people-record-touches](https://joshuamandel.com/my-ehi/people-record-touches/)** (the last two written by a
sub-agent as a stress test of the skills) — alongside the interactive
**[agent-harness](https://joshuamandel.com/my-ehi/agent-harness/)**, a browser tool that loads the redacted
SQLite and answers questions about the record with an LLM.

---

## Project layout

```
skills/                         the three portable skills (genre knowledge — no PHI)
  reading-epic-ehi-export/      method + schema-mapping + general patterns + 27 clinical-area guides + loaders
  ehi-deep-dives/               the view-first deep-dive loop (incl. abstracting to a view model),
                                build mechanics, viz craft, the component kit (components/), and
                                scripts/ — screenshot.ts (verify), serve.ts (view), build-site.ts (ship)
  import-ehi/                   zip → raw.unredacted/ → redacted raw/ (scripts 01–05 + redact-lib)
lib/                            portable helpers: q.ts (SQL), rtf2txt.ts, validate-extract.ts
.github/workflows/pages.yml     CI: build the dives and deploy them to GitHub Pages
raw.unredacted/                 the full-PHI export — gitignored, never committed (the redaction source)
raw/                            the REDACTED, same-shape, verified-clean export (committable)
db/ehi.sqlite                   the loaded database — gitignored; rebuilt from redacted raw/ at publish time
deep-dives/<topic>/             one self-contained folder per dive (per-specimen):
                                  BUILD.md         the build spec — view-model schema + per-slot recipe from
                                                   raw (saves reverse-engineering; design rationale optional
                                                   opening section; older dives may also carry STORYBOARD.md)
                                  viewmodel.json   the clean data the app renders (assembled; the deliverable)
                                  parts/ scripts/  the editable slots + the bun/SQLite pipeline that builds them
                                  app.tsx index.html page.css   the static app (imports ./viewmodel.json)
artifacts/                      discovery map, friction reports, decisions — gitignored (raw PHI exhaust)
```

**Stack:** `bun` + TypeScript end to end, SQLite as the query substrate, static React/D3 pages for the deep
dives. No Python, no shell-pipeline analysis — one language from load to chart.
