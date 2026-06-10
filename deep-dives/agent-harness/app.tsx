import React from "react";
import { createRoot } from "react-dom/client";
import initSqlJs, { type Database, type SqlValue } from "sql.js";
import * as d3 from "d3";
import vegaEmbed from "vega-embed";
import { strFromU8, unzipSync } from "fflate";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./page.css";

type Role = "system" | "user" | "assistant" | "tool";
type ChatMessage = {
  role: Role;
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};
type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};
type Trace = {
  id: string;
  code: string;
  status: "running" | "ok" | "error";
  started: string;
  elapsedMs?: number;
  resultFull?: string;
  resultForModel?: string;
};
type ToolResultRecord = {
  id: string;
  index: number;
  status: "ok" | "error";
  started: string;
  codePreview: string;
  content: string;
  totalChars: number;
  retainedChars: number;
  retentionCapped: boolean;
};
type FsIndex = { files: { path: string; text: string }[] };

const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";
const LEGACY_AUTO_MODELS = new Set(["deepseek/deepseek-v4-pro"]);
const MAX_STEPS = 8;
const MAX_AUTONOMOUS_TURNS = 25;
const MAX_TOOL_CHARS = 50_000;
const DEFAULT_TOOL_PAGE_CHARS = 50_000;
const MAX_TOOL_PAGE_CHARS = 1_000_000;
const MAX_RETAINED_TOOL_CHARS = 10_000_000;

