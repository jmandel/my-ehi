/**
 * People behind the record. A static React/D3 deep dive powered only by
 * ./viewmodel.json. The raw EHI tables stay behind the projection boundary.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import * as d3 from "d3";
import vm from "./viewmodel.json";
import "./page.css";

type Ev = { kind: "fact"; date?: string; text?: string };
const EVIDENCE = vm.evidence as Record<string, Ev>;
const taskGroups = vm.taskGroups as Array<{ id: string; label: string; color: string; touches: number; humans: number; systems: number }>;
const groupColor = new Map(taskGroups.map((g) => [g.id, g.color]));
const fmt = d3.format(",");

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
      ⌖{list.length > 1 ? <span>{list.length}</span> : null}
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
          <b>Evidence{ctx.ids.length > 1 ? ` · ${ctx.ids.length}` : ""}</b>
          <button onClick={ctx.close} aria-label="Close">×</button>
        </div>
        <div className="drawer-body">
          {ctx.ids.map((id) => {
            const e = EVIDENCE[id];
            return (
              <div className="src-block" key={id}>
                <div className="src-meta"><span>Structured fact</span>{e?.date ? <em>{e.date}</em> : null}</div>
                <p>{e?.text ?? `Evidence not found: ${id}`}</p>
              </div>
            );
          })}
          <p className="drawer-foot">These are cleaned structured statements from the projection, not raw EHI rows.</p>
        </div>
      </aside>
    </>
  );
}

function Prose({ id }: { id: string }) {
  const s = (vm.sections as any[]).find((x) => x.id === id);
  return (
    <div className="prose">
      {s?.narrative?.map((p: any, i: number) => (
        <p key={i}>{p.text}{p.cites?.length ? <Cite ids={p.cites} /> : null}</p>
      ))}
    </div>
  );
}

function StatStrip() {
  const c = vm.meta.counts;
  const stats = [
    ["Touch fields", fmt(c.touchEvents), "attributable role fields"],
    ["Named people", fmt(c.namedHumans), "merged across id spaces"],
    ["System actors", fmt(c.systemActors), "batch, EDI, placeholders"],
    ["Dual identities", fmt(c.dualIdHumans), "SER + EMP same name"],
    ["Source tables", fmt(c.rawSourceTables), "raw table families"],
  ];
  return (
    <div className="stat-strip">
      {stats.map(([k, v, sub]) => (
        <div className="stat" key={k}>
          <div className="stat-v">{v}</div>
          <div className="stat-k">{k}</div>
          <div className="stat-sub">{sub}</div>
        </div>
      ))}
    </div>
  );
}

type NodeBox = { name: string; col: number; total: number; x: number; y: number; h: number; w: number; inOff: number; outOff: number };
type Ribbon = { source: string; target: string; count: number; sourceNode: NodeBox; targetNode: NodeBox; sy0: number; sy1: number; ty0: number; ty1: number; color: string };

function Alluvial() {
  const W = 1060, H = 610;
  const M = { t: 22, r: 20, b: 34, l: 20 };
  const colX = [M.l, W * 0.40, W * 0.80];
  const nodeW = [220, 240, 170];
  const domainTask = (vm.visualData.domainTaskLinks as any[]).filter((d) => d.count >= 4);
  const taskKind = vm.visualData.taskActorKindLinks as any[];
  const domains = d3.rollups(domainTask, (v) => d3.sum(v, (d: any) => d.count), (d: any) => d.source)
    .sort((a, b) => d3.descending(a[1], b[1])).slice(0, 14);
  const keptDomains = new Set(domains.map((d) => d[0]));
  const leftLinks = domainTask.filter((d) => keptDomains.has(d.source));
  const taskTotals = d3.rollups(leftLinks, (v) => d3.sum(v, (d: any) => d.count), (d: any) => d.target)
    .sort((a, b) => taskGroups.findIndex((g) => g.id === a[0]) - taskGroups.findIndex((g) => g.id === b[0]));
  const kindTotals = d3.rollups(taskKind, (v) => d3.sum(v, (d: any) => d.count), (d: any) => d.target)
    .sort((a, b) => d3.descending(a[1], b[1]));
  const cols = [domains, taskTotals, kindTotals];
  const maxColTotal = d3.max(cols, (col) => d3.sum(col, (d) => d[1])) || 1;
  const scale = (H - M.t - M.b - 12 * 11) / maxColTotal;
  const nodes = new Map<string, NodeBox>();
  cols.forEach((col, ci) => {
    let y = M.t;
    col.forEach(([name, total]) => {
      const h = Math.max(8, total * scale);
      const box = { name, col: ci, total, x: colX[ci], y, h, w: nodeW[ci], inOff: 0, outOff: 0 };
      nodes.set(`${ci}:${name}`, box);
      y += h + 12;
    });
  });
  const ribbons: Ribbon[] = [];
  function addRibbon(sourceCol: number, targetCol: number, source: string, target: string, count: number, color: string) {
    const s = nodes.get(`${sourceCol}:${source}`);
    const t = nodes.get(`${targetCol}:${target}`);
    if (!s || !t) return;
    const sw = count * scale;
    const tw = count * scale;
    const r = { source, target, count, sourceNode: s, targetNode: t, sy0: s.y + s.outOff, sy1: s.y + s.outOff + sw, ty0: t.y + t.inOff, ty1: t.y + t.inOff + tw, color };
    s.outOff += sw;
    t.inOff += tw;
    ribbons.push(r);
  }
  leftLinks.sort((a, b) => d3.ascending(a.source, b.source) || d3.descending(a.count, b.count))
    .forEach((d) => addRibbon(0, 1, d.source, d.target, d.count, groupColor.get(d.target) || "#777"));
  taskKind.sort((a, b) => d3.ascending(a.source, b.source) || d3.descending(a.count, b.count))
    .forEach((d) => addRibbon(1, 2, d.source, d.target, d.count, groupColor.get(d.source) || "#777"));
  const path = (r: Ribbon) => {
    const x0 = r.sourceNode.x + r.sourceNode.w, x1 = r.targetNode.x;
    const c0 = x0 + (x1 - x0) * 0.48, c1 = x0 + (x1 - x0) * 0.52;
    return `M${x0},${r.sy0} C${c0},${r.sy0} ${c1},${r.ty0} ${x1},${r.ty0} L${x1},${r.ty1} C${c1},${r.ty1} ${c0},${r.sy1} ${x0},${r.sy1} Z`;
  };
  return (
    <figure className="viz-card">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Record domains flow into task groups and actor kinds">
        <text x={colX[0]} y={H - 8} className="axis-label">record area</text>
        <text x={colX[1]} y={H - 8} className="axis-label">kind of work</text>
        <text x={colX[2]} y={H - 8} className="axis-label">who/what performed it</text>
        {ribbons.map((r, i) => <path key={i} d={path(r)} fill={r.color} opacity={0.24}><title>{`${r.source} → ${r.target}: ${fmt(r.count)}`}</title></path>)}
        {[...nodes.values()].map((n) => (
          <g key={`${n.col}:${n.name}`}>
            <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={4} fill={n.col === 1 ? groupColor.get(n.name) || "#555" : "#29313a"} opacity={n.col === 1 ? 0.88 : 0.94} />
            <text x={n.x + 9} y={n.y + Math.min(17, Math.max(12, n.h / 2 + 4))} fill="#fff" fontSize={n.h < 14 ? 9 : 11.5} fontWeight={700}>{n.name}</text>
            {n.h >= 22 ? <text x={n.x + n.w - 8} y={n.y + n.h - 7} textAnchor="end" fill="#e6edf4" fontSize={10}>{fmt(n.total)}</text> : null}
          </g>
        ))}
      </svg>
      <figcaption>Ribbons are counts of attributable fields. Narrow low-frequency record areas are omitted from this overview but remain in the actor table.</figcaption>
    </figure>
  );
}

function Matrix() {
  const rows = (vm.topActors as any[]).slice(0, 26);
  const cells = vm.visualData.topActorTaskMatrix as any[];
  const W = 1060, left = 205, top = 112, cellW = 58, cellH = 22;
  const H = top + rows.length * cellH + 28;
  const max = d3.max(cells, (d: any) => d.count) || 1;
  const byKey = new Map(cells.map((d: any) => [`${d.actorKey}|${d.taskGroup}`, d.count]));
  return (
    <figure className="viz-card matrix-card">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="People by task-group heatmap">
        {taskGroups.map((g, i) => (
          <g key={g.id} transform={`translate(${left + i * cellW + cellW / 2},${top - 12}) rotate(-48)`}>
            <text textAnchor="start" fontSize={10.5} fontWeight={700} fill="#4b5563">{g.label}</text>
          </g>
        ))}
        {rows.map((a, ri) => {
          const y = top + ri * cellH;
          return (
            <g key={a.key}>
              <circle cx={12} cy={y + 10} r={4} fill={a.kind === "Human" ? "#126c5a" : "#6b7280"} />
              <text x={23} y={y + 14} fontSize={11.5} fontWeight={ri < 8 ? 800 : 600} fill="#1f2937">{a.name}</text>
              <text x={left - 9} y={y + 14} textAnchor="end" fontSize={10.5} fill="#6b7280">{fmt(a.touches)}</text>
              {taskGroups.map((g, ci) => {
                const count = byKey.get(`${a.key}|${g.id}`) || 0;
                const opacity = count ? 0.18 + 0.82 * Math.sqrt(count / max) : 0.05;
                return (
                  <rect key={g.id} x={left + ci * cellW} y={y} width={cellW - 4} height={cellH - 4} rx={3} fill={count ? g.color : "#eef1f4"} opacity={opacity}>
                    <title>{`${a.name}: ${fmt(count)} ${g.label}`}</title>
                  </rect>
                );
              })}
            </g>
          );
        })}
      </svg>
      <figcaption>Rows are sorted by total touches. Darker cells indicate a heavier concentration of that actor's record work.</figcaption>
    </figure>
  );
}

function TaskChord() {
  const groups = taskGroups;
  const W = 1060, H = 700, cx = 368, cy = 350;
  const outer = 248, inner = 226;
  const idx = new Map(groups.map((g, i) => [g.id, i]));
  const matrix = groups.map(() => groups.map(() => 0));
  for (const link of vm.visualData.taskCooccurrence as any[]) {
    const i = idx.get(link.source);
    const j = idx.get(link.target);
    if (i == null || j == null) continue;
    matrix[i][j] = link.weight;
    matrix[j][i] = link.weight;
  }
  const chord = d3.chord().padAngle(0.035).sortSubgroups(d3.descending).sortChords(d3.descending)(matrix);
  const arc = d3.arc<any>().innerRadius(inner).outerRadius(outer);
  const ribbon = d3.ribbon<any>().radius(inner - 2);
  const bridgeActors = vm.visualData.topBridgeActors as any[];
  const topLinks = [...(vm.visualData.taskCooccurrence as any[])].slice(0, 8);
  const angle = (d: any) => (d.startAngle + d.endAngle) / 2;
  const labelPos = (d: any) => {
    const a = angle(d) - Math.PI / 2;
    return { x: Math.cos(a) * (outer + 22), y: Math.sin(a) * (outer + 22), flip: angle(d) > Math.PI };
  };
  return (
    <figure className="viz-card chord-card">
      <div className="chord-grid">
        <svg viewBox={`0 0 ${W} ${H}`} className="chart chord-svg" role="img" aria-label="Chord diagram connecting task groups performed by the same named people">
          <g transform={`translate(${cx},${cy})`}>
            <circle r={inner - 26} fill="#f7f9fb" stroke="#dbe2ea" />
            <text textAnchor="middle" y={-12} fontSize={16} fontWeight={850} fill="#1f2937">shared people</text>
            <text textAnchor="middle" y={9} fontSize={12} fill="#687385">connect task groups</text>
            {chord.map((d, i) => {
              const color = groupColor.get(groups[d.source.index].id) || "#777";
              return (
                <path key={i} d={ribbon(d) || ""} fill={color} opacity={0.34} stroke="#fff" strokeWidth={0.45}>
                  <title>{`${groups[d.source.index].label} ↔ ${groups[d.target.index].label}: ${fmt(d.source.value)} bridge weight`}</title>
                </path>
              );
            })}
            {chord.groups.map((g) => {
              const group = groups[g.index];
              const p = labelPos(g);
              const rotate = (angle(g) * 180 / Math.PI) - 90;
              return (
                <g key={group.id}>
                  <path d={arc(g) || ""} fill={group.color} stroke="#fff" strokeWidth={1.5}>
                    <title>{`${group.label}: ${fmt(group.touches)} touches`}</title>
                  </path>
                  <g transform={`translate(${p.x},${p.y}) rotate(${rotate + (p.flip ? 180 : 0)})`}>
                    <text textAnchor={p.flip ? "end" : "start"} fontSize={10.6} fontWeight={800} fill="#374151">{group.label}</text>
                  </g>
                </g>
              );
            })}
          </g>
          <g transform="translate(735,70)">
            <text className="axis-label" x={0} y={0}>strongest bridges</text>
            {topLinks.map((l: any, i: number) => (
              <g key={`${l.source}-${l.target}`} transform={`translate(0,${24 + i * 44})`}>
                <rect x={0} y={0} width={260} height={33} rx={5} fill="#f4f7fa" stroke="#dde4ec" />
                <rect x={0} y={0} width={Math.max(3, Math.min(260, l.weight * 2.1))} height={33} rx={5} fill={groupColor.get(l.source) || "#777"} opacity={0.22} />
                <text x={9} y={13} fontSize={10.3} fontWeight={800} fill="#27313c">{l.source}</text>
                <text x={9} y={27} fontSize={10.3} fontWeight={800} fill="#27313c">+ {l.target}</text>
                <text x={252} y={20} textAnchor="end" fontSize={11} fontWeight={850} fill="#4b5563">{fmt(l.people)} people</text>
              </g>
            ))}
          </g>
        </svg>
        <div className="bridge-list">
          <div className="bridge-title">Broadest human bridges</div>
          {bridgeActors.slice(0, 10).map((a: any) => (
            <div className="bridge-person" key={a.name}>
              <div>
                <b>{a.name}</b>
                <span>{fmt(a.touches)} touches · {a.taskGroupCount} task groups</span>
              </div>
              <div className="mini-bars">
                {taskGroups.map((g) => {
                  const v = a.taskGroups[g.id] || 0;
                  return v ? <i key={g.id} style={{ width: `${Math.max(5, Math.sqrt(v) * 7)}px`, background: g.color }} title={`${g.label}: ${fmt(v)}`} /> : null;
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <figcaption>Ribbon weight is based on named humans who perform both task groups, weighted by the smaller of their two task counts. It highlights operational bridges, not raw volume alone.</figcaption>
    </figure>
  );
}

function DepartmentFingerprints() {
  const depts = (vm.topDepartments as any[]).slice(0, 14).map((d) => d.key);
  const links = (vm.visualData.deptTaskLinks as any[]).filter((d) => depts.includes(d.source));
  const byDept = d3.group(links, (d) => d.source);
  const W = 1060, left = 270, top = 26, rowH = 38, barW = 540;
  const H = top + depts.length * rowH + 50;
  const totals = new Map(depts.map((dept) => [dept, d3.sum(byDept.get(dept) || [], (d: any) => d.count)]));
  const maxTotal = d3.max([...totals.values()]) || 1;
  const x = d3.scaleLinear().domain([0, maxTotal]).range([0, barW]);
  const shortDept = (dept: string) => dept
    .replace("Assoc Physicians ", "")
    .replace("Associated Physicians ", "")
    .replace("UnityPoint Health - Meriter", "Meriter ")
    .replace("GENERIC EXTERNAL DATA DEPARTMENT", "Generic external data")
    .replace("Assoc Physicans BUSINESS SERVICES", "Business services");
  const rows = depts.map((dept) => {
    const total = totals.get(dept) || 0;
    let offset = 0;
    const segs = [...(byDept.get(dept) || [])]
      .sort((a, b) => taskGroups.findIndex((g) => g.id === a.target) - taskGroups.findIndex((g) => g.id === b.target))
      .map((d: any) => {
        const width = x(d.count);
        const seg = { ...d, x0: offset, width };
        offset += width;
        return seg;
      });
    const dominant = [...(byDept.get(dept) || [])].sort((a: any, b: any) => b.count - a.count)[0];
    const diversity = (byDept.get(dept) || []).filter((d: any) => d.count > 0).length;
    return { dept, total, segs, dominant, diversity };
  });
  return (
    <figure className="viz-card dept-card">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Department task fingerprints as horizontal stacked bars">
        <text x={left} y={15} className="axis-label">task mix within each department/context</text>
        <text x={left + barW + 32} y={15} className="axis-label">dominant work</text>
        {rows.map((r, i) => {
          const y = top + i * rowH;
          return (
            <g key={r.dept}>
              <text x={0} y={y + 17} fontSize={12} fontWeight={800} fill="#374151">{shortDept(r.dept)}</text>
              <text x={left - 14} y={y + 17} textAnchor="end" fontSize={11} fill="#6b7280">{fmt(r.total)}</text>
              <rect x={left} y={y + 3} width={barW} height={18} rx={4} fill="#edf1f5" />
              {r.segs.map((s: any) => (
                <rect key={`${r.dept}-${s.target}`} x={left + s.x0} y={y + 3} width={Math.max(1.5, s.width)} height={18} fill={groupColor.get(s.target) || "#777"}>
                  <title>{`${r.dept} · ${s.target}: ${fmt(s.count)}`}</title>
                </rect>
              ))}
              <text x={left + barW + 32} y={y + 13} fontSize={11.5} fontWeight={700} fill="#27313c">{r.dominant?.target ?? "No task"}</text>
              <text x={left + barW + 32} y={y + 28} fontSize={10.5} fill="#6b7280">{r.diversity} task groups</text>
            </g>
          );
        })}
        <line x1={left} x2={left + barW} y1={H - 22} y2={H - 22} stroke="#c9d2dc" />
        {[0, .25, .5, .75, 1].map((p) => (
          <g key={p}>
            <line x1={left + barW * p} x2={left + barW * p} y1={H - 26} y2={H - 18} stroke="#c9d2dc" />
            <text x={left + barW * p} y={H - 4} textAnchor="middle" fontSize={10.5} fill="#6b7280">{fmt(Math.round(maxTotal * p))}</text>
          </g>
        ))}
      </svg>
      <div className="legend compact">
        {taskGroups.map((g) => <span key={g.id}><i style={{ background: g.color }} />{g.label}</span>)}
      </div>
      <figcaption>Each row is scaled to the busiest department/context, so both volume and task composition are comparable without clipping labels.</figcaption>
    </figure>
  );
}

function Timeline() {
  const cells = vm.visualData.yearTaskGrid as any[];
  const years = [...new Set(cells.map((d) => d.year))].sort();
  const W = 1060, left = 210, top = 24, cellW = Math.min(72, (W - left - 24) / years.length), cellH = 25;
  const H = top + taskGroups.length * cellH + 34;
  const max = d3.max(cells, (d) => d.count) || 1;
  const byKey = new Map(cells.map((d) => [`${d.year}|${d.taskGroup}`, d.count]));
  return (
    <figure className="viz-card">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Task groups by year">
        {years.map((y, i) => <text key={y as any} x={left + i * cellW + cellW / 2} y={15} textAnchor="middle" fontSize={11} fontWeight={700} fill="#4b5563">{String(y)}</text>)}
        {taskGroups.map((g, ri) => (
          <g key={g.id}>
            <text x={0} y={top + ri * cellH + 16} fontSize={11.5} fontWeight={700} fill="#374151">{g.label}</text>
            {years.map((y, ci) => {
              const count = byKey.get(`${y}|${g.id}`) || 0;
              return <rect key={y as any} x={left + ci * cellW} y={top + ri * cellH} width={cellW - 4} height={cellH - 5} rx={3} fill={count ? g.color : "#edf0f3"} opacity={count ? 0.18 + 0.82 * Math.sqrt(count / max) : 0.7}><title>{`${y} · ${g.label}: ${fmt(count)}`}</title></rect>;
            })}
          </g>
        ))}
      </svg>
      <figcaption>The 2027 column is scheduled/future record structure present in the export, not completed future care.</figcaption>
    </figure>
  );
}

function DualIdentityLedger() {
  const rows = vm.dualIdHumans as any[];
  return (
    <div className="ledger-wrap">
      {rows.slice(0, 18).map((a) => (
        <div className="identity-row" key={a.key}>
          <div>
            <b>{a.name}</b>
            <span>{a.sourceIds.join(" · ")}</span>
          </div>
          <div className="mini-bars">
            {taskGroups.map((g) => {
              const v = a.taskGroups[g.id] || 0;
              if (!v) return null;
              return <i key={g.id} style={{ width: `${Math.max(4, Math.sqrt(v) * 7)}px`, background: g.color }} title={`${g.label}: ${fmt(v)}`} />;
            })}
          </div>
          <em>{fmt(a.touches)} touches · {a.taskGroupCount} task groups</em>
        </div>
      ))}
    </div>
  );
}

function ActorTable() {
  const [filter, setFilter] = React.useState("all");
  const rows = (vm.actors as any[]).filter((a) => filter === "all" || a.kind === filter).slice(0, 42);
  return (
    <div className="actor-panel">
      <div className="seg">
        {["all", "Human", "System / placeholder", "External source"].map((f) => (
          <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>{f === "all" ? "All" : f}</button>
        ))}
      </div>
      <table className="grid">
        <thead><tr><th>Actor</th><th>Kind</th><th className="num">Touches</th><th>Heaviest roles</th><th>Departments / contexts</th></tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.key}>
              <td><b>{a.name}</b><small>{a.sourceIds.join(" · ")}</small></td>
              <td>{a.kind}</td>
              <td className="num">{fmt(a.touches)}</td>
              <td>{a.topRoles.slice(0, 3).map((r: any) => <span className="pill" key={r.key}>{r.key} <b>{fmt(r.count)}</b></span>)}</td>
              <td>{a.topDepartments.slice(0, 3).map((d: any) => <span className="dept-chip" key={d.key}>{d.key} <b>{fmt(d.count)}</b></span>)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SourceTableSummary() {
  return (
    <div className="source-grid">
      {(vm.rollups.sourceTables as any[]).map((s) => <div key={s.key}><b>{s.key}</b><span>{fmt(s.count)}</span></div>)}
    </div>
  );
}

function App() {
  const drawer = useDrawer();
  return (
    <DrawerContext.Provider value={drawer}>
      <main className="page">
        <header className="page-head">
          <div className="eyebrow">Epic EHI deep dive · people and record responsibility</div>
          <h1>Who touched the record?</h1>
          <p className="dek">{vm.summary[0]} <Cite ids="e_scope" /></p>
          <StatStrip />
        </header>

        <section className="section">
          <h2>The record is a production network, not a list of doctors</h2>
          <Prose id="map" />
          <Alluvial />
        </section>

        <section className="section">
          <h2>People roll up differently depending on the task</h2>
          <Prose id="people" />
          <TaskChord />
          <Matrix />
          <DualIdentityLedger />
        </section>

        <section className="section">
          <h2>Departments and workqueues leave distinct fingerprints</h2>
          <Prose id="departments" />
          <DepartmentFingerprints />
        </section>

        <section className="section">
          <h2>The task mix changes over the export</h2>
          <Timeline />
        </section>

        <section className="section">
          <h2>Inspect the actors</h2>
          <ActorTable />
        </section>

        <section className="section">
          <h2>Scope and limits</h2>
          <Prose id="limits" />
          <SourceTableSummary />
        </section>

        <footer className="foot">Built from a display-clean view model generated from the local EHI SQLite database. Provider names, staff names, dates, departments, and clinical task labels are shown; direct identifiers are not emitted.</footer>
      </main>
      <SourceDrawer />
    </DrawerContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
