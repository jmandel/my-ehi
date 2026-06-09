# Allergy & atopy deep dive — storyboard (the view designed first)

**Patient:** MANDEL, JOSHUA C (Z7004242) — a polysensitized atopic adult.
**The argument the whole page makes:** his allergy list reads like a heavily-allergic patient with
two drug allergies and two nut allergies — four entries, all "High severity," all flattened to the
same coded reaction "Hives." The single most clinically important fact about this profile is one a
plain list actively **hides**: most of his food "allergies" are not food allergies at all. A
2024–2025 allergist workup took the food story apart at the molecular level, and component-resolved
IgE testing resolved every implicated nut to the **birch-pollen-cross-reactive PR-10 proteins only**
(hazelnut Cor a 1, peanut Ara h 8) — while the storage proteins that mark true, anaphylaxis-risk food
allergy (walnut Jug r 1/Jug r 3, peanut Ara h 2 and the rest) were **negative**. The diagnosis is
**oral allergy syndrome**, driven by one broadly positive aeroallergen sensitization — not nut allergy.

**The tool an allergist would want:** not an infographic, and not a re-print of the allergy table. A
page that (1) shows the flat list the way the chart presents it, then immediately flags the two quiet
"tells" that it is not what it implies; (2) traces how the "Peanut (diagnostic)" entry was actually
**born** — at a kiosk allergen review, not from a reaction; (3) teaches the one principle the whole
case turns on (PR-10 cross-reactivity vs. storage-protein primary allergy), then **dissects each
implicated food** — its low whole-allergen value beside *which protein* its IgE binds — so the
reframe is something the reader can *see*; (4) places the 2025 problem-list formalization and ties the
food story back to its engine, the aeroallergen skin-prick test; (5) shows the referral and the two
documented medications; and (6) closes like a consult — assessment, what an allergist would do, and an
honest list of what this export simply cannot answer.

**Structural rule:** the app imports ONLY `viewmodel.json` (`import vm from "./viewmodel.json"`). Every
value in it is already display-clean (dates "Aug 9, 2018"; allergens as readable labels; IgE values as
"0.95 kU/L"; plain status words). Every claim cites an `evidenceId` that resolves, in a drawer, to a clean
note **quote** (with author + date) or a clean readable **statement** of a structured fact — never a raw
Clarity row. The headline figures are carried in the view model, so the views render numbers, they do not
derive them. This dive HAS a projection pipeline, so the anti-drift rule applies: the structured slots are
the output of `project.ts` (committed into `parts/slots.json`), the narrative + evidence are hand-authored
in `parts/narrative.json`, and `viewmodel.json` is the **assembled** output of `scripts/assemble.ts` — to
change a number, re-run the projection; to change a sentence, edit the narrative part and re-assemble; the
view model is never hand-edited. The BUILD record carries the per-slot recipe.

**The fact that shapes everything: this dive is note-derived.** The whole molecular story — every IgE
value, every component result, the skin-prick panel, the prior immunotherapy — exists in this export
**only as free text in two problem-overview notes.** There are **no structured allergen-IgE result
rows** (the panel was an outside Quest lab; nothing landed in `ORDER_RESULTS`). So the evidence drawer
for the centerpiece is, correctly, a **verbatim note quote**, and the structured `igeComponents` slot
is a *hand-curated transcription* of that quote — flagged as such everywhere it matters.

---

## Section order, beat by beat

Each section lists: **narrative beat** · **visualization(s)** · **crunched figures/tables** ·
**evidence it drills to**. Section ids match `viewmodel.sections[].id`. (A header reframe board sits
above section 1; the seven-year timeline is folded into the overview section.)

