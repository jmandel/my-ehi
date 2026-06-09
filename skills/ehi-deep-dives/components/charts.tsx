/**
 * charts.tsx — reusable clinical charts done *right* (the Deep-dives skill's visualization craft, as code).
 *
 * Each chart takes data + draws the clinical reference context (category bands, reference ranges, target
 * zones) behind the data, so a reading reads as "where in the risk landscape," not just "a line." D3 for
 * scales/shapes, React for the SVG. Keep these generic; theme-specific charts can compose them.
 */
import React from "react";
import * as d3 from "d3";

const AXIS = "#9aa0a6", GRID = "#ececec", INK = "#1a1a1a";

// ---------------------------------------------------------------------------
// Blood pressure range-band plot (AHA/ACC 2017 systolic categories behind the data).
// ---------------------------------------------------------------------------
export type BP = { date: string; sys: number; dia: number; src?: string };
const SYS_BANDS = [
  { lo: 40, hi: 120, label: "Normal", fill: "#e6f4ea" },
  { lo: 120, hi: 130, label: "Elevated", fill: "#fef7e0" },
  { lo: 130, hi: 140, label: "Stage 1", fill: "#fde9d9" },
  { lo: 140, hi: 200, label: "Stage 2", fill: "#fce0e0" },
];
export function BPBandPlot({ rows, width = 720, height = 360 }: { rows: BP[]; width?: number; height?: number }) {
  const M = { t: 12, r: 150, b: 34, l: 40 };
  const iw = width - M.l - M.r, ih = height - M.t - M.b;
  const dates = rows.map((d) => new Date(d.date));
  const x = d3.scaleTime().domain(d3.extent(dates) as [Date, Date]).range([0, iw]);
  const y = d3.scaleLinear().domain([40, 200]).range([ih, 0]);
  const line = (k: "sys" | "dia") => d3.line<BP>().x((d) => x(new Date(d.date))).y((d) => y(d[k]))(rows) ?? "";
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="chart" role="img" aria-label="Blood pressure vs AHA/ACC categories">
      <g transform={`translate(${M.l},${M.t})`}>
        {SYS_BANDS.map((b) => (
          <g key={b.label}>
            <rect x={0} y={y(b.hi)} width={iw} height={y(b.lo) - y(b.hi)} fill={b.fill} />
            <text x={iw + 56} y={(y(b.lo) + y(b.hi)) / 2 + 4} fontSize={11} fill="#9aa0a6">{b.label}</text>
          </g>
        ))}
        {y.ticks(6).map((t) => (
          <text key={t} x={-8} y={y(t) + 4} fontSize={11} fill={AXIS} textAnchor="end">{t}</text>
        ))}
        {x.ticks(Math.min(6, rows.length)).map((t, i) => (
          <text key={i} x={x(t)} y={ih + 20} fontSize={11} fill={AXIS} textAnchor="middle">{d3.timeFormat("%b ’%y")(t)}</text>
        ))}
        <path d={line("sys")} fill="none" stroke="#c1121f" strokeWidth={2.25} />
        <path d={line("dia")} fill="none" stroke="#1d4ed8" strokeWidth={2.25} />
        {rows.map((d, i) => (
          <g key={i}>
            <circle cx={x(new Date(d.date))} cy={y(d.sys)} r={3.25} fill="#c1121f" />
            <circle cx={x(new Date(d.date))} cy={y(d.dia)} r={3.25} fill="#1d4ed8" />
          </g>
        ))}
        {/* legend (top-left, inside plot) — avoids colliding with the right-margin band labels */}
        <g transform="translate(2,2)">
          <circle cx={5} cy={5} r={3.5} fill="#c1121f" /><text x={13} y={9} fontSize={11} fill="#c1121f" fontWeight={600}>systolic</text>
          <circle cx={70} cy={5} r={3.5} fill="#1d4ed8" /><text x={78} y={9} fontSize={11} fill="#1d4ed8" fontWeight={600}>diastolic</text>
        </g>
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Lab trend vs reference range (shaded normal band; out-of-range points marked).
// ---------------------------------------------------------------------------
export type LabPoint = { date: string; value: number; low?: number | null; high?: number | null; src?: string };
export function LabTrend({
  rows, label, unit, width = 680, height = 220,
}: { rows: LabPoint[]; label: string; unit?: string; width?: number; height?: number }) {
  const M = { t: 16, r: 56, b: 30, l: 44 };
  const iw = width - M.l - M.r, ih = height - M.t - M.b;
  const vals = rows.map((r) => r.value);
  const lo = rows.map((r) => r.low ?? Infinity).filter(isFinite);
  const hi = rows.map((r) => r.high ?? -Infinity).filter(isFinite);
  const yMin = Math.min(...vals, ...lo) * 0.9;
  const yMax = Math.max(...vals, ...hi) * 1.1;
  const x = d3.scaleTime().domain(d3.extent(rows.map((r) => new Date(r.date))) as [Date, Date]).range([0, iw]);
  const y = d3.scaleLinear().domain([yMin, yMax]).range([ih, 0]).nice();
  const refLow = rows.find((r) => r.low != null)?.low ?? null;
  const refHigh = rows.find((r) => r.high != null)?.high ?? null;
  const path = d3.line<LabPoint>().x((d) => x(new Date(d.date))).y((d) => y(d.value))(rows) ?? "";
  const outOfRange = (d: LabPoint) => (d.low != null && d.value < d.low) || (d.high != null && d.value > d.high);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="chart" role="img" aria-label={`${label} trend`}>
      <g transform={`translate(${M.l},${M.t})`}>
        {refLow != null && refHigh != null && (
          <>
            <rect x={0} y={y(refHigh)} width={iw} height={y(refLow) - y(refHigh)} fill="#e6f4ea" />
            <text x={iw + 4} y={y(refHigh) + 4} fontSize={10} fill="#6b7075">{refHigh}</text>
            <text x={iw + 4} y={y(refLow) + 4} fontSize={10} fill="#6b7075">{refLow}</text>
          </>
        )}
        {y.ticks(4).map((t) => (
          <g key={t}>
            <line x1={0} x2={iw} y1={y(t)} y2={y(t)} stroke={GRID} />
            <text x={-8} y={y(t) + 4} fontSize={10} fill={AXIS} textAnchor="end">{t}</text>
          </g>
        ))}
        {x.ticks(Math.min(6, rows.length)).map((t, i) => (
          <text key={i} x={x(t)} y={ih + 18} fontSize={10} fill={AXIS} textAnchor="middle">{d3.timeFormat("%b ’%y")(t)}</text>
        ))}
        <path d={path} fill="none" stroke="#374151" strokeWidth={2} />
        {rows.map((d, i) => (
          <circle key={i} cx={x(new Date(d.date))} cy={y(d.value)} r={3.5}
            fill={outOfRange(d) ? "#c1121f" : "#374151"} stroke="white" strokeWidth={1} />
        ))}
        <text x={0} y={-4} fontSize={12} fontWeight={600} fill={INK}>{label}{unit ? ` (${unit})` : ""}</text>
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Timeline of dated events, optionally laned by category.
// ---------------------------------------------------------------------------
export type Event = { date: string; label: string; category?: string; src?: string };
/**
 * Dated events on a time axis. `labels` renders each event's text (alternating above/below the dot to
 * reduce collisions) — use it for static pages where hover titles are invisible; for very dense clusters,
 * compose a custom timeline instead. Without `labels`, labels appear only on hover.
 */
export function Timeline({ events, width = 760, laneHeight = 30, labels = false }:
  { events: Event[]; width?: number; laneHeight?: number; labels?: boolean }) {
  const cats = Array.from(new Set(events.map((e) => e.category ?? "")));
  const M = { t: labels ? 30 : 24, r: 16, b: labels ? 30 : 24, l: 8 };
  const iw = width - M.l - M.r;
  const lh = labels ? Math.max(laneHeight, 48) : laneHeight;
  const height = M.t + M.b + Math.max(1, cats.length) * lh;
  const x = d3.scaleTime().domain(d3.extent(events.map((e) => new Date(e.date))) as [Date, Date]).range([0, iw]);
  const color = d3.scaleOrdinal<string, string>().domain(cats).range(d3.schemeTableau10 as string[]);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="chart" role="img" aria-label="Timeline">
      <g transform={`translate(${M.l},${M.t})`}>
        <line x1={0} x2={iw} y1={-8} y2={-8} stroke={GRID} />
        {x.ticks(6).map((t, i) => (
          <text key={i} x={x(t)} y={-12} fontSize={10} fill={AXIS} textAnchor="middle">{d3.timeFormat("%Y")(t)}</text>
        ))}
        {cats.map((c, li) => (
          <g key={c} transform={`translate(0,${li * lh})`}>
            {c ? <text x={0} y={4} fontSize={10} fill="#6b7075">{c}</text> : null}
            <line x1={0} x2={iw} y1={lh / 2} y2={lh / 2} stroke={GRID} />
            {events.filter((e) => (e.category ?? "") === c).map((e, i) => {
              const above = i % 2 === 0;
              return (
                <g key={i} transform={`translate(${x(new Date(e.date))},${lh / 2})`}>
                  <circle r={4} fill={color(c)} stroke="white" />
                  <title>{e.date} — {e.label}</title>
                  {labels ? (
                    <text x={6} y={above ? -6 : 14} fontSize={10} fill={INK}>{e.label}</text>
                  ) : null}
                </g>
              );
            })}
          </g>
        ))}
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Medication exposure interval bars (start→stop), so gaps/overlaps/reorders show.
// ---------------------------------------------------------------------------
export type Interval = { name: string; start: string; stop?: string | null; src?: string };
export function IntervalBars({ items, asOf, width = 720, rowH = 26 }: { items: Interval[]; asOf?: string; width?: number; rowH?: number }) {
  const M = { t: 20, r: 16, b: 24, l: 150 };
  const iw = width - M.l - M.r;
  const height = M.t + M.b + items.length * rowH;
  const end = asOf ? new Date(asOf) : new Date(Math.max(...items.map((i) => new Date(i.stop ?? i.start).getTime())));
  const x = d3.scaleTime()
    .domain([new Date(Math.min(...items.map((i) => new Date(i.start).getTime()))), end])
    .range([0, iw]);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="chart" role="img" aria-label="Medication intervals">
      <g transform={`translate(${M.l},${M.t})`}>
        {x.ticks(6).map((t, i) => (
          <g key={i}>
            <line x1={x(t)} x2={x(t)} y1={-6} y2={items.length * rowH} stroke={GRID} />
            <text x={x(t)} y={-10} fontSize={10} fill={AXIS} textAnchor="middle">{d3.timeFormat("%Y")(t)}</text>
          </g>
        ))}
        {items.map((it, i) => {
          const x0 = x(new Date(it.start));
          const x1 = x(new Date(it.stop ?? end.toISOString()));
          return (
            <g key={i} transform={`translate(0,${i * rowH})`}>
              <text x={-M.l + 2} y={rowH / 2 + 4} fontSize={11} fill={INK}>{it.name}</text>
              <rect x={x0} y={rowH / 2 - 6} width={Math.max(2, x1 - x0)} height={12} rx={3} fill="#6366f1" opacity={0.85} />
              {!it.stop && <text x={x1 + 4} y={rowH / 2 + 4} fontSize={10} fill="#6366f1">ongoing</text>}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
