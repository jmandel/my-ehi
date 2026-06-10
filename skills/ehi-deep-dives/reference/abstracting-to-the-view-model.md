# Step 3 in depth: abstracting the data to fill the view model

This is the data-work engine behind **step 3** of building a deep dive (the SKILL.md process: ideate →
explore → define the view model → **abstract to fill it** → build). The deep dive's storyboard has told you
*what the view shows*; here you produce, in the right form, the **narrative analysis, crunched data/figures,
and visualization-ready structures** that fill the one `viewmodel.json` — leaning on the
`reading-epic-ehi-export` skill to know *where* the data is and what it means.

It is **agentically mediated** — much of the value is judgment a query can't express (reading a note and
naming what it's about; deciding which of 200 messages is a clinical concern vs. an admin ping; turning a
series into the exact shape a chart wants). Name the operation you're using.

## Three kinds of abstraction operation

Every value and every finding is produced by one of these; they compose, and each can be its own fan-out.

1. **EXTRACT — deterministic, by script.** A bun/SQLite script queries and transforms. No judgment; cheap
   and exact. *Decode the genre gotchas here* (unpack packed BP, filter the `9999999` sentinel, convert
   units, resolve ids, carry reference ranges). E.g. one row per BP reading; one charge per row.
2. **ENRICH — agentic per-item judgment (a "map" over many items).** An agent **reads each of N items and
   emits structured output for it**: classify, categorize, extract a finding/entity, score relevance,
   normalize free text to a code, judge a status the data leaves implicit. The work a script *can't* do —
   and the heart of an agentically-mediated deep dive. E.g. label all ~200 MyChart messages by topic /
   initiator / clinical-vs-admin; pull the assessment+plan from each of 80 notes; tag each transaction with
   its real-world event. **Fan it out** (batch items across agents), write enriched rows to a file, and keep
   each row **traceable** (the source id + the basis — a quote or rule — for the judgment).
3. **SYNTHESIZE — agentic holistic reasoning (a "reduce" over the whole).** An agent works the full
   extracted+enriched material and the notes → the **analysis**: findings (claim + significance +
   citations), the argument, open questions. Judgment at the level of the case.
   - **Computed scores/indices are first-class, and you have autonomy to derive them.** When the view needs
     a figure the chart never produced (ASCVD/PREVENT, FIB-4, Charlson, an effective write-off rate),
     research the model, **abstract its inputs from *any* source — structured tables and the notes** (a
     smoking status or a family onset age the form left null are enrich pulls), compute it, and emit it with
     every input and caveat attached (a bounded range when an input is missing). Compute the number, don't
     just list inputs.

> Reach for the cheapest operation that suffices. Don't make an agent transcribe what a script could
> compute; don't make a script fake a judgment only reading can make.

## Project off the field guide, not raw `PRAGMA`

Before you write projection SQL for a domain, **open that domain's field guide**
(`reading-epic-ehi-export/reference/clinical-areas/<area>.md`) and use its documented join recipes and
value/current-state tables — don't reconstruct the query from raw column exploration of the spine table. This
is the reading skill's **"third crucial caveat"** (see its SKILL.md): a blank column is rarely "no data," so
**any verdict that resolves to "none / empty / not measured / never done" is a smell, not a result.** A dropped
`*_NAME` companion resolves through its `CLARITY_*` dictionary (a diagnosis name via `DX_ID → CLARITY_EDG`); a
value missing from the spine lives in a `V_EHI_*` view (a flowsheet reading via `V_EHI_FLO_MEAS_VALUE`, not
`IP_FLWSHT_MEAS`). In a deep dive the stakes are higher because the false negative ships as a *finding* ("no
chronic problems", "never screened") — confirm absence against the code column and the guide's named
dictionary/view before any claim asserts it.

## Everything you emit is a clean PROJECTION

The view model is what the app renders, so **do the cleaning here, once.** Project into clean, semantic,
app-ready values: human field names (`systolic`, `medication`, `dose`, `status` — not `cv_relevance`,
`*_C_NAME`, packed strings), human values (formatted dates, drug names cleaned to `"lisinopril 10 mg"` not
`"lisinopril (PRINIVIL,ZESTRIL) tablet"`, codes resolved to labels, units converted, plain status words).
Keep internal ids and a `src` as **side fields for tracing**, never as display content. **If a raw export
string can reach the screen from your JSON, the projection isn't done.** (Whether the final pretty-printing
lands in the projection or a small app helper is a judgment call; the rule is just that the screen never
shows a raw Clarity string.) Use ENRICH to add canonical keys the raw data fragments (HDL shipped as
`HIGH DENSITY CHOLESTEROL` then `HDL` → one `analyte: "HDL"`).

## Filling the view model (the deliverable)

The deliverable is the **view model** the deep-dives step 2 defined — one JSON of slots holding **structured
AND narrative content**, including the rich **assessment narrative** that tells the story through the
analytic lens (not thin captions: a real summary, section prose, and an "assessment / what an expert would
do / what the data can't answer"). Fill the slots, **writing to files**, two ways:

- **Projection** — a bun/SQLite script queries and **splices a clean, view-shaped result into a slot**
  (`viewModel.bp.readings = [...]`). This is how *large* extracts get in without being transcribed through a
  schema: the script writes them straight to the file, already display-clean.
- **Hand-abstraction** — an agent writes a narrative / curated-judgment slot (the section prose, the
  evidence quotes, the assessment).

To avoid races, agents fill **separate part files** (`deep-dives/<topic>/parts/<slot>.json|.md`) and an
assemble step merges them into the one sibling `viewmodel.json`. Each agent returns a **receipt** (slot filled, counts, a
grep-clean check, friction) — never the content itself, which lives in the file.

## Files vs. schema — never lose the judgment

- **Data (large) → files.** A schema response truncates a 400-row table; large/structured outputs go to
  files; the schema return is a *receipt*.
- **Judgement (findings, verdicts) → file or schema, but captured and used.** A long analysis belongs in a
  file; a tight verdict can ride back as a rich schema response — but never as a throwaway. Any judgment
  returned via schema must be persisted and used; analysis that goes unread is a failed pass.

## Traceability & hygiene

Every structured value traces (a `src` side-field or an evidence id); every claim cites a clean note quote
or readable statement (with author + date) — quote the *note*, not its cache (reading-skill general-patterns
§40). Gate with `bun lib/validate-extract.ts <viewmodel.json>` (auto-detects the dataset vs. view-model shape).
Note text via `lib/rtf2txt.ts`. PHI: never emit SSN, street address, email, phone, or the MRN (`APL…`); the
opaque `PAT_ID` surrogate (`Z#######`) is not a direct identifier. Bun + TypeScript + SQLite only; no
future/fabricated provenance; `PRAGMA` the real columns (they drift). **An aggregate that resolves to
none/empty/"not available" is a publish smell** — re-derive it through the field-guide recipe (dictionary join
/ `V_EHI_*` value view) before any claim asserts absence; the linter can't catch a *false* absence, so this
one is on you.
