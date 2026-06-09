/**
 * ui.tsx — page shell + layout primitives for a deep dive. The story is the spine; these keep it legible.
 */
import React from "react";

export function PageShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="dd">
      <header className="dd-header">
        <h1>{title}</h1>
        {subtitle ? <p className="dd-subtitle">{subtitle}</p> : null}
      </header>
      <main>{children}</main>
    </div>
  );
}

export function Section({ id, title, kicker, children }: { id?: string; title: string; kicker?: string; children: React.ReactNode }) {
  return (
    <section className="dd-section" id={id}>
      {kicker ? <div className="dd-kicker">{kicker}</div> : null}
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/** Wrap a chart with a caption + (optional) source marker; charts answer a question posed in prose. */
export function Figure({ caption, children }: { caption: React.ReactNode; children: React.ReactNode }) {
  return (
    <figure className="dd-figure">
      <div className="dd-figure-body">{children}</div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

/** A headline statistic with label and optional context line. */
export function Stat({ value, label, context }: { value: React.ReactNode; label: string; context?: React.ReactNode }) {
  return (
    <div className="dd-stat">
      <div className="dd-stat-value">{value}</div>
      <div className="dd-stat-label">{label}</div>
      {context ? <div className="dd-stat-context">{context}</div> : null}
    </div>
  );
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return <div className="dd-statrow">{children}</div>;
}
