/**
 * Allergy & atopy — MANDEL, JOSHUA C.  The bespoke tool an allergist would want to fully
 * understand this atopic profile: what component-resolved (molecular) IgE testing added over a
 * plain allergy list. The central move is a reframe — a flat "peanut allergy, High severity" list
 * is taken apart at the molecular level and resolves to birch-pollen cross-reactivity (oral allergy
 * syndrome, low systemic risk), tied back to a broadly positive aeroallergen skin-prick test.
 *
 * STRUCTURAL RULE: this app imports ONLY ./viewmodel.json. Nothing raw
 * can reach the screen — there is no dataset.json / analysis.json / raw-extract import. Every value
 * in the view model is already display-clean. Every ⌖ cite opens a clean drawer onto
 * viewmodel.evidence[id] (a verbatim note quote with date+author, or a readable statement of a
 * structured fact) — never a Clarity row.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { create } from "zustand";
import vm from "./viewmodel.json";
import "./page.css";

// ------------------------------------------------------------------ evidence drawer (cite ⌖)
type EvEntry = { kind: "note" | "fact"; who?: string; date?: string; quote?: string; text?: string };
const EVIDENCE = vm.evidence as Record<string, EvEntry>;

const useDrawer = create<{ ids: string[] | null; open: (ids: string[]) => void; close: () => void }>((set) => ({
  ids: null,
  open: (ids) => set({ ids }),
  close: () => set({ ids: null }),
}));

/** A ⌖ marker that opens the evidence drawer onto the given evidence ids. */
function Cite({ ids, label }: { ids: string | string[]; label?: string }) {
  const list = Array.isArray(ids) ? ids : [ids];
  const open = useDrawer((s) => s.open);
  return (
    <button className="cite" title={label ?? "Show evidence"} aria-label={label ?? "Show evidence"} onClick={() => open(list)}>
      ⌖{list.length > 1 ? <span className="cite-n">{list.length}</span> : null}
    </button>
  );
}

function EvidenceBlock({ id }: { id: string }) {
  const e = EVIDENCE[id];
  if (!e) return <div className="src-block"><div className="src-statement">Evidence not found: {id}</div></div>;
  const provenance = [e.who, e.date].filter(Boolean).join(" · ");
  return (
    <div className="src-block">
      <div className="src-head">
        <span className={`src-tag ${e.kind === "note" ? "note" : ""}`}>{e.kind === "note" ? "Note quote" : "Record"}</span>
        {provenance && <span>{provenance}</span>}
      </div>
      {e.kind === "note" ? (
        <blockquote className="src-quote">{e.quote}</blockquote>
      ) : (
        <p className="src-statement">{e.text}</p>
      )}
    </div>
  );
}

function SourceDrawer() {
  const ids = useDrawer((s) => s.ids);
  const close = useDrawer((s) => s.close);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);
  if (!ids) return null;
  return (
    <>
      <div className="drawer-scrim" onClick={close} />
      <aside className="drawer" role="dialog" aria-label="Evidence">
        <div className="drawer-head">
          <span className="drawer-title">Evidence {ids.length > 1 ? `· ${ids.length} sources` : ""}</span>
          <button className="drawer-close" onClick={close} aria-label="Close">×</button>
        </div>
        <div className="drawer-body">
          {ids.map((id) => <EvidenceBlock key={id} id={id} />)}
          <p className="drawer-foot">
            Quotes are the verbatim record captured during the allergy synthesis pass — including the two problem
            overview notes that carry the only IgE and skin-prick values in this export; statements summarise
            structured facts from the normalised record. Nothing here is a raw export row.
          </p>
        </div>
      </aside>
    </>
  );
}

// ------------------------------------------------------------------ narrative prose with inline cites
type Para = { text: string; cites?: string[] };
function Prose({ paras }: { paras: Para[] }) {
  return (
    <div className="prose">
      {paras.map((p, i) => (
        <p key={i}>
          {p.text}
          {p.cites && p.cites.length ? <Cite ids={p.cites} label="Evidence for this statement" /> : null}
        </p>
      ))}
    </div>
  );
}

function SectionShell({ id, n, title, children }: { id: string; n: number; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="section">
      <h2><span className="sec-n">{n}</span>{title}</h2>
      {children}
    </section>
  );
}

const sectionById = Object.fromEntries((vm.sections as any[]).map((s) => [s.id, s]));

