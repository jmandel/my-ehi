#!/usr/bin/env bun
//
// serve.ts — host the built deep dives over HTTP for LIVE viewing in a browser.
//
// A deep dive is a client-side React app and MUST be served over HTTP: opening a built bundle via file://
// gives a null origin, the crossorigin module script is CORS-blocked, and React never mounts (you get a
// blank page). This serves a whole directory tree so you can open the landing page and click through every
// dive. Point it at the deep-dives folder so "/" is the landing index that links into each dive's dist dir.
//
//   # build each dive first (its JSON is baked into the bundle at build time), e.g.:
//   ( cd deep-dives/coverage-billing && bun build index.html --outdir dist )
//   # then host the whole tree and leave it running:
//   bun <skill>/scripts/serve.ts [root=deep-dives] [port=8088]
//   # open http://localhost:<port>/  -> landing page -> click into any dive
//
// For automated visual verification use screenshot.ts instead — it serves, captures, and tears down on its
// own, so you do NOT need this server running for a screenshot. This one is for a human at a browser.
//
const root = (process.argv[2] ?? "deep-dives").replace(/\/+$/, "");
const port = Number(process.argv[3] ?? 8088);

const CT: Record<string, string> = {
  html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg",
  jpeg: "image/jpeg", gif: "image/gif", ico: "image/x-icon", woff2: "font/woff2", map: "application/json",
};

const server = Bun.serve({
  port,
  async fetch(req) {
    let path = decodeURIComponent(new URL(req.url).pathname);
    if (path.endsWith("/")) path += "index.html";          // directory -> its index
    let file = Bun.file(root + path);
    if (!(await file.exists()) && !/\.[a-z0-9]+$/i.test(path)) {
      file = Bun.file(root + path + "/index.html");        // extensionless -> try as a directory
    }
    if (!(await file.exists())) return new Response("not found: " + path, { status: 404 });
    const ext = path.split(".").pop()!.toLowerCase();
    return new Response(file, { headers: { "content-type": CT[ext] ?? "application/octet-stream" } });
  },
});
console.log(`serving ${root}/ at http://localhost:${server.port}/  (Ctrl-C to stop)`);
