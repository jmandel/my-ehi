# Understanding an Epic EHI export — and building the skills to do it again

You're working in this folder. It starts with two things:

- **`raw/`** — a **redacted, same-shape copy** of an Epic "EHI Export" of my health records: thousands of
  tab-separated tables, one HTML schema doc per table, RTF clinical notes, secure messages. It is the
  verified output of the import skill below. Treat it as a **read-only specimen**: you study it, you never
  rewrite it.
- **`skills/import-ehi/`** — an existing, finished skill that turns the original "Requested Record.zip"
  into that redacted `raw/` (unzip → discover identifiers from structured columns + agentic free-text
  sweep → human-reviewed term list → fuzzy-redact → *prove* zero residual). If you are ever handed a zip
  instead of a `raw/`, run it first. Its full-PHI byproducts (`raw.unredacted/`, the term list, its DB)
  are gitignored and stay that way.

Your mission: develop **two further skills** on top of it — *reading* the export, and *building deep
dives* from it — and then the deep dives themselves.

**The core idea that should shape everything.** My export is one specimen of a genre — Epic EHI exports
in general. Learn the species from this individual, then write a field guide to the species. Durable
knowledge lives in the **skills**; anything true only of *my* specimen lives in **generated artifacts**,
never in the skills. Carry one habit relentlessly: every time you learn something, ask *"genre, or only
this specimen?"* A specimen number may appear in a skill only as a labeled illustration ("in one
specimen, 169 encounters"), never as an asserted fact. (The deep dives at the end are the exception:
they're tied to my real record. The skills that explain how to build them stay generic.)

Because `raw/` is already redacted, you don't carry PHI anxiety through this project — what you carry is
**portability discipline**, which looks similar but has a different reason: a skill stuffed with this
specimen's worked values helps nobody else's export and bloats fast. Specimen values stay out of skills;
describe the mechanism, not the cell. And when you audit your own documents, **value-grep** for
transcribed specimen data — an instruction alone will not stop an agent from pasting a worked example.

## How to begin

Start by exploring — but **lean on workflows and sub-agents from the start**. Workflows are the default
unit of work for the whole project: discovery, deriving the guides, stress-testing the skills, building
the dives. **This is the part that breaks under pressure: the lead starts doing the work itself —
skimming a few tables, writing from memory, building a view by hand — and the coverage and the learning
quietly vanish.** Your job as lead is to orchestrate and synthesize: pose the question, fan agents across
the data, reconcile what they bring back. Once you have an initial handle, come back to me with the
questions worth asking; then run autonomously, checking in only when something genuinely needs my call.

Hard-won workflow craft — bake these into how you run every fan-out:

- **A standing preamble for every sub-agent.** Compose once and reuse: the DB access incantation, the
  data traps (below), and the house rules (*genre not specimen · method not data · explain why*). Agents
  without the preamble rediscover the traps one ruined query at a time.
- **Artifacts to disk; returns are receipts.** Agents write their real output (a drafted guide, a
  dataset) to files and return a receipt (path, counts, verdict) — schema-bound responses for judgments.
  Then an interruption (a crash, a usage limit) loses only in-flight agents: finished work is already on
  disk, and a journaled workflow resumes from where it stopped instead of re-spending.
- **One writer per file per phase.** Parallel agents editing one file silently clobber each other.
  Partition edits (one agent per guide); shared files get a single dedicated pass.