// ================================================================== Allergy roster (overview)
function RosterView() {
  const list = vm.allergies as any[];
  const kindOf = (cat: string) => (cat.toLowerCase().startsWith("drug") ? "drug" : "food");
  return (
    <div className="roster">
      {list.map((a, i) => {
        const food = kindOf(a.category) === "food";
        const tell = a.allergen.includes("(diagnostic)")
          ? "test-based, not a reaction"
          : food
            ? "reframed below as cross-reactivity"
            : null;
        return (
          <div key={i} className={`roster-row ${kindOf(a.category)}`}>
            <div className="roster-head">
              <span className="roster-allergen">
                {a.allergen}
                {tell ? <span className="tell-tag">{tell}</span> : null}
              </span>
              <span><span className="sev-pill">{a.severity} severity</span></span>
            </div>
            <div className="roster-meta">
              <span className="cat-tag">{a.category}</span>
              <span>reaction: <span className="reaction-tag">{a.reaction}</span></span>
              <span>noted <span className="nm">{a.notedDate}</span> by {a.notedBy}</span>
              <span><Cite ids={a.allergen.includes("(diagnostic)") ? "e_alg_peanut" : "e_alg_2018"} label={`${a.allergen} — record`} /></span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ================================================================== Peanut genesis micro-flow
function GenesisView() {
  const g = vm.peanutGenesis as any[];
  return (
    <div>
      <div className="genesis">
        {g.map((row, i) => {
          const isFreeText = !!row.freeText;
          const cls = isFreeText ? "freetext" : row.accepted ? "" : "rejected";
          return (
            <div key={i} className={`genesis-card ${cls}`}>
              <div className="genesis-allergen">{row.freeText ?? row.allergen}</div>
              <div className={`genesis-state ${isFreeText ? "add" : row.accepted ? "yes" : "no"}`}>
                {isFreeText ? "free-text added →" : row.accepted ? "kept (Y)" : "rejected (N)"}
              </div>
            </div>
          );
        })}
      </div>
      <p className="fig-note">
        The Jul 14, 2020 kiosk allergen review, item by item: the system-suggested coded allergen
        <b> Peanut Oil</b> was rejected, and a free-text <b>"Peanut (diagnostic)"</b> was added in its place —
        that free-text add is the coded peanut allergy the list now shows as High severity.
        <Cite ids="e_peanut_genesis" label="Kiosk allergen review" />
      </p>
    </div>
  );
}

// ================================================================== CENTERPIECE: component-resolution dissection
// For each implicated food: its low whole-allergen IgE value (left), then the molecular components
// tested (right), color-coded by what they MEAN — teal PR-10 (birch cross-reactive / OAS, low risk),
// red storage protein / amber LTP (the markers of true systemic food allergy). The chart's whole job
// is to make visible that every POSITIVE is a cross-reactive PR-10 and every systemic-risk marker is
// NEGATIVE — i.e. that "peanut/nut allergy" is, molecularly, oral allergy syndrome.
const FAMILY_CLASS: Record<string, "cross" | "storage" | "ltp"> = {
  "PR-10 (Bet v 1 homolog)": "cross",
  "Storage protein (2S albumin)": "storage",
  "Lipid transfer protein": "ltp",
};
const FAMILY_COLOR: Record<string, string> = {
  cross: "#0e7490",
  storage: "#b42318",
  ltp: "#b8860b",
};
const FAMILY_SOFT: Record<string, string> = {
  cross: "#e6f4f7",
  storage: "#fbe9e7",
  ltp: "#f8f0d8",
};

function ComponentChip({ comp }: { comp: any }) {
  const fam = FAMILY_CLASS[comp.family] ?? "cross";
  const color = FAMILY_COLOR[fam];
  const pos = comp.positive;
  return (
    <span
      className={`crd-chip ${pos ? "pos" : "neg"}`}
      style={pos
        ? { background: color }
        : { color, border: `1.5px solid ${color}`, background: FAMILY_SOFT[fam] }}
    >
      <code>{comp.code}</code>
    </span>
  );
}

function FoodDissection({ food }: { food: any }) {
  const isOAS = food.interpretation.toLowerCase().includes("oral allergy");
  const verdictCls = isOAS ? "verdict-oas" : "verdict-clear";
  const THRESH = (vm.igeComponents as any).positiveThreshold as number;
  const SCALE = 1.0; // all three whole-allergen positives sit below 1.0 kU/L
  const w = food.wholeValue as number;
  return (
    <div className={`crd-card ${verdictCls}`}>
      <div className="crd-top">
        <span className="crd-food">{food.food}</span>
        <span className="crd-whole">
          whole-allergen IgE <b>{food.wholeIgE}</b> <span className="lowpos">low positive</span>
        </span>
      </div>
      <div className="crd-body">
        <div className="crd-wholecol">
          <div className="crd-wholecol-cap">Whole-allergen value</div>
          <div className="crd-bar-track">
            <div className="crd-bar-fill" style={{ width: `${Math.min(100, (w / SCALE) * 100)}%` }} />
            <div className="crd-bar-thresh" style={{ left: `${(THRESH / SCALE) * 100}%` }} />
          </div>
          <div className="crd-bar-scale"><span>0</span><span>0.5</span><span>1.0 kU/L</span></div>
          <div className="crd-bar-cap">
            Barely over the {THRESH} kU/L positivity line (dashed). A whole-allergen number alone
            cannot tell a dangerous allergy from a harmless one.
          </div>
        </div>
        <div className="crd-compcol">
          <div className="crd-compcol-cap">Which protein the IgE binds</div>
          <div className="crd-comps">
            {food.components.map((c: any, i: number) => {
              const fam = FAMILY_CLASS[c.family] ?? "cross";
              return (
                <div key={i} className="crd-comp">
                  <ComponentChip comp={c} />
                  <span className="crd-comp-meaning">{c.meaning}</span>
                  <span className={`crd-comp-state ${c.positive ? "pos" : "neg"}`} style={c.positive ? { color: FAMILY_COLOR[fam] } : undefined}>
                    {c.positive ? "positive" : "negative"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className={`crd-verdict ${isOAS ? "oas" : "clear"}`}>
        → <b>{isOAS ? "Oral allergy syndrome." : "No primary allergy."}</b> {food.interpretation.replace(/^Oral allergy syndrome\s*/i, "").replace(/^[—–-]\s*/, "").replace(/^\(/, "(")}
      </div>
    </div>
  );
}

function ComponentDissectionView() {
  const ig = vm.igeComponents as any;
  return (
    <div className="crd">
      <div className="crd-legend">
        <span className="lg-title">Protein families</span>
        <span className="lg-item"><span className="lg-sw" style={{ background: FAMILY_COLOR.cross }} /><b>PR-10 (Bet v 1 homolog)</b> — birch cross-reactive, oral allergy syndrome</span>
        <span className="lg-item"><span className="lg-sw" style={{ background: FAMILY_COLOR.storage }} /><b>Storage protein (2S albumin)</b> — systemic-risk marker</span>
        <span className="lg-item"><span className="lg-sw" style={{ background: FAMILY_COLOR.ltp }} /><b>Lipid transfer protein</b> — systemic-risk marker</span>
      </div>

      <div className="crd-grid">
        {ig.foods.map((f: any, i: number) => <FoodDissection key={i} food={f} />)}
      </div>

      <div className="crd-negs">
        <div className="crd-negs-cap">Whole-allergen negative — no component testing needed ({ig.negatives.length} tree nuts)</div>
        <div className="crd-negs-row">
          {ig.negatives.map((nn: any, i: number) => <span key={i} className="neg-chip">{nn.food}</span>)}
        </div>
      </div>

      <p className="fig-note">
        {ig.testName}, drawn {ig.testDate}, in {ig.units}. Six tree nuts were flatly negative; the three faint
        positives all sit below 1 kU/L. The molecular layer is the point: every <b style={{ color: FAMILY_COLOR.cross }}>positive</b> component
        is a cross-reactive PR-10 (Cor a 1, Ara h 8), and every <b style={{ color: FAMILY_COLOR.storage }}>systemic-risk marker</b> (Jug r 1,
        Jug r 3, the peanut storage proteins) is negative — which is why the allergist read both hazelnut and peanut
        as oral allergy syndrome.<Cite ids="e_ige_panel" label="Component-resolved IgE panel" />
      </p>
    </div>
  );
}

// ================================================================== The principle band (storage vs PR-10)
function PrincipleBand() {
  return (
    <div className="principle">
      <div className="principle-card cross">
        <div className="principle-tag">Cross-reactive · low systemic risk</div>
        <div className="principle-head">PR-10 / Bet v 1 homologs</div>
        <div className="principle-body">
          Heat-labile birch-pollen mimics (Bet v 1 in birch, with homologs across many plant foods).
          IgE against them reflects pollen cross-reactivity and causes <b>oral allergy syndrome</b> —
          mouth and throat itch with raw foods — but rarely systemic reactions.
        </div>
        <div className="principle-risk">Cor a 1 (hazelnut) · Ara h 8 (peanut) — both positive here</div>
      </div>
      <div className="principle-card primary">
        <div className="principle-tag">Primary allergy · anaphylaxis risk</div>
        <div className="principle-head">Storage proteins & LTP</div>
        <div className="principle-body">
          Heat-stable seed storage proteins (2S albumins like peanut Ara h 2 or walnut Jug r 1) and lipid
          transfer proteins are the markers of <b>true, potentially anaphylactic food allergy</b>. Which
          protein the IgE binds — not how much — is what tells you the risk.
        </div>
        <div className="principle-risk">Jug r 1 / Jug r 3 · peanut storage proteins — all negative here</div>
      </div>
    </div>
  );
}

// ================================================================== Skin-prick test panel (aeroallergen engine)
function SPTView() {
  const s = vm.spt as any;
  return (
    <div className="spt-wrap">
      <div className="spt-grid">
        {s.positives.map((p: string, i: number) => <span key={i} className="spt-chip">{p}</span>)}
      </div>
      <div className="spt-prior">
        <b>Prior immunotherapy:</b> {s.priorImmunotherapy}.
        <Cite ids={s.evidenceId} label="Skin-prick test" />
      </div>
      <p className="fig-note">
        The {s.test} of {s.date} was broadly positive across the aeroallergen spectrum — {s.positives.length} categories,
        from trees and grass to ragweed, mugwort and molds. This polysensitized pollen profile is the engine behind the
        food findings: tree-pollen (birch-group) sensitization is exactly what cross-reacts with the PR-10 proteins
        (Cor a 1, Ara h 8) the component panel found.<Cite ids={["e_spt", "e_ige_panel"]} label="Pollen engine" />
      </p>
    </div>
  );
}

// ================================================================== Problems + meds (2025 formalization)
function ProblemsMedsView() {
  const problems = vm.problems as any[];
  const meds = vm.meds as any[];
  return (
    <div className="pm-grid">
      <div className="pm-card">
        <div className="pm-cap">Problems formalized · Dec 4, 2025</div>
        {problems.map((p, i) => (
          <div key={i} className="pm-item">
            <div className="pm-name">{p.diagnosis}<Cite ids={p.evidenceId} label={`${p.diagnosis} — record`} /></div>
            <div className="pm-sub">{p.status} · workup dated {p.workupDate}, entered {p.enteredDate} by {p.enteredBy}</div>
          </div>
        ))}
        <p className="pm-sub" style={{ marginTop: 10 }}>
          The naming itself encodes the analysis: not "nut allergy," but <b style={{ color: "var(--ink)" }}>pollen-food allergy</b> —
          the unified diagnosis the component testing made possible.
        </p>
      </div>
      <div className="pm-card">
        <div className="pm-cap">Medications documented</div>
        {meds.map((m, i) => (
          <div key={i} className="pm-item">
            <div className="pm-name">{m.name}<Cite ids={m.evidenceId} label={`${m.name} — record`} /></div>
            <div className="pm-sub">
              {m.role}
              <span className="pm-badge">historical</span>
            </div>
            <div className="pm-sub">{m.documentation}, {m.documentedDate}.</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ================================================================== Management — referral + thread
function ManagementView() {
  const r = vm.referral as any;
  return (
    <div>
      <div className="pm-card" style={{ maxWidth: 640 }}>
        <div className="pm-cap">The referral that bracketed the workup</div>
        <div className="pm-item">
          <div className="pm-name">{r.order}<Cite ids={r.evidenceId} label="Allergy referral" /></div>
          <div className="pm-sub">Placed {r.placedDate} by {r.placedBy} · status {r.status}</div>
          <div className="pm-sub">Indication: <b style={{ color: "var(--ink)" }}>"{r.indication}"</b></div>
          <div className="pm-sub">Specialty appointment {r.appointmentDate} — the same day as the skin-prick test.</div>
        </div>
      </div>
      <p className="fig-note">
        The referral question ("is the nut allergy real?") and its answer ("oral allergy syndrome") bracket the
        molecular workup. The medications fit the calibrated picture above: an antihistamine for the dominant
        aeroallergen burden, and a rescue auto-injector retained as a precaution given the labeled nut allergies —
        even though the component testing points to low systemic risk.<Cite ids={["e_referral", "e_meds"]} label="Referral and medications" />
      </p>
    </div>
  );
}

// ================================================================== Atopy timeline (the seven-year arc)
function TimelineView() {
  const tl = vm.timeline as any[];
  return (
    <div className="tl">
      {tl.map((t, i) => (
        <div key={i} className={`tl-step kind-${t.kind}`}>
          <div className="tl-date">{t.date}</div>
          <div className="tl-body">
            <span className="tl-kind">{t.kind}</span>
            {t.event}
            <Cite ids={t.evidenceId} label={`${t.date} — evidence`} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ================================================================== header reframe board
const REFRAME = {
  before: [
    { label: "Peanut", line: "High severity · reaction \"Hives\"" },
    { label: "Tree nut", line: "High severity · reaction \"Hives\"" },
    { label: "Reading", line: "two nut allergies — textbook anaphylaxis setup" },
  ],
  after: [
    { label: "Peanut", line: "Ara h 8 only (PR-10) — storage proteins negative" },
    { label: "Hazelnut", line: "Cor a 1 only (PR-10) — walnut storage/LTP negative" },
    { label: "Reading", line: "oral allergy syndrome — birch cross-reactivity, low systemic risk" },
  ],
};

// ================================================================== App
function App() {
  const order = ["overview", "peanut-genesis", "ige-components", "problems-2025", "management", "assessment"];
  const titleOf = (id: string) => sectionById[id]?.title ?? id;
  const proseOf = (id: string): Para[] => sectionById[id]?.narrative ?? [];
  let n = 0;
  return (
    <div className="page">
      <SourceDrawer />
      <header className="page-head">
        <div className="ph-eyebrow">Allergy & atopy · deep dive</div>
        <h1>MANDEL, JOSHUA C</h1>
        <div className="ph-demo">Polysensitized atopic adult · allergic rhinoconjunctivitis + pollen-food allergy · EpiPen + loratadine on chart</div>
        <p className="ph-headline">{vm.summary}</p>

        <div className="reframe">
          <div className="reframe-col before">
            <div className="reframe-cap">What the plain allergy list says</div>
            {REFRAME.before.map((b, i) => (
              <div key={i} className="reframe-line"><b>{b.label}:</b> {b.line}</div>
            ))}
          </div>
          <div className="reframe-arrow">→</div>
          <div className="reframe-col after">
            <div className="reframe-cap">What component-resolved IgE testing showed</div>
            {REFRAME.after.map((a, i) => (
              <div key={i} className="reframe-line"><b>{a.label}:</b> {a.line}</div>
            ))}
          </div>
        </div>
        <p className="reframe-foot">
          The same molecular finding ties the food story to a broadly positive aeroallergen skin-prick test — one
          pollen sensitization expressing itself across the diet. The drug allergies (sulfa, penicillin) are a
          separate question the IgE panel does not address.<Cite ids={["e_ige_panel", "e_spt"]} label="The reframe" />
        </p>
      </header>

      {order.map((id) => {
        n += 1;
        if (id === "assessment") {
          return (
            <SectionShell key={id} id={id} n={n} title={titleOf("assessment")}>
              <Prose paras={proseOf("assessment")} />
            </SectionShell>
          );
        }
        const lead = proseOf(id);
        return (
          <SectionShell key={id} id={id} n={n} title={titleOf(id)}>
            <Prose paras={lead} />
            {id === "overview" && (
              <>
                <h4 className="subhead">The four active allergies, as the list presents them</h4>
                <RosterView />
                <h4 className="subhead">The seven-year arc — a list assembled in 2018–2020, then a 2024–2025 allergy workup</h4>
                <TimelineView />
              </>
            )}
            {id === "peanut-genesis" && <GenesisView />}
            {id === "ige-components" && (
              <>
                <h4 className="subhead">The principle component testing turns on</h4>
                <PrincipleBand />
                <h4 className="subhead">The dissection — each food's whole-allergen value, then which protein its IgE binds</h4>
                <ComponentDissectionView />
              </>
            )}
            {id === "problems-2025" && (
              <>
                <ProblemsMedsView />
                <h4 className="subhead">Upstream of the food story — the aeroallergen engine (skin-prick test, May 9 2025)</h4>
                <SPTView />
              </>
            )}
            {id === "management" && <ManagementView />}
          </SectionShell>
        );
      })}

      <footer className="page-foot">
        Built over a single display-clean view model abstracted from the verified allergy analysis and the complete
        normalised record. The IgE and skin-prick values exist in this export only as free text in two problem
        overview notes — no structured allergen-IgE result rows exist — so they are carried as curated note quotes,
        each drillable from its ⌖. Every figure is pre-computed; every claim traces to a verbatim note quote or a
        readable statement of the record. Single-export, single-patient view.
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
