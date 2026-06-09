/**
 * Prevention & self-tracking — MANDEL, JOSHUA C. The tool a primary-care clinician would want to
 * understand this patient's prevention behavior across eight years: three parallel immunization
 * programs, recurring reassuring screening, and a self-funded continuous-glucose-monitor experiment
 * run against an entirely normal A1c — engagement that runs ahead of what the system asks for.
 *
 * STRUCTURAL RULE: this app imports ONLY ./viewmodel.json.
 * Nothing raw can reach the screen — there is no dataset/extract import. Every value in the view model
 * is already display-clean. Every ⌖ cite opens a clean drawer onto viewmodel.evidence[id] (a verbatim
 * note/message quote with date+author, or a readable statement of a structured fact) — never a row.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { create } from "zustand";
import vm from "./viewmodel.json";
import "./page.css";

// ------------------------------------------------------------------ evidence drawer (cite ⌖)
type EvEntry = { kind: "note" | "message" | "fact"; who?: string; date?: string; quote?: string; text?: string };
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

const EV_TAG: Record<string, string> = { note: "Note quote", message: "Portal message", fact: "Record" };
function EvidenceBlock({ id }: { id: string }) {
  const e = EVIDENCE[id];
  if (!e) return <div className="src-block"><div className="src-statement">Evidence not found: {id}</div></div>;
  const provenance = [e.who, e.date].filter(Boolean).join(" · ");
  const quoted = e.kind === "note" || e.kind === "message";
  return (
    <div className="src-block">
      <div className="src-head">
        <span className={`src-tag ${e.kind}`}>{EV_TAG[e.kind] ?? "Record"}</span>
        {provenance && <span>{provenance}</span>}
      </div>
      {quoted ? (
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
            Quotes are verbatim note and patient-portal text captured during the prevention synthesis pass;
            statements summarise structured facts from the normalised record. Nothing here is a raw export row.
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

/** "Sep 25, 2022" -> "Sep 25 ’22" (robust; operates only on the already-clean display date). */
const shortDate = (d: string) => {
  const m = d.match(/^([A-Za-z]+ \d{1,2}),? (\d{4})$/);
  return m ? `${m[1]} ’${m[2].slice(-2)}` : d;
};
/** "Sep 25, 2022" -> "Sep ’22" (month + 2-digit year, for tight axes). */
const monthYear = (d: string) => {
  const m = d.match(/^([A-Za-z]+) \d{1,2},? (\d{4})$/);
  return m ? `${m[1]} ’${m[2].slice(-2)}` : d;
};

// ================================================================== shared scale helpers (engagement timeline)
const T0 = +new Date("2017-01-01");
const T1 = +new Date("2026-12-31");
const yearTicks = (() => { const a: number[] = []; for (let y = 2017; y <= 2026; y++) a.push(y); return a; })();

// lane colors keyed to the CSS palette
const LANE_COLOR: Record<string, string> = {
  Influenza: "#1d4ed8", "COVID-19": "#0e7490", "Travel cluster": "#b45309",
  "Self-tracking": "#7c3aed", Screening: "#475569",
};

// ================================================================== CENTERPIECE — prevention engagement timeline
/**
 * Every prevention act this patient took across eight years, on one axis, in five lanes:
 *   Immunizations split into Influenza / COVID-19 / Travel programs (self-reported doses ringed),
 *   a Self-tracking lane carrying the CGM monitoring window + glucose draws,
 *   a Screening lane carrying every PHQ-2 + A1c, and the forward immunization forecast as open markers.
 * This is the view a clinician reasons with: the cadence, the parallel programs, the one CGM episode,
 * and the fact that the forecast simply projects the same posture forward.
 */