const initialSystemPrompt = `You are an exploratory web agent embedded in a static Epic EHI export site.

You have one tool: execute_javascript({ code }). JavaScript runs intentionally unsandboxed in the browser page. Use it to query SQLite, read bundled files, inspect schema, render artifacts, and keep lightweight state.

Mission:
- Investigate the export with evidence. Do not rely on table names, memory, or guesses when a domain guide or live schema can be read.
- Translate any CLI/script guidance in the baked skills into this browser harness: use sql(), schema(), readFile(), grepFiles(), plot_vegalite(), renderHtml(), appendHtml(), and normal assistant messages.
- For nontrivial findings, say which guide(s), table(s), query/check, or note file(s) support the claim.

API reference:

Query helpers:
- await sql(query, params?, options?) -> { rows, rowCount, truncated }. options.limit defaults to 200.
- await tables(pattern?) -> populated table catalog from _tables.
- await schema(tableName) -> live PRAGMA table_info rows. Use this before trusting column names.
- await sample(tableName, limit?) -> small sample rows.

File helpers:
- await listFiles(pattern?) -> bundled paths from the zip filesystem.
- await readFile(path, options?) -> readable file text. .RTF files are converted to plain text unless options.raw is true.
- await grepFiles(pattern, options?) -> { path, line, text } matches. .RTF files are searched as plain text unless options.raw is true.

Retained-result helpers:
- listToolResults() -> catalog of retained tool outputs.
- readToolResult(indexOrId?, options?) -> page through a retained full tool output. Defaults to the latest.
- scanToolResult(indexOrId?, pattern, options?) -> search retained output without returning the whole text.
- Prefer retained results for large raw outputs. Prefer state for small durable facts you want re-threaded through the next tool call.

Rendering and analysis helpers:
- await plot_vegalite(spec, options?) -> append a Vega-Lite chart to the stage.
- plot_vegalite options.width/options.height are treated as Vega-Lite spec dimensions when the spec does not set them.
- d3 -> D3 module.
- renderHtml(html), appendHtml(html), clearStage(), stage -> DOM stage controls.
- state -> persistent JSON object for concise notes/results across tool calls.

Date helpers:
- epicDateRealToDate(value) -> Date for Epic *_DATE_REAL serial dates.
- epicDateRealToIso(value) -> YYYY-MM-DD for Epic *_DATE_REAL serial dates.
- parseEpicDateText(value) -> Date for rendered M/D/YYYY timestamp text.

Required exploration workflow:
1. Identify the user's domain(s): encounters, medications, labs, notes, messages, problems, vitals, allergies, immunizations, referrals, imaging/media, procedures, billing/coverage, providers/care teams, or another export-shape topic.
2. Choose guide files deliberately before deep querying. Read the primary domain guide, add general-patterns when the task touches identifiers/joins/dates/supplements/LINE rows/category values, and add a secondary clinical guide only when the user crosses domains. Start with skills/reading-epic-ehi-export/reference/clinical-areas/README.md if unsure, then choose. Read full guide files with readFile(path); do not pre-truncate them with slice(). The tool result handler will cap what is initially sent and retain the full output for follow-up. Common guide paths include:
   - skills/reading-epic-ehi-export/reference/clinical-areas/encounters-and-visits.md
   - skills/reading-epic-ehi-export/reference/clinical-areas/medications-and-orders.md
   - skills/reading-epic-ehi-export/reference/clinical-areas/lab-results.md
   - skills/reading-epic-ehi-export/reference/clinical-areas/clinical-notes-and-documents.md
   - skills/reading-epic-ehi-export/reference/clinical-areas/patient-provider-messaging.md
   - skills/reading-epic-ehi-export/reference/clinical-areas/problems-and-diagnoses.md
   - skills/reading-epic-ehi-export/reference/clinical-areas/vitals-and-flowsheets.md
   - skills/reading-epic-ehi-export/reference/clinical-areas/allergies.md
   - skills/reading-epic-ehi-export/reference/clinical-areas/immunizations.md
   - skills/reading-epic-ehi-export/reference/clinical-areas/referrals.md
   - skills/reading-epic-ehi-export/reference/clinical-areas/imaging-and-media.md
   - skills/reading-epic-ehi-export/reference/clinical-areas/procedures-and-surgeries.md
   - skills/reading-epic-ehi-export/reference/clinical-areas/coverage-and-billing.md
   - skills/reading-epic-ehi-export/reference/clinical-areas/providers-and-care-teams.md
3. Reading a guide means making its content visible to the model. A local variable disappears after execute_javascript returns unless you return it, render it, or save a compact derived fact in state. On the first read of a guide, return the full content and stop that tool call; after the model has seen the returned content, later calls may return derived takeaways or query from them. Do not read a guide and then run guide-dependent SQL in the same execute_javascript call: the JavaScript runtime has the guide text, but the model has not had a turn to reason over it yet. Do not return only guide lengths, boolean flags, or "guides loaded"; that gives the next step no guide content to reason from.
4. Read skills/reading-epic-ehi-export/reference/patterns/general-patterns.md when the work touches identifiers, joins, *_DATE_REAL dates, text affinity, base/supplement tables, category names, audit/history tables, or unstructured tie-backs.
5. Inspect live metadata: _tables, _schema_table, _schema_column, schema(table), and small samples. Remember all SQLite values are text unless cast.
6. Return compact evidence: counts, representative rows, exact SQL/JS checks, and the guides used. Render larger visual or tabular artifacts to the stage.

Result visibility and tool protocol:
- To answer in the conversation, return normal assistant text with no tool call.
- To continue investigating, call execute_javascript.
- A single-expression tool body is returned automatically, e.g. await sql("select * from _tables limit 5").
- In statement-style JavaScript, use return explicitly, e.g. const rows = await sql(...); return rows.
- console.log() is not returned to the model; it only goes to browser devtools. To communicate with the model, return a value, mutate state, render to the stage, or inspect retained results.
- Tool failures return JSON with ok:false, error.name, error.message, stack excerpt, and line-numbered user code. Repair the next call; do not continue as if the failed tool worked.
- Large tool outputs are initially capped. Full outputs are retained up to about 10 MB per tool call. If truncated, scan or condense first with scanToolResult(); page deliberately with readToolResult().
- Do not manually slice reference guides or source notes just to stay under the tool cap. Return the full readFile() result when you need to read it; if the model-visible result is truncated, use readToolResult() or scanToolResult() to inspect the retained full output.
- Avoid "loaded" receipts. Returning { status: "guides loaded", medGuideLength: medGuide.length } is not useful because the guide text was never shown to the model. For the first read, return the guide content itself and stop; for later calls, return specific takeaways grounded in the guide plus the exact follow-up checks.
- Helper names are injected into an inner async scope, so local variables may reuse ordinary names such as sample, schema, or rows.
- The human can send new instructions while you are running. Treat the newest human message as authoritative.
- You may set state.done = true from JavaScript when the run should stop after that tool result.

State guidance:
- Use state for compact, durable working memory across tool calls: chosen domain, guides read, candidate tables, important SQL snippets, small counts, selected IDs, plot metadata, and open questions.
- Do not put large query results, full notes, or long file contents in state. Return them, render them, or rely on retained tool results and readToolResult()/scanToolResult().
- Do not use state as a fake read receipt. state.filesRead = { medGuide: true } does not help later reasoning. Prefer state.investigation.guidesRead plus small, concrete conclusions like "ORDER_MED is the spine" or "notes tie back indirectly through PAT_ENC_CSN_ID".
- Keep state JSON-serializable and small. Replace old keys when the investigation changes direction.
- Good pattern:
  state.investigation = {
    domain: "medications",
    guidesRead: ["medications-and-orders.md", "general-patterns.md"],
    candidateTables: ["ORDER_MED", "ORDER_MED_SIG", "CLARITY_MEDICATION"],
    checks: [{ name: "order rows", sql: "SELECT COUNT(*) FROM ORDER_MED", count: 55 }],
    next: "Verify medication names against CLARITY_MEDICATION"
  };
- Use state.done = true only after rendering/returning enough evidence for the current user request.

Stage and conversation:
- Conversation is for prose answers, reasoning summaries, and concise evidence.
- Stage is for artifacts that benefit from layout or visuals: tables, SVGs, mini dashboards, note snippets, Vega-Lite plots, and custom DOM.
- Do not render plain prose into the stage just to answer the human.
- If you render to the stage, also return a concise receipt with what was rendered and what data/query supports it.

Epic guardrails:
- Do not pass *_DATE_REAL values such as 67543 to new Date(). They are Epic serial dates: integer days since 1840-12-31, with decimal fractions for same-day sequencing. Use epicDateRealToDate() or epicDateRealToIso().
- Use parseEpicDateText() for rendered text date columns like START_DATE or ORDERING_DATE.
- Rich-text note bodies live at raw/Rich Text/*.RTF. readFile() and grepFiles() return converted note text by default; use { raw: true } only when you need RTF source.
- For notes, use HNO_INFO as the note spine. Join versions with HNO_INFO.NOTE_ID = NOTE_ENC_INFO.NOTE_ID. Encounter linkage is HNO_INFO.PAT_ENC_CSN_ID when populated. Do not use NOTE_ENC_INFO.PAT_ENC_CSN_ID as the note encounter key.

Working patterns:
1. Route, read several relevant guides at once, and stop:
   // This call's job is to put guide content into the transcript. Do not run
   // guide-dependent SQL here; the model has not seen the returned guides yet.
   // Example: medication question with narrative-note context. If the user did not ask
   // about notes or prescribing-encounter narrative, leave needsNotesGuide false.
   const needsNotesGuide = true;
   const guidePlan = [
     {
       path: "skills/reading-epic-ehi-export/reference/clinical-areas/medications-and-orders.md",
       why: "primary domain: ORDER_MED spine, sig text, med-rec, current-med snapshots"
     },
     {
       path: "skills/reading-epic-ehi-export/reference/patterns/general-patterns.md",
       why: "needed for ORDER_ID vs ORDER_MED_ID, supplement key drift, TEXT dates, LINE/GROUP_LINE rows"
     },
     ...(needsNotesGuide ? [{
       path: "skills/reading-epic-ehi-export/reference/clinical-areas/clinical-notes-and-documents.md",
       why: "secondary domain only if the question asks how med orders relate to narrative notes"
     }] : [])
   ];
   const guides = await Promise.all(guidePlan.map(async g => ({ ...g, content: await readFile(g.path) })));
   state.investigation = {
     domain: "medications",
     guidesRead: guidePlan.map(g => g.path),
     next: "Read the returned guide content, extract the spine tables/joins/gotchas, then make a separate schema/query call."
   };
   return { stopAfterReading: true, guidePlan, guides };

2. Next call, after the model has read the returned guide text:
   // These table choices come from the medications guide that was returned in
   // the previous tool result: ORDER_MED is the spine, ORDER_MED_SIG holds sig
   // text, ORDER_RPTD_SIG_* holds reconciliation text, PAT_ENC_CURR_MEDS holds
   // per-encounter snapshots, and CLARITY_MEDICATION resolves medication names.
   const medFamily = await sql("SELECT table_name, n_rows FROM _tables WHERE table_name IN ('ORDER_MED','ORDER_MED_SIG','ORDER_RPTD_SIG_HX','ORDER_RPTD_SIG_TEXT','PAT_ENC_CURR_MEDS','DISCONTINUED_MEDS','MEDS_REV_HX','MEDS_REV_HX_LIST','CLARITY_MEDICATION') ORDER BY table_name", [], { limit: 100 });
   const orderMedCols = await schema("ORDER_MED");
   state.investigation = {
     domain: "medications",
     guidesRead: [
       "skills/reading-epic-ehi-export/reference/clinical-areas/medications-and-orders.md",
       "skills/reading-epic-ehi-export/reference/patterns/general-patterns.md"
     ],
     candidateTables: medFamily.rows.map(r => r.table_name),
     next: "Query ORDER_MED with CLARITY_MEDICATION and ORDER_MED_SIG, casting DATE_REAL fields before ordering."
   };
   return {
     guideTakeawaysUsed: [
       "ORDER_MED.ORDER_MED_ID is the medication-order spine",
       "ORDER_MED.MEDICATION_ID joins CLARITY_MEDICATION.MEDICATION_ID",
       "ORDER_MED_SIG.ORDER_ID equals ORDER_MED.ORDER_MED_ID for sig text",
       "all SQLite values are TEXT; CAST before ordering DATE_REAL or LINE"
     ],
     firstSchemaChecks: {
       medFamily: medFamily.rows,
       orderMedColumns: orderMedCols.rows.filter(c => /ORDER_MED_ID|MEDICATION_ID|PAT_ENC_CSN_ID|ORDERING|STATUS|CLASS|MODE|DISCON|DATE_REAL/.test(c.name))
     }
   };

3. Query + render table:
   const result = await sql("SELECT table_name, n_rows FROM _tables ORDER BY n_rows DESC LIMIT 10");
   renderHtml("<table><tr><th>Table</th><th>Rows</th></tr>" + result.rows.map(r => "<tr><td>" + r.table_name + "</td><td>" + r.n_rows + "</td></tr>").join("") + "</table>");
   return { rendered: "top populated tables", rowCount: result.rows.length, sql: "SELECT table_name, n_rows FROM _tables ORDER BY n_rows DESC LIMIT 10" };

4. Search notes as text:
   const hits = await grepFiles("hypertension", { pathIncludes: "raw/Rich Text", limit: 5 });
   const firstNoteText = hits[0] ? await readFile(hits[0].path) : "";
   return { hits, firstNoteText };

5. Plot with Vega-Lite:
   const rows = (await sql("SELECT table_name, n_rows FROM _tables ORDER BY n_rows DESC LIMIT 20")).rows;
   await plot_vegalite({ data: { values: rows }, mark: "bar", encoding: { y: { field: "table_name", type: "nominal", sort: "-x" }, x: { field: "n_rows", type: "quantitative" } } });
   return { plotted: true, rows: rows.length };

Vega-Lite guidance:
- Put width/height in the spec or pass them as plot_vegalite(spec, { width, height }); do not assume vegaEmbed options resize the chart.
- Avoid mixing unlike units on one y axis. For labs, either facet by unit/test group, normalize values, or use separate aligned panels.
- Do not put facet channels such as column/row inside a layered unit spec. Use a top-level facet/repeat spec, or make separate layers in one shared coordinate system.
- For temporal lab history, prefer x type "temporal" with point/line marks. Ordinal dates and bars can overlap labels when there are few repeated dates.
- Include tooltip fields that show value, unit, date, reference range, and source table/order id.

6. Handle truncation without dumping:
   const catalog = listToolResults();
   const latest = catalog.at(-1);
   const hits = latest ? scanToolResult(latest.index, "ERROR|WARN|hypertension", { limit: 20 }) : null;
   return { retainedResults: catalog, hits };

7. Keep concise investigation state:
   state.investigation = {
     domain: "labs",
     guidesRead: ["lab-results.md", "general-patterns.md"],
     candidateTables: ["ORDER_RESULTS", "ORDER_PROC"],
     next: "Check where external result values are represented"
   };
   return { savedState: state.investigation };`;

