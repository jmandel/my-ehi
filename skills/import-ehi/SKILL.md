---
name: import-ehi
description: >
  Import an Epic EHI Export (the "Requested Record" zip) into a working tree and produce a REDACTED, same-shape
  subset that is safe to commit and publish. Goes zip → raw.unredacted/ (full PHI, gitignored) → raw/ (redacted,
  committable) via: discover identifier values from the structured columns, fuzzy-redact them everywhere
  (notes included), use agents to catch free-text-only secrets, and PROVE the result clean. Use this whenever
  you want to publish or share more than a hand-picked artifact — closer to the full record — without leaking PHI.
---

# Import an EHI export (extract → redact → safe-to-commit)

You have an Epic **EHI Export** zip and you want to publish **close to the whole thing** — the structured tables
and the free-text notes — not just a few curated deep dives. The job is to turn the full-PHI export into a
**redacted, same-shape subset** you can commit to git, with a *defensible* safety argument.

```
"Requested Record.zip"
  → 01  unzip → raw.unredacted/ + load → db/ehi.unredacted.sqlite  (FULL PHI — gitignored, never committed)
  → 02  discover identifier VALUES from the structured columns        → redact/identifiers.json
  → (agents) find the free-text-only secrets the columns miss          → redact/agentic-findings.json
  → 03  assemble + hygiene + variant-expand → .redaction-terms.json    ← HUMAN REVIEW CHECKPOINT
  → 04  fuzzy-redact every term everywhere; omit media                 → raw/   (redacted, same shape)
  → 05  PROVE 0 residual (deterministic) ── + agentic sweep (semantic) → safe to commit
```

`raw/` stays **gitignored until 05 passes**; only then is it un-ignored and committable. `raw.unredacted/`,
`.redaction-terms.json`, and the `redact/` working dir are **always** gitignored.

> **PHI path discipline.** The import DB is `db/ehi.unredacted.sqlite` — a deliberately distinct path from
> the redacted analysis DB `db/ehi.sqlite`, so a deep-dive or publish can never silently read unredacted
> data. Every loaded DB carries a `_provenance` stamp; `q.ts` shouts when it opens an unredacted-sourced DB,
> and `build-site.ts` refuses to publish one. Both paths are gitignored (`db/`, `*.unredacted.sqlite`).

## The core idea: the structured data is an inventory of this record's secrets

Epic puts identifiers in **known columns** — `PATIENT` (SSN, DOB, phones, email, MRN, name), the relationship
tables (`PAT_RELATIONSHIPS`/`PAT_REL_*` — family names/phones/emails/addresses), `PAT_ADDRESS`,
`ACCOUNT`/`ACCT_*` (guarantor), `V_EHI_COVERAGE_SUBS` (subscriber). So **`02` extracts the actual identifier
*values* from those columns**, and **`04` fuzzy-matches and redacts those values from *every* file** — TSVs and
notes alike. The structured columns are the *discovery* mechanism; the values they yield are scrubbed
*everywhere*. (Do **not** target org/payer/provider phone/address columns — those are public business
contacts, not PHI; redacting them would gut the clinical context you want to keep.)

## What the deterministic layer can't see, agents find

Some secrets live **only in free text** — a child named in a portal message but never a structured contact, a
home address written into a note, a portal access code. So an **agentic pass reads the notes + messages** and
adds those values to the inventory. Run it as a workflow (fan out over note batches + messages, then an
adversarial completeness pass). **PHI discipline:** agents write found *values* only into the gitignored
`redact/*.json`; their workflow **receipts carry counts and type/relation labels only — never a value** (so
PHI doesn't leak into transcripts/logs).

## Term hygiene — never redact a generic value

A redaction term must be a **specific identifier**, never a category. `EMPLOYER_ID_EMPLOYER_NAME` holds the
*value* `"OTHER"`; adding that to the redact set would fuzzy-match and **destroy every "other" in the corpus.**
`redact-lib.ts` carries a stop-word guard (`OTHER/NONE/UNKNOWN/SELF/wife/home/…`) and `03` drops anything that
trips it. Rule of thumb: `_C_NAME`/category columns are never good redaction sources.

## Variant expansion — match the forms a value actually appears in

The fuzzy regex (char-by-char with a short punctuation/space gap — adopted from the prior project) absorbs
*formatting* (`012 33 4456` ⇄ `012-33-4456`), but **not reordering or reformatting**. So `03` expands by type:
- a **name** `Last,First` → `First Last`, `Last First`, `Last, First`, standalone surname, standalone first;
- a **date** → every common format (`M/D/YYYY`, `YYYY-MM-DD`, `Mon D, YYYY`, `D Mon YYYY`, 2-digit year, …).

Each term's `match` array lists exactly what will be redacted, so the review is concrete. **Trade-off, stated
in the file:** standalone-first-name and date redaction can *over*-match (a common first name elsewhere; a
clinical date equal to a relative's DOB) — the owner can prune any `match` form they don't want.

## Allowlist, not denylist — emit only what you can check

`04` copies **only file types it knows how to scan and `05` does scan** (`.tsv .htm .html .rtf .css`), redacting
each; it **omits all media** (`.pdf/.jpg/.tif/…` — unscannable here) and **loudly warns** on any *unknown*
extension rather than passing it through. So nothing un-verifiable can reach the committable `raw/`.

## The proof by construction

Two complementary guarantees:
- **Deterministic (provable):** `05` re-scans every emitted file for every redact term in every expanded form —
  **decoding each RTF to plain text first**, which catches the one tricky case of a value split across RTF
  control words (and so dodged the byte-level redactor). The proof is **0 residual**, plus a check that the
  **keep-terms survived** (no accidental over-redaction of the patient's public name). Exit 1 on any leak.
- **Semantic (best-effort):** an **adversarial agentic sweep** re-reads the *redacted* notes/messages hunting
  for anything a privacy reviewer would still redact (a relative by description, a paraphrased address, a
  disclosure) that no term covered. Real survivors become new terms; re-run `04`/`05`. Loop until both pass.

Be honest about scope: the deterministic proof guarantees **every value that appears in a structured field is
gone everywhere**; the agentic sweep mitigates **free-text-only** secrets but is not a proof. State this when
you publish.

## The review checkpoint (do not skip)

After `03`, **stop**. The owner opens `.redaction-terms.json`, curates `keep` vs `redact` (e.g. *keep* the
patient's own name/DOB; *redact* family names, home address, contacts, credentials), prunes over-broad `match`
forms, and adds anything missed. **Nothing is redacted until they approve the list.** Defaults: the patient's
own name + DOB + coarse geo (city/ZIP) are kept; everything else is redacted — but they are defaults, to be
reviewed, not trusted.

## Scripts

`01-extract.ts` (unzip + load) · `02-extract-identifiers.ts` (structured inventory) · the agentic find
workflow · `03-assemble-terms.ts` (hygiene + variant-expand → the reviewable list) · `04-redact.ts`
(destructive: redact + omit media) · `05-verify.ts` (the 0-residual proof) · `redact-lib.ts` (stop-words,
name/date expansion, the fuzzy regex). Built on `bun` + the loaded SQLite + `lib/rtf2txt.ts`.
