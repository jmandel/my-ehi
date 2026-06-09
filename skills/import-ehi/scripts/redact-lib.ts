//
// redact-lib.ts — term hygiene + variant expansion shared by 03-assemble / 04-redact / 05-verify.
//
// Two jobs: (1) keep GENERIC/category values out of the redact set (redacting "OTHER" would wreck the
// corpus); (2) expand each real identifier into the forms it actually appears in — a name in first-last,
// last-first, and standalone components; a date in every common format — because the fuzzy regex only
// absorbs punctuation/spacing, not reordering or reformatting.

// Generic Epic category values + common words that must NEVER be redaction terms.
export const STOPWORDS = new Set([
  "other", "none", "unknown", "unspecified", "not specified", "null", "n/a", "na", "self", "patient",
  "yes", "no", "true", "false", "male", "female", "declined", "refused", "decline", "not on file",
  "spouse", "child", "wife", "husband", "daughter", "son", "mother", "father", "parent", "guardian",
  "home", "work", "mobile", "cell", "primary", "secondary", "active", "inactive", "deceased", "living",
]);

export function junkReason(value: string): string | null {
  const v = value.trim();
  if (v.replace(/\s+/g, "").length < 3) return "too short";
  if (STOPWORDS.has(v.toLowerCase())) return "generic/category value";
  if (/^\d{1,2}$/.test(v)) return "bare small number";
  return null;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON = MONTHS.map((m) => m.slice(0, 3));

function parseDate(s: string): { y: number; m: number; d: number } | null {
  const t = s.replace(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)[a-z]*\.?\s+/i, "").trim();
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\b/))) return { m: +m[1], d: +m[2], y: +m[3] };
  if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})\b/))) return { m: +m[1], d: +m[2], y: 2000 + +m[3] };
  if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\b/))) return { y: +m[1], m: +m[2], d: +m[3] };
  if ((m = t.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/))) {
    const mi = MONTHS.findIndex((x) => x.toLowerCase().startsWith(m![1].slice(0, 3).toLowerCase()));
    if (mi >= 0) return { m: mi + 1, d: +m[2], y: +m[3] };
  }
  if ((m = t.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})\b/))) {
    const mi = MONTHS.findIndex((x) => x.toLowerCase().startsWith(m![2].slice(0, 3).toLowerCase()));
    if (mi >= 0) return { m: mi + 1, d: +m[1], y: +m[3] };
  }
  return null;
}
export const looksLikeDate = (s: string) => parseDate(s) != null;

export function expandDate(s: string): string[] {
  const dt = parseDate(s);
  if (!dt) return [s.trim()];
  const { y, m, d } = dt, mm = String(m).padStart(2, "0"), dd = String(d).padStart(2, "0"), yy = String(y).slice(-2);
  const M = MONTHS[m - 1], Mo = MON[m - 1];
  return [...new Set([
    `${m}/${d}/${y}`, `${mm}/${dd}/${y}`, `${m}/${d}/${yy}`, `${mm}/${dd}/${yy}`,
    `${y}-${mm}-${dd}`,
    `${M} ${d}, ${y}`, `${M} ${d} ${y}`, `${Mo} ${d}, ${y}`, `${Mo} ${d} ${y}`, `${d} ${Mo} ${y}`, `${d} ${M} ${y}`,
  ])];
}

export const looksLikeName = (value: string, type: string) =>
  type === "name" || /^[A-Z][A-Za-z'-]+\s*,\s*[A-Z][A-Za-z'-]+/.test(value);

export function expandName(s: string): string[] {
  let last = "", first = "", mid = "";
  if (s.includes(",")) {
    const [l, rest] = s.split(",", 2); last = l.trim();
    const r = rest.trim().split(/\s+/); first = r[0] || ""; mid = r.slice(1).join(" ");
  } else {
    const r = s.trim().split(/\s+/);
    if (r.length >= 2) { first = r[0]; last = r[r.length - 1]; mid = r.slice(1, -1).join(" "); } else first = r[0] || "";
  }
  const out = new Set<string>([s.trim()]);
  if (first && last) {
    out.add(`${first} ${last}`); out.add(`${last} ${first}`); out.add(`${last}, ${first}`);
    if (mid) { out.add(`${first} ${mid} ${last}`); out.add(`${last}, ${first} ${mid}`); }
  }
  if (last.length >= 3) out.add(last);     // standalone surname (usually safe; rare names)
  if (first.length >= 3) out.add(first);   // standalone first name (may over-match common names — accepted for 3rd-party safety)
  return [...out].filter((v) => v.replace(/\s+/g, "").length >= 3 && !STOPWORDS.has(v.toLowerCase()));
}

// All the string forms one identifier should be matched in.
export function expandTerm(value: string, type: string): string[] {
  if (looksLikeDate(value)) return expandDate(value);
  if (looksLikeName(value, type)) return expandName(value);
  return [value.trim()];
}

// fuzzy regex: char-by-char with a short gap of punctuation + SPACE only — NOT tab/newline, so a match can
// never span a TSV field separator (tab) or row boundary and merge columns. (Values split across RTF control
// words are still caught downstream, because 05-verify decodes each RTF to plain text and re-scans.)
// USE FOR IDs/phones/SSN/email/dates — values whose only variants are punctuation/spacing. NOT for names.
const GAP = "[\\-_.,()\\[\\]{}/\\\\ \\xa0]{0,3}";
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const fuzzy = (term: string) =>
  new RegExp(term.replace(/\s+/g, "").split("").map((c) => esc(c)).join(GAP), "gi");

// NAME matcher: whole-WORD, not char-by-char. A short first name must match only as a complete word —
// never as the same letters buried inside a longer, unrelated word — or it would redact chunks of clinical
// text (a 4-letter name otherwise matches a stray substring of an ordinary word). Multi-word variants allow
// flexible space/punct between tokens, each token bounded by non-letters. This is why names get variant-
// EXPANSION (forms) but word-level MATCHING, while IDs/phones get the char-gap fuzzy.
export function nameMatcher(variant: string): RegExp {
  const toks = variant.split(/[^A-Za-z0-9]+/).filter((t) => t.length >= 2).map(esc);
  if (!toks.length) return /[^\s\S]/;                       // never matches
  return new RegExp(`(?<![A-Za-z])${toks.join("[\\s,.()'\\-]{1,3}")}(?![A-Za-z])`, "gi");
}

// pick the right matcher for a value's type.
export const matcherFor = (variant: string, type: string): RegExp =>
  type === "name" ? nameMatcher(variant) : fuzzy(variant);
