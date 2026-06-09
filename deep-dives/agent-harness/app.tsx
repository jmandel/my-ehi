import React from "react";
import { createRoot } from "react-dom/client";
import initSqlJs, { type Database, type SqlValue } from "sql.js";
import * as d3 from "d3";
import vegaEmbed from "vega-embed";
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
type FsIndex = { files: { path: string; text: string }[] };
type OpenRouterModel = {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: Record<string, string>;
  supported_parameters?: string[];
};

const DEFAULT_MODEL = "openrouter/free";
const MAX_STEPS = 8;
const MAX_AUTONOMOUS_TURNS = 12;
const MAX_TOOL_CHARS = 14000;

const initialSystemPrompt = `You are an exploratory web agent embedded in a static Epic EHI export site.

You can call one tool: execute_javascript({ code }).

The JavaScript runs intentionally unsandboxed in the page. Use it to query the client-side SQLite database,
read bundled skill files, inspect schema, and write directly to the stage DOM.

Available helpers inside execute_javascript:
- await sql(query, params?, options?) -> rows as objects. options.limit defaults to 200.
- await tables(pattern?) -> populated table catalog.
- await schema(tableName) -> live PRAGMA table_info rows.
- await sample(tableName, limit?) -> sample rows.
- await listFiles(pattern?) -> bundled file paths from skills plus redacted raw text payloads.
- await readFile(path) -> bundled file text.
- await grepFiles(pattern, options?) -> {path, line, text} matches.
- state -> persistent JSON object. Mutate it to carry notes/results across tool calls.
- d3 -> D3 module.
- await plot_vegalite(spec, options?) -> append a Vega-Lite chart to the stage.
- epicDateRealToDate(value) -> Date for Epic *_DATE_REAL serial dates.
- epicDateRealToIso(value) -> YYYY-MM-DD for Epic *_DATE_REAL serial dates.
- parseEpicDateText(value) -> Date for rendered M/D/YYYY timestamp text.
- stage -> HTMLElement for visual output.
- renderHtml(html), appendHtml(html), clearStage().

Tool return values:
- A single-expression tool body is returned automatically, e.g. await sql("select * from _tables limit 5").
- In statement-style JavaScript, use return explicitly, e.g. const rows = await sql(...); return rows.
- If you only render to the stage or mutate state, a transcript return value is optional.
- Helper names are injected into an inner async scope; local variables may reuse ordinary names like sample,
  schema, or rows without colliding with the helper API.
- Tool failures return JSON with ok:false, error.name, error.message, a stack excerpt, and line-numbered
  user code. Read that error and repair the next tool call; do not continue as if the failed tool worked.

Epic date rules:
- Do not pass *_DATE_REAL values such as 67543 to new Date(). They are numeric Epic serial dates: integer
  days since 1840-12-31, with decimal fractions for same-day sequencing.
- Use epicDateRealToDate() / epicDateRealToIso() for *_DATE_REAL columns. Use parseEpicDateText() for
  rendered text date columns like START_DATE or ORDERING_DATE.

Conversation vs. stage:
- To answer in the conversation, return normal assistant message text. Do not call a tool for ordinary prose.
- If the answer is complete, return the final answer as normal assistant text with no tool call.
- If you need to keep working, call execute_javascript. You may include a short assistant message before the
  tool call, and it will be shown in the conversation.
- The stage is only for artifacts that benefit from layout or visuals: small tables, SVGs, mini dashboards,
  note snippets, and plots. Do not render plain prose into the stage just to answer the human.

Notes quickstart:
- The detailed notes guide is bundled at
  skills/reading-epic-ehi-export/reference/clinical-areas/clinical-notes-and-documents.md. Read it before
  doing serious note work.
- Rich-text note bodies are files under raw/Rich Text/*.RTF; there is no SQLite column containing the RTF
  body. Use await listFiles("raw/Rich Text"), await grepFiles("term", { pathIncludes: "raw/Rich Text" }),
  and await readFile(path).
- Use HNO_INFO as the note spine. Join note versions with HNO_INFO.NOTE_ID = NOTE_ENC_INFO.NOTE_ID. Link
  to encounters through HNO_INFO.PAT_ENC_CSN_ID when populated. Do not use NOTE_ENC_INFO.PAT_ENC_CSN_ID as
  the note encounter key; in this export it is blank.
- Plain text note body chunks, when present, are in HNO_PLAIN_TEXT via NOTE_CSN_ID = NOTE_ENC_INFO.CONTACT_SERIAL_NUM.

When analyzing data, show the SQL or JS check you used. Keep state concise and purposeful.

Run protocol:
- Continue working by calling execute_javascript when more investigation or rendering is needed.
- When the task is complete, respond with normal assistant text and no tool call.
- You may also set state.done = true from JavaScript when the run should stop after that tool result.
- If the human sends a new message while you are running, it will be inserted into the same run. Treat it as the newest instruction.`;

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

