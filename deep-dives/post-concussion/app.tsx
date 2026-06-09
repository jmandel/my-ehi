/**
 * Post-concussion syndrome — MANDEL, JOSHUA C.  The bespoke tool a neurologist would want to
 * fully understand a five-year head-injury course: a normal scan that the symptoms outlasted,
 * one well-chosen medication titrated against a documented response, and a specialist evaluation
 * that left this record entirely.
 *
 * STRUCTURAL RULE: this app imports ONLY ./viewmodel.json. Nothing
 * raw can reach the screen — there is no dataset/analysis import. Every value in the view model is
 * already display-clean. Every ⌖ cite opens a clean drawer onto viewmodel.evidence[id] (a verbatim
 * note quote with date+author, or a readable statement of a structured fact) — never a row.
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
            Quotes are the curated verbatim record captured during the post-concussion synthesis pass; statements
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

// ================================================================== CENTERPIECE: the dual-track course chart
// A neurologist reading this case reasons over two tracks at once: the discrete arc of events
// (two injuries, a normal scan, the diagnosis, referrals, the relocation, the taper) and the
// continuous nortriptyline dose held against them. This bespoke view draws both on one time axis
// so the cause-and-effect is legible: the drug thread *begins* at the second injury, the dose
// climbs *as* the response is documented, and the whole on-drug band sits beneath the flat,
// persistent reality of a normal scan. The dose track is a step (each dose held until the next
// order changes it); events are marked on a rail above it and drill to their evidence.

const ARC = vm.arc as any[];
const DOSE_SEGMENTS = (vm.medCourse as any).doseSegments as any[];

const KIND_COLOR: Record<string, string> = {
  injury: "#c1121f", imaging: "#0e7490", diagnosis: "#7c3aed", therapy: "#b45309",
  medication: "#4338ca", response: "#1a7f43", care: "#b45309", resolution: "#4338ca",
};
const KIND_LABEL: Record<string, string> = {
  injury: "Head injury", imaging: "Imaging", diagnosis: "Diagnosis", therapy: "Therapy",
  medication: "Medication", response: "Response", care: "Specialty care", resolution: "Resolution",
};

const ms = (iso: string) => +new Date(iso + "T00:00:00");

function CourseChart() {
  const W = 980;
  const Mh = { r: 16, l: 50 };          // horizontal margins (independent of the event rail height)
  const iw = W - Mh.l - Mh.r;
  const PLOT_H = 320, B = 40;            // plot body + bottom axis

  // time domain: a quarter before the index injury → a quarter after the taper
  const t0 = ms("2020-04-01"), t1 = ms("2026-03-01");
  const x = (iso: string) => ((ms(iso) - t0) / (t1 - t0)) * iw;
  const doseMax = 35;
  const ih = PLOT_H;
  const y = (mg: number) => ih - (mg / doseMax) * ih;

  // dose step path + on-drug area, built from the projected dose segments
  const onDrug = DOSE_SEGMENTS.filter((s) => s.doseMg > 0);
  const stepPts: [number, number][] = [];
  onDrug.forEach((s) => {
    stepPts.push([x(s.fromIso), y(s.doseMg)]);
    stepPts.push([x(s.toIso), y(s.doseMg)]);
  });
  // drop to zero at the taper (end of last on-drug segment)
  const lastOn = onDrug[onDrug.length - 1];
  if (lastOn) stepPts.push([x(lastOn.toIso), y(0)]);
  const stepLine = stepPts.map((p, i) => `${i ? "L" : "M"} ${p[0]} ${p[1]}`).join(" ");
  const areaPath =
    `M ${x(onDrug[0].fromIso)} ${y(0)} ` +
    onDrug.map((s) => `L ${x(s.fromIso)} ${y(s.doseMg)} L ${x(s.toIso)} ${y(s.doseMg)}`).join(" ") +
    ` L ${x(lastOn.toIso)} ${y(0)} Z`;

  // years
  const years = [2020, 2021, 2022, 2023, 2024, 2025, 2026];

  // ---- event rail: pack labels into stacked rows so none ever overlap ----
  // Each event gets a short headline; we estimate its pixel width from char count and
  // greedily assign it to the first row whose previous label has cleared, expanding the
  // label's anchor leftward when it would run off the right edge.
  const SHORT: Record<string, string> = {
    "Index head injury": "Index head injury",
    "Brain MRI — normal": "Brain MRI — normal",
    "Post-concussion syndrome diagnosed": "PCS diagnosed",
    "Occupational & vision therapy": "OT & vision therapy",
    "Second head injury (snorkeling)": "2nd injury (snorkeling)",
    "Nortriptyline started · Neurology referred": "Nortriptyline started · Neuro referred",
    "Early response documented": "Early response: better in a week",
    "Neurology care relocated to Massachusetts": "Neuro care → Massachusetts",
    "Maintained at 30 mg": "Maintained at 30 mg",
    "Tapered off — therapy completed": "Tapered off — completed",
  };
  const CHAR_W = 5.6; // ~px per char at 10.5px font
  const events = ARC.map((e) => {
    const head = SHORT[e.title] ?? e.title;
    const w = Math.max(e.date.length, head.length) * CHAR_W + 10;
    return { ...e, head, cx: x(e.dateIso), color: KIND_COLOR[e.kind] ?? "#565d67", w };
  }).sort((a, b) => a.cx - b.cx);

  const GAP = 8;
  const rowRightEdge: number[] = []; // last occupied x per row
  const placed = events.map((e) => {
    // anchor the label at the dot, but clamp so it never overflows the plot's right edge
    const anchorX = Math.min(e.cx, iw - e.w + 4);
    let row = 0;
    while (row < rowRightEdge.length && anchorX < rowRightEdge[row] + GAP) row++;
    if (row === rowRightEdge.length) rowRightEdge.push(-Infinity);
    rowRightEdge[row] = anchorX + e.w;
    return { ...e, row, anchorX };
  });
  const nRows = rowRightEdge.length;
  const ROW_H = 32;
  const railTop = 12;                          // y of the first (topmost) label row
  const railDotY = railTop + nRows * ROW_H + 4; // single dot rail, just below the lowest label row
  const Mt = railDotY + 14;                    // plot top
  const H = Mt + PLOT_H + B;                   // total svg height grows with the rail

  const doseTicks = [0, 10, 20, 30];

  return (
    <div className="course-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="course-svg" role="img" aria-label="Post-concussion course: events and nortriptyline dose over time">
        {/* ---- event rail (above the plot): leader from each dot up to a packed, non-overlapping label ---- */}
        <g transform={`translate(${Mh.l},0)`}>
          {/* the dot rail */}
          <line x1={0} x2={iw} y1={railDotY} y2={railDotY} stroke="#eef0f3" />
          {placed.map((e, i) => {
            const labTopY = railTop + e.row * ROW_H;     // top text baseline of this label
            const labBotY = labTopY + 13;
            return (
              <g key={i}>
                {/* leader: dot → up to the label block (kinked so a clamped label still connects) */}
                <path
                  d={`M ${e.cx} ${railDotY} L ${e.cx} ${labBotY + 5} L ${e.anchorX + 4} ${labBotY + 5}`}
                  fill="none" stroke={e.color} strokeWidth={1} opacity={0.4}
                />
                <circle cx={e.cx} cy={railDotY} r={4} fill={e.color} stroke="#fff" strokeWidth={1.5} />
                <text x={e.anchorX} y={labTopY} fontSize={11} fontWeight={700} fill={e.color}>{e.date}</text>
                <text x={e.anchorX} y={labBotY} fontSize={10.5} fill="#3a3f45">{e.head}</text>
              </g>
            );
          })}
        </g>

        {/* ---- plot area ---- */}
        <g transform={`translate(${Mh.l},${Mt})`}>
          {/* the "normal scan" persistent baseline — a slate band across the whole arc */}
          <line x1={0} x2={iw} y1={y(0)} y2={y(0)} stroke="#cdd1d8" strokeWidth={1} />
          {/* dose gridlines */}
          {doseTicks.map((t) => (
            <g key={t}>
              <line x1={0} x2={iw} y1={y(t)} y2={y(t)} stroke="#eef0f3" />
              <text x={-10} y={y(t) + 4} fontSize={11} fill="#9aa0a6" textAnchor="end">{t}</text>
            </g>
          ))}
          <text x={-Mh.l + 4} y={-7} fontSize={11} fontWeight={600} fill="#4338ca">mg nightly</text>

          {/* year ticks */}
          {years.map((yr) => {
            const xi = x(`${yr}-01-01`);
            if (xi < 0 || xi > iw) return null;
            return (
              <g key={yr}>
                <line x1={xi} x2={xi} y1={0} y2={ih} stroke="#f4f5f7" />
                <text x={xi} y={ih + 20} fontSize={11} fill="#9aa0a6" textAnchor="middle">{yr}</text>
              </g>
            );
          })}

          {/* a faint marker of the normal MRI date, well before any drug */}
          {(() => {
            const mri = ARC.find((e) => e.kind === "imaging");
            if (!mri) return null;
            const xi = x(mri.dateIso);
            return (
              <g>
                <line x1={xi} x2={xi} y1={0} y2={ih} stroke="#0e7490" strokeWidth={1} strokeDasharray="3 4" opacity={0.5} />
                <text x={xi + 5} y={14} fontSize={10} fill="#0e7490">normal MRI — symptoms persist</text>
              </g>
            );
          })()}

          {/* on-drug shaded band + dose step */}
          <path d={areaPath} fill="#4338ca" opacity={0.08} />
          <path d={stepLine} fill="none" stroke="#4338ca" strokeWidth={2.5} strokeLinejoin="round" />

          {/* dose labels at each plateau */}
          {onDrug.map((s, i) => {
            const xc = (x(s.fromIso) + x(s.toIso)) / 2;
            return (
              <text key={i} x={xc} y={y(s.doseMg) - 8} fontSize={11.5} fontWeight={700} fill="#3730a3" textAnchor="middle">
                {s.doseMg} mg
              </text>
            );
          })}

          {/* small dots where the dose changes, to anchor the steps */}
          {onDrug.map((s, i) => (
            <circle key={i} cx={x(s.fromIso)} cy={y(s.doseMg)} r={3.5} fill="#4338ca" stroke="#fff" strokeWidth={1.2} />
          ))}
          {/* taper-to-zero terminus */}
          <circle cx={x(lastOn.toIso)} cy={y(0)} r={4.5} fill="#c1121f" stroke="#fff" strokeWidth={1.5} />
          <text x={x(lastOn.toIso)} y={y(0) - 9} fontSize={11} fontWeight={700} fill="#c1121f" textAnchor="end">off</text>
        </g>
      </svg>

      <div className="course-legend">
        <span className="cl-item"><span className="cl-line" /> nortriptyline dose (mg nightly, held until reordered)</span>
        <span className="cl-item"><span className="cl-sw" style={{ background: "#4338ca", opacity: 0.18 }} /> time on drug</span>
        {["injury", "imaging", "diagnosis", "care", "response"].map((k) => (
          <span key={k} className="cl-item"><span className="cl-sw" style={{ background: KIND_COLOR[k], borderRadius: "50%", width: 11, height: 11 }} /> {KIND_LABEL[k]}</span>
        ))}
      </div>
    </div>
  );
}

