/**
 * Coverage & billing — MANDEL, JOSHUA C.  The bespoke tool a billing analyst would want to
 * fully understand this claims history: one insurer, a per-claim ledger that reconciles to the
 * penny, and the void → reverse → repost → rebill correction that turned a denied $315 office
 * visit into a paid one (the centerpiece state machine over a single claim).
 *
 * STRUCTURAL RULE: this app imports ONLY ./viewmodel.json. Nothing
 * raw can reach the screen — there is no dataset / extract import. Every value in the view model is
 * already display-clean (formatted dates, plain words, ids only as side fields). Every ⌖ cite opens
 * a clean drawer onto viewmodel.evidence[id] (a verbatim note quote with date+author, or a readable
 * statement of a structured billing fact) — never a raw Clarity row.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { create } from "zustand";
import vm from "./viewmodel.json";
import "./page.css";

// ------------------------------------------------------------------ money formatting (display-only)
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0 = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

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
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  const open = useDrawer((s) => s.open);
  if (!list.length) return null;
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
        <span className="src-tag">{e.kind === "note" ? "Note quote" : "Billing record"}</span>
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
            Quotes are the curated verbatim record captured during the billing synthesis pass; statements
            summarise structured facts from the normalised claims ledger. Nothing here is a raw export row.
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
const proseOf = (id: string): Para[] => sectionById[id]?.narrative ?? [];
const titleOf = (id: string) => sectionById[id]?.title ?? id;

// ================================================================== money disposition flow (custom)
// One sticker price ($4,506 net professional) splits three ways. A horizontal Sankey-style band:
// the full billed bar on the left fans into three stacked destinations on the right, widths to scale.
const SEG_COLOR: Record<string, string> = { writeoff: "#7b828b", insurance: "#1a7f43", patient: "#b45309" };
const SEG_BG: Record<string, string> = { writeoff: "#eef0f2", insurance: "#eaf6ee", patient: "#fbf0e2" };

function MoneyFlow() {
  const mf = vm.moneyflow as any;
  const segs: any[] = mf.segments;
  const total = mf.billedNet as number;
  const W = 900, H = 250, M = { t: 18, r: 16, b: 16, l: 16 };
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  const srcW = 150;                 // width of the source (billed) block
  const gap = 200;                  // horizontal gap the ribbons span
  const dstX = M.l + srcW + gap;    // x where destination blocks start
  const dstW = iw - srcW - gap;
  const y = (v: number) => (v / total) * ih;
  // stack destinations top→bottom in segment order
  let acc = 0;
  const placed = segs.map((s) => {
    const h = y(s.amount);
    const block = { ...s, yTop: M.t + acc, h };
    acc += h;
    return block;
  });
  // source block spans full height; ribbons leave the source at the same proportional bands
  let sacc = 0;
  const ribbons = placed.map((s) => {
    const sTop = M.t + sacc; sacc += s.h;
    return { ...s, sTop };
  });
  const fmtPct = (a: number) => Math.round((a / total) * 100) + "%";
  return (
    <div className="flow-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="How the net billed amount splits into write-off, insurance, and patient">
        {/* source block */}
        <rect x={M.l} y={M.t} width={srcW} height={ih} fill="#33373c" rx={4} />
        <text x={M.l + srcW / 2} y={M.t + ih / 2 - 8} textAnchor="middle" fill="#fff" fontSize={20} fontWeight={800}>{usd0(total)}</text>
        <text x={M.l + srcW / 2} y={M.t + ih / 2 + 12} textAnchor="middle" fill="#cfd4da" fontSize={11.5}>net billed work</text>
        <text x={M.l + srcW / 2} y={M.t + ih / 2 + 28} textAnchor="middle" fill="#9aa0a6" fontSize={10}>2018 – 2025 · professional</text>
        {/* ribbons */}
        {ribbons.map((s) => {
          const x0 = M.l + srcW, x1 = dstX;
          const c = (x0 + x1) / 2;
          const sa = s.sTop, sb = s.sTop + s.h, da = s.yTop, db = s.yTop + s.h;
          const path = `M ${x0} ${sa} C ${c} ${sa}, ${c} ${da}, ${x1} ${da} L ${x1} ${db} C ${c} ${db}, ${c} ${sb}, ${x0} ${sb} Z`;
          return <path key={s.key} d={path} fill={SEG_COLOR[s.key]} opacity={0.32} />;
        })}
        {/* destination blocks */}
        {placed.map((s) => (
          <g key={s.key}>
            <rect x={dstX} y={s.yTop} width={dstW} height={Math.max(2, s.h - 3)} fill={SEG_COLOR[s.key]} rx={3} />
            <text x={dstX + 12} y={s.yTop + Math.max(2, s.h - 3) / 2 + 1} fill="#fff" fontSize={13} fontWeight={700}>{s.label}</text>
            <text x={dstX + dstW - 12} y={s.yTop + Math.max(2, s.h - 3) / 2 - 5} fill="#fff" fontSize={15} fontWeight={800} textAnchor="end">{usd(s.amount)}</text>
            <text x={dstX + dstW - 12} y={s.yTop + Math.max(2, s.h - 3) / 2 + 12} fill="#eef0f2" fontSize={11} textAnchor="end" opacity={0.92}>{fmtPct(s.amount)} of billed</text>
          </g>
        ))}
      </svg>
      <div className="flow-legend">
        {placed.map((s) => (
          <span key={s.key} className="fl">
            <i style={{ background: SEG_COLOR[s.key] }} />
            <b>{usd(s.amount)}</b>&nbsp;{s.label}
            <Cite ids={s.evidenceId} label={`${s.label} — evidence`} />
            <span>— {s.sub}</span>
          </span>
        ))}
      </div>
      <p className="fig-note">
        {mf.patientShareNote} The three pieces reconcile to the net billed exactly:
        {" "}{usd(mf.reconciliation.insurancePaid)} paid + {usd(mf.reconciliation.contractualWriteoff)} write-off
        + {usd(mf.reconciliation.patientOwed)} patient = {usd(mf.reconciliation.checksum)}.
        <Cite ids="e_reconcile_artifact" label="Why the per-claim remittance is the honest anchor" />
      </p>
    </div>
  );
}

