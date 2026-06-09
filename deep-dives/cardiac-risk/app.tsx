/**
 * Cardiovascular risk — MANDEL, JOSHUA C.  The bespoke tool a cardiologist would want to
 * fully understand this primary-prevention case: every modifiable driver drifting the wrong
 * way while the chart treats him as a healthy young man, and the structural mechanism (a single
 * 2022 hypertension diagnosis, declined and never carried forward) that hides it.
 *
 * STRUCTURAL RULE: this app imports ONLY ./viewmodel.json. Nothing
 * raw can reach the screen — there is no dataset.json / analysis.json import. Every value in the
 * view model is already display-clean. Every ⌖ cite opens a clean drawer onto viewmodel.evidence[id]
 * (a verbatim note quote with date+author, or a readable statement of a structured fact) — never a row.
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
  if (!e) return <div className="src-block"><div className="src-fact">Evidence not found: {id}</div></div>;
  const provenance = [e.who, e.date].filter(Boolean).join(" · ");
  return (
    <div className="src-block">
      <div className="src-head">
        <span className="src-tag">{e.kind === "note" ? "Note quote" : "Record"}</span>
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
            Quotes are the curated verbatim record captured during the cardiology synthesis pass; statements
            summarise structured facts from the normalised record. Nothing here is a raw export row.
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

// ================================================================== HTN — timeline + coding scorecard
const TONE_CLASS: Record<string, string> = { bad: "bad", watch: "warn", good: "good" };
const STEP_CLASS: Record<string, string> = { action: "step-act", decline: "step-decline", boilerplate: "step-boiler" };

function HTNView() {
  const h = vm.htn as any;
  return (
    <div className="htn-view">
      {/* the thread: diagnosis → decline → boilerplate-over-Stage-1 */}
      <h4 className="subhead">The thread, end to end</h4>
      <div className="htn-thread">
        {h.timeline.map((t: any, i: number) => (
          <div key={i} className={`htn-step ${STEP_CLASS[t.tone] ?? ""}`}>
            <div className="htn-step-date">{t.date}</div>
            <div className="htn-step-body">
              {t.event}
              <Cite ids={t.evidenceId} label={`${t.date} — evidence`} />
            </div>
          </div>
        ))}
      </div>

      {/* coding scorecard */}
      <h4 className="subhead">Why it stays invisible — the coding scorecard</h4>
      <table className="grid scorecard">
        <tbody>
          {h.scorecard.map((s: any, i: number) => (
            <tr key={i} className={TONE_CLASS[s.tone]}>
              <td className="sc-label">{s.label}</td>
              <td className="sc-value"><span className={`sc-pill ${TONE_CLASS[s.tone]}`}>{s.value}</span></td>
              <td className="sc-detail">{s.detail ?? ""}</td>
              <td className="sc-cite"><Cite ids={s.evidenceId} label={`${s.label} — evidence`} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* the boilerplate vs the vitals actually recorded */}
      <h4 className="subhead">The reassurance line beside the blood pressure recorded that day</h4>
      <table className="grid">
        <thead>
          <tr><th>Visit</th><th>What the note says</th><th className="num">BP recorded</th><th>Category</th><th></th></tr>
        </thead>
        <tbody>
          {h.boilerplateVsVitals.map((b: any, i: number) => (
            <tr key={i}>
              <td className="nowrap">{b.date}</td>
              <td className="quote-cell">“{b.noteSays}”</td>
              <td className="num"><b>{b.bpRecorded.replace(" mmHg", "")}</b></td>
              <td><CatPill cat={b.category} /></td>
              <td><Cite ids={b.evidenceId} label={`${b.date} — note`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fig-note">
        The note calls the blood pressure “good” on the same page that records a Stage-1 reading — the contradiction
        the chart never surfaces. With hypertension off the problem list, nothing in the chart’s machinery prompts the
        chronic axis at any of these visits.
      </p>
    </div>
  );
}

// ================================================================== BP — category-band plot + table
const BP_BANDS = [
  { lo: 40, hi: 120, label: "Normal", fill: "#eaf6ee" },
  { lo: 120, hi: 130, label: "Elevated", fill: "#fbf3dc" },
  { lo: 130, hi: 140, label: "Stage 1", fill: "#fde9d4" },
  { lo: 140, hi: 200, label: "Stage 2", fill: "#fbdada" },
];
const CAT_COLOR: Record<string, string> = { Normal: "#1a7f43", Elevated: "#b8860b", "Stage 1": "#d2691e", "Stage 2": "#b42318" };
function CatPill({ cat }: { cat: string }) {
  return <span className="cat-pill"><span className="cat-dot" style={{ background: CAT_COLOR[cat] }} />{cat}</span>;
}

function BPBandPlot({ readings, meanSys }: { readings: any[]; meanSys: number }) {
  const W = 860, H = 360, M = { t: 16, r: 118, b: 38, l: 42 };
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  const t0 = +new Date(readings[0].date_iso), t1 = +new Date(readings[readings.length - 1].date_iso);
  const x = (iso: string) => ((+new Date(iso) - t0) / (t1 - t0)) * iw;
  const yMin = 55, yMax = 150;
  const y = (v: number) => ih - ((v - yMin) / (yMax - yMin)) * ih;
  const sysPath = readings.map((d, i) => `${i ? "L" : "M"} ${x(d.date_iso)} ${y(d.sys)}`).join(" ");
  const diaPath = readings.map((d, i) => `${i ? "L" : "M"} ${x(d.date_iso)} ${y(d.dia)}`).join(" ");
  const yTicks = [60, 80, 100, 120, 140];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Blood pressure against ACC/AHA categories">
      <g transform={`translate(${M.l},${M.t})`}>
        {BP_BANDS.map((b) => {
          const yTop = Math.max(0, y(Math.min(b.hi, yMax)));
          const yBot = Math.min(ih, y(Math.max(b.lo, yMin)));
          if (yBot <= yTop) return null;
          return (
            <g key={b.label}>
              <rect x={0} y={yTop} width={iw} height={yBot - yTop} fill={b.fill} />
              <text x={iw + 6} y={(yTop + yBot) / 2 + 4} fontSize={11} fill="#6b7075">{b.label}</text>
            </g>
          );
        })}
        {[120, 130, 140].map((t) => <line key={t} x1={0} x2={iw} y1={y(t)} y2={y(t)} stroke="#fff" strokeWidth={1} />)}
        {/* office-mean systolic reference line */}
        <line x1={0} x2={iw} y1={y(meanSys)} y2={y(meanSys)} stroke="#9b2226" strokeWidth={1} strokeDasharray="5 4" opacity={0.6} />
        <text x={iw + 6} y={y(meanSys) - 4} fontSize={10} fill="#9b2226">mean {Math.round(meanSys)}</text>
        {yTicks.map((t) => <text key={t} x={-8} y={y(t) + 4} fontSize={11} fill="#9aa0a6" textAnchor="end">{t}</text>)}
        {readings.map((d, i) => (
          <text key={i} x={x(d.date_iso)} y={ih + 22} fontSize={10} fill="#9aa0a6" textAnchor="middle">{d.date.slice(-4)}</text>
        ))}
        <path d={sysPath} fill="none" stroke="#9b2226" strokeWidth={1.5} opacity={0.45} />
        <path d={diaPath} fill="none" stroke="#1d4ed8" strokeWidth={1.5} opacity={0.35} />
        {readings.map((d, i) => {
          const flagged = d.category === "Stage 2";
          return (
            <g key={i}>
              <line x1={x(d.date_iso)} x2={x(d.date_iso)} y1={y(d.sys)} y2={y(d.dia)} stroke="#bbb" strokeWidth={1} />
              <circle cx={x(d.date_iso)} cy={y(d.sys)} r={flagged ? 6 : 4.5} fill={CAT_COLOR[d.category]} stroke={flagged ? "#000" : "#fff"} strokeWidth={flagged ? 1.6 : 1} />
              <circle cx={x(d.date_iso)} cy={y(d.dia)} r={4} fill="#1d4ed8" stroke="#fff" strokeWidth={1} />
              <text x={x(d.date_iso)} y={y(d.sys) - 9} fontSize={10} fontWeight={600} fill="#444" textAnchor="middle">{d.sys}</text>
            </g>
          );
        })}
        <g transform="translate(2,2)">
          <circle cx={6} cy={6} r={4} fill="#9b2226" /><text x={15} y={10} fontSize={11} fill="#444" fontWeight={600}>systolic (colored by category)</text>
          <circle cx={230} cy={6} r={4} fill="#1d4ed8" /><text x={239} y={10} fontSize={11} fill="#444" fontWeight={600}>diastolic</text>
        </g>
      </g>
    </svg>
  );
}

function BPView() {
  const bp = vm.bp as any;
  const readings: any[] = bp.readings;
  const counts = readings.reduce((m: Record<string, number>, r) => { m[r.category] = (m[r.category] || 0) + 1; return m; }, {});
  const sysVals = readings.map((r) => r.sys);
  return (
    <div>
      <BPBandPlot readings={readings} meanSys={bp.meanSys} />
      <p className="fig-note">
        Every office reading, {readings.length} over {readings[0].date.slice(-4)}–{readings[readings.length - 1].date.slice(-4)}, against the
        2017 ACC/AHA systolic bands. The single black-ringed point ({readings.find((r) => r.category === "Stage 2")?.sys}/
        {readings.find((r) => r.category === "Stage 2")?.dia}, Dec 2022) is the only reading Epic auto-flagged abnormal; the dashed line is the
        office mean systolic.<Cite ids="e_bp_series" label="Blood-pressure readings" />
      </p>
      <div className="bp-summary">
        <span><b>{Math.round(bp.meanSys)}</b> mean systolic</span>
        <span><b>{Math.min(...sysVals)}–{Math.max(...sysVals)}</b> systolic range</span>
        <span><b>{bp.nStage1Plus} of {bp.n}</b> at or above Stage 1</span>
        <span className="bp-counts">
          {["Normal", "Elevated", "Stage 1", "Stage 2"].map((c) => counts[c] ? (
            <span key={c} className="count-chip" style={{ borderColor: CAT_COLOR[c], color: CAT_COLOR[c] }}>{c} · {counts[c]}</span>
          ) : null)}
        </span>
      </div>
      <table className="grid">
        <thead><tr><th>Date</th><th className="num">Systolic</th><th className="num">Diastolic</th><th>ACC/AHA category</th></tr></thead>
        <tbody>
          {readings.map((r, i) => (
            <tr key={i}>
              <td className="nowrap">{r.date}</td>
              <td className="num"><b>{r.sys}</b></td>
              <td className="num">{r.dia}</td>
              <td><CatPill cat={r.category} />{r.category === "Stage 2" ? <span className="flag-badge">Epic: High</span> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fig-note">
        The office mean of {Math.round(bp.meanSys)} is concordant with — if anything below — the patient’s own home report of “upper 130s,” so this
        is corroborated sustained hypertension, not white-coat lability.<Cite ids={["e_home_report", "e_office_home_concordant"]} label="Office-vs-home concordance" />
      </p>
    </div>
  );
}

// ================================================================== Lipids — trend small-multiples + panels
function LipidSpark({ title, values, dates, ref, invert, unit }: {
  title: string; values: number[]; dates: string[]; ref?: { lo?: number; hi?: number }; invert?: boolean; unit?: string;
}) {
  const W = 220, H = 96, M = { t: 18, r: 14, b: 18, l: 30 };
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  const allRefs = [ref?.lo, ref?.hi].filter((v) => v != null) as number[];
  const lo = Math.min(...values, ...allRefs) * 0.92;
  const hi = Math.max(...values, ...allRefs) * 1.08;
  const x = (i: number) => (values.length === 1 ? iw / 2 : (i / (values.length - 1)) * iw);
  const y = (v: number) => ih - ((v - lo) / (hi - lo)) * ih;
  const path = values.map((v, i) => `${i ? "L" : "M"} ${x(i)} ${y(v)}`).join(" ");
  const first = values[0], last = values[values.length - 1];
  // direction tone: for HDL, falling is adverse (invert); for others, rising is adverse
  const rising = last > first;
  const adverse = invert ? !rising : rising;
  const arrow = last === first ? "→" : rising ? "↑" : "↓";
  const outOf = (v: number) => (ref?.lo != null && v < ref.lo) || (ref?.hi != null && v > ref.hi);
  return (
    <div className="spark-card">
      <div className="spark-head">
        <span className="spark-title">{title}</span>
        <span className={`spark-delta ${adverse ? "adverse" : "ok"}`}>{first}{unit ? "" : ""} {arrow} {last}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="spark-svg" role="img" aria-label={`${title} trend`}>
        <g transform={`translate(${M.l},${M.t})`}>
          {ref?.hi != null && ref.hi <= hi && <line x1={0} x2={iw} y1={y(ref.hi)} y2={y(ref.hi)} stroke="#d2a0a0" strokeWidth={1} strokeDasharray="3 3" />}
          {ref?.lo != null && ref.lo >= lo && <line x1={0} x2={iw} y1={y(ref.lo)} y2={y(ref.lo)} stroke="#d2a0a0" strokeWidth={1} strokeDasharray="3 3" />}
          <path d={path} fill="none" stroke={adverse ? "#b42318" : "#1a7f43"} strokeWidth={2} />
          {values.map((v, i) => (
            <g key={i}>
              <circle cx={x(i)} cy={y(v)} r={3.5} fill={outOf(v) ? "#b42318" : (adverse ? "#b42318" : "#1a7f43")} stroke="#fff" strokeWidth={1.2} />
              <text x={x(i)} y={y(v) - 7} fontSize={9.5} fill="#444" textAnchor="middle" fontWeight={i === values.length - 1 ? 700 : 400}>{v}</text>
            </g>
          ))}
        </g>
      </svg>
      <div className="spark-x">{dates.map((d, i) => <span key={i}>{d.slice(-4)}</span>)}</div>
    </div>
  );
}

function LipidView() {
  const L = vm.lipids as any;
  const t = L.trend;
  return (
    <div>
      <div className="spark-grid">
        <LipidSpark title="HDL (the driver)" values={t.hdl} dates={t.dates} ref={{ lo: 40 }} invert unit="mg/dL" />
        <LipidSpark title="Chol / HDL ratio" values={t.ratio} dates={t.dates} ref={{ hi: 5 }} />
        <LipidSpark title="Triglycerides" values={t.tg} dates={t.dates} ref={{ hi: 149 }} unit="mg/dL" />
        <LipidSpark title="Total cholesterol" values={t.totalChol} dates={t.dates} ref={{ hi: 199 }} unit="mg/dL" />
        <LipidSpark title="LDL (calculated)" values={t.ldl} dates={t.dates} ref={{ hi: 129 }} unit="mg/dL" />
      </div>
      <p className="fig-note">
        Red trend = moving the adverse way; the dashed line is the reference bound. The protective HDL is falling and the ratio and triglycerides
        climb, while LDL stays essentially flat — so LDL is not the story.<Cite ids={["e_hdl", "e_ratio", "e_ldl"]} label="Lipid trends" />
      </p>

      <h4 className="subhead">The three panels, value against reference</h4>
      <div className="panel-grid">
        {L.panels.map((p: any, i: number) => (
          <div key={i} className="panel-card">
            <div className="panel-head">
              <span className="panel-date">{p.date}</span>
              <span className={`fast-badge ${p.fasting ? "fast" : "nonfast"}`}>{p.fasting ? "fasting" : "non-fasting"}</span>
            </div>
            <table className="grid mini">
              <tbody>
                {p.rows.map((r: any, j: number) => (
                  <tr key={j}>
                    <td>{r.analyte}</td>
                    <td className="num"><b>{r.value}</b>{r.flag ? <span className={`flag-badge ${r.flag.toLowerCase()}`}>{r.flag}</span> : null}</td>
                    <td className="dim num">{r.refText}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <p className="fig-note">
        The 2025 panel was non-fasting, which inflates the triglyceride and the calculated VLDL and ratio; the 2018 baseline was fasting. The
        driver — HDL — is measured directly and does not depend on fasting, so the atherogenic shift is real regardless.<Cite ids={["e_fasting_2018", "e_nonfasting_2025"]} label="Fasting status" />
      </p>
    </div>
  );
}

// ================================================================== ASCVD — arc gauge + trajectory + inputs
const fmtPct = (v: number) => v.toFixed(2) + "%";
const GW = 460, GH = 248, GCX = GW / 2, GCY = 208, RAD = 166, SCALE_MAX = 10;
const angOf = (v: number) => Math.PI + (Math.min(v, SCALE_MAX) / SCALE_MAX) * (0 - Math.PI);
const ptOn = (v: number, r: number) => ({ x: GCX + r * Math.cos(angOf(v)), y: GCY + r * Math.sin(angOf(v)) });
function arcWedge(v0: number, v1: number, rO: number, rI: number): string {
  const p0 = ptOn(v0, rO), p1 = ptOn(v1, rO), q1 = ptOn(v1, rI), q0 = ptOn(v0, rI);
  const large = Math.abs(angOf(v1) - angOf(v0)) > Math.PI ? 1 : 0;
  return `M ${p0.x} ${p0.y} A ${rO} ${rO} 0 ${large} 1 ${p1.x} ${p1.y} L ${q1.x} ${q1.y} A ${rI} ${rI} 0 ${large} 0 ${q0.x} ${q0.y} Z`;
}
const GAUGE_BANDS = [
  { lo: 0, hi: 5, fill: "#bfe3c9", label: "Low (<5%)" },
  { lo: 5, hi: 7.5, fill: "#f5d99a", label: "Borderline (5–7.5%)" },
  { lo: 7.5, hi: 10, fill: "#f3b4ad", label: "Intermediate (7.5%+)" },
];

function RiskGauge({ value }: { value: number }) {
  const rO = RAD, rI = RAD - 44;
  const tip = ptOn(value, rO - 6);
  const mark = ptOn(value, (rO + rI) / 2);
  return (
    <svg viewBox={`0 0 ${GW} ${GH}`} className="chart ascvd-gauge" role="img" aria-label="10-year ASCVD risk gauge">
      {GAUGE_BANDS.map((b) => <path key={b.label} d={arcWedge(b.lo, b.hi, rO, rI)} fill={b.fill} />)}
      {[0, 5, 7.5, 10].map((tk) => {
        const o = ptOn(tk, rO + 3), inn = ptOn(tk, rI - 4), lab = ptOn(tk, rO + 17);
        const key = tk === 5 || tk === 7.5;
        return (
          <g key={tk}>
            <line x1={inn.x} y1={inn.y} x2={o.x} y2={o.y} stroke={key ? "#6b7075" : "#b8bcc2"} strokeWidth={key ? 1.75 : 1} />
            <text x={lab.x} y={lab.y + 4} fontSize={11} fill="#6b7075" textAnchor="middle" fontWeight={key ? 700 : 400}>{tk}%</text>
          </g>
        );
      })}
      <line x1={GCX} y1={GCY} x2={tip.x} y2={tip.y} stroke="#1a1d21" strokeWidth={3} strokeLinecap="round" />
      <circle cx={GCX} cy={GCY} r={7} fill="#1a1d21" />
      <circle cx={mark.x} cy={mark.y} r={8} fill="#7c3aed" stroke="#fff" strokeWidth={2.5} />
      <text x={GCX} y={GCY - 44} fontSize={40} fontWeight={800} fill="#1a1d21" textAnchor="middle" letterSpacing="-0.02em">{fmtPct(value)}</text>
      <text x={GCX} y={GCY - 24} fontSize={12} fill="#6b7075" textAnchor="middle">10-year ASCVD (2025 panel) · well below the 5% line</text>
    </svg>
  );
}

function TrajectoryStrip({ points }: { points: { date: string; pct: number }[] }) {
  const W = 460, H = 110, M = { l: 16, r: 16, t: 26, b: 24 };
  const iw = W - M.l - M.r, max = 3;
  const x = (v: number) => M.l + (Math.min(v, max) / max) * iw;
  const y = M.t + 14;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart ascvd-traj" role="img" aria-label="ASCVD trajectory">
      <text x={M.l} y={14} fontSize={11} fill="#6b7075" fontWeight={700}>Trajectory — age held at 43, lipids from each panel (0–3% detail)</text>
      <line x1={M.l} y1={y} x2={M.l + iw} y2={y} stroke="#e3e6ea" strokeWidth={2} />
      {[0, 1, 2, 3].map((tk) => (
        <g key={tk}>
          <line x1={x(tk)} y1={y - 4} x2={x(tk)} y2={y + 4} stroke="#b8bcc2" />
          <text x={x(tk)} y={H - 6} fontSize={10} fill="#9aa0a6" textAnchor="middle">{tk}%</text>
        </g>
      ))}
      <line x1={x(points[0].pct)} y1={y} x2={x(points[points.length - 1].pct)} y2={y} stroke="#7c3aed" strokeWidth={3} strokeLinecap="round" opacity={0.5} />
      {points.map((p, i) => {
        const isLast = i === points.length - 1;
        const above = isLast || i % 2 === 0;
        return (
          <g key={p.date}>
            <circle cx={x(p.pct)} cy={y} r={isLast ? 6 : 4.5} fill={isLast ? "#7c3aed" : "#b794f4"} stroke="#fff" strokeWidth={1.5} />
            <text x={x(p.pct)} y={above ? y - 10 : y + 25} fontSize={11} fill="#5a3a8a" textAnchor="middle" fontWeight={isLast ? 700 : 500}>{fmtPct(p.pct)}</text>
            <text x={x(p.pct)} y={above ? y + 16 : y + 38} fontSize={9.5} fill="#9aa0a6" textAnchor="middle">{p.date.slice(-4)}</text>
          </g>
        );
      })}
    </svg>
  );
}

const INPUT_TONE: Record<string, "adverse" | "protective" | "neutral"> = {
  "HDL cholesterol": "adverse", "Systolic BP": "adverse", "On BP treatment": "adverse",
  Smoker: "protective", Diabetes: "protective",
};

function SensBars({ points, highlightLabel, baseline }: { points: { label: string; pct: number }[]; highlightLabel?: string; baseline?: number }) {
  const max = Math.max(...points.map((p) => p.pct)) * 1.18;
  return (
    <div className="sens-bars">
      {points.map((p) => (
        <div key={p.label} className="sb-row">
          <div className="sb-label">{p.label}</div>
          <div className="sb-track">
            <div className={`sb-fill ${highlightLabel && p.label.startsWith(highlightLabel) ? "hi" : ""}`} style={{ width: `${(p.pct / max) * 100}%` }} />
            {baseline != null && <div className="sb-baseline" style={{ left: `${(baseline / max) * 100}%` }} />}
          </div>
          <div className="sb-val">{fmtPct(p.pct)}</div>
        </div>
      ))}
    </div>
  );
}

function ASCVDView() {
  const a = vm.ascvd as any;
  const baseline = a.trajectory[0].pct;
  return (
    <div className="ascvd-view">
      <div className="ascvd-top">
        <div>
          <RiskGauge value={a.high_pct} />
          <div className="ascvd-bandkey">
            {GAUGE_BANDS.map((b) => <span key={b.label}><i className="sw" style={{ background: b.fill }} />{b.label}</span>)}
          </div>
          <TrajectoryStrip points={a.trajectory} />
        </div>
        <div className="ascvd-read">
          <p>
            Computed here from the record — the chart never produced it. As a confirmed White, non-Hispanic male in primary prevention, his
            Pooled-Cohort 10-year ASCVD runs <b>{a.low}</b> on the 2018 fasting panel to <b>{a.high}</b> on the latest 2025 panel.<Cite ids="e_ascvd_computed" label="ASCVD computation" />
          </p>
          <p>{a.threshold_note}<Cite ids="e_ascvd_computed" label="Thresholds and trajectory" /></p>
          <p className="cross-check">
            <b>{a.cross_check.model}:</b> {a.cross_check.value} — {a.cross_check.note}<Cite ids={a.cross_check.evidenceId} label="PREVENT cross-check" />
          </p>
        </div>
      </div>

      <h4 className="subhead">Contributing inputs — every estimator input, each drillable to its source</h4>
      <div className="ascvd-chips">
        {a.inputs.map((inp: any, i: number) => (
          <div key={i} className={`ascvd-chip ${INPUT_TONE[inp.label] ?? "neutral"}`}>
            <div className="chip-name">{inp.label}<Cite ids={inp.evidenceId} label={`${inp.label} — source`} /></div>
            <div className="chip-val">{inp.value}</div>
          </div>
        ))}
      </div>
      <p className="tiny">{a.basis}</p>

      <div className="ascvd-cols">
        <div className="ascvd-col">
          <div className="sens-cap">
            <b>{a.sensitivities.systolic.title}.</b> {a.sensitivities.systolic.note}<Cite ids={a.sensitivities.systolic.evidenceId} label="Systolic sensitivity" />
            <span className="sens-panel"> {a.sensitivities.systolic.panel}.</span>
          </div>
          <SensBars points={a.sensitivities.systolic.points.map((p: any) => ({ label: p.label, pct: p.pct }))} highlightLabel="Systolic 132" />
        </div>
        <div className="ascvd-col">
          <div className="sens-cap">
            <b>{a.sensitivities.fasting_redraw.title}.</b> {a.sensitivities.fasting_redraw.note}<Cite ids={a.sensitivities.fasting_redraw.evidenceId} label="Fasting-redraw scenario" />
          </div>
          <SensBars points={a.sensitivities.fasting_redraw.points.map((p: any) => ({ label: p.label, pct: p.pct }))} highlightLabel="Total cholesterol 188" baseline={baseline} />
          <div className="tiny">Dashed line = his {a.low} baseline at the 2018 HDL of 52. Even reverting cholesterol to 159, HDL 40 keeps him above it.</div>
        </div>
      </div>

      <details className="caveats" open>
        <summary>Caveats — every one made explicit ({a.caveats.length})</summary>
        <ul>{a.caveats.map((c: string, i: number) => <li key={i}>{c}</li>)}</ul>
      </details>
    </div>
  );
}

// ================================================================== Family — graphical pedigree (SVG)
const COND_BY_KEY: Record<string, { label: string; color: string; abbr: string }> = Object.fromEntries(
  (vm.family as any).conditions.map((c: any) => [c.key, { label: c.label, color: c.color, abbr: c.label.split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 3) }])
);
const COND_ORDER = (vm.family as any).conditions.map((c: any) => c.key);

const PED_R = 26;
const PED_GEN_Y = [70, 210, 350];
const PED_X: Record<string, number> = { mgm: 150, mgf: 310, pgm: 610, pgf: 770, mother: 380, father: 540, proband: 420, brother: 500 };
const PED_W = 920;

function pedWedge(cx: number, cy: number, r: number, i: number, n: number): string {
  const a0 = -Math.PI / 2 + (2 * Math.PI * i) / n, a1 = -Math.PI / 2 + (2 * Math.PI * (i + 1)) / n;
  const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0), x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
}
function pedBand(cx: number, cy: number, r: number, i: number, n: number) {
  return { x: cx - r + (2 * r * i) / n, y: cy - r, w: (2 * r) / n, h: 2 * r };
}

function PedSymbol({ node }: { node: any }) {
  const x = PED_X[node.id], y = PED_GEN_Y[node.generation - 1];
  const isMale = node.sex === "male";
  const cvList: string[] = COND_ORDER.filter((k: string) => node.affected.includes(k));
  const n = cvList.length;
  const stroke = "#1a1d21";
  return (
    <g>
      {n > 0 && cvList.map((c, i) =>
        isMale
          ? (() => { const b = pedBand(x, y, PED_R, i, n); return <rect key={c} x={b.x} y={b.y} width={b.w} height={b.h} fill={COND_BY_KEY[c].color} opacity={0.9} />; })()
          : <path key={c} d={pedWedge(x, y, PED_R, i, n)} fill={COND_BY_KEY[c].color} opacity={0.9} />
      )}
      {isMale
        ? <rect x={x - PED_R} y={y - PED_R} width={2 * PED_R} height={2 * PED_R} fill={n ? "none" : "#fff"} stroke={stroke} strokeWidth={2} />
        : <circle cx={x} cy={y} r={PED_R} fill={n ? "none" : "#fff"} stroke={stroke} strokeWidth={2} />}
      {node.deceased && <line x1={x - PED_R - 6} y1={y + PED_R + 6} x2={x + PED_R + 6} y2={y - PED_R - 6} stroke={stroke} strokeWidth={2} />}
      {node.proband && (
        <g>
          <line x1={x - PED_R - 22} y1={y + PED_R + 22} x2={x - PED_R - 4} y2={y + PED_R + 4} stroke="#0a7d32" strokeWidth={2.5} />
          <path d={`M ${x - PED_R - 4} ${y + PED_R + 4} l -8 -1 l 4 7 z`} fill="#0a7d32" />
          <text x={x - PED_R - 26} y={y + PED_R + 30} fontSize={13} fontWeight={700} fill="#0a7d32">P</text>
        </g>
      )}
      <text x={x} y={y + PED_R + 16} fontSize={12} fill="#1a1d21" textAnchor="middle" fontWeight={node.proband ? 700 : 500}>
        {node.relation.replace(" (proband)", "").replace("Self", "Self")}
      </text>
      {n > 0 && (
        <text x={x} y={y + PED_R + 31} fontSize={10} textAnchor="middle">
          {cvList.map((c, i) => <tspan key={c} fill={COND_BY_KEY[c].color} fontWeight={600}>{i > 0 ? "  " : ""}{COND_BY_KEY[c].abbr}</tspan>)}
        </text>
      )}
    </g>
  );
}

function CoupleLine({ a, b }: { a: string; b: string }) {
  const gen = a.startsWith("m") && a.length === 3 || a.startsWith("p") && a.length === 3 ? 1 : (a === "mother" || a === "father") ? 2 : 3;
  const y = PED_GEN_Y[gen - 1];
  return <line x1={Math.min(PED_X[a], PED_X[b]) + PED_R} y1={y} x2={Math.max(PED_X[a], PED_X[b]) - PED_R} y2={y} stroke="#1a1d21" strokeWidth={2} />;
}

function FamilyView() {
  const f = vm.family as any;
  const members: any[] = f.members;
  const byId = Object.fromEntries(members.map((m) => [m.id, m]));
  const descent = [
    { mx: (PED_X.mgm + PED_X.mgf) / 2, my: PED_GEN_Y[0], childY: PED_GEN_Y[1], children: [PED_X.mother] },
    { mx: (PED_X.pgm + PED_X.pgf) / 2, my: PED_GEN_Y[0], childY: PED_GEN_Y[1], children: [PED_X.father] },
    { mx: (PED_X.mother + PED_X.father) / 2, my: PED_GEN_Y[1], childY: PED_GEN_Y[2], children: [PED_X.proband, PED_X.brother] },
  ];
  const affectedMembers = members.filter((m) => m.affected.length);
  return (
    <div className="ped-wrap">
      <svg viewBox={`0 0 ${PED_W} 430`} className="pedigree-svg" role="img" aria-label="Cardiovascular family pedigree">
        {["I", "II", "III"].map((g, i) => <text key={g} x={18} y={PED_GEN_Y[i] + 4} fontSize={13} fill="#9aa0a6" fontWeight={700}>{g}</text>)}
        {descent.map((d, i) => {
          const barY = (d.my + d.childY) / 2 + 6;
          const xs = d.children;
          return (
            <g key={i}>
              <line x1={d.mx} y1={d.my} x2={d.mx} y2={barY} stroke="#1a1d21" strokeWidth={2} />
              <line x1={Math.min(...xs, d.mx)} y1={barY} x2={Math.max(...xs, d.mx)} y2={barY} stroke="#1a1d21" strokeWidth={2} />
              {xs.map((cx, j) => <line key={j} x1={cx} y1={barY} x2={cx} y2={d.childY - PED_R} stroke="#1a1d21" strokeWidth={2} />)}
            </g>
          );
        })}
        <CoupleLine a="mgm" b="mgf" /><CoupleLine a="pgm" b="pgf" /><CoupleLine a="mother" b="father" />
        <text x={(PED_X.mgm + PED_X.mgf) / 2} y={PED_GEN_Y[0] - PED_R - 14} fontSize={11} fill="#6b7075" textAnchor="middle">maternal line</text>
        <text x={(PED_X.pgm + PED_X.pgf) / 2} y={PED_GEN_Y[0] - PED_R - 14} fontSize={11} fill="#6b7075" textAnchor="middle">paternal line</text>
        {members.map((m) => <PedSymbol key={m.id} node={m} />)}
      </svg>

      <div className="ped-legend">
        <div className="ped-legend-key">
          <span className="plk-title">Symbols</span>
          <span className="plk"><svg width="20" height="20"><rect x="3" y="3" width="14" height="14" fill="none" stroke="#1a1d21" strokeWidth="2" /></svg> male</span>
          <span className="plk"><svg width="20" height="20"><circle cx="10" cy="10" r="7" fill="none" stroke="#1a1d21" strokeWidth="2" /></svg> female</span>
          <span className="plk"><svg width="20" height="20"><circle cx="10" cy="10" r="7" fill="none" stroke="#1a1d21" strokeWidth="2" /><line x1="1" y1="19" x2="19" y2="1" stroke="#1a1d21" strokeWidth="2" /></svg> deceased</span>
          <span className="plk"><span style={{ color: "#0a7d32", fontWeight: 700 }}>↗ P</span> proband</span>
        </div>
        <div className="ped-legend-key">
          <span className="plk-title">Affected (shaded)</span>
          {COND_ORDER.map((c: string) => <span key={c} className="plk"><i className="ped-sw" style={{ background: COND_BY_KEY[c].color }} /> {COND_BY_KEY[c].label}</span>)}
        </div>
      </div>

      <p className="fig-note">
        <b>{f.totalCvFacts} of {f.totalFacts}</b> family-history facts are cardiovascular. {f.bilateral}
        <Cite ids={["e_family_mother_htn", "e_family_father_hld", "e_family_brother", "e_family_maternal_stroke", "e_family_paternal_mi", "e_family_count"]} label="Family-history facts" />
      </p>
      <div className="ped-drill">
        {affectedMembers.map((m) => (
          <span key={m.id} className="ped-drill-item">
            <b>{m.relation.replace(" (proband)", "")}</b>: {m.affected.map((c: string, i: number) => (
              <span key={c}>{i > 0 ? ", " : ""}<span style={{ color: COND_BY_KEY[c].color }}>{COND_BY_KEY[c].label}</span></span>
            ))}
          </span>
        ))}
      </div>
      <p className="open-flag">
        <span className="open-flag-tag">not in the export</span>
        {f.onsetCaveat}
        <Cite ids="e_family_onset_absent" label="Onset absent in table and notes" />
      </p>
    </div>
  );
}

// ================================================================== Acute events — two cards
function AcuteView() {
  const events = vm.acute as any[];
  return (
    <div className="acute-grid">
      {events.map((ev, i) => (
        <div key={i} className="acute-card">
          <div className="acute-card-head">
            <span className="acute-date">{ev.date}</span>
            <span className="acute-ext">external · imported</span>
          </div>
          <div className="acute-title">{ev.label}</div>
          <div className="acute-setting">{ev.setting}</div>
          <div className="acute-result">
            {ev.result}
            <Cite ids={ev.readEvidenceId ? [ev.evidenceId, ev.readEvidenceId] : [ev.evidenceId]} label={`${ev.date} — read`} />
          </div>
          <table className="grid mini acute-studies">
            <tbody>
              {ev.studies.map((s: any, j: number) => (
                <tr key={j}><td>{s.study}</td><td className="dim">{s.result}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="acute-reassure"><span className="reassure-badge">reassuring</span> {ev.reassurance}</div>
          <div className="acute-unrec">
            <span className="unrec-tag">unreconciled</span> {ev.unreconciledNote}
            <Cite ids={ev.pcpSilentEvidenceId ? [ev.unreconciledEvidenceId, ev.pcpSilentEvidenceId] : [ev.unreconciledEvidenceId]} label="Unreconciled" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ================================================================== Metabolic — weight line + A1c + CGM
function WeightLine({ rows }: { rows: any[] }) {
  const W = 560, H = 200, M = { t: 16, r: 16, b: 26, l: 36 };
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  const t0 = +new Date(rows[0].date_iso), t1 = +new Date(rows[rows.length - 1].date_iso);
  const x = (iso: string) => ((+new Date(iso) - t0) / (t1 - t0)) * iw;
  const vals = rows.map((r) => r.lb);
  const lo = Math.min(...vals) - 4, hi = Math.max(...vals) + 4;
  const y = (v: number) => ih - ((v - lo) / (hi - lo)) * ih;
  const path = rows.map((r, i) => `${i ? "L" : "M"} ${x(r.date_iso)} ${y(r.lb)}`).join(" ");
  // overweight band: BMI 25 at his height (~71in) ≈ 179 lb; mark roughly
  const owLb = 179;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Weight trend">
      <g transform={`translate(${M.l},${M.t})`}>
        {owLb >= lo && owLb <= hi && (
          <>
            <rect x={0} y={0} width={iw} height={y(owLb)} fill="#fbf3dc" opacity={0.6} />
            <line x1={0} x2={iw} y1={y(owLb)} y2={y(owLb)} stroke="#b8860b" strokeWidth={1} strokeDasharray="4 3" />
            <text x={iw - 2} y={y(owLb) - 5} fontSize={10} fill="#946b08" textAnchor="end">overweight (BMI ≥ 25)</text>
          </>
        )}
        {[170, 180, 190].map((t) => t >= lo && t <= hi && <text key={t} x={-8} y={y(t) + 4} fontSize={11} fill="#9aa0a6" textAnchor="end">{t}</text>)}
        <path d={path} fill="none" stroke="#b42318" strokeWidth={2} />
        {rows.map((r, i) => (
          <g key={i}>
            <circle cx={x(r.date_iso)} cy={y(r.lb)} r={3.5} fill="#b42318" stroke="#fff" strokeWidth={1.2} />
            {(i === 0 || i === rows.length - 1) && <text x={x(r.date_iso)} y={y(r.lb) - 8} fontSize={10} fontWeight={700} fill="#444" textAnchor={i === 0 ? "start" : "end"}>{r.lb}</text>}
            <text x={x(r.date_iso)} y={ih + 20} fontSize={9.5} fill="#9aa0a6" textAnchor="middle">{r.date.slice(-4)}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}

function MetabolicView() {
  const m = vm.metabolic as any;
  const first = m.weight[0], last = m.weight[m.weight.length - 1];
  const gain = (last.lb - first.lb).toFixed(1);
  return (
    <div className="metab-row">
      <div>
        <WeightLine rows={m.weight} />
        <p className="fig-note">
          Weight rose <b>+{gain} lb</b> ({first.lb} → {last.lb}) from {first.date.slice(-4)} to {last.date.slice(-4)}, moving BMI into the overweight
          range — the plausible common cause behind the simultaneous blood-pressure, HDL, and triglyceride drift.<Cite ids="e_weight" label="Weight series" />
        </p>
      </div>
      <div className="metab-side">
        <div className="metab-fact">
          <div className="metab-fact-label">Hemoglobin A1c</div>
          <div className="metab-fact-val">{m.a1c.map((a: any) => a.pct + "%").join("  →  ")}</div>
          <div className="metab-fact-note">Both normal — neither diabetic nor prediabetic, so dysglycemia is not a current driver.<Cite ids="e_a1c" label="A1c values" /></div>
        </div>
        <div className="metab-fact">
          <div className="metab-fact-label">Continuous glucose monitor</div>
          <div className="metab-fact-val">Self-funded, then “not taking”</div>
          <div className="metab-fact-note">{m.cgm.note}<Cite ids={["e_cgm_engagement", "e_cgm"]} label="CGM engagement" /></div>
        </div>
      </div>
    </div>
  );
}

// ================================================================== driver board (header)
const DRIVERS = [
  { problem: "Blood pressure", line: "Stage-1 range for 7 years (mean systolic 132; 7 of 9 readings at/above threshold, none normal; home report agrees)", tone: "bad", to: "#bp" },
  { problem: "Hypertension coding", line: "diagnosed once 8/2022, treated for one day on paper, declined, never problem-listed or re-addressed", tone: "bad", to: "#htn" },
  { problem: "Lipids", line: "HDL 52 → 40 (now Low), chol/HDL ratio 3.1 → 4.7, triglycerides to 282 (non-fasting)", tone: "bad", to: "#lipids" },
  { problem: "Family history", line: "hypertension ×2 and hyperlipidemia ×2 in first-degree relatives; a hard atherosclerotic event in all 4 grandparents", tone: "bad", to: "#family" },
  { problem: "10-year ASCVD", line: "never computed in the chart; computed here 1.06% → 2.04%, nearly doubled, driven by the HDL fall", tone: "warn", to: "#ascvd" },
  { problem: "Weight / glycemia", line: "+13 lb into the overweight range (174 → 187 lb); A1c normal (5.4–5.5%); not diabetic", tone: "warn", to: "#metabolic" },
];
const COUNTERWEIGHTS = [
  { label: "Troponin negative", note: "May 2024 chest pain" },
  { label: "Neck CT angiogram clean", note: "no atherosclerosis at 42" },
  { label: "A1c normal", note: "5.4–5.5%" },
  { label: "Kidneys clear", note: "eGFR > 90, electrolytes normal" },
];

// ================================================================== App
function App() {
  const order = ["htn", "bp", "lipids", "ascvd", "family", "acute", "metabolic", "assessment"];
  const titleOf = (id: string) => sectionById[id]?.title ?? id;
  const proseOf = (id: string) => sectionById[id]?.narrative ?? [];
  let n = 0;
  return (
    <div className="page">
      <SourceDrawer />
      <header className="page-head">
        <div className="ph-eyebrow">Cardiovascular risk · deep dive</div>
        <h1>MANDEL, JOSHUA C</h1>
        <div className="ph-demo">Male · age 43 · primary prevention (no established ASCVD, no diabetes)</div>
        <p className="ph-headline">{vm.summary}</p>

        <div className="driver-board">
          <table className="driver-table">
            <tbody>
              {DRIVERS.map((d) => (
                <tr key={d.problem} className={`driver-row ${d.tone}`}>
                  <td className="dr-problem"><a href={d.to}>{d.problem}</a></td>
                  <td className="dr-line">{d.line}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="counterweights">
            <span className="cw-title">Reassuring counterweights</span>
            {COUNTERWEIGHTS.map((c) => (
              <span key={c.label} className="cw-item"><b>{c.label}</b> <span className="cw-note">{c.note}</span></span>
            ))}
          </div>
        </div>
      </header>

      {order.map((id) => {
        n += 1;
        if (id === "assessment") {
          // closing section: prose + plan + open questions, all from the view model's assessment narrative
          const paras: Para[] = proseOf("assessment");
          return (
            <SectionShell key={id} id={id} n={n} title={titleOf("assessment")}>
              <Prose paras={paras} />
            </SectionShell>
          );
        }
        const lead = proseOf(id);
        return (
          <SectionShell key={id} id={id} n={n} title={titleOf(id)}>
            <Prose paras={lead} />
            {id === "htn" && <HTNView />}
            {id === "bp" && <BPView />}
            {id === "lipids" && <LipidView />}
            {id === "ascvd" && <ASCVDView />}
            {id === "family" && <FamilyView />}
            {id === "acute" && <AcuteView />}
            {id === "metabolic" && <MetabolicView />}
          </SectionShell>
        );
      })}

      <footer className="page-foot">
        Built over a single display-clean view model assembled from the cardiology analysis and the complete normalised record.
        Every figure is carried pre-computed; every ⌖ traces a claim to a verbatim note quote or a readable statement of the record.
        Single-export, single-specimen view.
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
