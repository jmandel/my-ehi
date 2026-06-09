#!/usr/bin/env bun
/**
 * screenshot.ts — render a built deep dive to a PNG for visual verification.
 *
 * A deep dive is a client-side React app, so you cannot eyeball it from the HTML — you must run it, and it
 * must be served over HTTP (opening the bundle via file:// fails: the module script is crossorigin and a
 * file:// origin is null, so CORS blocks it and React never mounts). This serves the built dir and drives
 * headless Chromium over the DevTools protocol to take a TRUE full-page screenshot (measures the document
 * height and captures beyond the viewport — long-form dives are 6,000–10,000px tall and a fixed-window
 * grab silently truncates them).
 *
 * Screenshots are THROWAWAY verification artifacts — write them to /tmp, never into the dive folder
 * (they are not deliverables; .gitignore drops deep-dives/<slug>/*.png so a stray one can't be committed).
 *
 * Usage:
 *   bun build index.html --outdir dist
 *   bun screenshot.ts <distDir> /tmp/shot.png [width=1100] [waitMs=4000] [maxHeightPx=30000]
 *   # capture only the top N px (legible detail of the opening sections):
 *   bun screenshot.ts <distDir> /tmp/top.png 1100 4000 2600
 */
import { spawn } from "bun";

const argv = process.argv.slice(2);
const clickArg = argv.find((a) => a.startsWith("--click="));
const clickSel = clickArg ? clickArg.slice("--click=".length) : null; // CSS selector to click before capture
const pos = argv.filter((a) => !a.startsWith("--"));
const distDir = pos[0];
const out = pos[1] ?? "shot.png";
const width = Number(pos[2] ?? 1100);
const waitMs = Number(pos[3] ?? 4000);
const maxHeight = Number(pos[4] ?? 30000);
if (!distDir) { console.error("usage: bun screenshot.ts <distDir> <out.png> [width] [waitMs] [maxHeightPx] [--click=<sel>]"); process.exit(1); }

const chromeBin = ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]
  .map((b) => Bun.which(b)).find(Boolean);
if (!chromeBin) { console.error("no chromium/chrome on PATH"); process.exit(1); }

// Serve the built dir on a free port.
let server: ReturnType<typeof Bun.serve> | null = null, servePort = 0;
for (let p = 8200; p < 8280; p++) {
  try {
    server = Bun.serve({ port: p, async fetch(req) {
      let path = new URL(req.url).pathname; if (path === "/") path = "/index.html";
      const f = Bun.file(distDir + path);
      return (await f.exists()) ? new Response(f) : new Response("not found", { status: 404 });
    }});
    servePort = p; break;
  } catch { /* busy */ }
}
if (!server) { console.error("no free serve port"); process.exit(1); }
const url = `http://localhost:${servePort}/`;

// Launch headless Chromium with a DevTools endpoint on a free port.
let dbgPort = 0, proc: any = null;
for (let p = 9222; p < 9300; p++) {
  proc = spawn({ cmd: [chromeBin, "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
    `--remote-debugging-port=${p}`, `--window-size=${width},1200`], stderr: "pipe", stdout: "pipe" });
  // probe the endpoint
  let ok = false;
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://localhost:${p}/json/version`); if (r.ok) { ok = true; break; } } catch {}
    await Bun.sleep(100);
  }
  if (ok) { dbgPort = p; break; }
  proc.kill();
}
if (!dbgPort) { console.error("could not start Chromium DevTools"); server.stop(true); process.exit(1); }

async function fail(msg: string): Promise<never> {
  console.error(msg); try { proc.kill(); } catch {} server!.stop(true); process.exit(1);
}

// Open a page target for the URL (newer Chromium wants PUT; fall back to GET).
const newUrl = `http://localhost:${dbgPort}/json/new?${encodeURIComponent(url)}`;
let target: any;
try { target = await (await fetch(newUrl, { method: "PUT" })).json(); }
catch { try { target = await (await fetch(newUrl)).json(); } catch (e) { await fail("could not open target: " + e); } }
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map<number, (v: any) => void>();
const send = (method: string, params: any = {}) =>
  new Promise<any>((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
await new Promise((r) => ws.addEventListener("open", () => r(null)));
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data as string); if (m.id && pending.has(m.id)) { pending.get(m.id)!(m.result); pending.delete(m.id); } });

await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url });
await Bun.sleep(waitMs); // let React + D3 paint
if (clickSel) {
  // click the first element matching the selector (e.g. a ⌖ cite) to open an interactive state
  await send("Runtime.evaluate", { expression: `(()=>{const el=document.querySelector(${JSON.stringify(clickSel)}); if(el){el.click(); return true} return false})()` });
  await Bun.sleep(900);
}
const metrics = await send("Page.getLayoutMetrics");
const contentH = Math.ceil((metrics.cssContentSize ?? metrics.contentSize)?.height ?? 1200);
const height = Math.min(contentH, maxHeight);
const shot = await send("Page.captureScreenshot", {
  format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 },
});
if (!shot?.data) await fail("captureScreenshot returned no data");
await Bun.write(out, Buffer.from(shot.data, "base64"));
console.log(`wrote ${out} — ${width}×${height}px (content ${contentH}px)${contentH > maxHeight ? " [clipped]" : ""} from ${distDir}`);
ws.close(); proc.kill(); server.stop(true); process.exit(0);
