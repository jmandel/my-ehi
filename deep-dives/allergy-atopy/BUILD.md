# BUILD — allergy & atopy deep dive

How an analyst recreates `viewmodel.json` **from the raw Epic EHI export** (`db/ehi.sqlite` + `raw/`). This is
a *data + abstraction spec*, not a script. Part 1 is the target schema the recipe builds toward; Part 2 is the
per-slot recipe — the raw tables/notes, the derivation logic in words, the constraints that bite, and (for the
note-derived slots) the abstraction rubric. The whole IgE/SPT centerpiece is **note-derived judgment**: those
values exist only as free text in two problem-overview RTFs, never as structured result rows.

A runnable implementation of this recipe is kept in `parts/` (the editable slot files) + `scripts/assemble.ts`
(splices the parts into `viewmodel.json`, validating that every cite resolves). That is *one* way to run the
recipe below — never read it as the recipe; the recipe is from raw.

---

## Part 1 — The target schema (TypeScript)

```ts
interface ViewModel {
  meta: { patient: string; topic: string; view: string; source: string };
  summary: string;                                   // multi-sentence assessment lede
  sections: Section[];                               // ordered narrative beats
  evidence: Record<string, Evidence>;                // every cite id resolves here

  allergies: Allergy[];                              // the coded allergy list (the spine)
  peanutGenesis: GenesisRow[];                       // the 2020 kiosk allergen-review micro-flow
  igeComponents: IgeComponents;                      // the centerpiece — note-derived
  problems: Problem[];                               // the two 2025 atopy problems
  meds: Med[];                                       // EpiPen + loratadine (historical)
  spt: SkinPrickTest;                                // aeroallergen panel — note-derived
  referral: Referral;                                // the AMB referral to Allergy
  timeline: TimelineEvent[];                         // the 2018→2025 atopic arc
}

interface Section {
  id: string;
  title: string;
  narrative: { text: string; cites: string[] }[];    // each cite is an evidence key
}

interface Evidence {
  kind: "fact" | "note";                             // structured statement vs verbatim note quote
  who?: string;                                      // note authorship/role
  date?: string;                                     // display date or date phrase
  text?: string;                                     // readable statement of a structured fact (kind:"fact")
  quote?: string;                                    // verbatim note line (kind:"note")
}

interface Allergy {
  allergen: string;                                  // readable label, e.g. "Peanut (diagnostic)"
  category: string;                                  // "Food (tree nut)" | "Drug (antibiotic)" | "Food (test-based)"
  severity: string;                                  // "High"
  reaction: string;                                  // "Hives"
  status: string;                                    // "Active"
  notedDate: string;                                 // "Aug 9, 2018"
  notedBy: string;                                   // "Ireland, Tracy C"
  dateAccuracy: string | null;                       // "Exact Date" | null
  date_iso: string;                                  // "2018-08-09"  (side field)
  src: string;                                       // trace tag (side field)
  allergyId: string;                                 // raw id (side field)
}

interface GenesisRow {
  allergen: string;                                  // reviewed allergen, readable
  accepted: boolean;                                 // kept (Y) vs rejected (N)
  freeText: string | null;                           // the typed free-text add, if any
  src: string;
}

interface IgeComponents {
  testName: string;                                  // "Quest component-resolved IgE panel"
  testDate: string;                                  // "Dec 5, 2024"
  testDate_iso: string;                              // "2024-12-05"
  units: string;                                     // "kU/L (specific IgE)"
  positiveThreshold: number;                         // 0.1
  families: IgeFamily[];                             // the protein-family explainer cards
  foods: IgeFood[];                                  // the three implicated foods, dissected
  negatives: { food: string }[];                     // whole-allergen-negative tree nuts
  src: string;
  evidenceId: string;                                // -> "e_ige_panel"
}
interface IgeFamily {
  key: string;                                       // "PR-10" | "storage" | "LTP"
  label: string;
  risk: "cross-reactive" | "primary";
  blurb: string;
}
interface IgeFood {
  food: string;
  wholeIgE: string;                                  // display string, e.g. "<n> kU/L"
  wholeValue: number;                                // the numeric IgE
  wholePositive: boolean;
  components: IgeComponent[];
  interpretation: string;                            // verdict line
}
interface IgeComponent {
  code: string;                                      // "Cor a 1", "Ara h 8", "Jug r 1", ...
  name: string;                                      // "Hazelnut PR-10"
  family: string;
  positive: boolean;
  risk: "cross-reactive" | "primary";
  meaning: string;
}

interface Problem {
  diagnosis: string;                                 // "Pollen-food allergy"
  status: string;                                    // "Active"
  workupDate: string;                                // "May 9, 2025" (problem NOTED_DATE)
  workupDate_iso: string;
  enteredBy: string;                                 // "Rammelkamp, Zoe L"
  enteredDate: string;                               // "Dec 4, 2025" (history first entry)
  enteredDate_iso: string;
  src: string;
  evidenceId: string;
}

interface Med {
  name: string;                                      // "Epinephrine auto-injector 0.3 mg (EpiPen)"
  role: string;                                      // "Emergency rescue (anaphylaxis)"
  documentation: string;                             // "Documented as already-taken (historical), not a new prescription"
  documentedDate: string;                            // "Dec 4, 2025"
  documentedDate_iso: string;
  src: string;
  evidenceId: string;
}

interface SkinPrickTest {
  test: string;                                      // "Skin-prick test"
  date: string;                                      // "May 9, 2025"
  date_iso: string;
  positives: string[];                               // ["Trees","Molds",...] — expanded labels
  priorImmunotherapy: string;                        // free-text statement
  src: string;
  evidenceId: string;
}

interface Referral {
  order: string;                                     // "Referral to Allergy"
  placedBy: string;                                  // "Rammelkamp, Zoe L"
  placedDate: string;                                // "Nov 27, 2024"
  placedDate_iso: string;
  indication: string;                                // "Past history of nut allergy"
  status: string;                                    // "Authorized"
  appointmentDate: string;                           // "May 9, 2025"
  appointmentDate_iso: string;
  src: string;
  evidenceId: string;
}

interface TimelineEvent {
  date: string;                                      // "Aug 9, 2018"
  date_iso: string;
  event: string;                                     // one-line description
  kind: "allergy" | "referral" | "test" | "problem";
  evidenceId: string;
}
```