### Header — reframe board (above `overview`)
- **Beat:** the case in one move. A two-column **before → after**: what the plain allergy list says
  ("Peanut: High severity, reaction Hives" / "two nut allergies — textbook anaphylaxis setup") beside
  what component-resolved IgE showed ("Ara h 8 only (PR-10), storage proteins negative" / "oral allergy
  syndrome — birch cross-reactivity, low systemic risk"). A footer notes the drug allergies are a
  separate question the IgE panel does not address.
- **Visualization:** the before/after reframe board.
- **Drills to:** `e_ige_panel`, `e_spt`.

### 1. The atopic profile — `overview`
- **Beat:** present the four active, high-severity allergies as the list presents them, then surface the
  two quiet signals that they are not what a flat list implies — "Hives" on all four is a default coded
  reaction, and the peanut entry is explicitly labeled "(diagnostic)," a clinician's flag for a
  test-based sensitization rather than a witnessed anaphylaxis. Behind the food entries sits a
  long-standing environmental allergy. The 2024–2025 workup was an investigation of how real these food
  entries are.
- **Visualization(s):** an **allergy roster** (one row per allergen: severity pill, category, reaction,
  noted date + author, and a "tell" tag where one applies — "test-based, not a reaction" /
  "reframed below as cross-reactivity"); a **seven-year timeline** (the list assembled 2018–2020, then
  the 2024–2025 workup arc, kind-coded allergy/referral/test/problem).
- **Crunched:** 4 active allergies; the 2018 trio (tree nut, sulfa, penicillins) entered together by one
  nurse; "Peanut (diagnostic)" added 2020; the 6-event arc.
- **Drills to:** `e_alg_2018`, `e_alg_peanut`, `e_spt`; each timeline node to its own evidence id.

### 2. How the peanut entry was created — `peanut-genesis`
- **Beat:** the "Peanut (diagnostic)" allergy did not come from a reaction. At a Jul 14, 2020 kiosk
  allergen review the system suggested the coded allergen "Peanut oil," it was rejected, and a free-text
  "Peanut (diagnostic)" was added in its place — that free-text add became the coded high-severity
  allergy. The "(diagnostic)" qualifier is the tell, and the component testing five years later bore it
  out exactly.
- **Visualization:** a **micro-flow** of the kiosk review, item by item — each reviewed allergen as a
  card marked kept / rejected, with the rejected "Peanut Oil" and the accepted free-text
  "Peanut (diagnostic)" called out.
- **Crunched:** the 5-row review (penicillins kept, sulfa kept, peanut oil rejected, tree nut kept,
  free-text peanut added).
- **Drills to:** `e_alg_peanut`, `e_peanut_genesis`, `e_ige_panel`.

### 3. Component-resolved IgE testing — `ige-components`  *(the centerpiece)*
- **Beat:** the analytical climax. State plainly that the panel lives entirely in one overview note's
  free text — there are no structured IgE rows — then teach the principle and dissect the result. Read as
  whole-allergen numbers alone the panel is already reassuring (six tree nuts negative; the three faint
  positives all below 1 kU/L). But the molecular layer is the point: PR-10 proteins are heat-labile
  birch mimics that cause oral allergy syndrome, low systemic risk; storage proteins and LTPs are the
  heat-stable markers of true anaphylactic allergy. *Which* protein the IgE binds — not how much — is
  what tells you the risk. Every positive here is a cross-reactive PR-10; every systemic-risk marker is
  negative.
- **Visualization(s):** a **principle band** (two cards — PR-10 / cross-reactive / low risk vs. storage
  & LTP / primary / anaphylaxis risk); the bespoke **component dissection** — for each implicated food
  (walnut, hazelnut, peanut): its low whole-allergen IgE on a 0–1 kU/L bar with the positivity threshold
  marked, beside its component chips color-coded by family (teal PR-10, red storage, amber LTP),
  positive filled / negative outlined, each with its meaning and a verdict line ("Oral allergy
  syndrome." / "No primary allergy."). A negatives strip for the six flatly-negative tree nuts.
- **Crunched (transcribed from the note):** walnut 0.12 (Jug r 1 neg, Jug r 3 neg); hazelnut 0.95
  (Cor a 1 pos only); peanut 0.13 (Ara h 8 pos, storage "remainder" neg); six tree nuts negative;
  positivity threshold 0.1 kU/L.
- **Drills to:** `e_ige_panel` (the verbatim Quest quote), `e_spt`, `e_problem_pfa`.

### 4. The 2025 atopy problems — `problems-2025`
- **Beat:** on Dec 4, 2025 the workup was formalized into two problem-list entries — "Allergic
  rhinoconjunctivitis, seasonal and perennial" and "Pollen-food allergy" — both back-dated to the
  May 9, 2025 allergy visit. The naming itself encodes the analysis: not "nut allergy," but
  **pollen-food allergy**. Then tie the food story back to its engine: the broadly positive aeroallergen
  skin-prick test, the upstream sensitization the food findings are an echo of.
- **Visualization(s):** a **problems + meds card pair** (the two problems; the meds also surface here);
  the **skin-prick panel** — the nine positive aeroallergen categories as chips, with the prior
  immunotherapy (~2000) noted.
- **Crunched:** 2 problems, both noted May 9 2025 / entered Dec 4 2025 by Dr. Rammelkamp; SPT positive
  across 9 categories (trees, molds, dust mites, dog, cat, grass, ragweed, weeds, mugwort).
- **Drills to:** `e_problem_arc`, `e_problem_pfa`, `e_spt`.

### 5. Referral and medications — `management`
- **Beat:** the thread runs through a referral and two documented medications. A referral to Allergy was
  placed Nov 27, 2024 under the indication "past history of nut allergy," with the appointment on May 9,
  2025 — the referral question ("is the nut allergy real?") and its answer ("oral allergy syndrome")
  bracket the molecular workup. An EpiPen 0.3 mg and loratadine 10 mg appear on the chart, both
  documented Dec 4, 2025 as **historical** medications — recorded as already-in-use, not newly written.
- **Visualization:** a **referral card** (order, placer, date, indication, status, appointment).
- **Crunched:** referral placed 11/27/2024 → appointment 5/9/2025; EpiPen + loratadine, both historical,
  documented 12/4/2025.
- **Drills to:** `e_referral`, `e_meds`.

### 6. Assessment — `assessment`
- **Beat:** close like a consult. (a) **Assessment:** a polysensitized, pollen-allergic adult with
  allergic rhinoconjunctivitis and an oral-allergy-syndrome food profile — and the single most useful
  thing in the record is that component-resolved IgE testing was done and correctly interpreted.
  (b) **What an allergist would do:** reassure on systemic risk for the three implicated nuts while
  continuing to honor the documented drug allergies (a separate question the IgE panel does not answer);
  counsel that OAS is typically worse with raw foods and in pollen season; revisit whether a
  "high severity" nut label and a retained EpiPen still match an Ara h 8-only, storage-protein-negative
  profile, or whether they can be downgraded with a documented shared decision; treat the aeroallergen
  burden, the actual driver. (c) **What this export cannot answer:** the IgE/SPT values exist only as
  free text in two overview notes — no structured rows, units, or reference flags to audit; the drug
  allergies carry no reaction detail beyond the default "Hives" and no test confirmation; and the export
  does not record whether the EpiPen was ever used, whether the nut labels were formally de-escalated, or
  what the patient's own symptom experience with these foods actually is.
- **Visualization:** prose (the consult close).
- **Drills to:** `e_ige_panel`, `e_alg_2018`, `e_meds`, `e_spt`.

---

## Visualizations inventory (bespoke vs. adapted)
- **Reframe board** (before → after) — bespoke header panel.
- **Allergy roster** — bespoke rows with "tell" tags.
- **Seven-year timeline** — bespoke kind-coded milestone list.
- **Peanut-genesis micro-flow** — bespoke kiosk-review card row.
- **Principle band** (PR-10 vs. storage/LTP) — bespoke two-card explainer.
- **Component dissection** — bespoke; whole-allergen bar + threshold marker beside family-colored
  component chips. The centerpiece, and genuinely not a kit primitive — a molecular IgE dissection is
  exactly the custom view the data deserves.
- **Skin-prick panel** — bespoke aeroallergen chip grid.
- **Problems + meds / referral cards** — small bespoke tables.

## The crunched figures the viewmodel must carry (curated/projected)
- Allergies: 4 rows (allergen, category, severity, reaction, noted date + author, status, src id).
- Peanut genesis: the 5-row kiosk review (kept/rejected + free-text).
- IgE components: 3 implicated foods × whole-allergen value + component family/positivity/meaning;
  6 whole-allergen-negative tree nuts; positivity threshold 0.1 kU/L. **All transcribed from the note.**
- Problems: 2 (diagnosis, status, workup/entered dates, enterer).
- Meds: 2 (name, role, historical documentation, date).
- SPT: 9 positive categories + prior immunotherapy. **From the note.**
- Referral: order, placer, dates, indication, status.
- Timeline: 6 events (2018 → 2025).