function EngagementTimeline() {
  const imm = vm.immunizations as any[];
  const selfDates = new Set((vm.selfReported as any).doses.map((d: any) => d.date_iso));
  const a1c = vm.a1c as any[];
  const phq2 = (vm.screening as any).phq2.series as any[];
  const cgm = vm.cgmOrders as any[];
  const forecast = vm.forecast as any[];

  const W = 980, M = { t: 30, r: 18, b: 30, l: 124 };
  const LANES = ["Influenza", "COVID-19", "Travel cluster", "Self-tracking", "Screening"];
  const laneH = 50;
  const iw = W - M.l - M.r, ih = LANES.length * laneH;
  const H = M.t + M.b + ih;
  const x = (iso: string) => M.l + ((+new Date(iso) - T0) / (T1 - T0)) * iw;
  const laneY = (name: string) => M.t + LANES.indexOf(name) * laneH + laneH / 2;

  // CGM monitoring window: first order through ~5 months of the refill (4 sensors × 2 wk ≈ 8 wk from May order)
  const cgmStart = "2024-03-12", cgmEnd = "2024-09-07";

  const immByLane = (lane: string) => imm.filter((d) => d.lane === lane);

  return (
    <div className="engage-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="engage-svg" role="img" aria-label="Prevention engagement timeline, 2017–2026">
        {/* year grid */}
        {yearTicks.map((y) => {
          const xx = x(`${y}-01-01`);
          return (
            <g key={y}>
              <line x1={xx} x2={xx} y1={M.t - 8} y2={M.t + ih} stroke="#eef0f2" />
              <text x={xx} y={M.t - 14} fontSize={11} fill="#9aa0a6" textAnchor="middle">{y}</text>
            </g>
          );
        })}
        {/* 2020 flu-gap shading */}
        <rect x={x("2020-01-01")} y={M.t - 8} width={x("2021-01-01") - x("2020-01-01")} height={ih} fill="#fbeaea" opacity={0.55} />
        <text x={(x("2020-01-01") + x("2021-01-01")) / 2} y={M.t + ih + 22} fontSize={10} fill="#b04a4a" textAnchor="middle">2020 flu gap</text>
        {/* forecast region shading */}
        <rect x={x("2026-01-01")} y={M.t - 8} width={x("2026-12-31") - x("2026-01-01")} height={ih} fill="#f4f1fb" opacity={0.7} />
        <text x={(x("2026-01-01") + x("2026-12-31")) / 2} y={M.t + ih + 22} fontSize={10} fill="#7c6aa8" textAnchor="middle">forecast</text>

        {/* lanes */}
        {LANES.map((lane) => {
          const cy = laneY(lane);
          const color = LANE_COLOR[lane];
          return (
            <g key={lane}>
              <text x={M.l - 12} y={cy - 4} fontSize={12} fontWeight={700} fill={color} textAnchor="end">{lane}</text>
              <line x1={M.l} x2={M.l + iw} y1={cy} y2={cy} stroke="#e6e8eb" />
            </g>
          );
        })}

        {/* immunization dots, per program lane */}
        {["Influenza", "COVID-19", "Travel cluster"].map((lane) => {
          const cy = laneY(lane);
          const color = LANE_COLOR[lane];
          return immByLane(lane).map((d, i) => {
            const cx = x(d.date_iso);
            const self = selfDates.has(d.date_iso);
            return (
              <g key={`${lane}-${i}-${d.date_iso}`}>
                <title>{d.date} — {d.vaccine}{self ? " (self-reported)" : ""}</title>
                <circle cx={cx} cy={cy} r={6} fill={self ? "#fff" : color} stroke={color} strokeWidth={self ? 2.4 : 1.4} />
                {self && <circle cx={cx} cy={cy} r={2.2} fill={color} />}
              </g>
            );
          });
        })}
        {/* lane count labels */}
        {["Influenza", "COVID-19", "Travel cluster"].map((lane) => (
          <text key={`c-${lane}`} x={M.l - 12} y={laneY(lane) + 12} fontSize={10.5} fill="#9aa0a6" textAnchor="end">
            {immByLane(lane).length} dose{immByLane(lane).length === 1 ? "" : "s"}
          </text>
        ))}

        {/* Self-tracking lane: CGM monitoring window bar + glucose draws */}
        {(() => {
          const cy = laneY("Self-tracking");
          const color = LANE_COLOR["Self-tracking"];
          const x0 = x(cgmStart), x1 = x(cgmEnd);
          return (
            <g>
              <rect x={x0} y={cy - 7} width={Math.max(6, x1 - x0)} height={14} rx={7} fill={color} opacity={0.78}>
                <title>FreeStyle Libre 3 monitoring window — Mar–Sep 2024 (orders + refill)</title>
              </rect>
              {cgm.map((o, i) => (
                <g key={`cgm-${i}`}>
                  <title>{o.date} — {o.item} ordered</title>
                  <line x1={x(o.date_iso)} x2={x(o.date_iso)} y1={cy - 11} y2={cy + 11} stroke={color} strokeWidth={2} />
                </g>
              ))}
              <text x={(x0 + x1) / 2} y={cy - 13} fontSize={9.5} fill={color} textAnchor="middle" fontWeight={700}>CGM worn</text>
            </g>
          );
        })()}

        {/* Screening lane: PHQ-2 (small) + A1c (labeled) */}
        {(() => {
          const cy = laneY("Screening");
          const color = LANE_COLOR.Screening;
          return (
            <g>
              {phq2.map((p, i) => (
                <g key={`phq-${i}`}>
                  <title>{p.date} — PHQ-2 total {p.total} (negative)</title>
                  <rect x={x(p.date_iso) - 3} y={cy - 3} width={6} height={6} fill={p.total > 0 ? "#b8860b" : color} opacity={0.85} />
                </g>
              ))}
              {a1c.map((a, i) => (
                <g key={`a1c-${i}`}>
                  <title>{a.date} — HbA1c {a.value}% (normal)</title>
                  <circle cx={x(a.date_iso)} cy={cy} r={6} fill="#fff" stroke={color} strokeWidth={2} />
                  <text x={x(a.date_iso)} y={cy - 11} fontSize={9.5} fill={color} textAnchor="middle" fontWeight={700}>A1c {a.value}%</text>
                </g>
              ))}
            </g>
          );
        })()}

        {/* forecast markers on the immunization lanes */}
        {forecast.map((f, i) => {
          const lane = f.vaccine === "Influenza" ? "Influenza" : "COVID-19";
          const cy = laneY(lane);
          const color = LANE_COLOR[lane];
          return (
            <g key={`fc-${i}`}>
              <title>{f.vaccine} next due {f.dueDate}</title>
              <circle cx={x(f.dueDate_iso)} cy={cy} r={6} fill="#fff" stroke={color} strokeWidth={1.6} strokeDasharray="2.5 2" />
            </g>
          );
        })}
      </svg>

      <div className="engage-legend">
        <span className="elg-title">Programs</span>
        {["Influenza", "COVID-19", "Travel cluster"].map((l) => (
          <span key={l} className="elg"><i className="elg-dot" style={{ background: LANE_COLOR[l] }} /> {l}</span>
        ))}
        <span className="elg"><i className="elg-ring" /> self-reported dose</span>
        <span className="elg"><i className="elg-ring" style={{ borderStyle: "dashed", borderColor: "#1d4ed8" }} /> forecast (next due)</span>
        <span className="elg"><i className="elg-band" style={{ background: LANE_COLOR["Self-tracking"] }} /> CGM worn</span>
      </div>
    </div>
  );
}

