# Understanding an Epic EHI export — and building reusable skills

A subfolder holds the raw Epic "EHI Export" of my records: thousands of TSV tables plus clinical notes and secure messages. Treat it as a read-only specimen. Learn the *genre* of Epic EHI exports from this
*specimen* and write a portable field guide. Genre knowledge lives in the skills; anything true only of my
record lives in per-specimen artifacts you generate — always ask "genre, or only this specimen?". The final
deep dives are the exception: tied to my real data.

## Way of working (open your first skill with this)
- Move between **top-down** (what *should* an export contain?) and **bottom-up** (what does this file show?),
  hypothesis and test, specimen and genre.
- **Explain *why*, not just *what*** — when data looks quirky, hypothesize how Epic/Chronicles records it and
  test more rows until the mechanism is clear.
- **Workflows + sub-agents are the default unit of work** — capture reusable patterns (fan-out, adversarial
  verification, loop-until-dry, judge panels, file+receipt) as syntax-independent shapes. The lead
  orchestrates and synthesizes; the work happens in many parallel agents, not the lead.
- **Use skills as you write them** — hand sub-agents the current draft, have them follow it and report where
  it failed; those friction reports drive each revision. Develop/use/refine is one loop.

## Stack
bun + TypeScript end to end; SQLite as query substrate. Load tables to SQLite first; every helper is a small bun `.ts`; deep dives are static bun/TS/React pages from JSON. No Python/shell pipelines. Keep it portable. Explore via workflows; come back with real questions once you have a handle, then run autonomously.

## Two skills (a tower)
**1. Reading an Epic EHI export** (foundational): (a) the *method* above; (b) *mapping the schema* —
inventory tables (to SQLite), locate unstructured material via fan-out; (c) *modeling patterns* in two
layers. **General patterns**, catalogued exhaustively with mechanistic depth (CSN/contacts, `*_DATE_REAL`
time, master-file IDs & assembly, `ZC_`/`_C_NAME` enums, the everything-is-TEXT trap, …), each chased to *why* with a traced example. **Clinical-area guides**, one per
domain (encounters, problems, meds, labs, notes, messaging, billing, …): tables, joins, gotchas, how
notes/messages tie back. Derive via sub-agents on real rows.

**2. Building a deep dive**: the web app a domain expert would want to understand one patient's history in an area — narrative-led, interrogable, not an infographic/dashboard. Worked
**view-first**: (1) ideate what the view shows; (2) explore the record (workflow) for what supports it, loop
until settled; (3) **abstract into one clean *view model*** — a single JSON holding structured data **and**
rich narrative (summary + section prose + an assessment) + an evidence map of clean quotes.
Abstraction is a step here: extract / enrich (per-item judgment) / synthesize. The view model is a **clean projection, not a mirror** (formatted/resolved values; ids as side fields) so the app **never dumps raw Clarity onto the screen**; large extracts go to files; returns are
receipts. (4) **build** the static React/D3 app on the view model alone, with **custom visualizations**; `bun build`; screenshot to verify. The spine is reasoning; every claim drills to clean evidence.

Write a top-level **README** as the front door.

## Payoff: five deep dives
Only *after* the data work, devise five diverse deep dives specific to my history, not
generic charts. Build view-first via workflows; refine the skill from the friction. Steer away from
infographics and from dumping raw export data into a dumb UI.

Ref: https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md
