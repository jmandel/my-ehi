#!/usr/bin/env bun
//
// build-site.ts — build every deep dive and assemble one static site dir for hosting.
//
// Produces a self-contained tree of pure-relative-path files, so it works whether served at a domain root
// (example.com/) OR a subpath (example.com/<reponame>/ — how GitHub Pages serves a project site). bun build
// emits ./hashed asset URLs and the dives use no leading-"/" paths, so NO base href is needed; the same
// artifact is correct at any mount point. Each dive is built straight into site/<slug>/; the landing page
// (deep-dives/index.html) is copied with its "<slug>/dist/" links flattened to "<slug>/".
//
//   bun <skill>/scripts/build-site.ts [divesDir=deep-dives] [outDir=site]
//   bun <skill>/scripts/serve.ts site 8088     # preview EXACTLY what Pages will serve
//
// CI just runs this after `bun install` and uploads outDir as the Pages artifact (see .github/workflows).
//
import { existsSync, rmSync, mkdirSync, readdirSync, statSync, cpSync, readFileSync } from "node:fs";
import { resolve, join, relative } from "node:path";

const divesDir = (process.argv[2] ?? "deep-dives").replace(/\/+$/, "");
const outDir = (process.argv[3] ?? "site").replace(/\/+$/, "");
if (!existsSync(divesDir)) { console.error(`no such dives dir: ${divesDir}`); process.exit(1); }

const absOut = resolve(outDir);
rmSync(absOut, { recursive: true, force: true });
mkdirSync(absOut, { recursive: true });
const dataDir = join(absOut, "data");
mkdirSync(dataDir, { recursive: true });

// Shared static data for browser-only tools. The DB is generated from the redacted raw export at build time;
// it is intentionally not checked into the repository.
if (existsSync("raw/EHITables")) {
  const builtDb = join(dataDir, "ehi.sqlite");
  const loadTables = Bun.spawnSync({
    cmd: ["bun", "skills/reading-epic-ehi-export/scripts/load-ehi-sqlite.ts", "raw", builtDb],
    stdout: "pipe", stderr: "pipe",
  });
  if (loadTables.exitCode !== 0) {
    console.error(`SQLite table load failed:\n${loadTables.stderr.toString()}`);
    process.exit(1);
  }
  const loadSchema = Bun.spawnSync({
    cmd: ["bun", "skills/reading-epic-ehi-export/scripts/load-schema-docs.ts", "raw", builtDb],
    stdout: "pipe", stderr: "pipe",
  });
  if (loadSchema.exitCode !== 0) {
    console.error(`SQLite schema-doc load failed:\n${loadSchema.stderr.toString()}`);
    process.exit(1);
  }
  console.log(`built browser SQLite DB -> ${outDir}/data/ehi.sqlite`);
} else {
  console.warn("raw/EHITables not found; skipping browser SQLite DB build");
}

const sqlWasm = "node_modules/sql.js/dist/sql-wasm.wasm";
if (existsSync(sqlWasm)) {
  cpSync(sqlWasm, join(dataDir, "sql-wasm.wasm"));
  console.log(`copied sql.js wasm -> ${outDir}/data/sql-wasm.wasm`);
}

if (existsSync("skills") || existsSync("raw/Rich Text")) {
  const files: { path: string; text: string }[] = [];
  const textExt = new Set([".md", ".ts", ".tsx", ".js", ".json", ".css", ".html", ".txt"]);
  const includeTextFile = (p: string, name: string) => {
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
    if (p.startsWith(`skills/`)) return textExt.has(ext);
    if (p.startsWith(join("raw", "Rich Text"))) return ext === ".rtf" || name === "_INDEX.HTML";
    return false;
  };
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        if (name === "node_modules" || name === "dist") continue;
        if (p === join("raw", "EHITables")) continue; // SQLite is the table interface; don't duplicate TSVs into JSON.
        if (p === join("raw", "_redaction")) continue;
        walk(p);
      } else if (st.isFile() && st.size < 400_000) {
        if (includeTextFile(p, name)) files.push({ path: relative(".", p), text: readFileSync(p, "utf8") });
      }
    }
  };
  if (existsSync("skills")) walk("skills");
  if (existsSync("raw/Rich Text")) walk("raw/Rich Text");
  await Bun.write(join(dataDir, "fs.json"), JSON.stringify({ files }, null, 2));
  console.log(`indexed ${files.length} text files -> ${outDir}/data/fs.json`);

  const coreSkillPaths = [
    "skills/reading-epic-ehi-export/SKILL.md",
    "skills/ehi-deep-dives/SKILL.md",
  ].filter(existsSync);
  if (coreSkillPaths.length) {
    const prompt = [
      "Core baked-in analysis skills",
      "",
      "The static site includes a virtual filesystem exposed to execute_javascript through listFiles(pattern), readFile(path), and grepFiles(pattern, options). It contains selected text files from skills/ plus redacted rich-text note payloads at raw/Rich Text/*.RTF and raw/Rich Text/_INDEX.HTML.",
      "",
      "When a skill below references a relative path such as reference/patterns/general-patterns.md or scripts/q.ts, resolve it relative to the directory containing that SKILL.md. For example, inside skills/reading-epic-ehi-export/SKILL.md, reference/patterns/general-patterns.md means skills/reading-epic-ehi-export/reference/patterns/general-patterns.md. Use readFile() or grepFiles() to inspect those referenced files before relying on them.",
      "",
      "Do not assume a referenced file is already in context. If a cited reference, script, or clinical-area guide matters, explicitly read it from the virtual filesystem.",
      "",
      ...coreSkillPaths.flatMap((path) => [
        `\n--- BEGIN ${path} ---\n`,
        readFileSync(path, "utf8"),
        `\n--- END ${path} ---\n`,
      ]),
    ].join("\n");
    await Bun.write(join(dataDir, "core-prompt.txt"), prompt);
    console.log(`wrote core prompt -> ${outDir}/data/core-prompt.txt`);
  }
}

// A dive = a subdirectory with its own index.html entry point.
const slugs = readdirSync(divesDir).filter((name) => {
  const p = join(divesDir, name);
  return statSync(p).isDirectory() && existsSync(join(p, "index.html"));
});
if (!slugs.length) { console.error(`no buildable dives under ${divesDir}/`); process.exit(1); }

for (const slug of slugs) {
  const r = Bun.spawnSync({
    cmd: ["bun", "build", "index.html", "--outdir", join(absOut, slug)],
    cwd: join(divesDir, slug), stdout: "pipe", stderr: "pipe",
  });
  if (r.exitCode !== 0) { console.error(`build failed for ${slug}:\n${r.stderr.toString()}`); process.exit(1); }
  console.log(`built ${slug} -> ${outDir}/${slug}/`);
}

// Landing page: flatten "<slug>/dist/" links to "<slug>/" so they point at the assembled tree.
const landing = join(divesDir, "index.html");
if (existsSync(landing)) {
  const html = (await Bun.file(landing).text()).replace(/\/dist\//g, "/");
  await Bun.write(join(absOut, "index.html"), html);
  console.log(`assembled landing -> ${outDir}/index.html`);
} else {
  console.warn(`no landing at ${landing} — the site has no root index`);
}

// Tell GitHub Pages to serve the files verbatim (skip Jekyll, which can drop some files).
await Bun.write(join(absOut, ".nojekyll"), "");
console.log(`done — ${slugs.length} dives in ${outDir}/ (relative paths; root- or subpath-safe)`);