---

## Part 2 — The recipe (data + abstraction spec)

### Workflow shape

The slots split cleanly into **projection slots** (structured tables, mechanical cleaning) and one big
**judgment unit** (the notes). Fan out:

- **Agent A — allergy spine** (`allergies`, `peanutGenesis`): pure projection off the `ALLERGY` family.
- **Agent B — problems / meds / referral** (`problems`, `meds`, `referral`): projection off `PROBLEM_LIST`,
  `ORDER_MED`, the `ORDER_PROC → REFERRAL` bridge.
- **Agent C — the note-reading judgment unit** (`igeComponents`, `spt`): owns the two problem-overview RTFs;
  reads them, applies the immunology rubric, and produces both the structured panel grid and the SPT panel.
  This is the analytic core and the one slot a query cannot reproduce.
- **Lead** writes the narrative (`summary`, `sections`) and the `evidence` map citing the agents' outputs,
  derives `timeline` from the dated anchors the agents found, and assembles into the schema — then checks the
  one invariant that matters: **every `cites[]` and every slot `evidenceId` resolves to an `evidence` key**.

Shared cleaning conventions used everywhere below:
- **Dates.** Raw dates are TEXT like `"8/9/2018 12:00:00 AM"`. Parse `M/D/YYYY`, drop the midnight time, emit a
  display form (`"Aug 9, 2018"`) plus an iso side field (`"2018-08-09"`). Never surface the `12:00:00 AM`.
- **Names.** Raw is SHOUTING (`"IRELAND, TRACY C"`). Title-case to `"Ireland, Tracy C"`; keep the `LAST, FIRST`
  order.