// ================================================================== Influenza — 8-of-9 season strip
function FluSeasonStrip() {
  const prog = vm.influenzaProgram as any;
  const covered = new Set<number>(prog.yearsCovered);
  const dateByYear: Record<number, string> = {};
  (prog.doses as any[]).forEach((d) => { dateByYear[Number(d.date_iso.slice(0, 4))] = d.date; });
  const seasons = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
  return (
    <div className="flu-strip">
      {seasons.map((y) => {
        const on = covered.has(y);
        return (
          <div key={y} className={`flu-cell ${on ? "on" : "off"}`}>
            <div className="flu-year">{y}</div>
            <div className="flu-mark">{on ? "✓" : "—"}</div>
            <div className="flu-date">{on ? monthYear(dateByYear[y]) : "no dose"}</div>
          </div>
        );
      })}
    </div>
  );
}

// ================================================================== COVID dose ladder
const COVID_BRAND_COLOR: Record<string, string> = { Moderna: "#7c3aed", "Pfizer bivalent": "#0369a1", "Pfizer Comirnaty": "#0369a1" };
function CovidLadder() {
  const series = vm.covidSeries as any;
  const selfDates = new Set((vm.selfReported as any).doses.map((d: any) => d.date_iso));
  return (
    <div className="covid-ladder">
      {(series.doses as any[]).map((d) => {
        const color = COVID_BRAND_COLOR[d.product] ?? "#6b7075";
        const self = selfDates.has(d.date_iso);
        return (
          <div key={d.doseNumber} className="covid-dose">
            <div className="covid-num" style={{ background: color }}>{d.doseNumber}</div>
            <div className="covid-date">{shortDate(d.date)}</div>
            <div className="covid-brand">{d.product}</div>
            {self ? <span className="covid-self">self-reported</span> : null}
          </div>
        );
      })}
    </div>
  );
}

