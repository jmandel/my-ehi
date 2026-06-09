# Understanding an Epic EHI Export — and building the skills to do it again

You're working in this folder. A subfolder contains the raw result of an Epic "EHI Export" of my health
records — structured data (thousands of tab-separated tables, each with an HTML schema file) alongside
unstructured material: full-text clinical notes and patient/provider secure messages. Treat that subfolder
as a **read-only specimen**: you study it, you don't rewrite it.

**The core idea that should shape everything.** My export is one specimen of a genre — Epic EHI exports in
general. Learn the species from this individual, then write a field guide to the species. Durable knowledge
lives in the **skills** (how encounters are modeled, how time and snapshots work, which tables appear, how
identifiers link things), useful to anyone holding *their own* Epic export who has never seen mine.
Anything true only of *my* specimen — my name, my dates, my providers — lives in the **artifacts** you
generate, never in the skills. Carry one habit relentlessly: every time you learn something, ask *"genre,
or only this specimen?"* That question keeps the skills clean and portable. (The deep dives at the end are
the exception: they're tied to my real record. The skill that explains how to build them stays generic.)

## How to begin

Start by exploring — but **lean on workflows and sub-agents from the start**, so you have real reach across
a large export and synthesize rather than spot-check. Workflows are the default unit of work for this whole
project: discovery, deriving the guides, drafting and stress-testing the skills, and building the deep dives
all run through orchestrated sub-agents. **This is the part that breaks under pressure: the lead agent
starts doing the work itself — skimming a few tables, writing from memory, building a view by hand — and
the fan-out and the learning quietly vanish. Don't let that happen.** Your job as lead is to orchestrate and
synthesize: pose the question, fan sub-agents across the data, reconcile what they bring back. Once you've
got an initial handle, come back to me with any questions worth asking — I'd rather you ask than guess on
something load-bearing. Then run the rest autonomously, checking in only when something genuinely needs my
call.

## The first thing you write: your way of working

Before the real digging, write down how you intend to operate — as the **opening of the Reading skill**, not
a separate manifesto. This is the engine of that skill and the foundation of everything: the
**top-down × bottom-up** method (what *should* an export contain? vs. what does this file actually show?),
moving between hypothesis and test, between specimen and genre. Capture the reusable **workflow patterns**
you settle into — fan-out reading, adversarial verification, loop-until-dry discovery, judge panels,
file-output-with-a-receipt — as orchestration *shapes* described independently of any workflow syntax.

Two principles deserve their own headlines because they decay first under pressure. **Go deep enough to
explain *why*, not just *what*** — when a value or join looks quirky, form a hypothesis about how
Epic/Chronicles produces that shape and test it against more rows until the mechanism is clear; a pattern
you can explain mechanistically is one the next analyst can trust. **Use the skills while you write them** —
the skills are the instructions your sub-agents operate under *right now*: hand each workflow the current
draft, have its agents follow it, and require them to report exactly where it failed (missing, wrong,
ambiguous, silently assumed). Those friction reports — not your impressions — drive each revision.
Develop / use / refine is one loop, not three phases. Write all of this in plain, concrete language: a
crisp principle, a plain explanation, a real example from actual fields.

## One stack

Everything runs on **bun + TypeScript**, with **SQLite** as the query substrate. First move: load the
export's tables into a SQLite database; from then on every helper and analysis is a small bun `.ts` file
querying it, and the deep dives are static bun/TypeScript/React pages built from JSON the abstraction step
produces. No Python, no shell-pipeline analysis — one language end to end. Keep it portable: the loader and
queries must work against anyone's export (the *how* lives in the skills; the loaded database is a
per-specimen artifact).

## The skills, as a tower

There are **two skills**, a stack where the second builds on the first. Build them the way you investigate
the data — through workflows that propose, challenge, and refine — and treat them as **living documents**:
draft early, put to work immediately, and fix every time *using* one exposes a gap. Write a **README** at
the top of the project as the front door: what each skill is, how they relate, how to move through them.