function formatToolError(error: unknown, code: string) {
  const err = error instanceof Error ? error : new Error(String(error));
  return JSON.stringify({
    ok: false,
    error: {
      name: err.name,
      message: err.message,
      stack: err.stack?.split("\n").slice(0, 12).join("\n") ?? null,
    },
    userCode: numberedCode(code),
    guidance: "Fix the JavaScript or Vega-Lite spec and retry. If a plot failed, inspect the stage error and the stack excerpt.",
  }, null, 2);
}

function makeToolFunction(AsyncFunction: FunctionConstructor, code: string) {
  const helperPrelude = "const { sql, tables, schema, sample, listFiles, readFile, grepFiles, state, d3, plot_vegalite, plotVegaLite, epicDateRealToDate, epicDateRealToIso, parseEpicDateText, stage, renderHtml, appendHtml, clearStage } = helpers;";
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
  const stageRef = React.useRef<HTMLDivElement | null>(null);

  const loadDb = React.useCallback(async () => {
    if (db) return db;
    setDbStatus("loading sql.js");
    const SQL = await initSqlJs({ locateFile: () => "../data/sql-wasm.wasm" });
    setDbStatus("fetching ehi.sqlite");
    const res = await fetch("../data/ehi.sqlite");
    if (!res.ok) throw new Error(`Could not fetch ../data/ehi.sqlite (${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const next = new SQL.Database(bytes);
    setDb(next);
    setDbStatus(`${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB loaded`);
    return next;
  }, [db]);

  const loadFs = React.useCallback(async () => {
    if (fsIndex) return fsIndex;
    const res = await fetch("../data/fs.json");
    if (!res.ok) throw new Error(`Could not fetch ../data/fs.json (${res.status})`);
    const next = (await res.json()) as FsIndex;
    setFsIndex(next);
    return next;
  }, [fsIndex]);

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
    const readFile = async (path: string) => {
      const idx = await loadFs();
      const file = idx.files.find((f) => f.path === path);
      if (!file) throw new Error(`No bundled file: ${path}`);
      return file.text;
    };
    const grepFiles = async (pattern: string, options?: { caseSensitive?: boolean; limit?: number; pathIncludes?: string }) => {
      const idx = await loadFs();
      const flags = options?.caseSensitive ? "" : "i";
      const re = new RegExp(pattern, flags);
      const out: { path: string; line: number; text: string }[] = [];
      const limit = options?.limit ?? 200;
      for (const file of idx.files.filter((f) => !options?.pathIncludes || f.path.includes(options.pathIncludes))) {
        const lines = file.text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) out.push({ path: file.path, line: i + 1, text: lines[i] });
          if (out.length >= limit) return out;
        }
      }
      return out;
    };
    const plot_vegalite = async (spec: unknown, options?: Record<string, unknown>) => {
      if (!stageRef.current) throw new Error("No stage element is mounted.");
      const mount = document.createElement("div");
      mount.className = "plot";
      stageRef.current.appendChild(mount);
      try {
        await vegaEmbed(mount, spec as never, { actions: false, ...options });
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
      listFiles, readFile, grepFiles,
      listSkillFiles: listFiles, readSkillFile: readFile, grepSkillFiles: grepFiles,
      d3, plot_vegalite, plotVegaLite: plot_vegalite,
      epicDateRealToDate, epicDateRealToIso, parseEpicDateText,
      renderHtml, appendHtml, clearStage,
      state: agentStateRef.current,
      syncState,
      get stage() { return stageRef.current; },
    };
  }, [loadDb, loadFs, syncState]);

  React.useEffect(() => {
    Object.assign(window, { ehiAgent: helpers });
  }, [helpers]);

  return { dbStatus, fsIndex, agentStateText, agentStateRef, loadDb, loadFs, syncState, helpers, stageRef };
}

async function callOpenRouter(apiKey: string, model: string, messages: ChatMessage[], signal?: AbortSignal) {
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
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${text}`);
  return JSON.parse(text).choices?.[0]?.message as ChatMessage;
}

function parseToolCode(call: ToolCall) {
  try {
    return (JSON.parse(call.function.arguments || "{}") as { code?: string }).code ?? "";
  } catch {
    return call.function.arguments;
  }
}

function compactToolResult(content: string | null) {
  if (!content) return "No tool output.";
  const [body] = content.split(/\n\nagent_state:\n/);
  const trimmed = body.trim();
  if (!trimmed || trimmed.startsWith("(no return value") || trimmed === "undefined") return "Tool completed with no returned value. See the stage and trace for effects.";
  return truncate(trimmed, 900);
}

function MessageView({ m, traces }: { m: ChatMessage; traces: Trace[] }) {
  const trace = m.tool_call_id ? traces.find((t) => t.id === m.tool_call_id) : null;
  return (
    <div className={`msg ${m.role}`}>
      <b>{m.role}</b>
      {m.tool_calls?.length ? (
        <>
          {m.content ? <pre className="assistant-text">{m.content}</pre> : null}
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
          <pre>{compactToolResult(m.content)}</pre>
          <small>{trace?.resultFull && trace.resultForModel && trace.resultFull !== trace.resultForModel ? "Model saw the bounded output above. Full output is retained in Tool trace." : "Full code and output are in Tool trace."}</small>
        </div>
      ) : m.content ? (
        <pre>{m.content}</pre>
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

function App() {
  const { dbStatus, fsIndex, agentStateText, agentStateRef, loadDb, loadFs, syncState, helpers, stageRef } = useHarness();
  const [apiKey, setApiKey] = React.useState(localStorage.getItem("openrouter_api_key") ?? "");
  const [model, setModel] = React.useState(localStorage.getItem("openrouter_model") ?? DEFAULT_MODEL);
  const [systemPrompt, setSystemPrompt] = React.useState(initialSystemPrompt);
  const [messages, setMessages] = React.useState<ChatMessage[]>([{ role: "system", content: initialSystemPrompt }]);
  const [corePromptStatus, setCorePromptStatus] = React.useState("loading core prompt");
  const [input, setInput] = React.useState("Find one interesting export-shape issue in the SQLite data, show the raw check, and render a small table in the stage.");
  const [traces, setTraces] = React.useState<Trace[]>([]);
  const [freeModels, setFreeModels] = React.useState<OpenRouterModel[]>([]);
  const [modelStatus, setModelStatus] = React.useState("finding free models");
  const [busy, setBusy] = React.useState(false);
  const [runStatus, setRunStatus] = React.useState<"idle" | "running" | "stopping" | "stopped" | "done">("idle");
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
    fetch("../data/core-prompt.txt")
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      })
      .then((text) => {
        if (cancelled) return;
        setSystemPrompt((prev) => prev === initialSystemPrompt ? `${initialSystemPrompt}\n\n${text}` : prev);
        setCorePromptStatus("core analysis skills loaded");
      })
      .catch(() => {
        if (!cancelled) setCorePromptStatus("core prompt not available");
      });
    return () => { cancelled = true; };
  }, []);

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
    setMessages([{ role: "system", content: systemPrompt }]);
    setTraces([]);
    agentStateRef.current = {};
    syncState();
    helpers.clearStage();
    setError(null);
  };

  const loadFreeModels = React.useCallback(async () => {
    setError(null);
    setModelStatus("finding free models");
    const res = await fetch("https://openrouter.ai/api/v1/models");
    const json = await res.json();
    if (!res.ok) throw new Error(`OpenRouter models ${res.status}: ${JSON.stringify(json)}`);
    const models = (json.data ?? []) as OpenRouterModel[];
    const isFree = (m: OpenRouterModel) => {
      const p = m.pricing ?? {};
      return m.id.includes(":free") || ["prompt", "completion", "request"].some((k) => p[k] === "0");
    };
    const usage = (m: OpenRouterModel) => {
      const any = m as OpenRouterModel & Record<string, any>;
      return Number(any.usage_last_week ?? any.usage?.last_week ?? any.top_provider?.usage_last_week ?? any.activity?.last_week ?? 0);
    };
    const scored = models.filter(isFree).sort((a, b) => {
      const at = a.supported_parameters?.includes("tools") ? 1 : 0;
      const bt = b.supported_parameters?.includes("tools") ? 1 : 0;
      const ac = Number((a as OpenRouterModel & { created?: number }).created ?? 0);
      const bc = Number((b as OpenRouterModel & { created?: number }).created ?? 0);
      return bt - at || usage(b) - usage(a) || bc - ac || (b.context_length ?? 0) - (a.context_length ?? 0) || a.id.localeCompare(b.id);
    });
    setFreeModels(scored.slice(0, 40));
    if (scored[0] && (!localStorage.getItem("openrouter_model") || model === DEFAULT_MODEL)) setModel(scored[0].id);
    setModelStatus(scored.length ? `${scored.length} free models found` : "using free router fallback");
  }, [model]);

  React.useEffect(() => {
    void loadFreeModels().catch((e) => {
      setModelStatus("free model list unavailable; using free router fallback");
      console.warn(e);
    });
  }, [loadFreeModels]);

  const runTool = async (call: ToolCall) => {
    const parsed = JSON.parse(call.function.arguments || "{}") as { code?: string };
    const code = parsed.code ?? "";
    const traceId = call.id || crypto.randomUUID();
    const started = performance.now();
    setTraces((prev) => [...prev, { id: traceId, code, status: "running", started: new Date().toISOString() }]);
    try {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const fn = makeToolFunction(AsyncFunction, code);
      const value = await fn(helpers);
      helpers.syncState();
      const stateSnapshot = JSON.stringify(agentStateRef.current, null, 2);
      const resultFull = `${stringifyResult(value)}\n\nagent_state:\n${stateSnapshot}`;
      const resultForModel = truncate(resultFull);
      const elapsedMs = Math.round(performance.now() - started);
      setTraces((prev) => prev.map((t) => t.id === traceId ? { ...t, status: "ok", elapsedMs, resultFull, resultForModel } : t));
      return resultForModel;
    } catch (e) {
      const resultFull = formatToolError(e, code);
      const resultForModel = truncate(resultFull);
      helpers.syncState();
      const elapsedMs = Math.round(performance.now() - started);
      setTraces((prev) => prev.map((t) => t.id === traceId ? { ...t, status: "error", elapsedMs, resultFull, resultForModel } : t));
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
    stopRequestedRef.current = false;
    setError(null);
    queuedRef.current = [];
    setQueuedCount(0);
    let next: ChatMessage[] = [{ role: "system", content: systemPrompt }, ...messages.filter((m) => m.role !== "system"), { role: "user", content: input }];
    setMessages(next);
    messagesRef.current = next;
    setInput("");
    try {
      for (let turn = 0; turn < MAX_AUTONOMOUS_TURNS; turn++) {
        if (stopRequestedRef.current) break;
        next = drainQueued(next);
        const controller = new AbortController();
        abortRef.current = controller;
        const assistant = await callOpenRouter(apiKey.trim(), model.trim(), next, controller.signal);
        next = [...next, assistant];
        setMessages(next);
        messagesRef.current = next;
        if (!assistant.tool_calls?.length && (assistant.content ?? "").trim()) {
          setRunStatus("done");
          break;
        }
        if (assistant.tool_calls?.length) {
          let toolSteps = 0;
          for (const call of assistant.tool_calls) {
            if (stopRequestedRef.current) break;
            if (call.function.name !== "execute_javascript") continue;
            const result = await runTool(call);
            next = [...next, { role: "tool", tool_call_id: call.id, content: result }];
            setMessages(next);
            messagesRef.current = next;
            toolSteps++;
            if (isDoneAfterTool()) break;
            if (toolSteps >= MAX_STEPS) break;
          }
          if (isDoneAfterTool()) {
            setRunStatus("done");
            break;
          }
          continue;
        }
        break;
      }
    } catch (e) {
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
          <div className="guide">
            <b>Key setup</b>
            <ol>
              <li>Open <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">openrouter.ai/keys</a>.</li>
              <li>Create an API key and paste it here. The key stays in this browser.</li>
              <li>The app picks a current free model automatically. You can override it below.</li>
            </ol>
          </div>
          <label>Model<input value={model} onChange={(e) => setModel(e.target.value)} /></label>
          {freeModels.length ? (
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {freeModels.map((m) => (
                <option key={m.id} value={m.id}>{m.supported_parameters?.includes("tools") ? "tools " : ""}{m.id} · ctx {m.context_length ?? "?"}</option>
              ))}
            </select>
          ) : null}
          <label>System prompt<textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} /></label>
          <dl>
            <div><dt>SQLite</dt><dd>{dbStatus}</dd></div>
            <div><dt>FS</dt><dd>{fsIndex ? `${fsIndex.files.length} files indexed` : "not loaded"}</dd></div>
            <div><dt>Models</dt><dd>{modelStatus}</dd></div>
            <div><dt>Prompt</dt><dd>{corePromptStatus}</dd></div>
            <div><dt>Run</dt><dd>{runStatus}{queuedCount ? `, ${queuedCount} queued` : ""}</dd></div>
            <div><dt>Tool</dt><dd>execute_javascript</dd></div>
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
            <pre>{`await sql("select ...")
await tables("%ORDER%")
await schema("ORDER_RESULTS")
await sample("PAT_ENC", 5)
await listFiles("Rich Text")
await readFile("raw/Rich Text/HNO_...")
await grepFiles("hypertension", { pathIncludes: "Rich Text" })
state.notes = [...]
d3.rollups(...)
await plot_vegalite({ mark: "bar", data: { values }, encoding: ... })
renderHtml("<h2>...</h2>")`}</pre>
          </details>
        </div>
      </section>

      <section className="chat">
        <div className="panel-head">
          <div>
            <h2>Conversation</h2>
            <p>{busy ? "The agent is running. New messages are queued into this same loop." : "Ask the agent to inspect the export, run JavaScript, query SQLite, and render into the stage."}</p>
          </div>
          <span className={`status ${runStatus}`}>{runStatus}{queuedCount ? ` · ${queuedCount} queued` : ""}</span>
        </div>
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