// ================================================================== Travel — recommendation → action mapping
function TravelView() {
  const t = vm.travelCluster as any;
  const recommended: string[] = t.pharmacistRecommended;
  // each administered dose: was it on the pharmacist's firm list, or routine add-on?
  const recItems = (t.doses as any[]).map((d) => {
    const base = d.vaccine.replace(/ \(.*\)/, "");
    const firm = recommended.some((r) => base.toLowerCase().includes(r.toLowerCase()) || r.toLowerCase().includes(base.toLowerCase()));
    return {
      vax: d.vaccine,
      basis: firm ? "Pharmacist-recommended (CDC guidance for India)" : "Routine adult coverage (added)",
      firm,
    };
  });
  return (
    <div className="travel-map">
      <div className="travel-trip">
        <span><b>Trip:</b> {t.destination}</span>
        <span className="tt-dim">{t.travelDates}</span>
        <span className="tt-dim">consult {t.consultDate} · shots {t.date}</span>
        <Cite ids="e_travel_destination" label="Travel destination & dates" />
      </div>
      <div className="travel-recs">
        {recItems.map((r, i) => (
          <div key={i} className={`travel-rec ${r.firm ? "given" : "advised"}`}>
            <div className="tr-vax">{r.vax}<span className={`tr-status ${r.firm ? "given" : "advised"}`}>administered</span></div>
            <div className="tr-sub">{r.basis}</div>
          </div>
        ))}
      </div>
      <table className="grid mini">
        <thead><tr><th>Pharmacist also advised (non-vaccine)</th><th></th></tr></thead>
        <tbody>
          {(t.alsoAdvised as string[]).map((a, i) => (
            <tr key={i}><td>{a}</td><td className="dim num">{i === 0 ? <Cite ids="e_travel_rph" label="Pharmacist recommendations" /> : ""}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="fig-note">
        The two administered shots that mattered — <b>Hepatitis A</b> and <b>Typhoid</b> — match the pharmacist's two
        firm immunization recommendations exactly; the Tdap was a routine adult booster added the same day. A physician
        signed the triage off four days later.<Cite ids={["e_travel_rph", "e_travel_signoff", "e_travel_doses"]} label="Recommendation, sign-off, and doses" />
      </p>
    </div>
  );
}

// ================================================================== PHQ-2 negative-screen plot
function Phq2View() {
  const phq2 = (vm.screening as any).phq2;
  const series: any[] = phq2.series;
  const max = 6, thresh = phq2.positiveThreshold; // 0–6 scale, positive ≥ 3
  return (
    <div>
      <div className="phq2-rows">
        {series.map((r) => (
          <div key={r.date_iso} className="phq2-row">
            <div className="phq2-date">{shortDate(r.date)}</div>
            <div className="phq2-track">
              <div className="phq2-band-neg" style={{ width: `${(thresh / max) * 100}%` }} />
              <div className="phq2-thresh" style={{ left: `${(thresh / max) * 100}%` }} />
              <div className={`phq2-fill ${r.total > 0 ? "warm" : ""}`} style={{ width: `${(Math.max(r.total, 0.18) / max) * 100}%` }} />
            </div>
            <div className="phq2-score">{r.total}<span className="neg">negative</span></div>
          </div>
        ))}
      </div>
      <p className="fig-note">
        Seven PHQ-2 depression screens, Aug 2022 – Dec 2025. Green band is the negative zone; the dashed line is the
        positive threshold of {thresh}. Every screen sits below it — six totaled 0; the single amber bar (Jul 2024)
        is a 1 on the "feeling down" item.<Cite ids="e_phq2" label="PHQ-2 series" />
      </p>
    </div>
  );
}

// ================================================================== A1c trend vs reference + glucose-gap card
function A1cTrend({ rows }: { rows: any[] }) {
  const W = 520, H = 196, M = { t: 18, r: 20, b: 26, l: 38 };
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  const refLo = rows[0].refLow, refHi = rows[0].refHigh;
  const lo = Math.min(refLo, ...rows.map((r) => r.value)) - 0.4;
  const hi = Math.max(refHi, ...rows.map((r) => r.value)) + 0.4;
  const t0 = +new Date(rows[0].date_iso), t1 = +new Date(rows[rows.length - 1].date_iso);
  const x = (iso: string) => M.l + (rows.length === 1 ? iw / 2 : ((+new Date(iso) - t0) / (t1 - t0)) * iw);
  const y = (v: number) => M.t + ih - ((v - lo) / (hi - lo)) * ih;
  const path = rows.map((r, i) => `${i ? "L" : "M"} ${x(r.date_iso)} ${y(r.value)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="HbA1c trend against reference range">
      {/* reference band */}
      <rect x={M.l} y={y(refHi)} width={iw} height={y(refLo) - y(refHi)} fill="#eaf6ee" />
      <text x={M.l + iw + 4} y={y(refHi) + 4} fontSize={10} fill="#6b7075">{refHi}</text>
      <text x={M.l + iw + 4} y={y(refLo) + 4} fontSize={10} fill="#6b7075">{refLo}</text>
      <text x={M.l + 4} y={y(refHi) - 5} fontSize={10} fill="#1a7f43">normal 4.0–6.0%</text>
      <path d={path} fill="none" stroke="#475569" strokeWidth={2} />
      {rows.map((r, i) => (
        <g key={i}>
          <circle cx={x(r.date_iso)} cy={y(r.value)} r={5} fill="#475569" stroke="#fff" strokeWidth={1.4} />
          <text x={x(r.date_iso)} y={y(r.value) - 11} fontSize={12} fontWeight={700} fill="#1a1d21" textAnchor="middle">{r.value}%</text>
          <text x={x(r.date_iso)} y={M.t + ih + 18} fontSize={10} fill="#9aa0a6" textAnchor="middle">{monthYear(r.date)}</text>
        </g>
      ))}
    </svg>
  );
}

function MetabolicView() {
  const a1c = vm.a1c as any[];
  const orders = vm.cgmOrders as any[];
  return (
    <div>
      <div className="metab-row">
        <div>
          <A1cTrend rows={a1c} />
          <p className="fig-note">
            Both HbA1c values — {a1c.map((a) => `${a.value}%`).join(" then ")} — sit mid-band in the normal range. The
            2023 draw was explicitly ordered to screen for diabetes; the 2025 draw under preventive care. Neither is
            diabetic or prediabetic.<Cite ids="e_a1c" label="HbA1c values" />
          </p>
        </div>
        <div className="metab-side">
          <div className="metab-fact">
            <div className="metab-fact-label">Point glucose (only values in record)</div>
            <div className="metab-fact-val">97 → 90 mg/dL</div>
            <div className="metab-fact-note">Two single draws (Aug 2022, Dec 2025), both normal.<Cite ids="e_no_glucose_series" label="Glucose values present" /></div>
          </div>
          <div className="gap-card">
            <span className="gc-tag">the data gap</span>
            <div className="gc-note">
              The CGM generated months of day-by-day glucose curves — the entire point of the experiment — but they live in
              the Abbott phone app, not the EHR. <b>Zero</b> continuous traces are in this export.<Cite ids="e_no_glucose_series" label="No CGM data in export" />
            </div>
          </div>
        </div>
      </div>

      <h4 className="subhead">The self-funded order trail</h4>
      <div className="cgm-orders">
        {orders.map((o, i) => (
          <div key={i} className="cgm-order">
            <div className="cgm-date">{o.date}</div>
            <div>
              <div className="cgm-item">{o.item}</div>
              <div className="cgm-detail">
                {o.quantity} · {o.refills === "0" ? "no refills" : `${o.refills} refills`} · <span className="cgm-sig">{o.sig}</span> · ordered by {o.orderingProvider}
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="fig-note">
        Three FreeStyle Libre 3 orders under PCP Zoe Rammelkamp — sensor + reader to start, then a four-sensor, four-refill
        script extending the monitoring across the summer. A phone note records the financial reality: "He knows he will pay
        out of pocket."<Cite ids={["e_cgm_orders", "e_cgm_outofpocket"]} label="CGM orders and out-of-pocket note" />
      </p>
    </div>
  );
}

// ================================================================== Screening dashboard
function ScreeningTable() {
  const topics = (vm.screening as any).topics as any[];
  return (
    <table className="grid">
      <thead><tr><th>Health-maintenance topic</th><th>Status</th><th>Last completed</th><th>Next due</th><th></th></tr></thead>
      <tbody>
        {topics.map((t, i) => {
          const ok = /Completed|Not Due/.test(t.status);
          return (
            <tr key={i}>
              <td>{t.topic}</td>
              <td><span className={`hm-pill ${ok ? "" : "due"}`}>{t.status}</span></td>
              <td className="nowrap">{t.lastCompleted || "—"}</td>
              <td className="nowrap">{t.nextDue || "satisfied"}</td>
              <td className="num">{i === 0 ? <Cite ids="e_screening_dash" label="Health-maintenance status" /> : ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ================================================================== program board (header)
const PROGRAMS = [
  { name: "Immunizations", color: "#475569", count: "18 doses", line: "three parallel programs over 8 years (2017–2025); forecast already projecting the next flu and COVID boosters into Aug 2026", to: "#immunizations" },
  { name: "Influenza", color: "var(--flu)", count: "8 / 9", line: "an annual flu shot in 8 of 9 seasons; the lone gap is the 2020 pandemic winter", to: "#immunizations" },
  { name: "COVID-19", color: "var(--covid)", count: "7 doses", line: "a complete, maintained series Moderna → Pfizer; 4 doses self-entered into his own chart", to: "#immunizations" },
  { name: "Travel cluster", color: "var(--travel)", count: "3 in 1 day", line: "Tdap, Typhoid, Hepatitis A ahead of a 2019 India trip — matching a pharmacist's CDC-based recommendations", to: "#travel" },
  { name: "Screening", color: "var(--screen)", count: "all clear", line: "7 negative PHQ-2 screens; HbA1c 5.4–5.5% (normal); diabetes / cholesterol / wellness panel current", to: "#screening" },
  { name: "Self-tracking (CGM)", color: "var(--self)", count: "self-funded", line: "a non-diabetic asked for and paid for a continuous glucose monitor to study his own food response — and lost 5 lb", to: "#cgm" },
];

// ================================================================== App
function App() {
  const order = ["immunizations", "travel", "screening", "cgm", "assessment"];
  const titleOf = (id: string) => sectionById[id]?.title ?? id;
  const proseOf = (id: string) => sectionById[id]?.narrative ?? [];
  let n = 0;
  return (
    <div className="page">
      <SourceDrawer />
      <header className="page-head">
        <div className="ph-eyebrow">Prevention &amp; self-tracking · deep dive</div>
        <h1>MANDEL, JOSHUA C</h1>
        <div className="ph-demo">Male · age 43 · primary prevention · no diabetes, no established disease in this thread</div>
        <p className="ph-headline">{(vm as any).summary}</p>

        <div className="prog-board">
          <table className="prog-table">
            <tbody>
              {PROGRAMS.map((p) => (
                <tr key={p.name} className="prog-row" style={{ borderLeftColor: p.color }}>
                  <td className="pr-program">
                    <a href={p.to}><span className="pr-dot" style={{ background: p.color }} />{p.name}</a>
                  </td>
                  <td className="pr-line"><span className="pr-count">{p.count}</span> — {p.line}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </header>

      {/* Centerpiece sits right after the header — the whole prevention record on one axis. */}
      <section className="section" id="overview">
        <h2><span className="sec-n">1</span>Eight years of prevention, on one axis</h2>
        <div className="prose">
          <p>
            Every prevention act in this record — every immunization, every screen, the one continuous-glucose-monitor
            episode, and the forward forecast — placed on a single timeline and separated into the programs a clinician
            reasons about. Read across, the cadence is the point: a steady annual influenza beat, a COVID-19 series that
            never lapses, a tight 2019 travel cluster, recurring negative screening, and a single self-directed CGM window
            in 2024 against an entirely normal A1c.
          </p>
        </div>
        <EngagementTimeline />
        <p className="fig-note">
          Filled dots are administered immunizations; hollow rings on the immunization lanes are self-reported doses (left)
          or the forecast's next-due projections (dashed). The violet bar is the CGM monitoring window with each order
          marked; the screening lane carries every PHQ-2 (squares) and HbA1c draw. Hover any marker for its exact date and
          detail.<Cite ids={["e_imm_count", "e_flu_program", "e_covid_series", "e_forecast"]} label="Immunization program, flu cadence, COVID series, forecast" />
        </p>
      </section>

      {order.map((id) => {
        n += 2; // section 1 is the centerpiece; numbered sections continue from 2
        if (id === "assessment") {
          return (
            <SectionShell key={id} id={id} n={n - 1} title={titleOf("assessment")}>
              <Prose paras={proseOf("assessment")} />
              <div className="assess-cross">
                <b>Cross-reference.</b> The same proactive posture appears, more pointedly, in this patient's cardiovascular
                record — where Stage-1 blood pressure and a falling HDL drift untreated. The prevention machinery he engages
                so willingly for vaccines, screening, and self-tracking never closed the loop on his modifiable cardiac risk.
                High engagement does not guarantee every preventable risk gets acted on.
              </div>
            </SectionShell>
          );
        }
        return (
          <SectionShell key={id} id={id} n={n - 1} title={titleOf(id)}>
            <Prose paras={proseOf(id)} />
            {id === "immunizations" && (
              <>
                <h4 className="subhead">Influenza — the metronome (8 of 9 seasons)</h4>
                <FluSeasonStrip />
                <p className="fig-note">
                  One cell per fall season, 2017–2025. Eight covered (blue), one gap (2020, amber). The immunization engine
                  never flags the gap as a lapse — it simply forecasts the next dose forward.<Cite ids="e_flu_program" label="Influenza program" />
                </p>
                <h4 className="subhead">COVID-19 — a complete, partly self-logged series</h4>
                <CovidLadder />
                <p className="fig-note">
                  Seven administrations in order, colored by manufacturer (violet Moderna, blue Pfizer). The four tagged
                  "self-reported" were entered by the patient into his own chart rather than given in this clinic — an early,
                  concrete signal of a self-documenting health consumer.<Cite ids={["e_covid_series", "e_self_reported"]} label="COVID series and self-reported flag" />
                </p>
              </>
            )}
            {id === "travel" && <TravelView />}
            {id === "screening" && (
              <>
                <Phq2View />
                <h4 className="subhead">Health-maintenance dashboard</h4>
                <ScreeningTable />
                <p className="fig-note">
                  The chart's health-maintenance engine carries the routine preventive panel as satisfied and not-due, last
                  completed Dec 4, 2025 — diabetes, cholesterol, wellness, and a one-time hepatitis C screen all current.<Cite ids="e_screening_dash" label="Health-maintenance status" />
                </p>
              </>
            )}
            {id === "cgm" && <MetabolicView />}
          </SectionShell>
        );
      })}

      <footer className="page-foot">
        Built over a single display-clean view model assembled from the prevention synthesis and the complete normalised
        record. Every figure is carried pre-computed; every ⌖ traces a claim to a verbatim note or portal-message quote, or a
        readable statement of the record. Single-export, single-specimen view.
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
