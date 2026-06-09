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
import { resolve, join } from "node:path";
import { zipSync } from "fflate";

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

{
  const textExt = new Set([".md", ".ts", ".tsx", ".js", ".json", ".css", ".html", ".txt"]);
  const includeBundlePath = (path: string) => {
    const name = path.split("/").at(-1) ?? "";
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
    if (path.startsWith("skills/reading-epic-ehi-export/")) return textExt.has(ext);
    if (path.startsWith("raw/Rich Text/")) return ext === ".rtf" || name === "_INDEX.HTML";
    return false;
  };
  const tracked = Bun.spawnSync({
    cmd: ["git", "ls-files", "-z", "skills/reading-epic-ehi-export", "raw/Rich Text"],
    stdout: "pipe", stderr: "pipe",
  });
  if (tracked.exitCode !== 0) {
    console.error(`git ls-files failed while building fs.zip:\n${tracked.stderr.toString()}`);
    process.exit(1);
  }
  const bundlePaths = tracked.stdout.toString()
    .split("\0")
    .filter(Boolean)
    .filter(includeBundlePath)
    .sort();
  if (!bundlePaths.length) {
    console.error("no tracked files matched fs.zip allowlist");
    process.exit(1);
  }
  const zipEntries: Record<string, Uint8Array> = {};
  for (const path of bundlePaths) zipEntries[path] = new Uint8Array(readFileSync(path));
  const zipped = zipSync(zipEntries, { level: 9 });
  await Bun.write(join(dataDir, "fs.zip"), zipped);
  console.log(`zipped ${bundlePaths.length} tracked files -> ${outDir}/data/fs.zip`);

  const coreSkillPaths = [
    "skills/reading-epic-ehi-export/SKILL.md",
  ].filter(existsSync);
  if (coreSkillPaths.length) {
    const prompt = [
      "Core baked-in Epic EHI reading skill",
      "",
      "The static site includes a zipped virtual filesystem exposed to execute_javascript through listFiles(pattern), readFile(path), and grepFiles(pattern, options). It is built only from git-tracked files and contains skills/reading-epic-ehi-export/** plus redacted rich-text note payloads at raw/Rich Text/*.RTF and raw/Rich Text/_INDEX.HTML.",
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
