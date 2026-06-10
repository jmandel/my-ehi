---
name: ehi-deep-dives
description: >-
  Build a deep dive from an Epic EHI export — the whole loop: ideate the view, explore the record for what
  supports it, abstract the data into a clean view model (structured + narrative, in one JSON), then build a
  bespoke static bun/React/D3 web app on that view model. Use this whenever making a clinical or financial
  deep dive / analysis app from such an export (after reading-epic-ehi-export has the data understood and in
  SQLite). A deep dive is the tool a clinician would want to understand a condition's course, or a billing
  analyst a claims history — NOT an infographic, dashboard, or slide deck; designed around what that expert
  needs, narrative-led, with the data interrogable through clean evidence (never raw rows). The "abstraction
  to power a deep dive" is step 3 here, not a separate skill (see reference/abstracting-to-the-view-model.md).
  Trigger on "build a deep dive", "make the <condition>/<billing> analysis app", "turn this into a deep dive".
---

# Deep dives

A deep dive is **the application a domain expert would want in order to fully understand this patient's
history in one area.** Ask it literally: *what would a neurologist need to understand this concussion
course? what would a billing analyst need to understand these claims?* — and build that. The data model,
the views, the reasoning, the layout all follow from the expert's real need, not from a template.

It is **not** an infographic, a dashboard, or a poster. It runs on a **complete, cleaned view model** (so
every claim drills to its evidence and the expert interrogates the reasoning, not just the few numbers you
pre-picked), and the analysis —
the genuine domain reasoning — is the spine. It is a static bun-built React/D3 site, but think of it as a
*small expert tool*, not a styled document.

## Three commitments (and the anti-patterns they replace)

1. **Domain-expert-driven, not templated.** Let what the expert needs to understand this case shape the
   whole thing. Different topics get different shapes — a medication-response question and a claims-denial
   question are not the same app. *Anti-pattern:* the same `header → stat-row → chart → header → chart`
   skeleton on every topic.
2. **Interrogable, but never shown raw.** Let the reader drill from any statement to its evidence, scan the
   record, filter, sort — over the clean view model. *Anti-pattern A:* hard-coding a handful of pre-chosen
   numbers into cards so nothing can be examined. *Anti-pattern B (just as bad):* dumping raw Clarity rows
   into the UI — locator strings (`PAT_ENC_DX:PAT_ENC_CSN_ID=948004323`), raw column names (`cv_relevance`,
   `enc_csn`, `src`, `*_date_real`), internal ids, `12:00:00 AM` timestamps, `lisinopril (PRINIVIL,ZESTRIL)
   tablet`. "Interrogable" means the reader can *examine the evidence*, presented for a human — not that you
   pipe the export into a table. See the rule below.
3. **Analysis carries the weight; the prose is a clinician's reasoning.** Findings, mechanisms,
   interpretation — substantive and grounded. *Anti-pattern:* decorative "AI-slop" section headers
   ("Imaging normal, symptoms persistent", "How a clinic visit becomes money") and number-spewing with no
   understanding. Use functional, substantive headings an expert would write (or none).

If a section doesn't help the expert understand the case better, cut it. Restraint over decoration.

## Don't dump raw columns — render thoughtfully

The failure mode to avoid is concrete: a wall of raw EHI table columns piped into the UI by an app that
isn't smart enough to do anything but print them — locator ids, `cv_relevance`, `12:00:00 AM`,
`lisinopril (PRINIVIL,ZESTRIL) tablet`, code suffixes, a `src` column. That's a database viewer, not a deep
dive. The way out is a thoughtfully-structured dataset *and* a thoughtful UI:

- **The view model is a projection, not a mirror** (step 3; engine in
  `reference/abstracting-to-the-view-model.md`). It gives you clean, well-named, human-valued JSON —
  semantic fields, resolved labels, sensible date/number shapes — with ids/`src` carried as side fields for
  tracing, not as display content. Render those.
- **Present, don't dump.** For each view choose the *few relevant fields*, give them human labels, and
  format values for reading. Where the final pretty-printing happens — already in the view model, or in the
  app with a small shared helper — is a judgment call; what matters is the screen reads cleanly and never
  shows a raw export string. (If you're writing the *same* formatting in many components, push it upstream
  into the projection so every view benefits.)

