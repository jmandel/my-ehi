#!/usr/bin/env bun
/**
 * family.ts — projection for the cardiac-risk view model's `family` slot.
 *
 *   bun deep-dives/cardiac-risk/scripts/family.ts
 *
 * Reads the CLEAN dataset projection (deep-dives/cardiac-risk/dataset.json,
 * risk_factors[kind=family] rows — relation / condition / relative_sex /
 * relative_status / cv_related, all already display-clean) and assembles a
 * proper THREE-GENERATION pedigree structure for a graphical family tree:
 *
 *   Generation I  — four grandparents (maternal pair, paternal pair)
 *   Generation II — mother, father  (children of their respective grandparents)
 *   Generation III — proband (Joshua) + brother  (children of mother+father)
 *
 * The proband is synthesised: he has no FAMILY_HX row of his own, but a real
 * pedigree needs the index person marked. His own affected conditions are
 * intentionally left empty here (his hypertension / lipid drift is the SUBJECT
 * of the deep dive, not "family history"), and `proband:true` flags him for the
 * ↗P marker.
 *
 * Output → deep-dives/cardiac-risk/parts/family.json
 *   { members:[{ id, relation, sex, deceased, affected:[condKey...], parents:[ids], proband? }],
 *     conditions:[{ key, label, color }],
 *     meta:{ ... counts + provenance } }
 *
 * EVERYTHING display-clean: relations are plain words ("Maternal grandmother"),
 * sex is "male"/"female", conditions are lowercase canonical keys mapped to a
 * proper label+color. No raw column names, no locator ids, no timestamps reach
 * this file. The dataset row's `src` is kept ONLY in meta.provenance for tracing,
 * never as a member field the app would render.
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";

const HERE = dirname(new URL(import.meta.url).pathname);
const TOPIC_DIR = join(HERE, "..");
const DATASET = join(TOPIC_DIR, "dataset.json");
const OUT_DIR = join(TOPIC_DIR, "parts");
const OUT = join(OUT_DIR, "family.json");

type FamRow = {
  kind: string;
  relation: string;            // "Mother" | "Maternal Grandfather" | ...
  condition: string;           // "Hypertension" | "Heart attack" | ...
  cv_related: boolean;
  relative_sex: "Male" | "Female";
  relative_status: "Alive" | "Deceased";
  src: string;
};

// ---------------------------------------------------------------------------
// Condition vocabulary — the four cardiovascular conditions that drive the
// affected-status shading, each given a clean lowercase key, a human label, and
// a stable color. Non-CV family conditions (ovarian/prostate/colon, thyroid)
// are NOT shading conditions; they still appear in each member's full
// condition list under meta for completeness, but `affected` holds only the CV
// keys so the pedigree shades the inherited cardiovascular substrate.
// ---------------------------------------------------------------------------
const CONDITIONS: { key: string; label: string; color: string; raw: string[] }[] = [
  { key: "htn",    label: "Hypertension",          color: "#c026d3", raw: ["Hypertension"] },
  { key: "hld",    label: "Hyperlipidemia",        color: "#d97706", raw: ["Hyperlipidemia"] },
  { key: "mi",     label: "Myocardial infarction", color: "#c1121f", raw: ["Heart attack"] },
  { key: "stroke", label: "Stroke",                color: "#1d4ed8", raw: ["Stroke"] },
];
const rawToKey = new Map<string, string>();
for (const c of CONDITIONS) for (const r of c.raw) rawToKey.set(r.toLowerCase(), c.key);

// Clean, capitalised-once relation words for display (the dataset has title-cased
// multi-word labels like "Maternal Grandmother"; render them as sentence case).
function cleanRelation(rel: string): string {
  const map: Record<string, string> = {
    "Mother": "Mother",
    "Father": "Father",
    "Brother": "Brother",
    "Maternal Grandmother": "Maternal grandmother",
    "Maternal Grandfather": "Maternal grandfather",
    "Paternal Grandmother": "Paternal grandmother",
    "Paternal Grandfather": "Paternal grandfather",
  };
  return map[rel] ?? rel;
}

// ---------------------------------------------------------------------------
// Pedigree skeleton: id -> { relation key in the data, generation, parents }.
// Parents are expressed as member ids, giving the app the full descent graph
// (grandparents -> parent -> proband/brother) instead of a flat list.
// ---------------------------------------------------------------------------
const SKELETON: {
  id: string;
  relationLabel: string;       // raw FAMILY_HX relation to pull rows by ("" = synthesised proband)
  generation: 1 | 2 | 3;
  parents: string[];
  proband?: boolean;
  // fallback sex/status for the synthesised proband (no FAMILY_HX row)
  sex?: "Male" | "Female";
  deceased?: boolean;
}[] = [
  // Generation I — grandparents
  { id: "mgm", relationLabel: "Maternal Grandmother", generation: 1, parents: [] },
  { id: "mgf", relationLabel: "Maternal Grandfather", generation: 1, parents: [] },
  { id: "pgm", relationLabel: "Paternal Grandmother", generation: 1, parents: [] },
  { id: "pgf", relationLabel: "Paternal Grandfather", generation: 1, parents: [] },
  // Generation II — parents
  { id: "mother", relationLabel: "Mother", generation: 2, parents: ["mgm", "mgf"] },
  { id: "father", relationLabel: "Father", generation: 2, parents: ["pgm", "pgf"] },
  // Generation III — proband + sibling
  { id: "proband", relationLabel: "", generation: 3, parents: ["mother", "father"], proband: true, sex: "Male", deceased: false },
  { id: "brother", relationLabel: "Brother", generation: 3, parents: ["mother", "father"] },
];

// map a member id back to the RAW FAMILY_HX relation label (the app's existing
// per-relative drill uses risk_factors[relation=<raw label>], e.g.
// "Maternal Grandmother") — kept in meta for tracing, not rendered.
function rawRelationFor(id: string): string {
  return SKELETON.find((s) => s.id === id)?.relationLabel ?? "";
}

// ---------------------------------------------------------------------------
function main() {
  const dataset = JSON.parse(readFileSync(DATASET, "utf8"));
  const fam: FamRow[] = (dataset.risk_factors ?? []).filter((r: any) => r.kind === "family");

  // group the clean family rows by relation
  const byRel = new Map<string, FamRow[]>();
  for (const f of fam) {
    if (!byRel.has(f.relation)) byRel.set(f.relation, []);
    byRel.get(f.relation)!.push(f);
  }

  // sanity: every grouped relation must be a node we know about (no orphans)
  const knownRelations = new Set(SKELETON.map((s) => s.relationLabel).filter(Boolean));
  for (const rel of byRel.keys()) {
    if (!knownRelations.has(rel)) {
      throw new Error(`family.ts: FAMILY_HX relation "${rel}" has no pedigree node — update SKELETON.`);
    }
  }

  const members = SKELETON.map((node) => {
    const rows = byRel.get(node.relationLabel) ?? [];

    // sex / deceased come from the data for real relatives; from the skeleton for the proband
    const sexRaw = rows[0]?.relative_sex ?? node.sex ?? "Male";
    const deceased = rows.length ? rows[0].relative_status === "Deceased" : !!node.deceased;

    // affected = the cardiovascular condition KEYS this relative carries (deduped, stable order)
    const affKeys = new Set<string>();
    for (const r of rows) {
      const k = rawToKey.get(r.condition.toLowerCase());
      if (k && r.cv_related) affKeys.add(k);
    }
    const affected = CONDITIONS.filter((c) => affKeys.has(c.key)).map((c) => c.key);

    // full condition list (CV + non-CV) for the member, display-clean, for tooltips/detail
    const allConditions = rows.map((r) => ({
      label: r.condition,
      cardiovascular: !!r.cv_related,
    }));

    return {
      id: node.id,
      relation: cleanRelation(node.relationLabel) || (node.proband ? "Self (proband)" : node.id),
      sex: (sexRaw === "Female" ? "female" : "male") as "male" | "female",
      deceased,
      affected,                 // cardiovascular condition keys -> drive shading
      conditions: allConditions, // every recorded condition for this relative, clean
      parents: node.parents,
      generation: node.generation,
      ...(node.proband ? { proband: true } : {}),
    };
  });

  // conditions legend (only the keys actually used by at least one member, in canonical order)
  const usedKeys = new Set(members.flatMap((m) => m.affected));
  const conditions = CONDITIONS
    .filter((c) => usedKeys.has(c.key))
    .map((c) => ({ key: c.key, label: c.label, color: c.color }));

  const totalFamilyFacts = fam.length;
  const totalCvFacts = fam.filter((f) => f.cv_related).length;

  const out = {
    members,
    conditions,
    meta: {
      slot: "family",
      layer: "VIEW MODEL — family pedigree slot. A clean 3-generation projection of risk_factors[kind=family] for a graphical pedigree (square=male, circle=female, slash=deceased, ↗P=proband). `affected` holds canonical cardiovascular condition keys mapping to the `conditions` legend; `parents` give the descent graph (grandparents→parent→proband). The proband is synthesised (he has no family-history row of his own).",
      generations: [
        { generation: 1, label: "Grandparents", ids: members.filter((m) => m.generation === 1).map((m) => m.id) },
        { generation: 2, label: "Parents", ids: members.filter((m) => m.generation === 2).map((m) => m.id) },
        { generation: 3, label: "Proband & siblings", ids: members.filter((m) => m.generation === 3).map((m) => m.id) },
      ],
      total_family_facts: totalFamilyFacts,
      total_cv_facts: totalCvFacts,
      bilateral: "Cardiovascular loading is bilateral: hypertension (mother, brother) and hyperlipidemia (father, brother) in first-degree relatives; a hard atherosclerotic event in all four grandparents (stroke x2 maternal line, myocardial infarction x2 paternal line).",
      onset_caveat: "Age of onset is blank for every family-history row and in every annual note's family-history block, so whether the grandparents' events were premature (the ASCVD-relevant cut: under 55 male / under 65 female) cannot be determined from this export.",
      // provenance for tracing only — NOT rendered as member content.
      // Use dataset-locator tokens (the app's Cite/drawer resolves these), not
      // raw Clarity locators, so the view-model part stays fully grep-clean:
      // the underlying FAMILY_HX rows + their `src` live in dataset.json.
      provenance: {
        source: "risk_factors[kind=family]",
        per_member: members.map((m) => ({
          id: m.id,
          // drill token the app already uses for per-relative family history
          locator: m.proband ? null : `risk_factors[relation=${rawRelationFor(m.id)}]`,
        })),
        all_rows_locator: "risk_factors[kind=family]",
      },
    },
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2));

  // receipt to stdout
  console.log(`wrote ${OUT}`);
  console.log(`members: ${members.length} | conditions: ${conditions.length} | family facts: ${totalFamilyFacts} (cv ${totalCvFacts})`);
  for (const m of members) {
    console.log(
      `  ${m.id.padEnd(8)} gen${m.generation}  ${m.relation.padEnd(22)} ${m.sex.padEnd(6)} ` +
      `${m.deceased ? "deceased" : "alive   "} parents=[${m.parents.join(",")}]` +
      `${m.proband ? " <PROBAND>" : ""}  affected=[${m.affected.join(",")}]`
    );
  }
}

main();
