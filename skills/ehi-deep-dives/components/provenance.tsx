/**
 * provenance.tsx — the clean evidence drawer: every claim drills to its source, rendered for a HUMAN.
 *
 * HARD RULE: the drawer reads like a clinician's note or one readable line — NEVER a Clarity row dump
 * (no raw column names, internal ids, locator strings, or `12:00:00 AM` timestamps). The cleaning already
 * happened at projection: the view model carries an `evidence` MAP keyed by a stable id, each entry a
 * verbatim note quote or a readable statement. The app cites ids; it never resolves raw rows at render time.
 * (This is the whole point of the view-first split — see SKILL.md. If you find yourself wanting to render a
 * dataset row here, stop: clean it into an evidence entry in the view model instead.)
 *
 *   import vm from "./viewmodel.json";
 *   <EvidenceProvider evidence={vm.evidence}>  …page…  <SourceDrawer/>  </EvidenceProvider>
 *   <Cite ids="e_carc_45" label="Net composition" />   // a ⌖ that opens the drawer onto evidence["e_carc_45"]
 *
 * An evidence entry is one of:
 *   { kind: "note", who?, date?, quote }   — a verbatim note/message quote
 *   { kind: "fact", who?, date?, text }    — a readable statement of a structured fact (already display-clean)
 * Build these in the abstraction pass (parts/ + the assemble script), never at render time.
 */
import React from "react";
import { create } from "zustand";

// "note" and "message" are quoted evidence (a verbatim note / MyChart-message line); "fact" is a readable statement.
export type Evidence = { kind: "note" | "message" | "fact"; who?: string; date?: string; quote?: string; text?: string };
export type EvidenceMap = Record<string, Evidence>;

const Ctx = React.createContext<EvidenceMap>({});
export function EvidenceProvider({ evidence, children }: { evidence: EvidenceMap; children: React.ReactNode }) {
  return <Ctx.Provider value={evidence}>{children}</Ctx.Provider>;
}

type DrawerState = { ids: string[] | null; open: (ids: string[]) => void; close: () => void };
export const useDrawer = create<DrawerState>((set) => ({
  ids: null,
  open: (ids) => set({ ids }),
  close: () => set({ ids: null }),
}));

/** A ⌖ marker that opens the evidence drawer onto the given evidence id(s). */
export function Cite({ ids, label }: { ids: string | string[]; label?: string }) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  const open = useDrawer((s) => s.open);
  if (!list.length) return null;
  return (
    <button className="cite" title={label ?? "Show evidence"} aria-label={label ?? "Show evidence"}
      onClick={(e) => { e.stopPropagation(); open(list); }}>
      ⌖{list.length > 1 ? <span className="cite-n">{list.length}</span> : null}
    </button>
  );
}

/** Render one evidence entry as a clean note quote or a readable statement — never a raw row. */
export function EvidenceBlock({ id }: { id: string }) {
  const e = React.useContext(Ctx)[id];
  if (!e) return <div className="src-block"><div className="src-meta">Evidence not found: {id}</div></div>;
  const provenance = [e.who, e.date].filter(Boolean).join(" · ");
  const quoted = e.kind === "note" || e.kind === "message";   // both carry a verbatim `quote`
  return (
    <div className="src-block">
      <div className="src-head">
        <span className="src-tag">{e.kind === "note" ? "note quote" : e.kind === "message" ? "message" : "record"}</span>
        {provenance && <span className="src-meta">{provenance}</span>}
      </div>
      {quoted
        ? <blockquote className="src-quote">{e.quote}</blockquote>
        : <p className="src-statement">{e.text}</p>}
    </div>
  );
}

export function SourceDrawer() {
  const ids = useDrawer((s) => s.ids);
  const close = useDrawer((s) => s.close);
  React.useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);
  if (!ids) return null;
  return (
    <>
      <div className="drawer-scrim" onClick={close} />
      <aside className="drawer" role="dialog" aria-label="Evidence">
        <div className="drawer-head">
          <span className="drawer-title">Evidence{ids.length > 1 ? ` · ${ids.length} sources` : ""}</span>
          <button className="drawer-close" onClick={close} aria-label="Close">×</button>
        </div>
        <div className="drawer-body">
          {ids.map((id) => <EvidenceBlock key={id} id={id} />)}
        </div>
      </aside>
    </>
  );
}