const toolDefinition = {
  type: "function",
  function: {
    name: "execute_javascript",
    description: "Run unsandboxed JavaScript in the browser page. Use helpers for SQLite, skill files, and DOM stage output.",
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "JavaScript code. May be async; `return` a value for the transcript.",
        },
      },
      required: ["code"],
      additionalProperties: false,
    },
  },
};

function truncate(s: string, n = MAX_TOOL_CHARS) {
  return s.length > n ? `${s.slice(0, n)}\n... [truncated ${s.length - n} chars]` : s;
}

function toolResultForModel(content: string, record: ToolResultRecord) {
  if (content.length <= MAX_TOOL_CHARS) return content;
  const nextOffset = Math.min(MAX_TOOL_CHARS, record.retainedChars);
  return `${content.slice(0, MAX_TOOL_CHARS)}
... [TRUNCATED ${content.length - MAX_TOOL_CHARS} chars before sending to the model]

FOLLOW-UP HINT:
- Full retained result: #${record.index} (${record.id})
- Retained chars: ${record.retainedChars}/${record.totalChars}${record.retentionCapped ? " (retention cap reached)" : ""}
- Next offset: ${nextOffset}
- To continue: return readToolResult(${record.index}, { offset: ${nextOffset}, length: ${DEFAULT_TOOL_PAGE_CHARS} })
- To request a larger explicit page: return readToolResult(${record.index}, { offset: ${nextOffset}, length: ${Math.min(MAX_TOOL_PAGE_CHARS, 100_000)} })
- To list retained results: return listToolResults()`;
}

function stringifyResult(value: unknown) {
  if (value === undefined) return "(no return value; use `return ...` in statement-style JavaScript to send a value back to the transcript)";
  if (typeof value === "string") return value;
  if (value instanceof HTMLElement) return `[HTMLElement ${value.tagName.toLowerCase()}]`;
  return JSON.stringify(value, null, 2);
}

function numberedCode(code: string, maxLines = 220) {
  const lines = code.split(/\r?\n/);
  const shown = lines.slice(0, maxLines).map((line, i) => `${String(i + 1).padStart(3, " ")} | ${line}`);
  if (lines.length > maxLines) shown.push(`... ${lines.length - maxLines} more lines`);
  return shown.join("\n");
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function extractSqlTableNames(code: string) {
  const names: string[] = [];
  const tablePattern = /\b(?:from|join|update|into)\s+(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([A-Za-z_][\w$]*))/gi;
  let match: RegExpExecArray | null;
  while ((match = tablePattern.exec(code))) {
    const name = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (name && !["select", "where"].includes(name.toLowerCase())) names.push(name);
  }
  return unique(names);
}

function patternFromName(name: string) {
  const token = name.split(/[_\W]+/).filter(Boolean).sort((a, b) => b.length - a.length)[0] ?? name;
  return `%${token}%`;
}

function buildErrorGuidance(err: Error, code: string) {
  const message = err.message;
  const tables = extractSqlTableNames(code);
  const firstTable = tables[0];
  const noColumn = /no such column:\s*([A-Za-z_][\w$]*)/i.exec(message);
  const noTable = /no such table:\s*([A-Za-z_][\w$]*)/i.exec(message);
  const syntax = /syntax error/i.test(message);
  const vega = /vega|signal|mark|encoding|scale|duplicate signal/i.test(message);

  if (noColumn) {
    const column = noColumn[1];
    const nextActions = [
      `Do not guess column names. Inspect live schema before retrying.`,
      firstTable
        ? `Run: const cols = await schema(${JSON.stringify(firstTable)}); return { table: ${JSON.stringify(firstTable)}, columns: cols.rows };`
        : `Run schema("TABLE_NAME") for the table you queried.`,
    ];
    if (firstTable) {
      nextActions.push(`Run: const rows = await sample(${JSON.stringify(firstTable)}, 5); return rows;`);
    }
    if (tables.length) {
      nextActions.push(`If this is the wrong table family, run: return await tables(${JSON.stringify(patternFromName(firstTable))});`);
    } else {
      nextActions.push(`If the table is uncertain, run tables("%keyword%") and then schema(theTable).`);
    }
    return {
      kind: "sqlite_missing_column",
      likelyCause: `${column} is not present in the live SQLite schema${firstTable ? ` for ${firstTable}` : ""}.`,
      missingColumn: column,
      detectedTables: tables,
      nextActions,
    };
  }

  if (noTable) {
    const table = noTable[1];
    return {
      kind: "sqlite_missing_table",
      likelyCause: `${table} is not a table in this SQLite export, or the table name differs from the Epic guide/example.`,
      missingTable: table,
      nextActions: [
        `Run: return await tables(${JSON.stringify(patternFromName(table))});`,
        `If no rows return, broaden the search: return await tables("%${table.split("_")[0]}%");`,
        `After selecting a live table, run schema(tableName) and sample(tableName, 5) before querying columns.`,
      ],
    };
  }

  if (syntax) {
    return {
      kind: "sqlite_syntax_or_javascript_wrapper",
      likelyCause: "SQLite rejected the query syntax, or JavaScript template/string construction produced invalid SQL.",
      detectedTables: tables,
      nextActions: [
        "Return the SQL string first if interpolation is involved.",
        "Run a smaller SELECT with one WHERE predicate, then add clauses back.",
        "If identifiers contain unusual characters, inspect schema(tableName) and quote identifiers with double quotes.",
      ],
    };
  }

  if (vega) {
    return {
      kind: "vega_lite_or_rendering",
      likelyCause: "The Vega-Lite spec or render call failed.",
      nextActions: [
        "Return the spec object to inspect generated fields and duplicate names.",
        "Use unique param/signal names for each plot.",
        "Render a minimal spec first, then add layers/transforms back.",
      ],
    };
  }

  return {
    kind: "javascript_or_tool_error",
    likelyCause: "The JavaScript tool call failed before producing a value.",
    detectedTables: tables,
    nextActions: [
      "Read the stack excerpt and line-numbered userCode.",
      "Retry with a smaller expression that returns intermediate values.",
      "For SQL, inspect tables(), schema(tableName), and sample(tableName, 5) before assuming names.",
    ],
  };
}

function formatToolError(error: unknown, code: string) {
  const err = error instanceof Error ? error : new Error(String(error));
  return JSON.stringify({
    ok: false,
    error: {
      name: err.name,
      message: err.message,
      stack: err.stack?.split("\n").slice(0, 12).join("\n") ?? null,
    },
    diagnosis: buildErrorGuidance(err, code),
    userCode: numberedCode(code),
  }, null, 2);
}

function makeToolFunction(AsyncFunction: FunctionConstructor, code: string) {
  const helperPrelude = "const { sql, tables, schema, sample, listFiles, readFile, grepFiles, listToolResults, readToolResult, scanToolResult, state, d3, plot_vegalite, plotVegaLite, epicDateRealToDate, epicDateRealToIso, parseEpicDateText, stage, renderHtml, appendHtml, clearStage } = helpers;";
  const expression = code.trim().replace(/;+\s*$/, "");
  if (expression) {
    try {
      return AsyncFunction("helpers", `${helperPrelude}\nreturn await (async () => (${expression}))();`);
    } catch {
      // Fall through to statement-style JavaScript. Statement blocks must return explicitly.
    }
  }
  return AsyncFunction("helpers", `${helperPrelude}\nreturn await (async () => {\n${code}\n})();`);
}

function qIdent(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

function epicDateRealToDate(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const day = Math.floor(n);
  const base = Date.UTC(1840, 11, 31);
  return new Date(base + day * 86_400_000);
}

function epicDateRealToIso(value: unknown) {
  const d = epicDateRealToDate(value);
  return d ? d.toISOString().slice(0, 10) : null;
}

function parseEpicDateText(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) {
    const d = new Date(text);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  let hour = Number(m[4]);
  const ap = (m[7] ?? "").toUpperCase();
  if (ap === "PM" && hour < 12) hour += 12;
  if (ap === "AM" && hour === 12) hour = 0;
  return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]), hour, Number(m[5]), Number(m[6]));
}

