import React from "react";
import { createRoot } from "react-dom/client";
import * as d3 from "d3";
import vm from "./viewmodel.json";
import "./page.css";

type Evidence = { kind: "fact"; text?: string; date?: string; who?: string };
const EVIDENCE = vm.evidence as Record<string, Evidence>;
const fmt = d3.format(",");

const kindColor: Record<string, string> = {
  clinic: "#2563eb",
  lab: "#0f766e",
  radiology: "#7c3aed",
  therapy: "#b45309",
  canceled: "#b42318",
  future: "#64748b",
};

function short(s: string | null | undefined, n: number) {
  const v = String(s ?? "");
  return v.length > n ? `${v.slice(0, n - 1)}...` : v;
}

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
      *
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
          <b>Evidence{ctx.ids.length > 1 ? ` - ${ctx.ids.length}` : ""}</b>
          <button onClick={ctx.close} aria-label="Close">x</button>
        </div>
        <div className="drawer-body">
          {ctx.ids.map((id) => {
            const e = EVIDENCE[id];
            return (
              <div className="src-block" key={id}>
                <div className="src-meta">Structured fact</div>
                <p>{e?.text ?? `Evidence not found: ${id}`}</p>
              </div>
            );
          })}
          <p className="drawer-foot">Evidence is projected into readable facts from the EHI tables. This drawer never renders raw rows.</p>
        </div>
      </aside>
    </>
  );
}

function Prose({ id, compact = false }: { id: string; compact?: boolean }) {
  const s = (vm.sections as any[]).find((x) => x.id === id);
  return (
    <div className={compact ? "prose compact-prose" : "prose"}>
      {s?.narrative?.map((p: any, i: number) => (
        <p key={i}>{p.text}{p.cites?.length ? <Cite ids={p.cites} /> : null}</p>
      ))}
    </div>
  );
}

function MetricRail() {
  const c = vm.meta.counts as any;
  const metrics = [
    ["Appointments", c.real_appointments, `${c.completed_appointments} completed`],
    ["Audit touches", c.audit_rows, `${c.audit_items} changed items`],
    ["Previsit rows", c.echeckin_step_rows, "eCheck-in steps"],
    ["Orders", c.order_rows, "timed order records"],
    ["Room values", c.room_assignments_present, "true room/bed hits"],
  ];
  return (
    <div className="metric-rail">
      {metrics.map(([label, value, sub]) => (
        <div className="metric" key={label as string}>
          <span>{label}</span>
          <b>{fmt(value as number)}</b>
          <em>{sub}</em>
        </div>
      ))}
    </div>
  );
}

function Panel({ title, cite, children, className = "" }: { title: string; cite?: string | string[]; children: React.ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-head">
        <h2>{title}</h2>
        {cite ? <Cite ids={cite} /> : null}
      </header>
      {children}
    </section>
  );
}

function SlotVitalsPlot() {
  const rows = (vm.appointmentRows as any[])
    .filter((r) => r.first_core_delta_min != null)
    .sort((a, b) => a.date_real - b.date_real);
  const w = 660;
  const h = 330;
  const margin = { top: 28, right: 112, bottom: 24, left: 102 };
  const x = d3.scaleLinear().domain([-25, 70]).range([margin.left, w - margin.right]);
  const y = d3.scaleBand().domain(rows.map((r) => r.csn)).range([margin.top, h - margin.bottom]).padding(0.42);
  const ticks = [-20, 0, 20, 40, 60];
  return (
    <svg className="viz" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="First vital time relative to scheduled slot">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={margin.top - 8} y2={h - margin.bottom + 5} className={t === 0 ? "axis-zero" : "axis-line"} />
          <text x={x(t)} y={h - 6} textAnchor="middle" className="axis-text">{t === 0 ? "slot" : `${t > 0 ? "+" : ""}${t}m`}</text>
        </g>
      ))}
      {rows.map((r) => {
        const cy = (y(r.csn) ?? 0) + y.bandwidth() / 2;
        return (
          <g key={r.csn}>
            <title>{`${r.date} ${r.department}: ${r.first_core_vital_time}, ${r.note}`}</title>
            <text x={10} y={cy + 4} className="row-date">{r.date.replace(", 20", ", '")}</text>
            <line x1={margin.left} x2={w - margin.right} y1={cy} y2={cy} className="row-line" />
            <circle cx={x(r.first_core_delta_min)} cy={cy} r={5.5} fill={kindColor[r.kind] ?? "#2563eb"} stroke="#fff" strokeWidth="2" />
            <text x={w - margin.right + 12} y={cy - 1} className="time-text">{r.first_core_vital_time}</text>
            <text x={w - margin.right + 12} y={cy + 11} className={r.first_core_delta_min < 0 ? "delta early-fill" : "delta late-fill"}>{r.note}</text>
          </g>
        );
      })}
    </svg>
  );
}