- **Labels.** Title-case SHOUTING allergen/category strings; map coded categories to plain words.
- **Side fields.** `src`, `*_iso`, raw ids ride along for tracing only — never rendered as display content.

---

### `allergies` — projection · Agent A

**Source.** `PAT_ALLERGIES` (the patient's pointer list) `JOIN ALLERGY` on `ALLERGY_ID = ALLERGY_RECORD_ID`,
`LEFT JOIN ALLERGY_REACTIONS` on `ALLERGY_ID`. Columns: `ALLERGEN_ID_ALLERGEN_NAME` (allergen),
`ALLERGY_SEVERITY_C_NAME` (severity), `ALLERGY_REACTIONS.REACTION_C_NAME` (reaction),
`ALRGY_STATUS_C_NAME` (status), `DATE_NOTED`, `ENTRY_USER_ID_NAME` (noted-by),
`ALLERGY_NOTED_DATE_ACCURACY_C_NAME`.

**Logic.** One output row per allergen. Group the reaction child rows up into the allergen and join them into
the `reaction` string (here every allergen has exactly the single default reaction "Hives"). Map the allergen
to a human `category` by a small lookup keyed on the raw allergen name (tree nut → "Food (tree nut)";
sulfa/penicillins → "Drug (antibiotic)"; the diagnostic peanut → "Food (test-based)"). Title-case the allergen,
preserving the parenthetical so `"PEANUT (DIAGNOSTIC)"` reads `"Peanut (diagnostic)"`.

**The constraint that bites — the label-lie.** Do **not** read severity from `SEVERITY_C_NAME`; that column is
the allergy **type** (it reads "Allergy"), not the severity. The real severity is `ALLERGY_SEVERITY_C_NAME`
("High"). This is the single most important gotcha in the slot — wiring the wrong column makes the whole roster
say the wrong thing. (Recorded in the `e_alg_2018` evidence text as an explicit caveat.)

**Ordering.** Sort by noted date as a real date, not lexically — parse `DATE_NOTED` to a timestamp in code and
sort on that. A lexical sort on the raw `M/D/YYYY` text mis-orders (e.g. "7/14/2020" vs "8/9/2018"). Result is
the 2018 trio first, then the 2020 peanut entry.

```sql
-- the join shape, for reference only (not the recipe)
SELECT a.ALLERGEN_ID_ALLERGEN_NAME, a.ALLERGY_SEVERITY_C_NAME, r.REACTION_C_NAME, a.DATE_NOTED
FROM PAT_ALLERGIES pa
JOIN ALLERGY a ON a.ALLERGY_ID = pa.ALLERGY_RECORD_ID
LEFT JOIN ALLERGY_REACTIONS r ON r.ALLERGY_ID = a.ALLERGY_ID
```

**Aside (not in the view model but worth knowing while in these tables).** A fifth `PAT_ALLERGIES` pointer is an
orphan — it points to an `ALLERGY` id with no detail row (a deleted/superseded allergy); surface it via the same
`LEFT JOIN` with `ALLERGY.ALLERGY_ID IS NULL`. And `ALLERGY_FLAG` is a toggle log whose **last `LINE`** is the
current No-Known-Allergies state (here "N" = patient has known allergies). Neither reaches the schema, but they
confirm the list is complete and current.

---

### `peanutGenesis` — projection · Agent A

**Source.** `PAT_REVIEW_ALLERGI` — the per-encounter allergen-review log — filtered to the **2020 kiosk-review
encounter CSN** (the encounter where "Peanut (diagnostic)" was born; identify it as the `ALLERGY_PAT_CSN` /
genesis encounter of the diagnostic-peanut `ALLERGY` row, then pull that CSN's review rows). Columns:
`PAT_REVIEW_ELG_ID_ALLERGEN_NAME` (the system-suggested coded allergen), `PAT_REVIEW_EXTERNAL` (free-text the
user typed), `PAT_REVIEW_ELG_R_YN` (kept/rejected), `LINE`.

**Logic.** One row per reviewed item, ordered by `CAST(LINE AS INT)` (the LINE is TEXT; an un-cast ORDER BY
sorts "10" before "2"). For each: `allergen` = the coded name, or the free-text if there's no coded allergen;
`accepted` = `R_YN === "Y"`; `freeText` = `PAT_REVIEW_EXTERNAL` when present. The story this slot tells: the
suggested coded allergen "Peanut Oil" was **rejected**, and a free-text **"Peanut (diagnostic)"** was accepted
in its place — that free-text add is what became the coded high-severity allergy. The other three (penicillins,
sulfa, tree nut) were re-affirmed at the same review. Title-case the labels.

---

### `igeComponents` — **judgment** · Agent C  *(the centerpiece)*

**Why this is judgment, not projection.** The Quest component-resolved IgE panel was run by an **outside lab**.
There are **no structured allergen-IgE rows** in `ORDER_RESULTS` — you can confirm the negative by scanning
`ORDER_RESULTS.COMPONENT_ID_NAME` for any allergen/IgE/component token and finding none. Every value in this
slot lives **only as free text** in one note. So the slot is a *hand-curated transcription + immunological
interpretation* of that note, frozen into the view model and flagged as such (in `meta.source`, the section
prose, and the `e_ige_panel` evidence quote).

**Source — the note, reached from raw.** The "Pollen-food allergy" problem in `PROBLEM_LIST` carries an
`OVERVIEW_NOTE_ID`. That id resolves to the RTF at `raw/Rich Text/HNO_<OVERVIEW_NOTE_ID>_*.RTF`. De-RTF it with
`lib/rtf2txt.ts` (strip control words, decode `\'hh` hex escapes, collapse `\par`→newline). The relevant text is
one compact line describing the Quest panel; it is captured verbatim as the `e_ige_panel` evidence `quote` —
**reference it by that evidenceId; never paste it here.** (Free-text note: it carries clinical values only,
no patient identifiers — keep the panel line, ignore the rest.)

**Abstraction rubric — reading the note into the grid.** Apply, in order:

1. **Whole-allergen values.** The note states six tree nuts "negative" and three faint numeric positives
   (walnut, hazelnut, peanut, each well under 1 kU/L). Put the six into `negatives[]` (title-cased food names);
   put the three into `foods[]` with their numeric `wholeValue` and a `"0.xx kU/L"` display string.
   `positiveThreshold` = 0.1 kU/L (the lab's detection floor; the three positives sit just above it).
2. **Component → protein family → risk.** This is the analytic move the whole dive turns on. Classify each
   named molecular component into one of three families and the risk it implies:
   - **PR-10 (Bet v 1 homolog)** — `Cor a 1` (hazelnut), `Ara h 8` (peanut): heat-labile birch-pollen mimics.
     Positivity ⇒ pollen cross-reactivity ⇒ **oral allergy syndrome**, low systemic risk. `risk:"cross-reactive"`.
   - **Storage protein (2S albumin)** — `Jug r 1` (walnut), `Ara h 1/2/3` (peanut): heat-stable. Positivity ⇒
     **true systemic/anaphylactic** food allergy. `risk:"primary"`.
   - **LTP (lipid transfer protein)** — `Jug r 3` (walnut): heat-stable, systemic. `risk:"primary"`.
   The principle to encode in `families[].blurb` and each component's `meaning`: *which* protein the IgE binds,
   not *how much* whole-allergen IgE, is what sets the risk.
3. **Per-food verdict.** Read the note's own component results onto each food and write the `interpretation`:
   - **Walnut** — storage (`Jug r 1`) and LTP (`Jug r 3`) both negative ⇒ "no evidence of primary walnut allergy"
     (its low whole value has no dangerous component behind it).
   - **Hazelnut** — `Cor a 1` only ⇒ "oral allergy syndrome" (the note says this explicitly).
   - **Peanut** — `Ara h 8` positive, the storage "remainder" negative ⇒ "oral allergy syndrome"; the
     Ara h 8-only (not Ara h 2) signature is the classic birch-driven, low-risk peanut pattern.
4. **Date / test name.** Test date = the "12/5/2024" the note states (display "Dec 5, 2024", iso side field).
   `testName` = "Quest component-resolved IgE panel"; `units` = "kU/L (specific IgE)".

**Honesty constraint.** Because the numbers are transcribed from prose, not a lab feed, the dive carries no
units/reference-flag audit trail — state that limitation (it lives in the assessment section and the "what this
export cannot answer" beat). The `igeComponents.evidenceId` points at `e_ige_panel`, whose quote is the single
source a skeptic can check the whole grid against.

---

### `spt` — **judgment** · Agent C

**Source.** The **"Allergic rhinoconjunctivitis" problem's** `OVERVIEW_NOTE_ID` → its
`raw/Rich Text/HNO_<id>_*.RTF`, de-RTF'd the same way. The skin-prick panel and prior-immunotherapy fact exist
only in this note's free text (no structured SPT rows). Captured verbatim as the `e_spt` evidence `quote`;
reference by evidenceId, do not paste.

**Rubric.** From the one SPT line: pull the test date ("5/9/25" → "May 9, 2025"), split the positive
aeroallergen list on commas, and **expand the chart's shorthand to plain words** (e.g. "RW" → "Ragweed"; lower
labels title-cased). Result is the nine positive categories (trees, molds, dust mites, dog, cat, grass, ragweed,
weeds, mugwort). Also lift the "Prior SCIT ~2000" phrase into `priorImmunotherapy` as a readable statement
("Prior subcutaneous immunotherapy (allergy shots), ~2000"). This panel is the **engine** the food findings are
an echo of — its evidenceId (`e_spt`) is cited from both the SPT section and the IgE cross-reactivity beat.

---

### `problems` — projection · Agent B

**Source.** `PROBLEM_LIST` for the two atopy problems, `LEFT JOIN CLARITY_EDG` on `DX_ID` for the human
`DX_NAME`, `LEFT JOIN PROBLEM_LIST_HX` (the history rows) at `LINE = '1'` for the first-entry stamp. Columns:
`DX_NAME` (diagnosis), `PROBLEM_STATUS_C_NAME` (status), `NOTED_DATE`, `PROBLEM_LIST_HX.HX_DATE_OF_ENTRY` and
`HX_ENTRY_USER_ID_NAME`.

**Logic.** Two rows: "Allergic rhinoconjunctivitis, seasonal and perennial" and "Pollen-food allergy".
The **two-date subtlety** that the slot exists to expose: `NOTED_DATE` is the clinically-meaningful workup date
(May 9, 2025 — the allergy visit), but the row was actually **keyed into the chart later** — read that entry
date from the `LINE 1` history row (Dec 4, 2025). Emit both: `workupDate` (from `NOTED_DATE`) and `enteredDate`
(from history), each with an iso side field, plus `enteredBy` (title-cased history user). `status` is taken
as-is ("Active"); note the problem list ships both active and resolved entries, so do not assume.

**Diagnosis name via the problem's own `DX_ID`** through `CLARITY_EDG` — not via any ICD cross-walk; the plain
problem name is what the view wants.

---

### `meds` — projection · Agent B

**Source.** `ORDER_MED` for the EpiPen and loratadine orders (optionally `LEFT JOIN CLARITY_MEDICATION` on
`MEDICATION_ID` for the generic name). Columns: `DISPLAY_NAME`/`DESCRIPTION`, `ORDER_CLASS_C_NAME`,
`PROVIDER_TYPE_C_NAME`, `ORDERING_DATE`.

**Logic.** Two rows. The **defining fact** is the `ORDER_CLASS_C_NAME` = **"Historical Med"** (provider type
"Documenting"): these are **documented as already-in-use**, not freshly prescribed — so `documentation` reads
"Documented as already-taken (historical), not a new prescription", and the documented date is `ORDERING_DATE`
(Dec 4, 2025). Clean the drug names to readable, dosed forms ("Epinephrine auto-injector 0.3 mg (EpiPen)",
"Loratadine 10 mg") and assign a plain-language `role` (rescue auto-injector vs daily/PRN antihistamine).
Strip any Epic `"(BRAND,BRAND) tablet"` cruft from the raw name when cleaning.

---

### `referral` — projection · Agent B

**Source.** The order→referral bridge: `ORDER_PROC` (the placed order) `JOIN ORDER_PROC_2` on `ORDER_PROC_ID`
to get `REFERRAL_ID`, then `JOIN REFERRAL` on that id; `LEFT JOIN REFERRAL_APT` on `REFERRAL_ID` for the
appointment, and `LEFT JOIN REFERRAL_DX → CLARITY_EDG` (at `LINE='1'`) for the indication diagnosis name.
Columns: `REFERRAL.REFERRING_PROV_ID_REFERRING_PROV_NAM` (placer), `ORDER_PROC.ORDERING_DATE` (placed),
`RFL_STATUS_C_NAME` (status), `REFERRAL_DX`'s `DX_NAME` (indication), `REFERRAL_APT.SERVICE_DATE` (appointment).

**Logic.** One row. `order` = "Referral to Allergy"; `placedBy` title-cased; `placedDate` from `ORDERING_DATE`
(Nov 27, 2024); `indication` = the `LINE 1` referral-DX name ("Past history of nut allergy"); `status` =
"Authorized"; `appointmentDate` from the referral-appointment service date (May 9, 2025 — the same day as the
SPT, which is the narrative hinge: the referral question and its answer bracket the workup). All dates cleaned
to display + iso. The cross-org target and external-appointment fields exist (`REFERRAL_CROSS_ORG`,
`REFERRAL_APT.EXT_SVC_DTTM`) but the view model keeps only order/placer/dates/indication/status.

---

### `timeline` — derived (lead)

**Source.** Not its own query — it is the **six dated anchors** the slots above already established, reduced to
one line each: the 2018 allergy trio (`e_alg_2018`), the 2020 peanut genesis (`e_alg_peanut`), the 2024 referral
(`e_referral`), the 2024 Quest draw (`e_ige_panel`), the 2025 allergy visit / SPT (`e_spt`), and the 2025
problem formalization (`e_problem_pfa`). Each event carries the display+iso date, a one-line `event`, a `kind`
tag (allergy / referral / test / problem) for color-coding, and the `evidenceId` of the slot it summarizes.
The dates come from the same raw fields the source slots used; this slot just sequences them.

---

### `summary`, `sections`, `evidence` — hand-authored narrative (lead)

These are the allergist's reasoning, written by the lead over the agents' outputs — the analytic spine the app
renders. `sections` are the storyboard beats (overview → peanut genesis → IgE components → 2025 problems →
management → assessment), each `text` paragraph citing `evidence` keys.

The **`evidence` map** is the clean drawer content, of two kinds:
- **`kind:"fact"`** — a readable statement of a structured finding (e.g. `e_alg_2018`, `e_problem_pfa`,
  `e_referral`, `e_meds`). Authored from the projection slots; the `text` restates the fact in plain English
  (including the severity label-lie caveat in `e_alg_2018`). No raw rows.
- **`kind:"note"`** — a **verbatim line** from one of the two overview RTFs (`e_ige_panel` = the Quest panel
  line; `e_spt` = the SPT line), each with `who` (note role) and `date`. These are the only two quotes in the
  dive, and they are the checkable source for the entire note-derived centerpiece.

**Invariant the lead checks at assembly:** every `cites[]` id in every section, and every slot `evidenceId`
(`igeComponents`, `spt`, `referral`, each `problems[]`, each `meds[]`, each `timeline[]`), resolves to a key in
`evidence`. A dangling reference fails the build.