function withVegaLiteDimensions(spec: unknown, options?: Record<string, unknown>) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return spec;
  const next = { ...(spec as Record<string, unknown>) };
  if (options?.width != null && next.width == null) next.width = options.width;
  if (options?.height != null && next.height == null) next.height = options.height;
  if (next.autosize == null) next.autosize = { type: "fit-x", contains: "padding" };
  return next;
}

function vegaEmbedOptions(options?: Record<string, unknown>) {
  const { width: _width, height: _height, ...embedOptions } = options ?? {};
  return embedOptions;
}

function rtfToText(rtf: string): string {
  let i = 0;
  let out = "";
  const skipStack: boolean[] = [false];
  const skipDepth = () => skipStack[skipStack.length - 1];
  const emit = (s: string) => { if (!skipDepth()) out += s; };

  while (i < rtf.length) {
    const c = rtf[i];
    if (c === "{") { skipStack.push(skipDepth()); i++; continue; }
    if (c === "}") { if (skipStack.length > 1) skipStack.pop(); i++; continue; }
    if (c === "\\") {
      const next = rtf[i + 1];
      if (next === "'") {
        const code = parseInt(rtf.slice(i + 2, i + 4), 16);
        if (!Number.isNaN(code)) emit(decodeRtfByte(code));
        i += 4;
        continue;
      }
      if (next === "~") { emit(" "); i += 2; continue; }
      if (next === "-" || next === "_") { i += 2; continue; }
      if (next === "*") { skipStack[skipStack.length - 1] = true; i += 2; continue; }
      if (next === "\\" || next === "{" || next === "}") { emit(next); i += 2; continue; }
      if (next === "\n" || next === "\r") { emit("\n"); i += 2; continue; }
      const m = /^\\([a-zA-Z]+)(-?\d+)?\s?/.exec(rtf.slice(i));
      if (m) {
        const word = m[1];
        const arg = m[2];
        i += m[0].length;
        if (word === "u" && arg != null) {
          let code = parseInt(arg, 10);
          if (code < 0) code += 65536;
          emit(String.fromCharCode(code));
          if (rtf[i] === "?") i++;
          continue;
        }
        if (["fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "themedata",
             "colorschememapping", "latentstyles", "datastore", "generator"].includes(word)) {
          skipStack[skipStack.length - 1] = true;
          continue;
        }
        if (word === "par" || word === "line" || word === "row" || word === "sect" || word === "page") { emit("\n"); continue; }
        if (word === "cell" || word === "tab" || word === "nestcell") { emit("\t"); continue; }
        continue;
      }
      i++;
      continue;
    }
    if (c === "\r" || c === "\n") { i++; continue; }
    emit(c);
    i++;
  }
  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n").map((line) => line.replace(/[ \t]+$/g, "")).join("\n")
    .trim();
}

function decodeRtfByte(code: number): string {
  const cp1252: Record<number, string> = {
    0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—",
    0x85: "…", 0xa0: " ", 0xb0: "°", 0xae: "®", 0xa9: "©",
  };
  return cp1252[code] ?? String.fromCharCode(code);
}

function corePromptFromSkill(skillText: string) {
  const skillPath = "skills/reading-epic-ehi-export/SKILL.md";
  return [
    "Core baked-in Epic EHI reading skill",
    "",
    "The static site includes data/my-ehi-skills.zip, a normal zip archive exposed to execute_javascript through sql(query), listFiles(pattern), readFile(path), and grepFiles(pattern, options). It contains db/ehi.sqlite plus a virtual filesystem built only from git-tracked files: skills/reading-epic-ehi-export/** and redacted rich-text note payloads at raw/Rich Text/*.RTF and raw/Rich Text/_INDEX.HTML.",
    "",
    "When the skill below references a relative path such as reference/patterns/general-patterns.md or scripts/q.ts, resolve it relative to the directory containing that SKILL.md. For example, inside skills/reading-epic-ehi-export/SKILL.md, reference/patterns/general-patterns.md means skills/reading-epic-ehi-export/reference/patterns/general-patterns.md. Use readFile() or grepFiles() to inspect those referenced files before relying on them.",
    "",
    "Do not assume a referenced file is already in context. If a cited reference, script, or clinical-area guide matters, explicitly read it from the virtual filesystem.",
    "",
    `--- BEGIN ${skillPath} ---`,
    "",
    skillText,
    "",
    `--- END ${skillPath} ---`,
  ].join("\n");
}

function makeRows(db: Database, query: string, params?: SqlValue[] | Record<string, SqlValue>, limit = 200) {
  const stmt = db.prepare(query);
  if (params) stmt.bind(params as never);
  const rows: Record<string, SqlValue>[] = [];
  let count = 0;
  while (stmt.step()) {
    if (count < limit) rows.push(stmt.getAsObject() as Record<string, SqlValue>);
    count++;
  }
  stmt.free();
  return { rows, rowCount: count, truncated: count > rows.length };
}