function AuditPanel() {
  const months = vm.auditMonths as any[];
  const items = (vm.auditItemRows as any[]).slice(0, 8);
  const maxMonth = d3.max(months, (d) => d.total) || 1;
  const maxItem = d3.max(items, (d) => d.n) || 1;
  return (
    <div className="audit-panel">
      <div className="audit-heat" style={{ gridTemplateColumns: `92px repeat(${months.length}, minmax(16px, 1fr))` }}>
        <div />
        {months.map((m) => <div className="month" key={m.month}>{m.label}</div>)}
        {["patient_record", "hospital_account"].map((key) => (
          <React.Fragment key={key}>
            <b>{key === "patient_record" ? "Patient" : "Account"}</b>
            {months.map((m) => {
              const n = Number(m[key] ?? 0);
              return <span key={`${key}-${m.month}`} className="heat" style={{ opacity: n ? 0.16 + 0.84 * (n / maxMonth) : 0.06 }} title={`${m.label}: ${fmt(n)}`} />;
            })}
          </React.Fragment>
        ))}
      </div>
      <div className="rank-bars">
        {items.map((r) => (
          <div className="rank" key={`${r.source}-${r.item}`}>
            <span>{r.item}</span>
            <div><i style={{ width: `${Math.max(2, (r.n / maxItem) * 100)}%` }} /></div>
            <b>{fmt(r.n)}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function PrevisitPanel() {
  const steps = (vm.echeckinSteps as any[]).slice(0, 10);
  const max = d3.max(steps, (d) => d.total) || 1;
  const tiles = vm.previsitTiles as any[];
  return (
    <div className="previsit-panel">
      <div className="micro-metrics">
        {tiles.slice(0, 6).map((t) => (
          <div key={t.label}>
            <b>{fmt(t.value)}</b>
            <span>{t.label}</span>
          </div>
        ))}
      </div>
      <div className="step-bars">
        {steps.map((s) => (
          <div className="step" key={s.step}>
            <span>{s.step}</span>
            <div className="stack" style={{ width: `${Math.max(14, (s.total / max) * 100)}%` }}>
              <i className="done" style={{ flex: s.completed }} />
              <i className="idle" style={{ flex: s.not_started }} />
              <i className="skip" style={{ flex: s.filtered_or_not_offered }} />
              <i className="need" style={{ flex: s.not_needed }} />
            </div>
            <b>{s.total}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function NoteTimingPanel() {
  const rows = vm.noteHourRows as any[];
  const summary = vm.noteTimingSummary as any;
  const context = vm.noteSlotContext as any;
  const max = d3.max(rows, (d) => Math.max(d.entry, d.filed, d.updated)) || 1;
  const hours = rows.filter((r) => r.entry || r.filed || r.updated || (r.hour >= 7 && r.hour <= 21));
  return (
    <div className="note-clock">
      <div className="note-stats">
        <div><b>{fmt(summary.filed_local_rows)}</b><span>local file times</span></div>
        <div><b>{fmt(summary.filed_after_hours)}</b><span>after-hours filed</span></div>
        <div><b>{fmt(summary.filed_weekend)}</b><span>weekend filed</span></div>
        <div><b>{fmt(context.same_day)}</b><span>same-day after-hours</span></div>
        <div><b>{fmt(context.morning_slot)}</b><span>from morning slots</span></div>
        <div><b>{fmt(context.afternoon_slot + context.late_slot)}</b><span>from afternoon/evening slots</span></div>
      </div>
      <div className="hour-bars">
        {hours.map((r) => (
          <div className={`hour ${r.hour < 7 || r.hour >= 18 ? "pajama" : ""}`} key={r.hour}>
            <span>{r.hour}</span>
            <div className="hour-stack">
              <i className="entry" style={{ height: `${Math.max(0, (r.entry / max) * 100)}%` }} title={`${r.entry} entered`} />
              <i className="filed" style={{ height: `${Math.max(0, (r.filed / max) * 100)}%` }} title={`${r.filed} filed`} />
              <i className="updated" style={{ height: `${Math.max(0, (r.updated / max) * 100)}%` }} title={`${r.updated} updated`} />
            </div>
          </div>
        ))}
      </div>
      <div className="note-types">
        <div className="context-note">
          <b>After-hours context</b>
          <span>{context.morning_slot} morning, {context.afternoon_slot} afternoon, {context.late_slot} late-day; {context.no_slot} without slot.</span>
        </div>
        {(vm.noteTypeRows as any[]).slice(0, 5).map((r) => (
          <div key={`${r.type}-${r.status}`}>
            <b>{r.type}</b>
            <span>{r.filed} filed · {r.after_hours_filed} after-hours</span>
          </div>
        ))}
      </div>
      <div className="legend tight note-legend">
        <span><i className="entry" />entry</span>
        <span><i className="filed" />filed</span>
        <span><i className="updated" />updated</span>
      </div>
    </div>
  );
}

function OrderTraces() {
  const rows = (vm.orderTimingRows as any[]).slice(0, 14);
  const w = 660;
  const h = 390;
  const margin = { top: 26, right: 78, bottom: 28, left: 178 };
  const domain: [number, number] = [-15, 90];
  const x = d3.scaleLinear().domain(domain).range([margin.left, w - margin.right]).clamp(true);
  const y = d3.scaleBand().domain(rows.map((_, i) => String(i))).range([margin.top, h - margin.bottom]).padding(0.32);
  const events = [
    ["proc_begin", "begin", "#7c3aed"],
    ["proc_start", "start", "#2563eb"],
    ["proc_end", "end", "#b45309"],
    ["result", "result", "#16803c"],
    ["charge", "charge", "#b42318"],
  ];
  return (
    <div>
      <svg className="viz" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Order timing traces">
        {[-15, 0, 30, 60, 90].map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={margin.top - 8} y2={h - margin.bottom + 4} className={t === 0 ? "axis-zero" : "axis-line"} />
            <text x={x(t)} y={h - 8} textAnchor="middle" className="axis-text">{t === 0 ? "order" : `${t > 0 ? "+" : ""}${t}m`}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const cy = (y(String(i)) ?? 0) + y.bandwidth() / 2;
          const vals = events
            .map(([key, label, color]) => ({ key, label, color, v: r.offsets[key] }))
            .filter((e) => e.v != null && e.v >= domain[0] && e.v <= domain[1]);
          return (
            <g key={`${r.display}-${i}`}>
              <title>{`${r.display}: ordered ${r.date} ${r.order}`}</title>
              <text x={10} y={cy - 2} className="row-date">{short(r.display, 28)}</text>
              <text x={10} y={cy + 10} className="row-sub">{r.type} · {r.date}</text>
              <line x1={margin.left} x2={w - margin.right} y1={cy} y2={cy} className="row-line" />
              {vals.length ? <line x1={x(d3.min(vals, (e) => e.v) ?? 0)} x2={x(d3.max(vals, (e) => e.v) ?? 0)} y1={cy} y2={cy} className="event-span" /> : null}
              {vals.map((e) => <circle key={e.key} cx={x(e.v)} cy={cy} r={4.5} fill={e.color as string} stroke="#fff" strokeWidth="1.5" />)}
              <text x={w - margin.right + 12} y={cy + 4} className="time-text">{r.order}</text>
            </g>
          );
        })}
      </svg>
      <div className="legend tight">
        <span><i className="begin" />begin</span>
        <span><i className="start" />start</span>
        <span><i className="end" />end</span>
        <span><i className="result" />result</span>
        <span><i className="charge" />charge</span>
      </div>
    </div>
  );
}

function VisitLedger() {
  const [kind, setKind] = React.useState("clinic");
  const labels: Record<string, string> = { clinic: "Clinic", lab: "Lab", radiology: "Radiology", therapy: "Therapy", canceled: "Canceled", future: "Future", all: "All" };
  const all = vm.appointmentRows as any[];
  const rows = kind === "all" ? all : all.filter((r) => r.kind === kind);
  return (
    <div className="ledger-block">
      <div className="seg" role="tablist" aria-label="Appointment filter">
        {Object.keys(labels).map((k) => (
          <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{labels[k]}</button>
        ))}
      </div>
      <table className="grid trace-grid">
        <thead>
          <tr><th>Date</th><th>Context</th><th>Front desk</th><th>Rooming proxy</th><th>Closeout</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.csn}>
              <td className="nowrap">
                <b>{r.date}</b>
                <span className={`pill ${r.kind}`}>{r.status}</span>
              </td>
              <td><b>{r.department}</b><span>{r.provider}</span></td>
              <td>
                <div className="mini-flow">
                  <span className={r.checkin_user ? "hit" : ""}>check-in</span>
                  <span className={r.echeckin_status ? "hit" : ""}>eCheck</span>
                  <span className={r.avs_time ? "hit" : ""}>AVS</span>
                  <span className={r.checkout_user ? "hit" : ""}>checkout</span>
                </div>
                <em>{r.checkin_user ?? "no check-in actor"}</em>
              </td>
              <td>
                {r.first_core_vital_time ? (
                  <>
                    <b>{r.first_core_vital_time}</b> <span className={r.first_core_delta_min < 0 ? "early" : "late"}>{r.note}</span>
                    <em>{r.first_core_vital_label}</em>
                  </>
                ) : <em>{r.note}</em>}
              </td>
              <td><b>{r.avs_time ?? "-"}</b><em>{r.checkout_user ?? "no checkout actor"}</em></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Boundaries() {
  return (
    <div className="boundary-grid">
      {(vm.negativeFindings as any[]).map((r) => (
        <div className="boundary" key={r.label}>
          <b>{fmt(r.present)}<span>/{fmt(r.total)}</span></b>
          <strong>{r.label}</strong>
          <p>{r.note}</p>
        </div>
      ))}
    </div>
  );
}

function AdtMini() {
  return (
    <div className="adt-mini">
      {(vm.adtEpisodes as any[]).map((e) => (
        <div key={e.csn}>
          <b>{e.date}</b>
          <span>{e.in_effective} → {e.out_effective}</span>
          <em>{Math.round(e.administrative_duration_min / 60)}h administrative window</em>
        </div>
      ))}
    </div>
  );
}

function App() {
  const drawer = useDrawer();
  return (
    <DrawerContext.Provider value={drawer}>
      <main className="page">
        <header className="hero">
          <div>
            <div className="eyebrow">Epic EHI operational layer</div>
            <h1>Operational details in an Epic EHI export</h1>
            <p className="dek">Not an exam-room stopwatch. A dense trail of scheduling, patient work, staff touches, order timing, and ADT machinery.</p>
          </div>
          <MetricRail />
        </header>

        <section className="thesis">
          <p>This export lacks a clean roomed-at / left-room pair, but it exposes workflow that most clinical exports drop: first vitals relative to the slot, eCheck-in steps, questionnaire attempts, order timestamps, AVS prints, and thousands of audit touches. <Cite ids={["e_no_exam_room_timer", "e_audit_trail"]} /></p>
        </section>

        <div className="signal-grid">
          <Panel title="Slot → first vitals" cite="e_slot_vitals_proxy">
            <SlotVitalsPlot />
          </Panel>
          <Panel title="Chart touches" cite="e_audit_trail">
            <AuditPanel />
          </Panel>
          <Panel title="Patient work before arrival" cite={["e_echeckin_steps", "e_questionnaire_workflow"]}>
            <PrevisitPanel />
          </Panel>
          <Panel title="Order timing traces" cite="e_order_timing">
            <OrderTraces />
          </Panel>
          <Panel title="Note finalization clock" cite="e_note_timing" className="span-2">
            <NoteTimingPanel />
          </Panel>
        </div>

        <section className="section">
          <div className="section-head">
            <div>
              <h2>Encounter Trace Ledger</h2>
              <p>One row per status-bearing appointment. The front-desk chips show presence of operational artifacts; the rooming proxy is the first core-vital timestamp when available.</p>
            </div>
            <Cite ids="e_appt_status_counts" />
          </div>
          <VisitLedger />
        </section>

        <section className="section lower-grid">
          <Panel title="What was searched but mostly absent" cite="e_no_exam_room_timer">
            <Boundaries />
          </Panel>
          <Panel title="ADT is administrative duration" cite="e_adt_therapy">
            <Prose id="adt" compact />
            <AdtMini />
          </Panel>
        </section>
      </main>
      <SourceDrawer />
    </DrawerContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
