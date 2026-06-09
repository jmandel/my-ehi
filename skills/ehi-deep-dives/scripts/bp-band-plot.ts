#!/usr/bin/env bun
/**
 * bp-band-plot.ts — Reference implementation of a blood-pressure range-band plot.
 *
 * WHY a band plot, not a line chart: a BP reading is two numbers (systolic /
 * diastolic) that are only meaningful against clinical thresholds. The right
 * display puts the AHA/ACC category bands behind the data (Normal / Elevated /
 * Stage 1 / Stage 2) so each point reads as "where in the risk landscape," and
 * draws systolic and diastolic as paired series. This file emits a standalone
 * SVG so the design can be eyeballed without a browser; the deep-dive React
 * component mirrors the same scales/bands.
 *
 * Usage: bun bp-band-plot.ts > out.svg   (uses a synthetic demo series)
 */
type BP = { date: string; sys: number; dia: number };

// AHA/ACC 2017 systolic category thresholds (mmHg) -> bands drawn behind data.
const SYS_BANDS = [
  { lo: 40, hi: 120, label: "Normal", fill: "#d8f3dc" },
  { lo: 120, hi: 130, label: "Elevated", fill: "#fef9c3" },
  { lo: 130, hi: 140, label: "Stage 1", fill: "#ffe8cc" },
  { lo: 140, hi: 200, label: "Stage 2", fill: "#ffd6d6" },
];

const demo: BP[] = [
  { date: "2018-08-09", sys: 118, dia: 74 },
  { date: "2019-05-02", sys: 124, dia: 80 },
  { date: "2020-11-18", sys: 122, dia: 78 },
  { date: "2021-06-14", sys: 131, dia: 85 },
  { date: "2022-09-30", sys: 138, dia: 88 },
  { date: "2023-03-07", sys: 129, dia: 84 },
  { date: "2024-07-28", sys: 126, dia: 82 },
];

function render(data: BP[]): string {
  const W = 760, H = 380, M = { t: 28, r: 130, b: 40, l: 46 };
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  const t0 = new Date(data[0].date).getTime();
  const t1 = new Date(data[data.length - 1].date).getTime();
  const x = (d: string) => M.l + ((new Date(d).getTime() - t0) / (t1 - t0)) * iw;
  const yLo = 40, yHi = 200;
  const y = (v: number) => M.t + (1 - (v - yLo) / (yHi - yLo)) * ih;

  const bands = SYS_BANDS.map(
    (b) =>
      `<rect x="${M.l}" y="${y(b.hi).toFixed(1)}" width="${iw}" height="${(y(b.lo) - y(b.hi)).toFixed(1)}" fill="${b.fill}"/>` +
      `<text x="${W - M.r + 8}" y="${((y(b.lo) + y(b.hi)) / 2 + 4).toFixed(1)}" font-size="11" fill="#555">${b.label}</text>`
  ).join("");

  const path = (key: "sys" | "dia", color: string) => {
    const d = data.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p[key]).toFixed(1)}`).join("");
    const dots = data.map((p) => `<circle cx="${x(p.date).toFixed(1)}" cy="${y(p[key]).toFixed(1)}" r="3.5" fill="${color}"/>`).join("");
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2"/>${dots}`;
  };

  const yTicks = [40, 80, 120, 160, 200].map(
    (v) => `<text x="${M.l - 8}" y="${(y(v) + 4).toFixed(1)}" font-size="11" fill="#666" text-anchor="end">${v}</text>`
  ).join("");
  const xTicks = data.filter((_, i) => i % 2 === 0).map(
    (p) => `<text x="${x(p.date).toFixed(1)}" y="${H - M.b + 18}" font-size="10" fill="#666" text-anchor="middle">${p.date.slice(0, 7)}</text>`
  ).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="system-ui,sans-serif">
<rect width="${W}" height="${H}" fill="white"/>
<text x="${M.l}" y="18" font-size="14" font-weight="600">Blood pressure vs. AHA/ACC category bands (mmHg)</text>
${bands}
${yTicks}${xTicks}
${path("sys", "#c1121f")}
${path("dia", "#1d4ed8")}
<text x="${W - M.r + 8}" y="${y(data[data.length-1].sys).toFixed(1)}" font-size="11" fill="#c1121f">systolic</text>
<text x="${W - M.r + 8}" y="${(y(data[data.length-1].dia)+12).toFixed(1)}" font-size="11" fill="#1d4ed8">diastolic</text>
</svg>`;
}

console.log(render(demo));