function useHarness() {
  const [db, setDb] = React.useState<Database | null>(null);
  const [dbStatus, setDbStatus] = React.useState("not loaded");
  const [fsIndex, setFsIndex] = React.useState<FsIndex | null>(null);
  const [agentStateText, setAgentStateText] = React.useState("{}");
  const agentStateRef = React.useRef<Record<string, unknown>>({});
  const toolResultsRef = React.useRef<ToolResultRecord[]>([]);
  const bundleRef = React.useRef<Record<string, Uint8Array> | null>(null);
  const bundlePromiseRef = React.useRef<Promise<Record<string, Uint8Array>> | null>(null);
  const stageRef = React.useRef<HTMLDivElement | null>(null);

  const loadBundle = React.useCallback(async () => {
    if (bundleRef.current) return bundleRef.current;
    if (!bundlePromiseRef.current) {
      bundlePromiseRef.current = fetch("../data/my-ehi-skills.zip").then(async (res) => {
        if (!res.ok) throw new Error(`Could not fetch ../data/my-ehi-skills.zip (${res.status})`);
        return unzipSync(new Uint8Array(await res.arrayBuffer()));
      });
    }
    const bundle = await bundlePromiseRef.current;
    bundleRef.current = bundle;
    return bundle;
  }, []);

  const loadDb = React.useCallback(async () => {
    if (db) return db;
    setDbStatus("loading sql.js");
    const SQL = await initSqlJs({ locateFile: () => "../data/sql-wasm.wasm" });
    setDbStatus("fetching my-ehi-skills.zip");
    const bundle = await loadBundle();
    const bytes = bundle["db/ehi.sqlite"];
    if (!bytes) throw new Error("data/my-ehi-skills.zip did not contain db/ehi.sqlite");
    const next = new SQL.Database(bytes);
    setDb(next);
    setDbStatus(`${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB loaded`);
    return next;
  }, [db, loadBundle]);

  const loadFs = React.useCallback(async () => {
    if (fsIndex) return fsIndex;
    const entries = await loadBundle();
    const next: FsIndex = {
      files: Object.entries(entries)
        .filter(([path]) => path !== "db/ehi.sqlite")
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, bytes]) => ({ path, text: strFromU8(bytes) })),
    };
    setFsIndex(next);
    return next;
  }, [fsIndex, loadBundle]);

  const loadCorePrompt = React.useCallback(async () => {
    const bundle = await loadBundle();
    const bytes = bundle["skills/reading-epic-ehi-export/SKILL.md"];
    if (!bytes) throw new Error("data/my-ehi-skills.zip did not contain skills/reading-epic-ehi-export/SKILL.md");
    return corePromptFromSkill(strFromU8(bytes));
  }, [loadBundle]);

  const syncState = React.useCallback(() => {
    setAgentStateText(JSON.stringify(agentStateRef.current, null, 2));
  }, []);

  const helpers = React.useMemo(() => {
    const renderHtml = (html: string) => {
      if (!stageRef.current) return null;
      stageRef.current.innerHTML = html;
      return stageRef.current;
    };
    const appendHtml = (html: string) => {
      if (!stageRef.current) return null;
      stageRef.current.insertAdjacentHTML("beforeend", html);
      return stageRef.current;
    };
    const clearStage = () => {
      if (stageRef.current) stageRef.current.innerHTML = "";
      return true;
    };
    const sql = async (query: string, params?: SqlValue[] | Record<string, SqlValue>, options?: { limit?: number }) => {
      const liveDb = await loadDb();
      return makeRows(liveDb, query, params, options?.limit ?? 200);
    };
    const tables = async (pattern?: string) => {
      const where = pattern ? "WHERE table_name LIKE $pattern" : "";
      return sql(`SELECT table_name, n_rows, n_columns FROM _tables ${where} ORDER BY n_rows DESC, table_name`, pattern ? { $pattern: pattern } : undefined, { limit: 1000 });
    };
    const schema = async (tableName: string) => sql(`PRAGMA table_info(${qIdent(tableName)})`, undefined, { limit: 1000 });
    const sample = async (tableName: string, limit = 10) => sql(`SELECT * FROM ${qIdent(tableName)} LIMIT ${Math.max(1, Math.min(100, limit))}`, undefined, { limit });
    const listFiles = async (pattern?: string) => {
      const idx = await loadFs();
      const needle = pattern?.toLowerCase();
      return idx.files.map((f) => f.path).filter((p) => !needle || p.toLowerCase().includes(needle));
    };
    const readableText = (path: string, text: string, raw?: boolean) => {
      if (raw) return text;
      return path.toLowerCase().endsWith(".rtf") ? rtfToText(text) : text;
    };
    const readFile = async (path: string, options?: { raw?: boolean }) => {
      const idx = await loadFs();
      const file = idx.files.find((f) => f.path === path);
      if (!file) throw new Error(`No bundled file: ${path}`);
      return readableText(file.path, file.text, options?.raw);
    };
    const grepFiles = async (pattern: string, options?: { caseSensitive?: boolean; limit?: number; pathIncludes?: string; raw?: boolean }) => {
      const idx = await loadFs();
      const flags = options?.caseSensitive ? "" : "i";
      const re = new RegExp(pattern, flags);
      const out: { path: string; line: number; text: string }[] = [];
      const limit = options?.limit ?? 200;
      for (const file of idx.files.filter((f) => !options?.pathIncludes || f.path.includes(options.pathIncludes))) {
        const lines = readableText(file.path, file.text, options?.raw).split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) out.push({ path: file.path, line: i + 1, text: lines[i] });
          if (out.length >= limit) return out;
        }
      }
      return out;
    };
    const listToolResults = () => toolResultsRef.current.map((r) => ({
      index: r.index,
      id: r.id,
      status: r.status,
      started: r.started,
      codePreview: r.codePreview,
      totalChars: r.totalChars,
      retainedChars: r.retainedChars,
      retentionCapped: r.retentionCapped,
    }));
    const readToolResult = (indexOrId?: number | string, options?: { offset?: number; length?: number }) => {
      const results = toolResultsRef.current;
      const record = indexOrId == null
        ? results.at(-1)
        : typeof indexOrId === "number"
          ? results.find((r) => r.index === indexOrId)
          : results.find((r) => r.id === indexOrId);
      if (!record) throw new Error(`No retained tool result for ${indexOrId ?? "latest"}`);
      const offset = Math.max(0, options?.offset ?? 0);
      const length = Math.max(1, Math.min(options?.length ?? DEFAULT_TOOL_PAGE_CHARS, MAX_TOOL_PAGE_CHARS));
      const text = record.content.slice(offset, offset + length);
      const nextOffset = offset + text.length < record.retainedChars ? offset + text.length : null;
      return {
        index: record.index,
        id: record.id,
        status: record.status,
        offset,
        requestedLength: length,
        returnedChars: text.length,
        nextOffset,
        totalChars: record.totalChars,
        retainedChars: record.retainedChars,
        retentionCapped: record.retentionCapped,
        text,
      };
    };
    const scanToolResult = (indexOrId: number | string | undefined, pattern: string, options?: { caseSensitive?: boolean; limit?: number; contextChars?: number }) => {
      const results = toolResultsRef.current;
      const record = indexOrId == null
        ? results.at(-1)
        : typeof indexOrId === "number"
          ? results.find((r) => r.index === indexOrId)
          : results.find((r) => r.id === indexOrId);
      if (!record) throw new Error(`No retained tool result for ${indexOrId ?? "latest"}`);
      const re = new RegExp(pattern, options?.caseSensitive ? "g" : "gi");
      const limit = options?.limit ?? 50;
      const contextChars = Math.max(0, Math.min(options?.contextChars ?? 180, 2000));
      const matches: { offset: number; match: string; context: string }[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(record.content)) && matches.length < limit) {
        const start = Math.max(0, m.index - contextChars);
        const end = Math.min(record.content.length, m.index + m[0].length + contextChars);
        matches.push({ offset: m.index, match: m[0], context: record.content.slice(start, end) });
        if (m[0].length === 0) re.lastIndex++;
      }
      return {
        index: record.index,
        id: record.id,
        pattern,
        matchCountReturned: matches.length,
        retainedChars: record.retainedChars,
        totalChars: record.totalChars,
        matches,
      };
    };
    const rememberToolResult = (record: Omit<ToolResultRecord, "index" | "content" | "retainedChars" | "retentionCapped"> & { content: string }) => {
      const retentionCapped = record.content.length > MAX_RETAINED_TOOL_CHARS;
      const content = retentionCapped
        ? `${record.content.slice(0, MAX_RETAINED_TOOL_CHARS)}\n... [retention cap reached; omitted ${record.content.length - MAX_RETAINED_TOOL_CHARS} chars]`
        : record.content;
      const next: ToolResultRecord = {
        ...record,
        index: toolResultsRef.current.length + 1,
        content,
        totalChars: record.content.length,
        retainedChars: content.length,
        retentionCapped,
      };
      toolResultsRef.current.push(next);
      return next;
    };
    const clearToolResults = () => {
      toolResultsRef.current = [];
    };
    const plot_vegalite = async (spec: unknown, options?: Record<string, unknown>) => {
      if (!stageRef.current) throw new Error("No stage element is mounted.");
      const mount = document.createElement("div");
      mount.className = "plot";
      stageRef.current.appendChild(mount);
      try {
        const normalizedSpec = withVegaLiteDimensions(spec, options);
        await vegaEmbed(mount, normalizedSpec as never, { actions: false, ...vegaEmbedOptions(options) });
        return { ok: true, plotIndex: stageRef.current.querySelectorAll(".plot").length };
      } catch (e) {
        mount.className = "plot plot-error";
        const message = e instanceof Error ? e.message : String(e);
        mount.textContent = `Vega-Lite render failed: ${message}`;
        throw e;
      }
    };
    return {
      sql, tables, schema, sample,
      listFiles, readFile, grepFiles, listToolResults, readToolResult, scanToolResult,
      listSkillFiles: listFiles, readSkillFile: readFile, grepSkillFiles: grepFiles,
      d3, plot_vegalite, plotVegaLite: plot_vegalite,
      epicDateRealToDate, epicDateRealToIso, parseEpicDateText,
      renderHtml, appendHtml, clearStage,
      _rememberToolResult: rememberToolResult,
      _clearToolResults: clearToolResults,
      state: agentStateRef.current,
      syncState,
      get stage() { return stageRef.current; },
    };
  }, [loadDb, loadFs, syncState]);

  React.useEffect(() => {
    Object.assign(window, { ehiAgent: helpers });
  }, [helpers]);

  return { dbStatus, fsIndex, agentStateText, agentStateRef, loadDb, loadFs, loadCorePrompt, syncState, helpers, stageRef };
}

