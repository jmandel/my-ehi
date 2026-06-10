/**
 * Up to Date? — an independent, guideline-anchored preventive-care audit.
 *
 * The tool a primary-care physician wants when inheriting this patient: what is screened/vaccinated,
 * what is genuinely due, what the EHR's own Health-Maintenance worklist gets wrong. Every verdict cites
 * BOTH a patient fact and a published recommendation (USPSTF / ACIP-CDC / ADA).
 *
 * STRUCTURAL RULE: this app imports ONLY ./viewmodel.json. Nothing raw reaches the screen; every value is
 * already display-clean. Every ⌖ opens a clean drawer onto viewmodel.evidence[id] — a readable statement,
 * a lab/immunization fact, or a cited guideline — never a Clarity row.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { create } from "zustand";
import * as d3 from "d3";
import vm from "./viewmodel.json";
import "./page.css";

// ----------------------------------------------------------------- evidence drawer
type EvEntry = { kind: string; who?: string; date?: string; text?: string; quote?: string; url?: string };
const EVIDENCE = vm.evidence as Record<string, EvEntry>;
const useDrawer = create<{ ids: string[] | null; open: (i: string[]) => void; close: () => void }>((set) => ({
  ids: null, open: (ids) => set({ ids }), close: () => set({ ids: null }),
}));
function Cite({ ids, label }: { ids?: string | (string | null | undefined)[]; label?: string }) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean) as string[];
  const open = useDrawer((s) => s.open);
  if (!list.length) return null;
  return (
    <button className="cite" title={label ?? "Show evidence"} aria-label={label ?? "Show evidence"}
      onClick={(e) => { e.stopPropagation(); open(list); }}>⌖{list.length > 1 ? <sup>{list.length}</sup> : null}</button>
  );
}
const EV_TAG: Record<string, string> = { fact: "record", lab: "lab result", immunization: "immunization", guideline: "guideline", note: "note", message: "message" };
function EvBlock({ id }: { id: string }) {
  const e = EVIDENCE[id];
  if (!e) return <div className="ev"><span className="meta">Evidence not found: {id}</span></div>;
  const meta = [e.who, e.date].filter(Boolean).join(" · ");
  const quoted = e.kind === "note" || e.kind === "message";
  return (
    <div className="ev">
      <div><span className="tag">{EV_TAG[e.kind] ?? e.kind}</span>{meta && <span className="meta">{meta}</span>}</div>
      {quoted ? <blockquote className="quote">{e.quote}</blockquote> : <p className="stmt">{e.text}</p>}
      {e.url && <a href={e.url} target="_blank" rel="noreferrer">{e.url}</a>}
    </div>
  );
}
function Drawer() {
  const ids = useDrawer((s) => s.ids), close = useDrawer((s) => s.close);
  React.useEffect(() => {
    const k = (ev: KeyboardEvent) => ev.key === "Escape" && close();
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [close]);
  if (!ids) return null;
  return (
    <>
      <div className="scrim" onClick={close} />
      <aside className="drawer" role="dialog" aria-label="Evidence">
        <div className="dh"><span className="t">Evidence{ids.length > 1 ? ` · ${ids.length}` : ""}</span><button onClick={close} aria-label="Close">×</button></div>
        <div className="db">{ids.map((id) => <EvBlock key={id} id={id} />)}</div>
      </aside>
    </>
  );
}

// ----------------------------------------------------------------- helpers
type Measure = (typeof vm.measures)[number];
const M: Record<string, Measure> = Object.fromEntries(vm.measures.map((m) => [m.key, m]));
const ASOF = vm.meta.asOf;
const STATUS: Record<string, { cls: string; label: string }> = {
  "up-to-date": { cls: "b-up", label: "Up to date" },
  "optional-done": { cls: "b-up", label: "Done · optional" },
  gap: { cls: "b-gap", label: "Open gap" },
  overdue: { cls: "b-gap", label: "Overdue" },
  "due-soon": { cls: "b-soon", label: "Due soon" },
  partial: { cls: "b-soon", label: "Partial" },
  optional: { cls: "b-na", label: "Optional" },
  monitored: { cls: "b-mon", label: "Monitored" },
  "not-yet-eligible": { cls: "b-future", label: "Not yet eligible" },
  "not-applicable": { cls: "b-na", label: "Not applicable" },
};
const Badge = ({ s }: { s: string }) => { const x = STATUS[s] ?? { cls: "b-na", label: s }; return <span className={`badge ${x.cls}`}>{x.label}</span>; };
const Prose = ({ paras }: { paras: string[] }) => (
  <div className="prose">{paras.map((p, i) => <p key={i} dangerouslySetInnerHTML={{ __html: p.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>") }} />)}</div>
);
const sec = (id: string) => vm.sections.find((s) => s.id === id)!;

// ----------------------------------------------------------------- masthead + patient rail
function Masthead() {
  return (
    <header className="masthead">
      <h1>{vm.meta.title}</h1>
      <p className="sub">{vm.meta.subtitle}</p>
      <div className="dateline">
        <span><b>Patient</b> {vm.meta.patient.age}-year-old {String(vm.meta.patient.sex).toLowerCase()}</span>
        <span><b>Audit as of</b> {fmt(ASOF)}</span>
        <span><b>Guidelines retrieved</b> {fmt(vm.meta.retrieved)}</span>
        <span><b>Authorities</b> USPSTF · CDC/ACIP · ADA</span>
      </div>
    </header>
  );
}
function fmt(iso: string) { const [y, m, d] = iso.split("-").map(Number); return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1]} ${d}, ${y}`; }

function PatientRail() {
  const facts = vm.riskFacts.filter((f) => ["smoking", "bmi", "problems", "alcohol"].includes(f.key));
  return (
    <div className="tally" style={{ marginTop: 6 }}>
      {facts.map((f) => (
        <div className="cell" key={f.key}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{f.value} <Cite ids={f.evidenceId} label={f.label} /></div>
          <div className="lbl">{f.label}</div>
        </div>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------- verdict + tally
function Verdict() {
  const c = vm.summary.counts;
  const s = sec("verdict");
  return (
    <section className="section" id="verdict">
      <div className="kicker">The audit</div>
      <h2>{s.title}</h2>
      <PatientRail />
      <Prose paras={s.prose} />
      <div className="tally">
        <div className="cell ok"><div className="n">{c.upToDate}</div><div className="lbl">up to date</div></div>
        <div className="cell gap"><div className="n">{c.openGaps}</div><div className="lbl">open gaps (act now)</div></div>
        <div className="cell soon"><div className="n">{c.comingDue}</div><div className="lbl">coming due / not yet eligible</div></div>
        <div className="cell na"><div className="n">{c.notApplicable}</div><div className="lbl">not applicable</div></div>
        <div className="cell"><div className="n" style={{ color: "var(--accent)" }}>−{c.epicNoise} / +{c.epicMissing}</div><div className="lbl">chart artifacts discarded / measures added</div></div>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------- act now
function ActNow() {
  const s = sec("act-now");
  return (
    <section className="section" id="act-now">
      <div className="kicker">Worklist</div>
      <h2>{s.title}</h2>
      <Prose paras={s.prose} />
      <div className="acts">
        {vm.actNow.map((k) => {
          const m = M[k];
          return (
            <div className="act" key={k}>
              <h3>{m.title} <Badge s={m.status} /></h3>
              <div className="foot"><span className="chip">{m.authority} <Cite ids={m.citationId} label="Recommendation" /></span></div>
              <div className="why">{m.eligibility.reason} <Cite ids={m.eligibility.factEvidence} label="Patient fact" /></div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ----------------------------------------------------------------- coverage lanes (custom D3)
function Lanes() {
  const s = sec("lanes");
  // only measures with REAL dated completion history (exclude the ADA duplicate and synthetic "asked today" rows)
  const lanes = vm.measures.filter((m) => m.key !== "diabetes-ada" &&
    (m.lane.markers ?? []).some((k) => k.iso !== ASOF))
    .sort((a, b) => (a.category < b.category ? 1 : -1) || a.title.localeCompare(b.title));

  const W = 940, padL = 196, padR = 28, rowH = 30, padT = 26, padB = 4;
  const H = padT + lanes.length * rowH + padB;
  const t = (iso: string) => Date.parse(iso);
  const allDates = lanes.flatMap((m) => [
    ...(m.lane.bands ?? []).flatMap((b) => [t(b.from), t(b.to)]),
    ...(m.lane.markers ?? []).filter((k) => k.iso !== ASOF).map((k) => t(k.iso)),
    ...(m.nextDue ? [t(m.nextDue.iso)] : []),
  ]);
  const min = Math.min(...allDates, t(ASOF)), max = Math.max(...allDates, t(ASOF));
  const x = d3.scaleUtc().domain([min, max]).range([padL, W - padR]).nice();
  const years = x.ticks(d3.utcYear.every(1)!);
  const open = useDrawer((s) => s.open);

  return (
    <section className="section" id="lanes">
      <div className="kicker">Longitudinal</div>
      <h2>{s.title}</h2>
      <Prose paras={s.prose} />
      <div className="lanes">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Coverage over time">
          {years.map((d, i) => (
            <g key={i}>
              <line className="grid-line" x1={x(d)} x2={x(d)} y1={padT - 6} y2={H - padB} />
              <text className="grid-text" x={x(d)} y={padT - 12} textAnchor="middle">{d.getUTCFullYear()}</text>
            </g>
          ))}
          <line className="today-line" x1={x(t(ASOF))} x2={x(t(ASOF))} y1={padT - 6} y2={H - padB} />
          <text className="today-text" x={x(t(ASOF))} y={H} textAnchor="middle" dy={-1}>today</text>
          {lanes.map((m, i) => {
            const y = padT + i * rowH;
            const cy = y + rowH / 2 - 2;
            const cat = m.category === "immunization" ? "vaccine" : m.category;
            return (
              <g key={m.key}>
                {i > 0 && <line className="grid-line" x1={0} x2={W} y1={y} y2={y} opacity={0.5} />}
                <text className="lane-label" x={10} y={cy - 2}>{m.title.replace(/ \(.*\)/, "")}</text>
                <text className="lane-cat" x={10} y={cy + 11}>{cat}{m.intervalMonths ? ` · every ${m.intervalMonths < 12 ? m.intervalMonths + "mo" : m.intervalMonths / 12 + "y"}` : ""}</text>
                {(m.lane.bands ?? []).map((b, j) => (
                  <rect key={j} className={b.kind === "covered" ? "band-covered" : "band-overdue"}
                    x={x(t(b.from))} y={cy - 7} width={Math.max(1, x(t(b.to)) - x(t(b.from)))} height={14} rx={2} />
                ))}
                {(m.lane.markers ?? []).filter((k) => k.iso !== ASOF).map((k, j) => (
                  <circle key={j} className="marker" cx={x(t(k.iso))} cy={cy}
                    r={5} stroke={m.status === "gap" ? "var(--gap)" : "var(--ok)"}
                    onClick={() => k.evidenceId && open([k.evidenceId])}>
                    <title>{k.display}</title>
                  </circle>
                ))}
              </g>
            );
          })}
        </svg>
        <div className="legend">
          <span><span className="sw" style={{ background: "var(--ok)", opacity: 0.5 }} />covered</span>
          <span><span className="sw" style={{ background: "var(--gap)", opacity: 0.3 }} />lapsed / overdue</span>
          <span><span className="sw" style={{ background: "var(--paper)", border: "2px solid var(--ok)", borderRadius: "50%" }} />completion (click for evidence)</span>
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------- reconciliation
function Reconciliation() {
  const s = sec("reconciliation");
  const missing = vm.measures.filter((m) => m.reconciliation.kind === "epic-missing" && m.status !== "not-applicable");
  const suppressed = vm.measures.filter((m) => m.reconciliation.kind === "epic-noise");
  const du = M["diabetes-uspstf"], da = M["diabetes-ada"];
  return (
    <section className="section" id="reconciliation">
      <div className="kicker">EHR vs guideline</div>
      <h2>{s.title}</h2>
      <Prose paras={s.prose} />

      <div className="recon-grid">
        <div className="recon-card">
          <h3>Forecast artifacts the audit discards</h3>
          <p className="desc">Impossible “next due” dates the engine anchored to the patient's birthday.</p>
          <ul>
            {vm.forecastArtifacts.map((a, i) => (
              <li key={i} className="artifact">
                <span>{a.topic.replace(/ \(.*\)/, "")}</span>
                <span className="bad">{a.nextDue.display} · age {a.ageAtDue}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="recon-card">
          <h3>Topics the chart suppressed</h3>
          <p className="desc">“Aged out” or hidden by the engine; the audit reclassifies them.</p>
          <ul>
            {suppressed.map((m) => (
              <li key={m.key}>
                <span>{m.title} <Cite ids={m.eligibility.factEvidence} /></span>
                <span className="chip">{m.reconciliation.epicStatus}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="recon-card">
          <h3>Measures the chart never tracked — the audit adds</h3>
          <p className="desc">Recommended for this patient but absent from the Health-Maintenance plan.</p>
          <ul>
            {missing.map((m) => (
              <li key={m.key}>
                <span>{m.title} <Cite ids={m.citationId} /></span>
                <Badge s={m.status} />
              </li>
            ))}
          </ul>
        </div>
        <div className="recon-card">
          <h3>Where the authorities disagree</h3>
          <p className="desc">One measure, two defensible answers — shown, not collapsed.</p>
          <div className="divergence">
            <div className="vs">
              <h4>USPSTF <Cite ids={du.citationId} /></h4>
              <div className="verdict">Screens 35–70 <strong>only if BMI ≥ 25</strong>. {du.eligibility.reason}</div>
            </div>
            <div>
              <h4>ADA <Cite ids={da.citationId} /></h4>
              <div className="verdict">Screens <strong>all adults ≥ 35</strong>, regardless of weight. {da.eligibility.reason}</div>
            </div>
          </div>
          <p className="desc" style={{ marginTop: 8 }}>In practice he was screened — A1c 5.5% in Dec 2025, normal.</p>
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------- prose-only sections
function ProseSection({ id, kicker }: { id: string; kicker: string }) {
  const s = sec(id);
  return (
    <section className="section" id={id}>
      <div className="kicker">{kicker}</div>
      <h2>{s.title}</h2>
      <Prose paras={s.prose} />
    </section>
  );
}

// ----------------------------------------------------------------- the full interrogable table
const CATS = [["all", "All"], ["screening", "Screening"], ["immunization", "Immunization"], ["counseling", "Counseling"]] as const;
function MeasuresTable() {
  const [cat, setCat] = React.useState<string>("all");
  const [onlyOpen, setOnlyOpen] = React.useState(false);
  const rows = vm.measures.filter((m) => (cat === "all" || m.category === cat) &&
    (!onlyOpen || ["gap", "overdue", "due-soon", "partial"].includes(m.status)));
  return (
    <section className="section" id="all-measures">
      <div className="kicker">The full record</div>
      <h2>Every measure, interrogable</h2>
      <p className="prose" style={{ maxWidth: "68ch" }}>The complete audit — sortable to the gaps, every verdict tracing to a guideline and a patient fact. This is the worklist behind the headline; nothing is pre-selected away.</p>
      <div className="controls">
        {CATS.map(([k, lbl]) => <button key={k} className={cat === k ? "on" : ""} onClick={() => setCat(k)}>{lbl}</button>)}
        <span style={{ width: 12 }} />
        <button className={onlyOpen ? "on" : ""} onClick={() => setOnlyOpen((v) => !v)}>Only gaps &amp; due</button>
      </div>
      <table className="measures">
        <thead><tr><th>Measure</th><th>Status</th><th>Authority</th><th>Last done</th><th>Next due</th><th>Chart (EHR) status</th></tr></thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.key}>
              <td>
                <div className="m-title">{m.title}</div>
                <div className="m-basis">{m.eligibility.reason} <Cite ids={m.eligibility.factEvidence} label="Patient fact" /></div>
              </td>
              <td><Badge s={m.status} /></td>
              <td>{m.authority !== "—" ? <span className="chip">{m.authority} <Cite ids={m.citationId} label="Recommendation" /></span> : "—"}
                {m.secondaryAuthority && <div style={{ marginTop: 4 }}><span className="chip">{m.secondaryAuthority} <Cite ids={m.secondaryCitationId} /></span></div>}</td>
              <td className="num">{m.lastDone?.display ?? "—"}</td>
              <td className="num">{m.nextDue?.display ?? (m.oneTime ? "one-time" : "—")}</td>
              <td>{m.reconciliation.epicStatus
                ? <span className="chip" title={m.reconciliation.note}>{m.reconciliation.epicStatus}{(m.reconciliation as any).dateArtifact ? " ⚠" : ""}</span>
                : <span style={{ color: "var(--ink-faint)", fontSize: 12.5 }}>not tracked</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ----------------------------------------------------------------- app
function App() {
  return (
    <div className="wrap">
      <Masthead />
      <Verdict />
      <ActNow />
      <Lanes />
      <Reconciliation />
      <ProseSection id="immunizations" kicker="Vaccines" />
      <MeasuresTable />
      <ProseSection id="limits" kicker="Caveats" />
      <footer className="foot">
        <p>Built from a single patient's Epic EHI export. Preventive-care verdicts are computed independently from the cited authorities (USPSTF, CDC/ACIP, ADA), retrieved {fmt(vm.meta.retrieved)}; they are an analytic aid, not medical advice. Every figure traces to a patient fact or a published recommendation via the ⌖ markers. No identifying information (name, MRN, address) appears in this view.</p>
      </footer>
      <Drawer />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
