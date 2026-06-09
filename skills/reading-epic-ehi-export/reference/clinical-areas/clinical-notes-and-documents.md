# Clinical notes & documents — Epic EHI field guide

**Scope.** Narrative clinical documentation: the HNO ("General Use Note") master file and its per-contact
versions, the two places a note body can live (plain-text table vs. `Rich Text/*.RTF` file), note
type/author/status metadata, procedure-result report text (`ORDER_NARRATIVE`), and the links that tie a
note to its encounter, its order, and a problem's overview. Scanned/attached documents (`DOC_INFORMATION`
+ `raw/Media`) are a *different* master file (DCS) — see the imaging-media guide.

**Where it sits.** A note is anchored to the patient via `V_EHI_HNO_LINKED_PATS.LINKED_PAT_ID` (= `PAT_ID`)
and to the encounter it documents via `HNO_INFO.PAT_ENC_CSN_ID` → `PAT_ENC.PAT_ENC_CSN_ID` (§2 CSN). The
note's *own* per-version serial (`CONTACT_SERIAL_NUM`) is a **separate** id space from the encounter CSN.

## Tables

| table | role | rows in specimen | notes |
|---|---|---|---|
| `HNO_INFO` | **Spine.** One row per logical note (PK `NOTE_ID`, the HNO master-file key). Type, author, encounter link, create/service/last-filed instants, soft-delete, addend/cosign pointers. | 188 | Time-insensitive "once per record" data (§6 base table). |
| `NOTE_ENC_INFO` | One row **per contact (version)** of a note: `NOTE_ID` + `CONTACT_SERIAL_NUM` + `CONTACT_DATE_REAL`. Per-version status, author, role, format, sign instants. | 194 | 194 contacts over 188 notes → 6 notes have >1 contact (addenda). |
| `NOTE_ENC_INFO_2` | Numbered supplement (§6) of `NOTE_ENC_INFO`, same key. Holds external/auto-reconciled-author fields. | 194 | All `EXT_*` columns empty here (no externally reconciled notes). |
| `HNO_PLAIN_TEXT` | Line-chunked **plain-text body** (§8). Key `NOTE_CSN_ID`(=`CONTACT_SERIAL_NUM`) + `LINE`; col `NOTE_TEXT`. | 82 | Body for notes with a plain rendering; doc says it explicitly **excludes** rich text. 24 distinct notes. |
| `NOTE_CONTENT_INFO` | Marker/index of contacts that carry discrete note content. **No text column.** | 80 | 79/80 join to a `Rich Text` contact — essentially enumerates the RTF contacts. |
| `ORDER_NARRATIVE` | Line-chunked **procedure-result report text** (§8). Key `ORDER_PROC_ID` + `LINE`; col `NARRATIVE`. | 465 | Keyed to the *order*, not the note. Radiology/diagnostic reports. Heavily blank-padded. |
| `HNO_ORDERS` | Bridge: a result-note → the order(s) it documents. `NOTE_ID` + `LINE` → `ORDER_ID`. | 7 | The only join from a note to `ORDER_NARRATIVE` text. |
| `V_EHI_HNO_LINKED_PATS` | Export view: which `PAT_ID` each note belongs to (`NOTE_ID` + `LINE` → `LINKED_PAT_ID`). | 188 | §27 export view; all 188 → the one patient here. |
| `raw/Rich Text/*.RTF` | **The only copy of a Rich-Text note body** in the whole export. Filename encodes `NOTE_ID` + an inverted date. | 100 files | + `_INDEX.HTML` manifest. See "Unstructured tie-back". |
| `raw/Rich Text/_INDEX.HTML` | Human-readable manifest: filename → "`<type>` by `<author>`, `<role>` at `<date time>` (`<status>`)". | 1 | Mirrors the `IP_NOTE_TYPE`/`AUTHOR`/`AUTHOR_PRVD_TYPE`/`NOTE_STATUS` columns. |

**Standard tables to expect that are EMPTY/absent here (described from the schema doc):**
- `HNO_NOTE_TEXT` — **absent.** The schema doc for `HNO_PLAIN_TEXT` literally redirects rich-text reporting
  to `HNO_NOTE_TEXT`, but it is **not exported**. This is *why* a Rich-Text note body exists only as the RTF
  file (see Gotchas). Expect to look for it and not find it.