// ================================================================== MRI read card (the normal scan)
function ImagingView() {
  const img = vm.imaging as any;
  const r = img.read;
  return (
    <div>
      <div className="mri-card">
        <div className="mri-meta">
          <div className="mri-impression">{r.impression}</div>
          <div className="mri-sub">Brain MRI without contrast — the central fact of the case. Structural imaging is clean, so everything after it is a clinical, symptom-defined syndrome, not a visible lesion.</div>
          <dl>
            <dt>Performed</dt><dd>{r.performedOn}</dd>
            <dt>Read by</dt><dd>{r.radiologist}</dd>
            <dt>Facility</dt><dd>{r.facility}</dd>
          </dl>
        </div>
        <div className="mri-report">
          <div className="src-head" style={{ marginBottom: 8 }}>
            <span className="src-tag note">Radiology report</span>
            <span>{r.radiologist} · {r.performedOn}</span>
            <Cite ids={["q_negative_mri", "s_mri_read"]} label="MRI read — evidence" />
          </div>
          <pre>{r.reportText}</pre>
        </div>
      </div>

      <h4 className="subhead">The 2020 imaging workup — four orders, one final read</h4>
      <table className="grid mri-orders">
        <thead>
          <tr><th>Study</th><th>Ordered</th><th>Status</th><th>Radiology read</th></tr>
        </thead>
        <tbody>
          {img.orders.map((o: any, i: number) => (
            <tr key={i}>
              <td>{o.study}</td>
              <td className="nowrap">{o.orderedOn}</td>
              <td>{o.status}</td>
              <td>{o.finalRead ? <span className="status-pill ok dot">Final — Negative</span> : <span className="dim">no read</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fig-note">
        The acute work-up took the injury seriously — three brain MRIs and one head/brain CT ordered over two weeks —
        but only the July 31 MRI reached a final radiology read, and it was unambiguously normal.<Cite ids="s_imaging_burst" label="Imaging burst" />
      </p>
    </div>
  );
}

// ================================================================== referral split (fulfilled vs expired)
function ReferralView() {
  const ref = vm.referrals as any;
  const items: any[] = ref.items;
  const ot = items.filter((r) => r.referredTo === "Occupational Therapy");
  const neuro = items.filter((r) => r.referredTo === "Neurology");
  return (
    <div>
      <div className="ref-split">
        <div className="ref-col fulfilled">
          <div className="ref-col-head"><span className="status-pill ok dot">Fulfilled</span> Occupational therapy</div>
          <div className="ref-col-sub">Placed Feb 2022, delivered as two in-system visits, then discharged — the course that got him to the 90–95% plateau.</div>
          {ot.map((r, i) => (
            <div key={i} className="ref-item">
              <span className="ref-to">{r.referredTo}</span>
              <span className="ref-when">placed {r.placedOn}</span>
              <span className="ref-out">{r.outcome}<Cite ids={["s_ot_fulfilled", "q_recovery"]} label="OT referral — evidence" /></span>
            </div>
          ))}
          {ref.otVisits.map((v: any, i: number) => (
            <div key={`v${i}`} className="ref-item">
              <span className="ref-to" style={{ fontWeight: 400 }}>{v.department}</span>
              <span className="ref-when">{v.date}</span>
            </div>
          ))}
        </div>
        <div className="ref-col expired">
          <div className="ref-col-head"><span className="status-pill gap dot">Expired</span> Neurology</div>
          <div className="ref-col-sub">Three referrals placed in Dec 2022, all carrying the post-concussion diagnosis — every one auto-closed without an in-system visit.</div>
          {neuro.map((r, i) => (
            <div key={i} className="ref-item">
              <span className="ref-to">{r.referredTo}</span>
              <span className="ref-when">placed {r.placedOn}</span>
              <span className="ref-out">{r.outcome}<Cite ids="s_neuro_referrals" label="Neurology referrals — evidence" /></span>
            </div>
          ))}
          <div className="ref-item" style={{ borderTop: "1px solid var(--rule)" }}>
            <span className="ref-out" style={{ gridColumn: "1 / -1", color: "#2b2f34" }}>
              The Sept 2023 note explains where the care went: “seeing neurology in Massachusetts.”<Cite ids="q_massachusetts" label="Relocation — evidence" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ================================================================== medication response readout
function ResponseView() {
  return (
    <div className="resp-row">
      <div className="resp-quotes">
        <div className="resp-quote">
          <div className="rq-text">“Headaches are better compared to last November, but still not great.”</div>
          <div className="rq-meta">Dr. Zoe Rammelkamp · Mar 2, 2023<Cite ids="q_better" label="Early benefit — evidence" /></div>
        </div>
        <div className="resp-quote">
          <div className="rq-text">“Better within the first week of nortriptyline. No side effects from nortriptyline.”</div>
          <div className="rq-meta">Dr. Zoe Rammelkamp · Mar 2, 2023<Cite ids="q_first_week" label="First-week response — evidence" /></div>
        </div>
        <div className="resp-quote">
          <div className="rq-text">“Headaches are tolerable — no longer taking amitriptyline … was taking 30 mg … but has tapered off.”</div>
          <div className="rq-meta">Clinic note · Dec 4, 2025<Cite ids={["q_off", "q_taper"]} label="Taper — evidence" /></div>
        </div>
      </div>
      <div className="resp-facts">
        <div className="resp-fact">
          <div className="resp-fact-val">&lt; 1 week</div>
          <div className="resp-fact-label">to first benefit</div>
          <div className="resp-fact-note">Improvement located precisely in time — "within the first week" — a fast, clean response.<Cite ids="q_first_week" label="Onset of benefit" /></div>
        </div>
        <div className="resp-fact">
          <div className="resp-fact-val">None</div>
          <div className="resp-fact-label">side effects documented</div>
          <div className="resp-fact-note">Tolerability at every follow-up is exactly what justifies continuing and up-titrating.<Cite ids="q_first_week" label="Tolerability" /></div>
        </div>
        <div className="resp-fact">
          <div className="resp-fact-val">10 → 30 mg</div>
          <div className="resp-fact-label">dose climbed, then off</div>
          <div className="resp-fact-note">Up-titrated as it kept helping; tapered to zero with the order closed "Therapy completed."<Cite ids={["m_dose_steps", "m_therapy_completed"]} label="Dose course" /></div>
        </div>
      </div>
    </div>
  );
}

// ================================================================== medication order table
function MedOrderView() {
  const mc = vm.medCourse as any;
  return (
    <div>
      <table className="grid">
        <thead>
          <tr><th>#</th><th>Ordered</th><th>Dose</th><th className="num">Quantity</th><th>Change</th><th>Ended</th><th></th></tr>
        </thead>
        <tbody>
          {mc.orders.map((o: any) => (
            <tr key={o.seq}>
              <td className="dim">{o.seq}</td>
              <td className="nowrap">{o.orderedOn}</td>
              <td><b>{o.dose}</b></td>
              <td className="num">{o.quantity}</td>
              <td>{o.changeNote}</td>
              <td className="nowrap dim">{o.endedOn}{o.discontinueReason ? ` · ${o.discontinueReason}` : ""}</td>
              <td><Cite ids={o.seq === mc.orders.length ? ["m_chain", "m_therapy_completed"] : ["m_chain", "m_dose_steps"]} label={`Order ${o.seq} — evidence`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fig-note">
        One continuous therapy across {mc.orderCount} linked orders ({mc.spanDays} days, ~{mc.spanYears} years), reordered as the
        prescription ran out — the reorder gaps lengthening (81 → 305 → 402 days) as the dispensed quantity grew from 90 to 270 capsules.<Cite ids={["m_chain", "m_reorder_intervals"]} label="Reorder chain" />
      </p>
      <p className="open-flag">
        <span className="open-flag-tag">naming wrinkle</span>
        {mc.nameDiscrepancyNote}<Cite ids="m_name_discrepancy" label="Name discrepancy — evidence" />
      </p>
    </div>
  );
}

// ================================================================== dx-coding frequency bars
function CodingView() {
  const rows = vm.encounterDx as any[];
  const max = Math.max(...rows.map((r) => r.encounters));
  return (
    <div>
      <div className="dxbars">
        {rows.map((r, i) => {
          const dominant = r.encounters === max;
          return (
            <div key={i} className="dxbar-row">
              <div className="dxbar-head">
                <span className={`dxbar-name ${dominant ? "dominant" : ""}`}>{r.diagnosis}</span>
                <span className="dxbar-n">{r.encounters}{r.encounters === 1 ? " enc" : " encs"}</span>
              </div>
              <div className="dxbar-track">
                <div className={`dxbar-fill ${dominant ? "dominant" : ""}`} style={{ width: `${(r.encounters / max) * 100}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <p className="fig-note">
        Post-concussion syndrome is the dominant longitudinal diagnosis — coded on {max} distinct encounters across more than three years —
        sitting atop the earlier acute head-injury codes that cluster at the events that triggered them.<Cite ids={["s_dx_frequency", "s_problem_record"]} label="Coding frequency" />
      </p>
    </div>
  );
}

// ================================================================== header arc-at-a-glance
const BEAT_LINK: Record<string, string> = {
  injury: "#injury", imaging: "#injury", diagnosis: "#syndrome", therapy: "#care-relocation",
  medication: "#medication-course", response: "#medication-course", care: "#care-relocation", resolution: "#medication-course",
};

function ArcBoard() {
  const p = vm.problem as any;
  const mc = vm.medCourse as any;
  return (
    <div className="arc-board">
      <table className="beat-table">
        <tbody>
          {ARC.map((b, i) => (
            <tr key={i} className={`beat-row ${b.kind}`}>
              <td className="beat-when">
                <a href={BEAT_LINK[b.kind] ?? "#injury"}>{b.title}</a>
                <span className="beat-date">{b.date}</span>
              </td>
              <td className="beat-line">{b.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="counterweights">
        <span className="cw-title">Reassuring</span>
        <span className="cw-item"><b>Negative cerebral MRI</b> <span className="cw-note">no recent or remote injury</span></span>
        <span className="cw-item"><b>Documented response</b> <span className="cw-note">better within the first week</span></span>
        <span className="cw-item"><b>Planned taper</b> <span className="cw-note">order closed "therapy completed"</span></span>
        <span className="cw-item"><b>{mc.orderCount} linked orders, 1 drug</b> <span className="cw-note">{mc.spanDays} days, one chain</span></span>
      </div>
    </div>
  );
}

// ================================================================== App
function App() {
  const order = ["injury", "syndrome", "second-injury", "medication-course", "care-relocation", "coding", "assessment"];
  const titleOf = (id: string) => sectionById[id]?.title ?? id;
  const proseOf = (id: string): Para[] => sectionById[id]?.narrative ?? [];
  let n = 0;
  return (
    <div className="page">
      <SourceDrawer />
      <header className="page-head">
        <div className="ph-eyebrow">Post-concussion syndrome · deep dive</div>
        <h1>MANDEL, JOSHUA C</h1>
        <div className="ph-demo">Two head injuries (2020, 2022) · normal brain MRI · post-concussion syndrome on 11 encounters · 2020 → 2025</div>
        <p className="ph-headline">{vm.summary}</p>
        <ArcBoard />
      </header>

      {/* the centerpiece, hoisted directly under the header as the spine of the whole arc */}
      <section className="section" id="course">
        <h2><span className="sec-n">★</span>The course on one axis — events against the medication thread</h2>
        <div className="prose">
          <p>
            A neurologist reads this case on two tracks at once: the discrete arc of events, and the one medication held
            against them. Drawn together, the cause-and-effect is legible — the nortriptyline thread <b>begins at the
            second injury</b>, the dose climbs <b>as the response is documented</b>, it is maintained through the stable
            years, and it steps to zero at a planned taper. All of it sits beneath the flat, persistent reality the scan
            established: structural imaging was normal, and stayed irrelevant to a symptom-defined syndrome.
          </p>
        </div>
        <CourseChart />
        <p className="fig-note">
          The dose step holds each prescribed dose until the next order changes it; the shaded band is time on drug.
          Markers above the plot are the arc's discrete events, colored by thread and drillable to their evidence.
          The dashed line marks the July 2020 MRI — normal, years before any drug.<Cite ids={["m_dose_steps", "m_chain", "q_negative_mri"]} label="Course chart — evidence" />
        </p>
      </section>

      {order.map((id) => {
        n += 1;
        if (id === "assessment") {
          return (
            <SectionShell key={id} id={id} n={n} title={titleOf(id)}>
              <Prose paras={proseOf(id)} />
            </SectionShell>
          );
        }
        return (
          <SectionShell key={id} id={id} n={n} title={titleOf(id)}>
            <Prose paras={proseOf(id)} />
            {id === "injury" && <ImagingView />}
            {id === "medication-course" && <><ResponseView /><h4 className="subhead">The four orders, one chain</h4><MedOrderView /></>}
            {id === "care-relocation" && <ReferralView />}
            {id === "coding" && <CodingView />}
          </SectionShell>
        );
      })}

      <footer className="page-foot">
        Built over a single display-clean view model assembled from the post-concussion analysis and the complete normalised record.
        Every figure is carried pre-computed; every ⌖ traces a claim to a verbatim note quote or a readable statement of the record.
        Single-export, single-patient view. No raw export rows reach this page.
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