type ModelActivity = {
  active: boolean;
  chars: number;
};

function streamedAssistantCharCount(message: ChatMessage) {
  const contentChars = message.content?.length ?? 0;
  const toolChars = message.tool_calls?.reduce((sum, call) => sum + call.function.name.length + call.function.arguments.length, 0) ?? 0;
  return contentChars + toolChars;
}

function mergeToolCallDelta(target: ChatMessage, deltaCall: Partial<ToolCall> & { index?: number }) {
  const index = deltaCall.index ?? 0;
  if (!target.tool_calls) target.tool_calls = [];
  let current = target.tool_calls[index];
  if (!current) {
    current = {
      id: deltaCall.id ?? `tool_call_${index}`,
      type: "function",
      function: { name: "", arguments: "" },
    };
    target.tool_calls[index] = current;
  }
  if (deltaCall.id) current.id = deltaCall.id;
  if (deltaCall.type) current.type = deltaCall.type;
  if (deltaCall.function?.name) current.function.name += deltaCall.function.name;
  if (deltaCall.function?.arguments) current.function.arguments += deltaCall.function.arguments;
}

async function readOpenRouterStream(res: Response, onActivity?: (activity: ModelActivity) => void) {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("OpenRouter streaming response did not include a readable body.");
  const decoder = new TextDecoder();
  let buffer = "";
  const assistant: ChatMessage = { role: "assistant", content: "" };

  const handleLine = (line: string) => {
    if (!line.startsWith("data:")) return false;
    const data = line.slice(5).trim();
    if (!data) return false;
    if (data === "[DONE]") return true;
    const parsed = JSON.parse(data);
    const choice = parsed.choices?.[0];
    const delta = choice?.delta;
    if (!delta) return false;
    if (delta.role) assistant.role = delta.role;
    if (delta.content) assistant.content = `${assistant.content ?? ""}${delta.content}`;
    if (delta.tool_calls?.length) {
      for (const call of delta.tool_calls) mergeToolCallDelta(assistant, call);
    }
    onActivity?.({ active: true, chars: streamedAssistantCharCount(assistant) });
    return false;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (handleLine(line)) {
        await reader.cancel().catch(() => undefined);
        if (!assistant.content) assistant.content = null;
        assistant.tool_calls = assistant.tool_calls?.filter(Boolean);
        return assistant;
      }
    }
  }
  buffer += decoder.decode();
  for (const line of buffer.split(/\r?\n/)) handleLine(line);
  if (!assistant.content) assistant.content = null;
  assistant.tool_calls = assistant.tool_calls?.filter(Boolean);
  return assistant;
}