// ================================================================== per-claim ledger (custom table)
const STATUS_META: Record<string, { color: string; cls: string; label: string }> = {
  closed: { color: "#1a7f43", cls: "closed", label: "Paid & closed" },
  rejected: { color: "#b42318", cls: "rejected", label: "Rejected" },
  voided: { color: "#6d28d9", cls: "voided", label: "Voided" },
  accepted: { color: "#5b6168", cls: "accepted", label: "Accepted (interim)" },
};

/** mini split bar: write-off | insurance | patient, proportional to billed */
function SplitBar({ billed, writeoff, insurancePaid, patientOwed }: any) {
  if (writeoff == null || insurancePaid == null) return <span className="dim" style={{ fontSize: 11 }}>—</span>;
  const seg = (v: number, c: string) => v > 0 ? <i key={c} style={{ width: `${(v / billed) * 100}%`, background: c }} /> : null;
  return (
    <span className="split-bar" title={`write-off ${usd(writeoff)} · insurer ${usd(insurancePaid)} · patient ${usd(patientOwed)}`}>
      {seg(writeoff, SEG_COLOR.writeoff)}
      {seg(insurancePaid, SEG_COLOR.insurance)}
      {seg(patientOwed, SEG_COLOR.patient)}
    </span>
  );
}

function ClaimsTable() {
  const c = vm.claims as any;
  const rows: any[] = c.rows;
  const byClaimNo = Object.fromEntries(rows.map((r) => [r.claimNo, r]));
  const t = c.totals;
  return (
    <div>
      <div className="claims-summary">
        <span className="status-chip closed">{t.nPaid} paid &amp; closed</span>
        <span className="status-chip rejected">{t.nRejected} rejected</span>
        <span className="status-chip voided">{t.nVoided} voided</span>
        <span className="status-chip accepted">{t.nAccepted} interim-accepted</span>
        <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--muted)", alignSelf: "center" }}>
          {t.nClaims} submissions · all to Blue Cross<Cite ids="e_claim_counts" label="Claim counts" />
        </span>
      </div>
      <table className="grid claims">
        <thead>
          <tr>
            <th>Date</th>
            <th>Service</th>
            <th className="num">Billed</th>
            <th className="num">Insurer paid</th>
            <th className="num">Patient</th>
            <th>Disposition</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const sm = STATUS_META[r.statusKey];
            const unpaid = r.statusKey === "rejected" || r.statusKey === "voided" || r.statusKey === "accepted";
            const src = r.resubmittedFrom ? byClaimNo[r.resubmittedFrom] : null;
            return (
              <tr key={r.claimNo} className={`${unpaid ? "dim-row" : ""} ${r.isDenialSaga ? "saga-row" : ""}`}>
                <td className="nowrap">{r.date}</td>
                <td className="svc">
                  {r.service}
                  {r.nCharges > 1 ? <span className="dim" style={{ fontSize: 11 }}> · {r.nCharges} charges</span> : null}
                  {r.resubmittedFrom ? <span className="resub-badge" title={`resubmitted from ${r.resubmittedFrom}`}>rebilled{src ? ` from ${src.date.replace(/,.*/, "")}` : ""}</span> : null}
                  {r.isDenialSaga ? <span className="saga-badge">denial saga ↓</span> : null}
                </td>
                <td className="num">{usd(r.billed)}</td>
                <td className="num">{r.insurancePaid == null ? "—" : usd(r.insurancePaid)}</td>
                <td className="num">{r.patientOwed == null ? "—" : usd(r.patientOwed)}</td>
                <td><SplitBar billed={r.billed} writeoff={r.writeoff} insurancePaid={r.insurancePaid} patientOwed={r.patientOwed} /></td>
                <td>
                  <span className="cl-status" style={{ color: sm.color }}>
                    <span className="cl-dot" style={{ background: sm.color }} />{sm.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="fig-note">
        The disposition bar shows each claim's billed dollar split three ways — <b style={{ color: SEG_COLOR.writeoff }}>write-off</b>,
        {" "}<b style={{ color: SEG_COLOR.insurance }}>insurer paid</b>, <b style={{ color: SEG_COLOR.patient }}>patient</b>.
        Dimmed rows are submissions that never paid; each carries a <b>rebilled</b> tag pointing at the resubmission that did.
        The four shaded rows are the December 2022 denial saga, expanded below.<Cite ids="e_rebill_pattern" label="The rebill pattern" />
      </p>
    </div>
  );
}

// ================================================================== CARC reason ledger (custom)
const BUCKET_COLOR: Record<string, string> = { writeoff: "#7b828b", patient: "#b45309", info: "#b8bcc2" };
function CarcLedger() {
  const carc = vm.carc as any;
  const groups = [
    { ...carc.writeoff, bucket: "writeoff", color: BUCKET_COLOR.writeoff },
    { ...carc.patient, bucket: "patient", color: BUCKET_COLOR.patient },
  ];
  const max = Math.max(...groups.flatMap((g: any) => g.rows.map((r: any) => r.amount)));
  const co45 = carc.writeoff.rows.find((r: any) => r.code === "45");
  return (
    <div className="carc-ledger">
      {groups.map((g: any) => (
        <div className="carc-group" key={g.label}>
          <div className="carc-group-head">
            <span className="carc-group-label">{g.label}</span>
            <span className="carc-group-total">{usd(g.total)}</span>
          </div>
          {g.rows.map((r: any) => {
            const w = max > 0 ? (r.amount / max) * 100 : 0;
            return (
              <div className="carc-row" key={r.code}>
                <span className={`carc-code ${g.bucket}`}>{r.code}</span>
                <span className="carc-plain">{r.plain}{r.sub && <span className="grp"> · {r.sub}</span>}</span>
                <span className="carc-amt">{usd(r.amount)}</span>
                <span>
                  <span className="carc-track"><span className="carc-fill" style={{ width: `${w}%`, background: g.color }} /></span>
                  <span className="carc-n"> {r.nLines}×</span>
                </span>
              </div>
            );
          })}
        </div>
      ))}
      <p className="fig-note">
        Read by reason code, the composition is stark. Code <b>45</b> — “charges exceed the fee schedule or maximum allowable” —
        is essentially the entire write-off ({usd(co45.amount)} of {usd(carc.writeoff.total)}); the list price is largely
        fictional, and the allowed amount governs. The patient's own {usd(carc.patient.total)} is almost all deductible, with a
        few dollars of coinsurance — exactly the $0-copay, 10%-coinsurance plan rule playing out. Both groups are read off each
        claim's <b>final</b> adjudication, so they sum to the write-off and patient slices of the {usd0(vm.moneyflow.billedNet)} flow
        above, to the penny.<Cite ids="e_carc_45" label="Net composition by reason code" />
      </p>
    </div>
  );
}

// ================================================================== denial state machine (CENTERPIECE)
const STEP_META: Record<string, { tag: string; color: string; bg: string }> = {
  neutral: { tag: "Filed", color: "#1d4ed8", bg: "#e8eefc" },
  bad: { tag: "Denied", color: "#b42318", bg: "#fde7e7" },
  action: { tag: "Correction", color: "#6d28d9", bg: "#efe9fb" },
  good: { tag: "Paid", color: "#1a7f43", bg: "#eaf6ee" },
};
const STEP_LABEL_BY_KEY: Record<string, string> = {
  submitted: "Filed", denied: "Denied", voided: "Void + repost", reversed: "Payment reversed", rebilled: "Rebilled", paid: "Paid",
};

function MoneyChips({ money }: { money: any }) {
  if (!money) return null;
  const order: [string, string, string][] = [
    ["billed", "billed", "billed"],
    ["allowed", "allowed", "billed"],
    ["paid", "insurer paid", money.paid === 0 ? "zero" : "paid"],
    ["writeoff", "write-off", "writeoff"],
    ["coinsurance", "patient", "patient"],
    ["voided", "charge voided", "neg"],
    ["reversed", "remit reversed", "neg"],
  ];
  return (
    <div className="saga-money">
      {order.filter(([k]) => money[k] != null).map(([k, label, cls]) => (
        <span key={k} className={`money-chip ${cls}`}>
          <span className="mk">{label}</span>{usd(money[k])}
        </span>
      ))}
    </div>
  );
}

function DenialSaga() {
  const d = vm.denial as any;
  const steps: any[] = d.steps;
  return (
    <div>
      <div className="saga">
        {steps.map((s, i) => {
          const meta = STEP_META[s.tone] ?? STEP_META.neutral;
          const carcs: any[] = s.carc ? (Array.isArray(s.carc) ? s.carc : [s.carc]) : [];
          return (
            <div className="saga-step" key={s.n}>
              <div className="saga-rail" style={{ color: meta.color }}>
                <div className="saga-dot" style={{ background: meta.color }} />
                {i < steps.length - 1 && <div className="saga-line" />}
              </div>
              <div className="saga-body">
                <div className="saga-head">
                  <span className="saga-tag" style={{ background: meta.bg, color: meta.color }}>{STEP_LABEL_BY_KEY[s.key] ?? meta.tag}</span>
                  <span className="saga-date">{s.date}</span>
                </div>
                <div className="saga-title">{s.label}<Cite ids={s.evidenceId} label={`${s.label} — evidence`} /></div>
                <div className="saga-text">{s.detail}</div>
                <MoneyChips money={s.money} />
                {carcs.length ? (
                  <div className="saga-carc">
                    {carcs.map((c, j) => (
                      <span key={j} className={`carc-chip ${c.code === "16" ? "bad" : ""}`}>
                        <b>CARC {c.code}</b> — {c.plain}{c.amount != null ? <> · {usd(c.amount)}</> : null}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <h4 className="subhead">What actually fixed it — the diagnosis</h4>
      <div className="dxfix">
        <div className="dxbox before">
          <div className="dxlabel">Denied claim carried</div>
          <div className="dxtext">{d.dxBefore}</div>
        </div>
        <div className="dxarrow" aria-hidden>→</div>
        <div className="dxbox after">
          <div className="dxlabel">Corrected claim carried</div>
          <div className="dxtext">{d.dxAfter}</div>
        </div>
      </div>
      <p className="fig-note">
        The reason-16 denial was not clinical — Blue Cross was not saying the visit was unnecessary; it was a
        specificity problem. Adding a specific concussion code, an external-cause code, and nausea supplied exactly
        the “missing information” the denial flagged, and the rebill adjudicated normally. The corrected claim paid
        {" "}{usd(d.finalPaid)} on the same {usd0(d.billed)} charge, leaving the patient the same {usd(d.finalPatientCoinsurance)}
        {" "}coinsurance a clean first pass would have owed — the denial cost staff time, not patient dollars.
        <Cite ids={["e_saga_dx_fix", "e_saga_paid"]} label="The fix and the final adjudication" />
      </p>
    </div>
  );
}

// ================================================================== HB OT episode (custom)
function HbEpisode() {
  const h = vm.hb as any;
  const total = h.billed as number;
  const parts = [
    { key: "writeoff", label: "Contractual write-off", amount: h.writeoff, sub: "above the allowed fee + bundled" },
    { key: "patient", label: "Applied to deductible", amount: h.patientDeductible, sub: "the patient's full out-of-pocket here" },
  ];
  return (
    <div>
      <div className="hb-grid">
        <div className="hb-charges">
          {h.charges.map((c: any, i: number) => (
            <div className="hbc-row" key={i}>
              <span className="hbc-svc">{c.service}<br /><span className="hbc-date">{c.date}</span></span>
              <span className="hbc-amt">{usd(c.amount)}</span>
            </div>
          ))}
          <div className="hbc-row total">
            <span className="hbc-svc">Total billed · {h.accountClass}</span>
            <span className="hbc-amt">{usd(total)}</span>
          </div>
        </div>
        <div className="hb-disp">
          <div className="cc-title">How Blue Cross split it</div>
          <div className="hb-disp-bar">
            {parts.map((p) => (
              <i key={p.key} style={{ width: `${(p.amount / total) * 100}%`, background: SEG_COLOR[p.key] }}>
                {p.amount / total > 0.18 ? usd0(p.amount) : ""}
              </i>
            ))}
          </div>
          {parts.map((p) => (
            <div className="hb-disp-row" key={p.key}>
              <i style={{ background: SEG_COLOR[p.key] }} />
              <span className="k">{p.label}</span>
              <span className="v">{usd(p.amount)}</span>
            </div>
          ))}
          <div className="hb-disp-row" style={{ borderTop: "1px solid var(--rule)", marginTop: 6, paddingTop: 8 }}>
            <i style={{ background: "var(--insurer)" }} />
            <span className="k">Insurance paid</span>
            <span className="v">{usd(h.insurancePaid)}</span>
          </div>
        </div>
      </div>
      <p className="fig-note">
        This single episode — three occupational-therapy charges in March 2022 — is the patient's most expensive event
        and the cleanest illustration of the deductible in the record. Because the deductible had not yet been met,
        Blue Cross paid <b>{usd0(h.insurancePaid)}</b> and the entire {usd(h.patientDeductible)} allowed amount landed on
        the patient. The account closed at a $0 balance on {h.zeroBalanceDate}.<Cite ids="e_hb_split" label="The OT remittance" />
        {" "}{h.emptyShellsNote}<Cite ids="e_hb_episode" label="The one real hospital episode" />
      </p>
    </div>
  );
}

// ================================================================== correspondence (custom)
function Correspondence() {
  const c = vm.correspondence as any;
  // surface the two letters that actually went to the patient
  const letters = [
    {
      date: "Oct 6, 2022",
      name: "Small-balance letter",
      bal: c.events.find((e: any) => e.label.includes("Small-balance"))?.patientBalance ?? 7.82,
      meta: "A $7.82 in-network coinsurance balance — the 10% share again — tripped a small-balance letter and briefly routed the account to a billing work-queue.",
      cls: "patient",
    },
    {
      date: "Jan 6, 2025",
      name: "‘No insurance on file’ letter",
      bal: c.events.find((e: any) => e.label.includes("No insurance"))?.insuranceBalance ?? 237,
      meta: "A ‘need insurance information — no insurance listed’ letter went out against a $237 balance with no coverage attached — a momentary gap, not a real loss of insurance.",
      cls: "patient",
    },
  ];
  return (
    <div>
      <div className="letters">
        {letters.map((l, i) => (
          <div className="letter" key={i}>
            <div className="letter-date">{l.date}</div>
            <div className="letter-name">{l.name}</div>
            <div className="letter-meta">
              <span className="letter-bal">{usd(l.bal)}</span> balance — {l.meta}
            </div>
          </div>
        ))}
      </div>
      <p className="fig-note">{c.note}<Cite ids="e_correspondence" label="The correspondence log" /></p>
    </div>
  );
}

// ================================================================== coverage card + headline figures
function CoverageCard() {
  const cov = vm.coverage as any;
  const rows = [
    ["Plan", cov.plan],
    ["Type", cov.planType],
    ["Group", cov.group],
    ["Subscriber", cov.subscriber],
    ["Office copay", cov.costSharing.officeCopay],
    ["In-network coinsurance", cov.costSharing.inNetworkCoinsurance],
    ["Secondary", cov.secondaryPayer === "None — single payer across the whole record" ? "None" : cov.secondaryPayer],
  ];
  return (
    <div className="coverage-card">
      <div className="cc-title">Coverage on file<Cite ids={["e_coverage", "e_cost_sharing"]} label="Coverage & cost-sharing" /></div>
      <div className="cc-payer">{cov.payer}</div>
      <div className="cc-plan">{cov.planType} · employer group {cov.group}</div>
      {rows.map(([k, v]) => (
        <div className="cc-row" key={k as string}><span className="cc-k">{k}</span><span className="cc-v">{v}</span></div>
      ))}
    </div>
  );
}

function HeadlineFigs() {
  const mf = vm.moneyflow as any;
  const figs = [
    { cls: "billed", val: usd0(mf.billedNet), label: "Net billed work", sub: `29 charges less one ${usd0(mf.voidedDuplicate)} voided duplicate`, cite: "e_billed_net" },
    { cls: "writeoff", val: usd0(mf.segments[0].amount), label: "Contractual write-off", sub: "owed by no one", cite: "e_moneyflow_split" },
    { cls: "insurer", val: usd0(mf.segments[1].amount), label: "Insurance paid", sub: "Blue Cross net-paid", cite: "e_moneyflow_split" },
    { cls: "patient", val: usd(mf.segments[2].amount), label: "Patient's own share", sub: "≈14% · deductible + 10% coinsurance", cite: "e_patient_share" },
  ];
  return (
    <div className="head-figs">
      {figs.map((f) => (
        <div className={`hfig ${f.cls}`} key={f.label}>
          <div className="hfig-val">{f.val}</div>
          <div className="hfig-label">{f.label}</div>
          <div className="hfig-sub">{f.sub}</div>
          <div className="hfig-cite"><Cite ids={f.cite} label={`${f.label} — evidence`} /></div>
        </div>
      ))}
    </div>
  );
}

// ================================================================== App
function App() {
  const order = ["machine", "totals", "claims", "denial", "hb", "friction", "assessment"];
  let n = 0;
  return (
    <div className="page">
      <SourceDrawer />
      <header className="page-head">
        <div className="ph-eyebrow">Coverage &amp; billing · deep dive</div>
        <h1>MANDEL, JOSHUA C</h1>
        <div className="ph-demo">One insurer · 2018 – 2025 · professional &amp; hospital billing · zero balance</div>
        <p className="ph-headline">{vm.summary}</p>
        <div className="head-grid">
          <CoverageCard />
          <HeadlineFigs />
        </div>
      </header>

      {order.map((id) => {
        n += 1;
        return (
          <SectionShell key={id} id={id} n={n} title={titleOf(id)}>
            <Prose paras={proseOf(id)} />
            {id === "totals" && <MoneyFlow />}
            {id === "totals" && <><h4 className="subhead">Adjustments by reason code</h4><CarcLedger /></>}
            {id === "claims" && <ClaimsTable />}
            {id === "denial" && <DenialSaga />}
            {id === "hb" && <HbEpisode />}
            {id === "friction" && <Correspondence />}
          </SectionShell>
        );
      })}

      <footer className="page-foot">
        Built over a single display-clean view model assembled from the billing analysis and the complete normalised
        claims ledger. Every figure is carried pre-computed; every ⌖ traces a claim to a verbatim note quote or a
        readable statement of the billing record. Single-export view. No SSN, address, phone, email, or raw MRN.
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