Then compose the clean data into a **coherent application**: one type scale and spacing rhythm, color used
to mean something, every table/legend/stat consistent and finished, a clear top-to-bottom hierarchy.
Screenshot the whole page (and key interactive states — the screenshot helper's `--click` opens them) and
look as a skeptical designer: it should read like a product a careful team built.

## The process: ideate → explore → define the view model → fill it → build

Work **view-first**, in five steps. Do **not** start from the data and hope a view emerges.

**1. Ideate.** Propose what this deep dive's view could do — the angle, the argument, what the finished app
might *show* (the narrative beats, the visualizations, the crunched figures). One or several candidate
ideas.

**2. Explore — and loop.** Run an exploratory agent workflow that probes the patient's record: *does the
data actually support this idea? what's really there? what could power each part?* Bring findings back,
sharpen (or change) the idea, explore again. **Loop ideate↔explore until you've landed on two things: what
the view will show, and how agents can power it** (which data, which abstractions, which computations).
This is what keeps the dive specific to the real record instead of a generic template.

**3. Define the view model.** Write the **view model**: a single JSON file that powers the whole app,
holding **structured and narrative content together** — every section, every figure's data, every chart's
shape, the prose, and the evidence, all in one place and all already display-clean. (Start as a skeleton of
slots; the next step fills them.) The app reads *only* this file, so nothing raw can leak. **Carry the rich
assessment narrative, not thin captions:** a real summary, multi-paragraph section prose, and an explicit
"assessment / what an expert would do / what the data can't answer" — the analytic story is what the app
renders as its spine, so it lives in the view model, each claim citing the evidence map.

**4. Abstract to fill the view model (workflows).** This is the data-work engine — its full detail
(extract / enrich / synthesize, the clean projection, traceability, computing scores) is in
[`reference/abstracting-to-the-view-model.md`](reference/abstracting-to-the-view-model.md). In short: fan
agents out to fill the slots — and because some slots hold **large** data extracts (worth doing when the
view benefits), the abstraction **writes to the file**, not to schema responses. A slot is filled by
**hand-abstraction** (an agent writes the narrative / curated judgment) or by **projection** (a bun/SQLite
script queries and splices a clean, view-shaped result into the slot). The workflow's structured returns are
**receipts** (what was filled, counts, friction); the content lives in the files. Assemble the parts into
the one view-model JSON.

**5. Build the app** from the view model (and only the view model). Screenshot, look, revise — the idea,
the view model, and the app sharpen together.

**6. Persist the build, not just the result.** A finished dive is a **folder of first-class artifacts,
committed together** — the result *and* the reasoning that produced it — so it can be understood, audited,
rebuilt, and extended. The set, and what each is responsible for:

| artifact | responsibility |
|---|---|
| `viewmodel.json` | **The deliverable**: clean, display-ready data + narrative + evidence the app imports — and the single home for the actual values and quotes. |
| `BUILD.md` | **The recipe from raw to the view model** — a *data + abstraction spec*: the **target schema in TypeScript** + per slot, how an analyst **queries and abstracts** from the raw export (`db/ehi.sqlite` + `raw/`) to that shape — the source tables, the derivation **logic in words**, and the abstraction rubrics, as a **workflow of parallel agents**. Explains the logic, doesn't recreate the scripts; independent of any intermediate files. *Method, not data* (defined below). May open with a **short design-rationale section** (the argument the page makes, the section beats) when that isn't already evident from the dive itself. |
| `parts/` + `scripts/` | **An optional runnable implementation** of BUILD's recipe (kept when it earns it — e.g. a complex computation): the slot files + bun/SQLite code. The recipe in `BUILD.md` stands without them. Where kept, `parts/` is the editable source and `viewmodel.json` is its assembled output (anti-drift, below). |
| `app.tsx` / `index.html` / `page.css` (+ local `components/`) | the static app. |

**What `BUILD.md` is — the recipe from the raw export to the view model.** It answers one question:
*starting from the **raw** EHI export (`db/ehi.sqlite` + `raw/`), how does an analyst **query and abstract**
their way to `viewmodel.json`?* It must **stand on its own from the raw export** — so do **not** write it in
terms of *this* dive's intermediate files (`dataset.json`, `parts/`, `project.ts`, `assemble.ts`, …). Those
are one incidental implementation, not the recipe; *"read `dataset.json`, then stitch the parts"* is cheating
— it describes plumbing, not how the data was actually derived. Every step names **raw tables and raw notes**
and the query/abstraction that turns them into the target shape. (If the dive keeps a runnable implementation
in `scripts/`, mention it in **one line** as *one* way to run the recipe — never as the recipe's steps.) It is
**method, not data**: the values, quotes, and figures live in `viewmodel.json`; BUILD points at them (by slot
name, `evidenceId`, table). Two parts:

1. **The target schema, in TypeScript.** Give the view model's shape as `interface ViewModel { … }` with a
   nested type per slot — the precise contract the app consumes and the thing the recipe builds toward. Types
   and shape only, no values.
2. **The recipe to populate it from raw — a *data + abstraction spec*, as a workflow of parallel agents.**
   It explains the **logic**, it does not recreate the scripts. Per slot/field of the schema:
   - **projection** (from the structured tables) — the **source**: which **raw** tables / columns / joins; the
     **derivation logic in words** (what is filtered, joined, computed); the **constraints** that bite
     (sentinels like `9999999`, CAST-before-ORDER, `*_DATE_REAL` epoch, dedup by charge `TX_ID`,
     base+supplement assembly); and the **cleaning rules** that produce the target shape (dates → `"Aug 29,
     2022"` with iso/real side fields, drug names → `"lisinopril 10 mg"`, coded categories → plain words). A
     **short SQL fragment only where it clarifies** the logic — a reference, never a recreated query/script.
   - **judgment** (from the raw notes / messages / media) — which raw content to read (`raw/Rich Text/*.RTF`
     via `lib/rtf2txt.ts`, the MyChart messages, the scanned media) and the **abstraction rubric** (the
     decision rules: "classify each med mention as start/stop/continue by …"; "keep the one quote a skeptic
     would demand") that turns it into the target fields. Reference a quote by its `evidenceId` + source note;
     never paste it.
   Lay it out as the **fan-out**: independent slots are parallel agent tasks; the lead assembles the populated
   slots into the schema and checks the invariants (e.g. every cite resolves). The same recipes also run solo.

Hard rules for BUILD: **explain the logic, don't recreate the script** — reference the source tables and state
the rules; a query/code fragment appears only where words don't suffice, never as a transcribed script.
**From raw, not from middle files** — a step that reads an intermediate artifact (`dataset.json`, a `parts/`
file) instead of the raw tables/notes is a bug; fold the cleaning into the recipe. **Don't reproduce data** —
no raw rows, no pasted quotes, no values transcribed for their own sake; name the slot / `evidenceId` / table
and move on. **Describe PHI-bearing fields, never quote them** — a free-text `COMPONENT_COMMENT` that carries
a lab address becomes *"parse the fasting flag, drop the rest."* The **same hard PHI rule as the app** applies
— never SSN, street address, phone, email, or raw MRN. A per-slot block reads like this — **logic and rules,
off the raw tables/notes**:

- ***`moneyflow: { billedNet, writeoff, paid, patient }` — projection.*** Source: `ARPB_TRANSACTIONS` (the PB
  charge ledger). Logic: take the charges, drop the one voided duplicate, and read each charge's settlement
  from its per-charge `TOTAL_MATCH_*` rollup columns — **not** by summing the `Payment`/`Adjustment` rows,
  which double-counts the reversal/repost churn (*the* gotcha here). Write-off = Σ matched-adjustment; paid =
  Σ matched-insurance; patient = matched-total − matched-insurance. (Cast the TEXT amounts; round to cents.)
- ***`evidence: Record<id, {kind, who?, date?, quote?, text?}>` — judgment.*** Source: the progress notes
  (`raw/Rich Text/*.RTF` via `lib/rtf2txt.ts`) and the radiology reads (`ORDER_NARRATIVE`). Rubric: for each
  claim the narrative makes, capture the single verbatim line that proves it (with author + date); quote the
  note not its cache; one per claim; the line a skeptic would demand. Referenced from the narrative by
  `evidenceId`; the quote text itself lives in `viewmodel.evidence`, not here.

**Source of truth — the anti-drift rule (a bug we hit).** Where the projection was kept as runnable code,
**`parts/` is the editable source and `viewmodel.json` is the *assembled* output** — committed because the app
imports it, but **never hand-edited**. To change a number or a sentence, edit the **part** (or its script)
and **re-assemble**; editing the generated view model directly is how it drifts from the source it claims to
come from. A dive with no kept pipeline has `viewmodel.json` as its hand-authored source, and `BUILD.md` is
the recipe that could rebuild it.

**One orienting doc, not two.** `BUILD.md` is the dive's single self-documentation file — its job is to
save the next person from **reverse-engineering the view model** (the interface, the per-slot derivation,
and the judgment rubrics that no script records). Design rationale, where worth keeping, is a short opening
section *inside* BUILD, not a separate document: the finished dive already shows its narrative and
visualization choices on screen. (Some earlier dives also carry a standalone `STORYBOARD.md` — grandfathered,
fine to keep, but don't create new ones.)

**Casing:** the orienting doc is upper-case like `README.md` — `BUILD.md`; everything else in the folder
stays lower-case. Keep it uniform across every dive.

Run every intensive step as a workflow; the lead orchestrates from receipts and screenshots and does not
hand-build. Fan out over views/slots, adversarially verify each claim against the data, and run an explicit
"designed argument, or a pile of charts?" critique pass.

---

## Mechanics (verified — these are stable)

Static site, `bun` + TypeScript + React + D3 (add `zustand` for interaction state; other libs when they
earn it). **Each dive is one self-contained folder** — data and app co-located:
`deep-dives/<name>/{BUILD.md, viewmodel.json, parts/, scripts/, app.tsx, index.html, page.css, components/…}`. The app
imports **only** its sibling view model — `import vm from "./viewmodel.json"` — and bun inlines it at build
time; `parts/` holds the hand-editable view-model slots an `assemble` script stitches into `viewmodel.json`,
and `scripts/` is how that JSON was derived from the DB. Nothing reaches across to a separate data tree.

```bash
bun build index.html --outdir dist                              # static bundle, JSON baked in
bun <skill>/scripts/screenshot.ts dist /tmp/shot.png 1100       # verify: TRUE full-page capture (6–10k px)
bun <skill>/scripts/screenshot.ts dist /tmp/top.png 1100 4000 2600  #  …or legible top section only (to /tmp)
bun <skill>/scripts/serve.ts deep-dives 8088                    # view live: hosts ALL dives + landing
bun <skill>/scripts/build-site.ts deep-dives site               # ship: assemble one static site dir
```

- **Use the scripts; don't hand-roll a server each time.** `screenshot.ts <distDir> out.png` takes a
  built **directory** (it serves it internally over HTTP and tears down — do NOT pass it a URL). `serve.ts`
  hosts the whole `deep-dives/` tree for a human to click through. `build-site.ts` produces the shippable
  `site/`. Reach for the matching one instead of improvising.
- **Serve over HTTP to view; never `file://`** (the crossorigin module bundle is CORS-blocked on a null
  origin and React never mounts → blank page).
- **Screenshot to verify it renders, and look at the whole thing.** The helper measures document height
  over the DevTools protocol and captures beyond the viewport, so tall pages aren't silently truncated. A
  blank page = a JS/import error (check `bun build` output and your import paths). Iterate build → shoot →
  read until it's right end to end.
- **Interactivity still ships static.** Filtering, drill-down, linked views, detail-on-demand all run
  client-side in the bundle; the page stays a single static artifact with the data baked in.
- **Ship it anywhere, root or subpath.** `build-site.ts` builds every dive into one `site/` with the
  landing page and **only relative asset paths**, so the same artifact is correct at a domain root
  (`example.com/`) or a project subpath (`example.com/<repo>/` — how GitHub Pages serves a project site). Keep
  it that way: never write a leading-`/` `href`/`src`/`url(/…)`/`fetch("/…")`, or it breaks under a subpath.
  A ready `.github/workflows/pages.yml` (setup-bun → `build-site.ts` → upload-pages-artifact → deploy-pages)
  publishes on push; preview the exact artifact first with `serve.ts site <port>`.

### Publish — the checklist (a new dive is not done until these pass)

1. **Lint the view model — no raw tells, all cites resolve.** `bun lib/validate-extract.ts
   deep-dives/<topic>/viewmodel.json`. It flags raw Clarity that leaked into *display* content (a stray
   `12:00:00 AM`, a `*_C_NAME` value, a `(PRINIVIL,ZESTRIL)` brand-dump, a `TABLE:COL=id` locator) and any
   unresolved `evidenceId`. Fix the **projection** (`parts/` / the recipe), not the symptom, until it's clean.
2. **Register it in the landing page.** A new `deep-dives/<topic>/` is invisible until you add a card/link
   for it to **`deep-dives/index.html`** (match the existing card markup, link `<topic>/dist/index.html`).
   `build-site.ts` flattens that link to `<topic>/` in the shipped `site/`.
3. **Assemble + preview.** `bun <skill>/scripts/build-site.ts deep-dives site`, then
   `bun <skill>/scripts/serve.ts site <port>` and click through — the landing card and the dive both load.
4. **Screenshot-verify** the dive renders end to end (it must be served over HTTP).
5. **Don't commit build artifacts.** `dist/`, `site/`, and **screenshots are throwaway** — write shots to
   `/tmp`, never into the dive folder, and let `.gitignore` keep `deep-dives/*/dist/` and `deep-dives/*/*.png`
   out of the repo. What you commit is `BUILD.md`, `viewmodel.json`, `parts/`+`scripts/` (if kept), and the
   app source — not its outputs.

## The toolbox (compose and extend — it is NOT a layout)

`components/` holds primitives, not a page template. Each is fed **clean rows straight from the view model**
(the projection already formatted them) — use them as building blocks and **write bespoke views when the
analysis calls for one**:

- `components/charts.tsx` — `BPBandPlot` (category bands behind paired sys/dia), `LabTrend` (value vs
  shaded reference range, out-of-range marked), `Timeline` (`labels` staggers them), `IntervalBars` (med
  exposure). Each takes a small array of display-clean rows from the view model. Extend or replace; a real
  analysis usually needs at least one custom view.
- `components/provenance.tsx` — the **clean evidence drawer**: wrap the page in `<EvidenceProvider
  evidence={vm.evidence}>`, drop one `<SourceDrawer/>`, and put `<Cite ids="e_carc_45"/>` next to any claim.
  Clicking the ⌖ opens a drawer onto `vm.evidence[id]` — a **verbatim note quote** or a **readable
  statement** of a structured fact, rendered for a human. There is no locator-to-row resolution and no raw
  dataset in the bundle: the evidence map was cleaned at projection, so a Clarity row physically *cannot*
  reach the drawer. This is how "interrogable" is met without ever vomiting raw rows. (Several dives inline
  this same ~40 lines rather than importing the kit — either is fine; the shape is identical.)
- `components/ui.tsx` / `styles.css` — typographic primitives for legible long-form. Use `Stat`/`StatRow`
  sparingly if at all; a wall of stat-cards is the infographic smell.

The view model is already display-clean and viz-ready, so **derive only light presentational things in the
app** (a percentage, a sort order, a max for a bar width) and **never hard-code a number that belongs in the
projection**. If a figure the app computes disagrees with the narrative prose, the projection is wrong — fix
`parts/` and re-assemble (`scripts/assemble-viewmodel.ts`), don't paper over it in the component.

## Visualization craft — build the view the data deserves (often custom)

**The kit is a floor, not a menu. Be willing — eager — to build a custom visualization when the data and
the analysis call for one.** This is the payoff of co-designing the abstraction and the app: because you
hold the *complete* normalized dataset, you can render the exact view a domain expert reasons with, not the
nearest generic chart. A laned list where the data is a **family tree** is a missed opportunity — draw a
real **graphical pedigree** (generations, sex symbols, affected-status shading, the proband marked). A
denial saga is a **state machine over a claim**, not a bar chart. A medication course against symptom
reports is a small bespoke **dual-track timeline**. When you reach for a kit chart, ask first whether a
purpose-built one would let the expert *see* the point the analysis is making — and if so, build it.

When a standard form *is* right, do it right: blood pressure → category-band plot, not a line; labs → value
against their own reference interval, out-of-range marked, trended; money → flows and reconciled ledgers;
timelines for arcs; med exposure → intervals. Respect units; never plot a sentinel; annotate in place;
**reconcile competing aggregations** of one quantity (general-patterns §42) where each appears. Few,
well-chosen, fully interrogable views — generic or custom — beat many decorative ones.

> **Sanity-check every figure against the whole it belongs to.** A part cannot exceed its total. If a
> "by category / by reason" breakdown sums to more than the quantity it decomposes, you are summing a
> **gross** ledger that double-counts (typically the same items re-aggregated across retried/superseded
> records), and presenting it as "the same quantity, by category" is false — net it out, or relabel it
> gross and make the gross-vs-net gap its own honest finding. Run this check before any "same quantity,
> two ways" panel ships.

## Domain scores & indices — research and compute them, don't just display inputs

A real deep dive often needs a **computed clinical/financial figure the chart never produced** — an ASCVD
or PREVENT 10-year risk, a FIB-4, a Charlson index, a CHA₂DS₂-VASc, an effective write-off rate. You have
**autonomy to learn the model and compute it.** Find the formula (it is fine to research a standard score),
then **abstract its inputs from *any* available source** — structured tables *and* the unstructured notes
(an enrich step: a smoking status from a note, a family onset age the form left null). Compute it in the
**projection** (a `scripts/` step that writes the result into the view model — *not* live in the app),
present it with **every input shown and drillable** and **every caveat
explicit** (a missing input, a non-fasting lab, an office-only measurement → give a *bounded range*, not a
false-precise point). The assembled inputs + a transparent, checkable number is exactly the added reasoning
that separates a tool from a readout.

## What "good" looks like

A domain expert reads it and says *"yes — now I understand this patient's <topic>, and I can check
anything I doubt."* It reasons; it shows the full record, not a chosen slice; every claim traces to rows
or a note; it renders cleanly end to end; it carries no slop headers, no decorative stat-walls, no PHI
(no SSN/address/email/phone/raw MRN). Friction with the abstraction-pass / Reading skills is captured and
routed back.