1. **Reading an Epic EHI export** — the foundational, larger skill: everything needed to walk into an
   unfamiliar export and understand it. Three parts.
   - *The method* — your way of working, above. The engine; the next two parts are it running.
   - *Mapping the schema* — how to inventory the structured tables (and load them into SQLite as the working
     substrate) and locate the unstructured material, using fan-out workflows to cover a large export at
     scale rather than sampling a few files by hand.
   - *Modeling patterns* — the genre's grammar, in two layers. **General-purpose patterns** catalogued
     exhaustively with mechanistic depth (CSN/contacts, effective-vs-instant time, `*_DATE_REAL`,
     master-file IDs and line-item assembly, base+supplement tables, `ZC_`/`_C_NAME` enumerations,
     status/lifecycle, snapshots, soft-deletes, the everything-is-TEXT trap, …) — the test of done is
     breadth, but for each pattern explain *why* the data is shaped that way and back it with a traced
     example, including where it frays. **Clinical-area guides**, one per major domain (encounters,
     problems, meds, labs, vitals, notes, messaging, billing, immunizations, allergies, care teams, …),
     each naming the tables, the joins, the gotchas chased to *why*, and how the notes/messages tie back.
     Derive each guide through sub-agents reading real rows and reconciling what they find, not a single
     pass from memory.

2. **Building a deep dive** — the one skill for turning a read export into excellent *deep dives*. A deep
   dive is the bespoke web application a domain expert (a clinician, a billing analyst) would want to *fully
   understand* one patient's history in an area — narrative-led, interrogable, **not** an infographic, a
   dashboard, or a slide deck. The skill describes the whole loop, worked **view-first**:
   1. **Ideate** what the view should show (the argument, the visualizations, the crunched figures).
   2. **Explore** the record (a workflow) for what data supports the idea; **loop** ideate↔explore until
      you've landed on what the view will show and how agents can power it.
   3. **Abstract the data into one clean *view model*** — a single JSON the app reads, holding **structured
      *and* rich narrative content together** (a real summary, multi-paragraph section prose, an explicit
      assessment / what-an-expert-would-do / what-the-data-can't-answer), plus an evidence map of clean note
      quotes. This is where "abstraction" lives — it's a *step* of building a dive, not a separate skill.
      It uses three operations: **extract** (deterministic bun/SQLite scripts), **enrich** (agentic per-item
      judgment at scale — read each of N notes/rows and classify/extract/score), and **synthesize**
      (holistic reasoning, incl. computing domain scores you have autonomy to research and derive from any
      source). Crucial discipline: the view model is a **clean projection, not a mirror of the export** —
      formatted dates, resolved labels, clean names, ids/`src` only as side fields — so the app **never
      dumps raw Clarity columns onto the screen** (the failure mode to avoid). Large extracts are written
      to files via projection scripts (not transcribed through schema responses); workflow returns are
      **receipts**; judgment is always captured and used.
   4. **Build** the static bun/React/D3 app on the view model alone, with **custom visualizations** the data
      deserves (the component kit is a floor — draw the real pedigree, the band plot, the risk gauge, the
      claims flow), `bun build index.html`, and verify it renders by screenshotting the whole page (and
      interactive states). The spine is the reasoning; charts are evidence; every claim drills to clean
      evidence; nothing raw reaches the UI.

## The payoff: five deep dives

By now the skills exist in draft and have been earning their keep — the deep dives are where you push them
hardest and do the last round of refinement. **Hold off on choosing the five until the data work is done**,
so they're specific to what's actually in my history (the conditions I carry, the labs and vitals that
recur, the arc the notes and messages trace), not generic charts. Then devise five diverse, concrete deep
dives that make real sense for *my* record — things I'd actually want to understand about my own health —
and build each view-first. Lean hard on LLM-mediated summarization and clinical reasoning over both
structured and unstructured data; present it beautifully and completely; keep full traceability. Run the
building through workflows, flag every point where the skill was missing/wrong/ambiguous, and feed those
friction points straight back into the skill. Iterate until both the deep dives and the skill are genuinely
good — steer hard away from shallow, decorative, infographic-style pages, and away from dumping raw export
data into a UI that isn't smart enough to present it.

## One reference

For authoring skills — the SKILL.md format and helper scripts —
see https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md.