- **Adversarial verification before anything load-bearing ships.** A claim a reader produced ("payments
  match charges via TX_ID") gets an independent skeptic prompted to *refute* it against real rows. A
  drafted document gets a verifier who did not write it: re-run every SQL recipe verbatim, check every
  named table/column, value-grep for transcribed specimen data.
- The other reusable shapes — fan-out reading, loop-until-dry discovery, judge panels — match the shape
  to the question and compose them.

## One stack

Everything runs on **bun + TypeScript**, with **SQLite** as the query substrate. No Python, no
shell-pipeline analysis — one language end to end, portable to anyone's export.

The first deliverable of the reading skill is the loader, and it must be **one command** that builds the
*complete* database: every TSV as a table, **plus the schema HTML parsed into catalog tables**
(`_tables` — what's populated; `_schema_table` — Epic's description of every table; `_schema_column` —
tens of thousands of per-column docs, greppable in SQL). The catalog is the single biggest
force-multiplier you will build: it makes the schema itself queryable. Do not ship the loader as two
separate steps — a data-only build looks perfectly healthy until a catalog join fails, the worst kind of
silent half-state. Add a tiny read-only query helper (`q.ts`) and give every sub-agent its incantation.

Three data traps go in every agent preamble, because each one produces wrong results *silently*:
**everything is TEXT** (CAST before ordering, aggregating, or range-comparing — text dates sort lexically
and lie); **a blank column is rarely "no data"** (the value usually lives behind a dropped `_NAME`
companion, an export view, or a sibling table — confirm the code column before asserting absence);
**the schema doc's columns are aspirational** (PRAGMA the real ones before writing a query).

## The skills, as a tower

Two skills, the second building on the first. Build them the way you investigate the data — workflows
that propose, challenge, and refine — and treat them as **living documents**: draft early, put to work
immediately, and fix every time *using* one exposes a gap. **Use the skills while you write them**: hand
each workflow the current draft, require agents to follow it and report exactly where it failed. Those
friction reports — not your impressions — drive each revision. Develop/use/refine is one loop. Write a
top-level **README** as the front door.

1. **Reading an Epic EHI export** — the foundational skill: walk into an unfamiliar export cold and come
   out understanding it. Three parts.
   - *The method* — your way of working: **top-down × bottom-up** (what *should* an export contain?
     vs. what does this file actually show?), with the discoveries living in the gap between them; and
     **explain *why*, not just *what*** — when a value or join looks quirky, hypothesize how
     Epic/Chronicles produces that shape and test it against more rows until the mechanism is clear. A
     pattern explained mechanistically is one the next analyst can trust; a surface description is a trap.
   - *Mapping the schema* — load everything (the one-command loader), inventory **from the catalog, not
     `ls`**, and locate the unstructured material (notes/messages/media and their subtle join paths) with
     fan-out.
   - *Modeling patterns* — the genre's grammar, two layers. **General patterns** catalogued exhaustively
     with mechanistic depth (CSN/contacts, `*_DATE_REAL` time, master-file IDs, base+supplement assembly,
     `_C_NAME` enumerations, status matrices, soft-deletes, sentinels, …), each with a traced example.
     One craft warning: the clinical guides will cite these patterns by section number, and **citations
     rot when the catalog is renumbered** — cite concept-plus-number ("§41, two ID spaces") so a stale
     number is self-healing, and sweep all citations after any renumbering. **Clinical-area guides**, one
     per domain (encounters first — it's the hub), each naming the tables, the *verified* joins, the
     gotchas chased to why, the decoy columns, how unstructured material ties back, and tested SQL
     recipes. Derive each through sub-agents reading real rows; verify adversarially before it ships.
   - Two disciplines the first draft will not have unless you force them. **Coverage accounting:**
     classify *every populated table* — existing domain / genuinely new domain / infrastructure — and
     keep the map current; the unclassified residue is exactly where under-documented domains hide (in
     one specimen: record-access audit, benefits & eligibility, questionnaires, episodes & care plans,
     order-lifecycle plumbing, decision-support alerts). **Map the negative space:** the
     infrastructure/plumbing tables deserve a guide of their own — the question an analyst actually asks
     is "is this clinically meaningful or safe to skip?", and answering it wrong in the dismissive
     direction is the silent-false-negative failure mode. Say what may be ignored *and why*, and name the
     look-like-plumbing tables that are actually load-bearing.

2. **Building a deep dive** — the one skill for turning a read export into excellent deep dives. A deep
   dive is the bespoke web application a domain expert (a clinician, a billing analyst) would want to
   *fully understand* one patient's history in an area — narrative-led, interrogable, **not** an
   infographic, a dashboard, or a slide deck. Worked **view-first**:
   1. **Ideate** what the view should show (the argument, the visualizations, the crunched figures).
   2. **Explore** the record (a workflow) for what supports it; loop ideate↔explore until settled.
   3. **Abstract into one clean *view model*** — a single JSON the app reads, holding structured data
      *and* rich narrative together (real summary, section prose, an explicit assessment and
      what-the-data-can't-answer), plus an evidence map of clean quotes. Three operations: **extract**
      (deterministic bun/SQLite scripts), **enrich** (agentic per-item judgment at scale), **synthesize**
      (holistic reasoning, including domain scores you research and derive). The view model is a **clean
      projection, not a mirror of the export** — formatted dates, resolved labels, ids only as side
      fields — so the app **never dumps raw Clarity columns onto the screen**. If the view model is
      assembled from parts, the parts are the editable source and assembly must be idempotent — a fix
      applied to a generated file is a fix the next build erases.
   4. **Build** the static bun/React/D3 app on the view model alone, with **custom visualizations** the
      data deserves (a component kit is a floor, not a ceiling), `bun build index.html`, and verify by
      screenshotting rendered pages and interactive states. Serve over HTTP (file:// blocks modules);
      ship a `serve.ts` for local viewing and a `build-site.ts` that assembles a relative-path,
      subpath-safe static site, rebuilding the DB from `raw/` at build time rather than committing it.
   - Each dive documents itself with one file: **BUILD.md**, the build spec that saves the next person
     from reverse-engineering the view model — the view-model TypeScript interface, plus per-slot
     population method *from the raw export*: tables, derivation logic in words, and for the agentic
     slots the judgment rubric used (the part no script records). Design rationale, if worth keeping,
     is a short section here, not a second document. BUILD is **method, not data**: no transcribed
     values or quotes — those live in the view model. A doc-type that *can* hold specimen data will,
     unless the skill states the method-vs-data boundary explicitly and the audit value-greps for it.

## The payoff: five deep dives

By now the skills exist in draft and have been earning their keep — the dives are where you push them
hardest. **Hold off on choosing the five until the data work is done**, so they're specific to what's
actually in my history, not generic charts. Then devise five diverse, concrete deep dives I'd actually
want about my own health, and build each view-first. Lean hard on LLM-mediated summarization and clinical
reasoning over both structured and unstructured data; keep full traceability; feed every friction point
straight back into the skill. Steer hard away from shallow infographic pages and from dumping raw export
data into a UI that isn't smart enough to present it.

## One reference

For authoring skills — the SKILL.md format and helper scripts —
see https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md.