- `DOC_INFORMATION` / `PATIENT_DOCS` — present (22 rows here) but belong to the **DCS scanned-document**
  master file, not HNO. Different domain; out of scope for narrative notes.

## How they join

All verified against rows in this specimen.

- **Note → its versions:** `HNO_INFO.NOTE_ID = NOTE_ENC_INFO.NOTE_ID` (1→N). 188 notes, 194 contact rows;
  e.g. `NOTE_ID 2302006711` has two contacts: `CONTACT_DATE_REAL` 65575 (`Signed`) and 65575.01
  (`Addendum`). Reassemble the audit trail by ordering contacts on `CAST(CONTACT_DATE_REAL AS REAL)` (§10).
- **Version supplement:** `NOTE_ENC_INFO.CONTACT_SERIAL_NUM = NOTE_ENC_INFO_2.NOTE_CSN_ID` (1:1, both 194
  rows) (§6). The `_2` adds external-author fields, all empty here.
- **Note → encounter:** `HNO_INFO.PAT_ENC_CSN_ID = PAT_ENC.PAT_ENC_CSN_ID` (§2). Only **77 of 188** notes
  carry this — telephone/letter/MyChart/system notes often have none. This is the encounter the note
  *documents*, NOT the note's own `CONTACT_SERIAL_NUM`.
- **Plain-text body:** `HNO_PLAIN_TEXT.NOTE_CSN_ID = NOTE_ENC_INFO.CONTACT_SERIAL_NUM` (all 24 plain CSNs
  match a contact). **Keying `HNO_PLAIN_TEXT` by `NOTE_ID` works too** (the col is present) but the join
  axis is the contact serial, not `NOTE_ID`. Reassemble body with `ORDER BY CAST(LINE AS INT)` (§8).
- **Content marker:** `NOTE_CONTENT_INFO.NOTE_CSN_ID = NOTE_ENC_INFO.CONTACT_SERIAL_NUM`; 79/80 land on a
  `NOTE_FORMAT_C_NAME = 'Rich Text'` contact.
- **Author / entry user:** `HNO_INFO.ENTRY_USER_ID = CLARITY_EMP.USER_ID` (alphanumeric Epic login, e.g.
  `BURKEBD1`; 69 join). `NOTE_ENC_INFO.AUTH_LNKED_PROV_ID = CLARITY_SER.PROV_ID` (80 join). Every `*_ID`
  ships beside a denormalized `*_ID_NAME` companion (§4), so you usually don't need the join for display.
- **Note → order → report text:** `HNO_ORDERS.NOTE_ID = HNO_INFO.NOTE_ID`; `HNO_ORDERS.ORDER_ID =
  ORDER_PROC.ORDER_PROC_ID = ORDER_NARRATIVE.ORDER_PROC_ID`. Verified: `NOTE_ID 5231916898 → ORDER_ID
  1025926289` (XR cervical spine, 96 narrative lines).
- **Problem → overview note:** `PROBLEM_LIST.OVERVIEW_NOTE_ID = HNO_INFO.NOTE_ID` (a `Problem Overview`
  note). Verified: `OVERVIEW_NOTE_ID 6400440669` is a Rich-Text "Problem Overview" note whose body is the
  RTF file `HNO_6400440669_53988_41.RTF`; the same opening text is cached in `PROBLEM_LIST.PROBLEM_CMT`
  (§23 preview cache).
- **Note → patient:** `V_EHI_HNO_LINKED_PATS.NOTE_ID → LINKED_PAT_ID` (= `PAT_ID`). 188 rows, all one
  patient here.

## Unstructured tie-back

This domain *is* the unstructured material. A note body lives in one or both of two places, and the
storage path is driven by `NOTE_ENC_INFO.NOTE_FORMAT_C_NAME`:

1. **Rich-Text bodies → `raw/Rich Text/*.RTF`, the ONLY copy.** There is no rich-text body column anywhere
   in the database (`HNO_NOTE_TEXT` is not exported). Filename convention:
   `HNO_<NOTE_ID>_<MIDDLE>_41.RTF`, where:
   - `NOTE_ID` = `HNO_INFO.NOTE_ID` (the **note**, not the contact serial).
   - `MIDDLE` = **`121531 − CONTACT_DATE_REAL`** of the note's **latest** contact. Verified exactly for
     **all 100** files (zero exceptions; e.g. `64869 + 56662 = 121531`). The complement makes a filename
     sort list newest-notes-first. Addendum contacts (`CONTACT_DATE_REAL` ending `.01`) yield a `.99`
     fractional MIDDLE (`121531 − 65575.01 = 55955.99`) — not corruption.
   - trailing `_41` = the HNO master-file INI context (constant), not part of any id.
   - **Join recipe:** parse `(NOTE_ID, MIDDLE)` from the filename, compute `date_real = 121531 − MIDDLE`,
     and match `NOTE_ENC_INFO(NOTE_ID, ROUND(CONTACT_DATE_REAL,2))`. Each file maps to **exactly one**
     contact — the note's MAX `CONTACT_DATE_REAL` (verified: 0 files map to a non-max contact; 0 notes have
     >1 file).
2. **Plain-text bodies → `HNO_PLAIN_TEXT`** (line-chunked, §8). Keyed by the contact serial.

`raw/Rich Text/_INDEX.HTML` is a ready-made manifest mapping every RTF to a one-line description; use it as
a fast index instead of opening files.

The RTF is **Epic-flavored RTF** carrying hidden SmartTool markup (see Gotchas) — render or strip it before
showing to a human.

## Gotchas & quirks (chased to *why*)