async function callOpenRouter(apiKey: string, model: string, messages: ChatMessage[], signal?: AbortSignal, onActivity?: (activity: ModelActivity) => void) {
  onActivity?.({ active: true, chars: 0 });
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": location.origin,
      "X-Title": "EHI Export Agent Harness",
    },
    signal,
    body: JSON.stringify({
      model,
      messages,
      tools: [toolDefinition],
      tool_choice: "auto",
      parallel_tool_calls: false,
      temperature: 0.2,
      stream: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${text}`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) return readOpenRouterStream(res, onActivity);
  const text = await res.text();
  const assistant = JSON.parse(text).choices?.[0]?.message as ChatMessage;
  onActivity?.({ active: true, chars: streamedAssistantCharCount(assistant) });
  return assistant;
}

function parseToolCode(call: ToolCall) {
  try {
    return (JSON.parse(call.function.arguments || "{}") as { code?: string }).code ?? "";
  } catch {
    return call.function.arguments;
  }
}

function MarkdownContent({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children, ...props }) => (
            <div className="table-scroll">
              <table {...props}>{children}</table>
            </div>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

function MessageView({ m, traces }: { m: ChatMessage; traces: Trace[] }) {
  const trace = m.tool_call_id ? traces.find((t) => t.id === m.tool_call_id) : null;
  return (
    <div className={`msg ${m.role}`}>
      <b>{m.role}</b>
      {m.tool_calls?.length ? (
        <>
          {m.content ? <MarkdownContent>{m.content}</MarkdownContent> : null}
          <div className="tool-call-list">
            {m.tool_calls.map((call) => (
              <details className="tool-call-card" key={call.id} open>
                <summary>{call.function.name}</summary>
                <pre>{parseToolCode(call)}</pre>
              </details>
            ))}
          </div>
        </>
      ) : m.role === "tool" ? (
        <div className="tool-result-card">
          <span className={trace?.status ?? "ok"}>{trace?.status ?? "tool result"}</span>
          {trace?.elapsedMs != null ? <em>{trace.elapsedMs} ms</em> : null}
          <pre>{m.content ?? "No tool output."}</pre>
          <small>{trace?.resultFull && trace.resultForModel && trace.resultFull !== trace.resultForModel ? "This is exactly the bounded output sent back to the model. Full output is retained in Tool trace." : "This is exactly the output sent back to the model."}</small>
        </div>
      ) : m.content ? (
        <MarkdownContent>{m.content}</MarkdownContent>
      ) : (
        <pre />
      )}
    </div>
  );
}

function TraceView({ t }: { t: Trace }) {
  return (
    <details className={`trace ${t.status}`} open={t.status !== "ok"}>
      <summary>
        <span>{t.status}</span>
        <b>execute_javascript</b>
        {t.elapsedMs != null ? <em>{t.elapsedMs} ms</em> : null}
      </summary>
      <pre className="code">{t.code}</pre>
      {t.resultFull ? <pre className="result">{t.resultFull}</pre> : null}
    </details>
  );
}

function CopyModelId({ value, onUse }: { value: string; onUse: (value: string) => void }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    onUse(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  return (
    <button className="copy-model" onClick={() => void copy()} title={`Copy ${value}`} type="button">
      <code>{value}</code>
      <span aria-hidden="true">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function initialOpenRouterModel() {
  const saved = localStorage.getItem("openrouter_model");
  if (!saved || LEGACY_AUTO_MODELS.has(saved)) return DEFAULT_MODEL;
  return saved;
}

function compactCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function App() {
  const { dbStatus, fsIndex, agentStateText, agentStateRef, loadDb, loadFs, loadCorePrompt, syncState, helpers, stageRef } = useHarness();
  const [apiKey, setApiKey] = React.useState(localStorage.getItem("openrouter_api_key") ?? "");
  const [model, setModel] = React.useState(initialOpenRouterModel);
  const [systemPrompt, setSystemPrompt] = React.useState(initialSystemPrompt);
  const [messages, setMessages] = React.useState<ChatMessage[]>([{ role: "system", content: initialSystemPrompt }]);
  const [corePromptStatus, setCorePromptStatus] = React.useState("loading core prompt");
  const [input, setInput] = React.useState("What was my last blood sugar?");
  const [traces, setTraces] = React.useState<Trace[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [runStatus, setRunStatus] = React.useState<"idle" | "running" | "stopping" | "stopped" | "done">("idle");
  const [turnsRemaining, setTurnsRemaining] = React.useState(MAX_AUTONOMOUS_TURNS);
  const [modelActivity, setModelActivity] = React.useState<ModelActivity>({ active: false, chars: 0 });
  const [queuedCount, setQueuedCount] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const messagesRef = React.useRef<ChatMessage[]>(messages);
  const messagesElRef = React.useRef<HTMLDivElement | null>(null);
  const followConversationRef = React.useRef(true);
  const queuedRef = React.useRef<ChatMessage[]>([]);
  const stopRequestedRef = React.useRef(false);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => localStorage.setItem("openrouter_api_key", apiKey), [apiKey]);
  React.useEffect(() => localStorage.setItem("openrouter_model", model), [model]);
  React.useEffect(() => { messagesRef.current = messages; }, [messages]);
  React.useLayoutEffect(() => {
    if (!followConversationRef.current) return;
    const el = messagesElRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [messages, traces]);
  React.useEffect(() => {
    void loadDb().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    void loadFs().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [loadDb, loadFs]);
  React.useEffect(() => {
    let cancelled = false;
    loadCorePrompt()
      .then((text) => {
        if (cancelled) return;
        setSystemPrompt((prev) => prev === initialSystemPrompt ? `${initialSystemPrompt}\n\n${text}` : prev);
        setCorePromptStatus("core analysis skills loaded");
      })
      .catch(() => {
        if (!cancelled) setCorePromptStatus("core prompt not available");
      });
    return () => { cancelled = true; };
  }, [loadCorePrompt]);

  const reset = () => {
    const hasWork = messages.some((m) => m.role !== "system") || traces.length > 0 || stageRef.current?.textContent?.trim();
    if (hasWork && !window.confirm("Clear the conversation, stage, tool trace, queued messages, and agent state? Your API key, model, loaded data, and system prompt stay in place.")) return;
    abortRef.current?.abort();
    followConversationRef.current = true;
    stopRequestedRef.current = false;
    queuedRef.current = [];
    setQueuedCount(0);
    setBusy(false);
    setRunStatus("idle");
    setTurnsRemaining(MAX_AUTONOMOUS_TURNS);
    setModelActivity({ active: false, chars: 0 });
    setMessages([{ role: "system", content: systemPrompt }]);
    setTraces([]);
    helpers._clearToolResults();
    agentStateRef.current = {};
    syncState();
    helpers.clearStage();
    setError(null);
  };

  const runTool = async (call: ToolCall) => {
    const parsed = JSON.parse(call.function.arguments || "{}") as { code?: string };
    const code = parsed.code ?? "";
    const traceId = call.id || crypto.randomUUID();
    const startedIso = new Date().toISOString();
    const started = performance.now();
    setTraces((prev) => [...prev, { id: traceId, code, status: "running", started: startedIso }]);
    try {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const fn = makeToolFunction(AsyncFunction, code);
      const value = await fn(helpers);
      helpers.syncState();
      const stateSnapshot = JSON.stringify(agentStateRef.current, null, 2);
      const resultFull = `${stringifyResult(value)}\n\nagent_state:\n${stateSnapshot}`;
      const record = helpers._rememberToolResult({
        id: traceId,
        status: "ok",
        started: startedIso,
        codePreview: code.trim().slice(0, 240),
        content: resultFull,
      });
      const resultForModel = toolResultForModel(record.content, record);
      const elapsedMs = Math.round(performance.now() - started);
      setTraces((prev) => prev.map((t) => t.id === traceId ? { ...t, status: "ok", elapsedMs, resultFull: record.content, resultForModel } : t));
      return resultForModel;
    } catch (e) {
      const resultFull = formatToolError(e, code);
      const record = helpers._rememberToolResult({
        id: traceId,
        status: "error",
        started: startedIso,
        codePreview: code.trim().slice(0, 240),
        content: resultFull,
      });
      const resultForModel = toolResultForModel(record.content, record);
      helpers.syncState();
      const elapsedMs = Math.round(performance.now() - started);
      setTraces((prev) => prev.map((t) => t.id === traceId ? { ...t, status: "error", elapsedMs, resultFull: record.content, resultForModel } : t));
      return resultForModel;
    }
  };

  const isDoneAfterTool = () => agentStateRef.current.done === true;

  const drainQueued = (next: ChatMessage[]) => {
    if (!queuedRef.current.length) return next;
    const queued = queuedRef.current.splice(0);
    setQueuedCount(0);
    const merged = [...next, ...queued];
    setMessages(merged);
    messagesRef.current = merged;
    return merged;
  };

  const continueWithQueued = (next: ChatMessage[]) => {
    if (!queuedRef.current.length) return null;
    if (agentStateRef.current.done === true) {
      delete agentStateRef.current.done;
      syncState();
    }
    return drainQueued(next);
  };

  const enqueueDuringRun = (content: string) => {
    if (!content.trim()) return;
    const msg: ChatMessage = { role: "user", content };
    queuedRef.current.push(msg);
    setQueuedCount(queuedRef.current.length);
    setMessages((prev) => [...prev, msg]);
    setInput("");
  };

  const stopRun = () => {
    stopRequestedRef.current = true;
    setRunStatus("stopping");
    abortRef.current?.abort();
  };

  const onConversationScroll = () => {
    const el = messagesElRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    followConversationRef.current = distanceFromBottom < 40;
  };

  const send = async () => {
    if (busy) {
      enqueueDuringRun(input);
      return;
    }
    if (!apiKey.trim()) {
      setError("Enter an OpenRouter API key first.");
      return;
    }
    setBusy(true);
    setRunStatus("running");
    setTurnsRemaining(MAX_AUTONOMOUS_TURNS);
    setModelActivity({ active: false, chars: 0 });
    stopRequestedRef.current = false;
    setError(null);
    queuedRef.current = [];
    setQueuedCount(0);
    let next: ChatMessage[] = [{ role: "system", content: systemPrompt }, ...messages.filter((m) => m.role !== "system"), { role: "user", content: input }];
    setMessages(next);
    messagesRef.current = next;
    setInput("");
    try {
      let completed = false;
      let stopReason: string | null = null;
      for (let turn = 0; turn < MAX_AUTONOMOUS_TURNS; turn++) {
        setTurnsRemaining(MAX_AUTONOMOUS_TURNS - turn);
        if (stopRequestedRef.current) {
          stopReason = "Stopped by user request.";
          break;
        }
        next = drainQueued(next);
        const controller = new AbortController();
        abortRef.current = controller;
        const assistant = await callOpenRouter(apiKey.trim(), model.trim(), next, controller.signal, setModelActivity);
        setModelActivity({ active: false, chars: 0 });
        setTurnsRemaining(Math.max(0, MAX_AUTONOMOUS_TURNS - turn - 1));
        next = [...next, assistant];
        setMessages(next);
        messagesRef.current = next;
        if (!assistant.tool_calls?.length && (assistant.content ?? "").trim()) {
          const queuedNext = continueWithQueued(next);
          if (queuedNext) {
            next = queuedNext;
            continue;
          }
          setRunStatus("done");
          completed = true;
          break;
        }
        if (assistant.tool_calls?.length) {
          let toolSteps = 0;
          for (const call of assistant.tool_calls) {
            if (stopRequestedRef.current) {
              stopReason = "Stopped by user request.";
              break;
            }
            if (call.function.name !== "execute_javascript") continue;
            const result = await runTool(call);
            next = [...next, { role: "tool", tool_call_id: call.id, content: result }];
            setMessages(next);
            messagesRef.current = next;
            toolSteps++;
            if (isDoneAfterTool()) break;
            if (toolSteps >= MAX_STEPS) {
              stopReason = `Stopped after ${MAX_STEPS} tool calls in one assistant turn. Send another message to continue from the retained conversation and tool trace.`;
              break;
            }
          }
          const queuedNext = !stopReason ? continueWithQueued(next) : null;
          if (queuedNext) {
            next = queuedNext;
            continue;
          }
          if (isDoneAfterTool()) {
            setRunStatus("done");
            completed = true;
            break;
          }
          if (stopReason) break;
          if (turn === MAX_AUTONOMOUS_TURNS - 1) {
            stopReason = `Stopped because the autonomous loop limit was exhausted after ${MAX_AUTONOMOUS_TURNS} assistant turns. Send another message to continue from the retained conversation and tool trace.`;
            break;
          }
          continue;
        }
        completed = true;
        break;
      }
      if (!completed && stopReason && !stopRequestedRef.current) {
        next = [...next, { role: "assistant", content: stopReason }];
        setMessages(next);
        messagesRef.current = next;
        setRunStatus("stopped");
      }
    } catch (e) {
      setModelActivity({ active: false, chars: 0 });
      if (e instanceof DOMException && e.name === "AbortError") {
        setRunStatus("stopped");
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      if (stopRequestedRef.current) setRunStatus("stopped");
      else setRunStatus((s) => s === "done" ? "done" : "idle");
    }
  };

  const runLabel = runStatus === "running"
    ? `${runStatus} · ${String(turnsRemaining).padStart(2, "0")} left${modelActivity.active ? ` · ${compactCount(modelActivity.chars)} chars` : ""}${queuedCount ? ` · ${queuedCount} queued` : ""}`
    : `${runStatus}${queuedCount ? `, ${queuedCount} queued` : ""}`;
  const sideRunLabel = runStatus === "running"
    ? queuedCount ? `running, ${queuedCount} queued` : "running"
    : runStatus;

  return (
    <main className="shell">
      <section className="side">
        <header>
          <a href="../index.html">Deep dives</a>
          <h1>Agent harness</h1>
          <p>Browser-only OpenRouter agent loop with unsandboxed JavaScript, SQLite WASM, bundled skills, and a writable DOM stage.</p>
        </header>
        <div className="settings">
          <label>OpenRouter API key<input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-or-v1-..." type="password" /></label>
          <details className="guide" open={!apiKey.trim()}>
            <summary>Key setup</summary>
            <ol>
              <li>Open <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">openrouter.ai/keys</a>.</li>
              <li>Create an API key and paste it here. The key stays in this browser.</li>
              <li>Pick a model on OpenRouter, copy its model ID, and paste it below.</li>
            </ol>
          </details>
          <label>Model<input value={model} onChange={(e) => setModel(e.target.value)} /></label>
          <div className="model-links" aria-label="OpenRouter model links">
            <a href="https://openrouter.ai/rankings" target="_blank" rel="noreferrer">Popular models</a>
            <a href="https://openrouter.ai/models?fmt=cards&max_price=0" target="_blank" rel="noreferrer">Free models</a>
          </div>
          <div className="model-help">
            <p>Default model:</p>
            <CopyModelId value={DEFAULT_MODEL} onUse={setModel} />
            <p>On OpenRouter, open a model page and copy the ID under the model title.</p>
          </div>
          <dl>
            <div><dt>Data</dt><dd>{dbStatus}</dd></div>
            <div><dt>Files</dt><dd>{fsIndex ? `${fsIndex.files.length} indexed` : "not loaded"}</dd></div>
            <div><dt>Run</dt><dd>{sideRunLabel}</dd></div>
          </dl>
          <button
            className="reset"
            onClick={reset}
            title="Clear conversation, stage, tool trace, queued messages, and agent state. Keeps API key, model, loaded data, and system prompt."
            type="button"
          >
            Clear Conversation
          </button>
          <details className="api-help">
            <summary>JavaScript API</summary>
            <pre>{`Query:
  await sql("select ...")
  await tables("%ORDER%")
  await schema("ORDER_RESULTS")
  await sample("PAT_ENC", 5)

Files:
  await listFiles("Rich Text")
  await readFile("raw/Rich Text/...")
  await grepFiles("hypertension", { pathIncludes: "Rich Text" })

Retained output:
  listToolResults()
  readToolResult()
  scanToolResult(undefined, "ERROR|WARN")

Render:
  await plot_vegalite(spec)
  renderHtml("<table>...</table>")

State:
  state.investigation = {
    domain: "labs",
    guidesRead: ["lab-results.md"],
    next: "Check latest glucose row"
  }
  state.done = true`}</pre>
          </details>
        </div>
      </section>

      <section className="chat">
        <div className="panel-head">
          <div>
            <h2>Conversation</h2>
            <p>{busy ? "The agent is running. New messages are queued into this same loop." : "Ask the agent to inspect the export, run JavaScript, query SQLite, and render into the stage."}</p>
          </div>
          <span className={`status ${runStatus}${modelActivity.active ? " model-active" : ""}`}>{runLabel}</span>
        </div>
        <details className="system-prompt-editor">
          <summary>System prompt</summary>
          <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} spellCheck={false} />
        </details>
        <div className="messages" onScroll={onConversationScroll} ref={messagesElRef}>
          {messages.filter((m) => m.role !== "system").length ? (
            messages.filter((m) => m.role !== "system").map((m, i) => <MessageView m={m} traces={traces} key={i} />)
          ) : (
            <div className="empty-chat">
              <b>Ready</b>
              <p>Try asking for a schema oddity, a note search, or a chart of table row counts. The agent can call tools repeatedly, then answer in the conversation.</p>
            </div>
          )}
        </div>
        <div className="composer">
          <textarea placeholder={busy ? "Send another instruction into the running loop..." : "Ask the agent to explore the export..."} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void send();
          }} />
          <div className="run-buttons">
            <button onClick={() => void send()}>{busy ? queuedCount ? `Queue (${queuedCount})` : "Queue Message" : "Send"}</button>
            <button className="stop" onClick={stopRun} disabled={!busy} type="button">Stop</button>
          </div>
          <p className="hint">Cmd/Ctrl+Enter sends. While running, Send queues your message into the active loop.</p>
          {error ? <p className="error">{error}</p> : null}
        </div>
      </section>

      <section className="stage-wrap">
        <div className="stage-head">
          <div>
            <h2>Stage</h2>
            <p>Agent-rendered HTML, SVG, tables, and Vega-Lite plots.</p>
          </div>
          <button type="button" onClick={() => helpers.clearStage()}>Clear</button>
        </div>
        <div className="stage" ref={stageRef}>
          <p className="empty">Agent JavaScript can write HTML, SVG, tables, or notes here with <code>renderHtml</code> and <code>appendHtml</code>.</p>
        </div>
        <h2>Agent state</h2>
        <pre className="state">{agentStateText}</pre>
        <h2>Tool trace</h2>
        <div className="traces">
          {traces.map((t) => <TraceView t={t} key={t.id} />)}
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
