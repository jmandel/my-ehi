#!/usr/bin/env bun
/**
 * rtf2txt.ts — robust RTF → plain text for Epic clinical notes & message bodies.
 *
 * Handles the cases that trip naive strippers (and bit an abstraction-pass agent): table-structured notes
 * (`\cell`/`\row`), non-breaking spaces (`\~`), hex escapes (`\'xx`), unicode (`\uNNNN`), and skippable
 * groups (font/color/stylesheet tables, `\*\...` destinations like field instructions). The goal is
 * readable prose, not perfect fidelity.
 *
 * Usage:
 *   bun lib/rtf2txt.ts <file.rtf>                 # print extracted text
 *   bun lib/rtf2txt.ts "raw/Rich Text/HNO_*.RTF"  # (shell-expanded) first match
 *   import { rtfToText } from "./lib/rtf2txt.ts"
 */

export function rtfToText(rtf: string): string {
  let i = 0;
  const n = rtf.length;
  let out = "";
  // Stack of group-skip flags: when truthy, text in the current/nested group is suppressed
  // (used for font/color/stylesheet tables and \*\ destinations).
  const skipStack: boolean[] = [false];
  const skipDepth = () => skipStack[skipStack.length - 1];

  const emit = (s: string) => { if (!skipDepth()) out += s; };

  while (i < n) {
    const c = rtf[i];
    if (c === "{") { skipStack.push(skipDepth()); i++; continue; }
    if (c === "}") { if (skipStack.length > 1) skipStack.pop(); i++; continue; }
    if (c === "\\") {
      const next = rtf[i + 1];
      // \'xx hex escape
      if (next === "'") {
        const hex = rtf.slice(i + 2, i + 4);
        const code = parseInt(hex, 16);
        if (!Number.isNaN(code)) emit(decodeByte(code));
        i += 4;
        continue;
      }
      // Special single-char control symbols
      if (next === "~") { emit(" "); i += 2; continue; }   // non-breaking space
      if (next === "-" || next === "_") { i += 2; continue; }   // optional/​non-breaking hyphen
      if (next === "*") { skipStack[skipStack.length - 1] = true; i += 2; continue; } // \*\ destination
      if (next === "\\" || next === "{" || next === "}") { emit(next); i += 2; continue; }
      if (next === "\n" || next === "\r") { emit("\n"); i += 2; continue; }
      // Control word: \word[-]number? then optional single space
      const m = /^\\([a-zA-Z]+)(-?\d+)?\s?/.exec(rtf.slice(i));
      if (m) {
        const word = m[1];
        const arg = m[2];
        i += m[0].length;
        if (word === "u" && arg != null) {              // \uNNNN unicode
          let code = parseInt(arg, 10);
          if (code < 0) code += 65536;
          emit(String.fromCharCode(code));
          // skip the following fallback char (\ucN defaults to 1)
          if (rtf[i] === "?" ) i++;
          continue;
        }
        // Destinations whose contents are not body text:
        if (["fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "themedata",
             "colorschememapping", "latentstyles", "datastore", "generator"].includes(word)) {
          skipStack[skipStack.length - 1] = true;
          continue;
        }
        // Breaks / whitespace control words → layout whitespace:
        if (word === "par" || word === "line" || word === "row" || word === "sect" || word === "page") { emit("\n"); continue; }
        if (word === "cell" || word === "tab" || word === "nestcell") { emit("\t"); continue; }
        // Everything else (formatting) → no text.
        continue;
      }
      i++; // stray backslash
      continue;
    }
    if (c === "\r" || c === "\n") { i++; continue; } // raw line breaks are layout, not content
    emit(c);
    i++;
  }
  // Tidy whitespace: collapse runs of blank lines, trim trailing spaces per line.
  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ /g, " ")
    .split("\n").map((l) => l.replace(/[ \t]+$/g, "")).join("\n")
    .trim();
}

// Epic RTF is typically ANSI/Windows-1252; map the common high-bytes, fall back to Latin-1.
function decodeByte(code: number): string {
  const cp1252: Record<number, string> = {
    0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—",
    0x85: "…", 0xa0: " ", 0xb0: "°", 0xae: "®", 0xa9: "©",
  };
  return cp1252[code] ?? String.fromCharCode(code);
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) { console.error('usage: bun lib/rtf2txt.ts <file.rtf>'); process.exit(1); }
  console.log(rtfToText(await Bun.file(path).text()));
}