- **The two body paths are NOT mutually exclusive.** *Observed:* 9 notes appear in **both**
  `HNO_PLAIN_TEXT` **and** have an RTF file (e.g. the `Letter` `NOTE_ID 1473625808`, the two `Problem
  Overview` notes). *Why:* for some note types Epic stores both a de-formatted plain rendering (in the
  table) and the formatted letterhead/SmartText rendering (the RTF) of the **same** content. *Handle:* don't
  assume "format tells you where the body is." Prefer the RTF when both exist (it's the faithful copy); fall
  back to `HNO_PLAIN_TEXT` for notes with no RTF.
- **`NOTE_FORMAT_C_NAME` is an unreliable "has-a-body" predictor.** *Observed:* of 194 contacts, 81 are
  `'Rich Text'` and **113 are NULL** — yet 23 of those NULL-format contacts still have an RTF file, and 24
  have plain text. *Why:* `'Rich Text'` is set only on signed clinical prose; administrative, system, and
  letter contacts leave it NULL even when they have a body. *Handle:* establish body presence by the join
  (file exists? rows in `HNO_PLAIN_TEXT`?), not by reading `NOTE_FORMAT_C_NAME`.
- **An addendum supersedes the file; only the latest contact gets an RTF.** *Observed:* the 4 Signed+Addendum
  notes each have ONE RTF, named for the addendum (`.01`/`.99`) contact, and the signed `.00` contact has no
  file. *Why:* each note re-renders its **whole** current body at the latest contact (the RTF is cumulative,
  not a delta), so the export ships one file = the current state. *Handle:* to read a note end-to-end, take
  the file at `MAX(CONTACT_DATE_REAL)`; for the per-version audit trail (who signed/addended when) read the
  `NOTE_ENC_INFO` rows, not separate files. Note: addenda show up **three** ways for one event — filename
  `.99`, `CONTACT_DATE_REAL .01`, and `NOTE_STATUS_C_NAME='Addendum'` — so naive note counting double-counts.
- **Note type lives in parallel columns and is often blank.** *Observed:* `NOTE_TYPE_NOADD_C_NAME` is blank
  for **107/188** notes; `IP_NOTE_TYPE_C_NAME` for 111. They disagree (NOADD has `Progress Note`, IP has
  `Progress Notes` / also `Consults`, `Miscellaneous`). *Why:* `NOTE_TYPE_NOADD` is a virtual item derived
  only when an ambulatory note-type context exists; `IP_NOTE_TYPE` is the inpatient/encounter note type.
  Many HNO rows are stubs with no signed contact and thus no type. *Handle:* `COALESCE(IP_NOTE_TYPE_C_NAME,
  NOTE_TYPE_NOADD_C_NAME)` for best coverage — but even then **104 notes have no type at all** (84 have a
  type from either column). For per-contact granularity also see `NOTE_ENC_INFO.NOTE_TYPE_C_NAME`.
- **~107 HNO rows are stubs.** *Observed:* 107 notes have blank `NOTE_TYPE_NOADD`, NULL status, and no body;
  some entered by system users (`HB BACKGROUND`, `MYCHART GENERIC`). *Why:* an HNO record is minted for many
  encounter/admin events that never become signed prose (problem-overview placeholders, encounter context,
  background tasks). *Handle:* filter on a populated `NOTE_ENC_INFO.NOTE_STATUS_C_NAME` (`Signed`/`Addendum`)
  to get real clinical narrative; 82 of 194 contacts have a status.
- **RTF carries hidden Epic SmartTool markup.** *Observed:* note bodies contain SmartLink tokens embedded as
  RTF bookmarks — `{\*\bkmkstart LINKBEGIN|80|86|NAME||||1}…{\*\bkmkend LINKBEGIN|…}` — plus
  `LISTBEGIN/LISTEND` (SmartList picklist resolutions), `BLOCKBEGIN/BLOCKEND` (SmartBlocks), and a hidden
  (`\v`) `SMARTLIST_METADATA_BEGIN…END` / `WILDCARD`/`PLACEHOLDER` trailer recording which SmartList items
  filled the note. *Why:* Epic round-trips structured data through the RTF so notes can be re-edited.
  *Handle:* stripping RTF control words alone leaves `\*`/`0x1C` field-separator artifacts and the
  LINK/LIST/BLOCK marker words; delete those markers too, or render the RTF properly.
- **`ORDER_NARRATIVE` is keyed by order, not note, and is mostly blank padding.** *Observed:* 465 rows over 6
  orders; the cervical-spine report has 96 `LINE` rows of which 90 are blank. Only **1 of the 6** narrated
  orders is reachable from a note via `HNO_ORDERS`. *Why:* report text is one DB row per source line
  (preserving the report's blank lines/pagination), filed against the procedure order independently of any
  note. *Handle:* read report text straight from `ORDER_NARRATIVE` by `ORDER_PROC_ID` (`ORDER BY CAST(LINE
  AS INT)`, optionally dropping blank lines); don't expect a note to point at it.

## Recipes

```sql
-- 1. List all notes with type, author, role, status, encounter date — newest first.
SELECT h.NOTE_ID,
       COALESCE(h.IP_NOTE_TYPE_C_NAME, h.NOTE_TYPE_NOADD_C_NAME) AS note_type,
       e.AUTHOR_USER_ID_NAME      AS author,
       e.AUTHOR_PRVD_TYPE_C_NAME  AS role,
       e.NOTE_STATUS_C_NAME       AS status,
       e.NOTE_FORMAT_C_NAME       AS format,
       e.CONTACT_DATE             AS note_date,
       h.PAT_ENC_CSN_ID           AS encounter_csn
FROM HNO_INFO h
JOIN NOTE_ENC_INFO e ON e.NOTE_ID = h.NOTE_ID
ORDER BY CAST(e.CONTACT_DATE_REAL AS REAL) DESC;

-- 2. Signed clinical narrative only (drop stubs/admin contacts), with body location.
SELECT h.NOTE_ID, e.CONTACT_SERIAL_NUM, e.NOTE_STATUS_C_NAME, e.NOTE_FORMAT_C_NAME,
       (SELECT COUNT(*) FROM HNO_PLAIN_TEXT p WHERE p.NOTE_CSN_ID = e.CONTACT_SERIAL_NUM) AS plain_lines
FROM HNO_INFO h
JOIN NOTE_ENC_INFO e ON e.NOTE_ID = h.NOTE_ID
WHERE e.NOTE_STATUS_C_NAME IN ('Signed','Addendum')   -- 82 contacts here
ORDER BY CAST(e.CONTACT_DATE_REAL AS REAL) DESC;

-- 3. Reassemble a plain-text note body.
SELECT GROUP_CONCAT(NOTE_TEXT, '') AS body
FROM (SELECT NOTE_TEXT FROM HNO_PLAIN_TEXT
      WHERE NOTE_ID = :note_id ORDER BY CAST(LINE AS INT));

-- 4. Find the RTF file for a note (compute the filename MIDDLE from the latest contact).
-- MIDDLE = 121531 - max(CONTACT_DATE_REAL). Keep 2 decimals for addenda (..55955.99),
-- but a whole-day note drops the trailing .00 (..56662). printf('%g') is WRONG here:
-- it rounds 55955.99 -> 55956 (6 sig-figs), so format with %.2f and strip a '.00' tail.
SELECT 'HNO_' || NOTE_ID || '_' ||
       replace(printf('%.2f', 121531 - MAX(CAST(CONTACT_DATE_REAL AS REAL))), '.00', '')
       || '_41.RTF' AS rtf_filename
FROM NOTE_ENC_INFO WHERE NOTE_ID = :note_id;
-- Easier in practice: just glob raw/Rich Text/HNO_<NOTE_ID>_*.RTF (one file per note).

-- 5. A problem's overview note text (cached preview + full body location).
SELECT pl.PROBLEM_LIST_ID, pl.OVERVIEW_NOTE_ID,
       substr(pl.PROBLEM_CMT,1,80) AS cached_preview,   -- §23
       h.IP_NOTE_TYPE_C_NAME AS overview_note_type
FROM PROBLEM_LIST pl
JOIN HNO_INFO h ON h.NOTE_ID = pl.OVERVIEW_NOTE_ID
WHERE pl.OVERVIEW_NOTE_ID IS NOT NULL;       -- body = RTF for these Rich-Text overview notes

-- 6. A result note's radiology report text via the order bridge.
SELECT ho.NOTE_ID, op.DESCRIPTION, n.LINE, n.NARRATIVE
FROM HNO_ORDERS ho
JOIN ORDER_PROC op ON op.ORDER_PROC_ID = ho.ORDER_ID
JOIN ORDER_NARRATIVE n ON n.ORDER_PROC_ID = ho.ORDER_ID
WHERE n.NARRATIVE IS NOT NULL AND TRIM(n.NARRATIVE) <> ''
ORDER BY ho.NOTE_ID, CAST(n.LINE AS INT);
```

## Open questions / specimen notes

- **`HNO_INFO.CONVERSATION_MSG_ID`** (1 populated row here, on a Progress Note) is meant to tie a note to its
  originating MyChart conversation, but the value (`358825337`) does **not** match `MYC_MESG.MESSAGE_ID`,
  `PARENT_MESSAGE_ID`, or `INBASKET_MSG_ID` in this specimen — it appears to be a distinct conversation/
  thread id space (§24 two ID spaces). Treat the cross-link as unconfirmed until a matching key is found.
- **The `121531` constant** is the per-day complement that reproduces every filename here exactly. The
  prior scout also derived an equivalent `793576 − day_ordinal` form; both work, but `121531 −
  CONTACT_DATE_REAL` is simpler and joins directly to a column. Whether `121531` is genre-stable or
  export-run-specific needs a second specimen to confirm.
- **`NOTE_ID 1997508480`** has 3 contacts (dates 65387/66350/66745), all with NULL status/format and
  different authors, and **no** RTF or plain-text body — likely a longitudinal/shared placeholder note
  re-contacted per encounter. Unresolved which (if any) body it should have.
- **MyChart-originated notes:** a patient MyChart message can surface as an HNO note authored by the system
  user `MYCHART, GENERIC`, with the message text exported as RTF. The handshake from note → message is via
  `CONVERSATION_MSG_ID` (see first bullet) — incomplete here.
- All `NOTE_ENC_INFO_2.EXT_*` (external/auto-reconciled author) and all cosign fields are empty in this
  specimen — no externally reconciled notes and no populated cosigner; the cosign workflow columns exist but
  can't be exercised here.
