import React from "react";
import { createRoot } from "react-dom/client";
import vm from "./viewmodel.json";
import "./page.css";

type Lane = "mechanics" | "clinical" | "boundary";
type Evidence = { kind: "fact" | "note" | "message"; who?: string; date?: string; text?: string; quote?: string };
type Oddity = {
  id: string;
  lane: Lane;
  title: string;
  stumper: string;
  likelyCause: string;
  whyItMatters: string;
  readerMove: string;
  rawChecks?: Array<{ title: string; rows: string[] }>;
  confidence: "high" | "medium";
  evidenceIds: string[];
  tags: string[];
};

const evidence = vm.evidence as Record<string, Evidence>;
const laneLabel: Record<Lane, string> = {
  mechanics: "Payload/detail gaps",
  clinical: "Join/key traps",
  boundary: "Schema/doc mismatch",
};

function useDrawer() {
  const [ids, setIds] = React.useState<string[] | null>(null);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setIds(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return { ids, open: setIds, close: () => setIds(null) };
}

const DrawerContext = React.createContext<ReturnType<typeof useDrawer> | null>(null);

function Cite({ ids, label }: { ids: string | string[]; label?: string }) {
  const ctx = React.useContext(DrawerContext);
  const list = Array.isArray(ids) ? ids : [ids];
  return (
    <button className="cite" title={label ?? "Show evidence"} aria-label={label ?? "Show evidence"} onClick={() => ctx?.open(list)}>
      <span>evidence</span>
      <b>{list.length}</b>
    </button>
  );
}

function SourceDrawer() {
  const ctx = React.useContext(DrawerContext)!;
  if (!ctx.ids) return null;
  return (
    <>
      <div className="drawer-scrim" onClick={ctx.close} />
      <aside className="drawer" role="dialog" aria-label="Evidence">
        <div className="drawer-head">
          <b>Evidence{ctx.ids.length > 1 ? ` (${ctx.ids.length})` : ""}</b>
          <button onClick={ctx.close} aria-label="Close">x</button>
        </div>
        <div className="drawer-body">
          {ctx.ids.map((id) => {
            const e = evidence[id];
            return (
              <div className="src-block" key={id}>
                <div className="src-meta">
                  <span>{e?.kind ?? "missing"}</span>
                  {e?.who ? <em>{e.who}</em> : null}
                  {e?.date ? <em>{e.date}</em> : null}
                </div>
                {e ? (e.quote ? <blockquote>{e.quote}</blockquote> : <p>{e.text}</p>) : <p>Evidence not found: {id}</p>}
              </div>
            );
          })}
          <p className="drawer-foot">Evidence is curated from the export checks shown on the cards.</p>
        </div>
      </aside>
    </>
  );
}

function StatStrip() {
  return (
    <div className="stats">
      {vm.stats.map((s) => (
        <div className={`stat ${s.lane}`} key={s.label}>
          <div className="stat-value">{s.value}</div>
          <div className="stat-label">{s.label}</div>
          <p>{s.note}</p>
        </div>
      ))}
    </div>
  );
}

function LanePanel({ active, setActive }: { active: Lane | "all"; setActive: (v: Lane | "all") => void }) {
  return (
    <div className="lane-panel">
      <button className={active === "all" ? "active all" : "all"} onClick={() => setActive("all")}>
        <b>All</b>
        <span>{(vm.oddities as Oddity[]).length} issues</span>
      </button>
      {vm.lanes.map((l) => (
        <button className={active === l.id ? `active ${l.id}` : l.id} key={l.id} onClick={() => setActive(l.id as Lane)}>
          <b>{l.title}</b>
          <span>{l.count} findings</span>
          <p>{l.thesis}</p>
        </button>
      ))}
    </div>
  );
}

function OddityCard({ o }: { o: Oddity }) {
  return (
    <article className={`oddity ${o.lane}`}>
      <div className="oddity-top">
        <span className="lane-tag">{laneLabel[o.lane]}</span>
        <span className="confidence">{o.confidence} confidence</span>
      </div>
      <h3>{o.title}</h3>
      <dl>
        <div>
          <dt>Observed failure</dt>
          <dd>{o.stumper}</dd>
        </div>
        <div>
          <dt>Raw check</dt>
          <dd>{o.likelyCause}</dd>
        </div>
        <div>
          <dt>Why expected</dt>
          <dd>{o.whyItMatters}</dd>
        </div>
        <div>
          <dt>Correct read</dt>
          <dd>{o.readerMove}</dd>
        </div>
      </dl>
      {o.rawChecks?.length ? (
        <div className="raw-checks">
          {o.rawChecks.map((check) => (
            <div className="raw-check" key={check.title}>
              <b>{check.title}</b>
              <pre>{check.rows.join("\n")}</pre>
            </div>
          ))}
        </div>
      ) : null}
      <div className="card-foot">
        <div className="tags">{o.tags.map((t) => <span key={t}>{t}</span>)}</div>
        <Cite ids={o.evidenceIds} label={`${o.title} evidence`} />
      </div>
    </article>
  );
}

function CauseMatrix({ oddities }: { oddities: Oddity[] }) {
  const lanes: Lane[] = ["mechanics", "clinical", "boundary"];
  return (
    <section className="matrix" aria-label="Cause split">
      {lanes.map((lane) => {
        const rows = oddities.filter((o) => o.lane === lane);
        return (
          <div className={`matrix-col ${lane}`} key={lane}>
            <h2>{laneLabel[lane]}</h2>
            <div className="bar"><i style={{ width: `${Math.max(18, rows.length * 8)}%` }} /></div>
            <p>{vm.lanes.find((l) => l.id === lane)?.thesis}</p>
            <ul>
              {rows.slice(0, 5).map((o) => <li key={o.id}>{o.title}</li>)}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

function App() {
  const drawer = useDrawer();
  const [active, setActive] = React.useState<Lane | "all">("all");
  const oddities = vm.oddities as Oddity[];
  const shown = active === "all" ? oddities : oddities.filter((o) => o.lane === active);
  return (
    <DrawerContext.Provider value={drawer}>
      <main className="page">
        <header className="hero">
          <div className="eyebrow">Epic EHI deep dive</div>
          <h1>{vm.meta.title}</h1>
          <p className="dek">{vm.summary}</p>
          <StatStrip />
        </header>

        <section className="section">
          <div className="section-head">
              <h2>Problems by type</h2>
            <p>{vm.meta.scope}</p>
          </div>
          <CauseMatrix oddities={oddities} />
        </section>

        <section className="section">
          <div className="section-head with-filter">
            <div>
              <h2>Problems found</h2>
              <p>Filter by problem type. Each case shows the failed expectation, the raw table check, and the safer way to read the export.</p>
            </div>
          </div>
          <LanePanel active={active} setActive={setActive} />
          <div className="oddity-grid">
            {shown.map((o) => <OddityCard o={o} key={o.id} />)}
          </div>
        </section>

        <section className="section rules">
          <h2>Practical rulebook</h2>
          <div className="rule-grid">
            {vm.rulebook.map((r) => (
              <div className="rule" key={r.title}>
                <h3>{r.title}</h3>
                <p>{r.text}</p>
              </div>
            ))}
          </div>
        </section>
        <footer className="foot">Built from SQLite catalog checks, table probes, and raw payload/index checks in this export.</footer>
      </main>
      <SourceDrawer />
    </DrawerContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
