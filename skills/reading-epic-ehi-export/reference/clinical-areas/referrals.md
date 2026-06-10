# Referrals — Epic EHI field guide

**Scope.** Outbound referral orders (the "AMB REFERRAL TO …" orders), their lifecycle/status over time,
who referred to which specialty/department, the coverage/authorization wrapped around each, and whether
the referred-to visit shows up inside this Epic instance or only as an external pointer.

**Where it sits.** A referral is a **two-record event**: an `ORDER_PROC` row placed *in* a source
encounter (`PAT_ENC_CSN_ID`), and a `REFERRAL` record (its own ID space) created from that order. Both
carry `PAT_ID`. The referred-*to* visit, when in-system, is a separate `PAT_ENC` linked back from
`REFERRAL_5` / `REFERRAL_APT` / `ASSOCIATED_REFERRALS`.

## Tables

| table | role | rows in specimen | notes |
|---|---|---|---|
| `REFERRAL` | spine: one row per referral | 10 | base of a 6-table supplement stack; 99 cols. Status, referring/referred-to, dates, auth, $ |
| `REFERRAL_2`…`REFERRAL_6` | numbered supplements (§6) | 10 each | 1:1 on `REFERRAL_ID`. `_5` holds the referred-to **encounter CSNs**; `_6` is a single column |
| `REFERRAL_HIST` | lifecycle audit trail (§17) | 175 | `(REFERRAL_ID, LINE)` per change. `CHANGE_TYPE_C_NAME`, `NEW_RFL_STATUS_C_NAME`, who/when |
| `REFERRAL_DX` | diagnoses on the referral (§7) | 11 | `(REFERRAL_ID, LINE)`; `DX_ID` → `CLARITY_EDG` |
| `REFERRAL_REASONS` | reason-for-referral list (§7) | 7 | `REFERRAL_REASON_C_NAME` (e.g. "Specialty Services Required") |
| `REFERRAL_PX` | procedures/visit-units requested (§7) | 10 | `PX_ID` (no `_NAME` companion) → `CLARITY_EAP.PROC_ID` → `PROC_NAME` (order-side namespace; resolves 10/10, e.g. "AMB REFERRAL TO GASTROENTEROLOGY"); `UNITS_REQUESTED`/`UNITS_APPROVED` |
| `REFERRAL_NOTES` | bridge to note text | 9 | `(REFERRAL_ID, LINE, NOTE_ID)` → HNO note / `Rich Text/HNO_<id>_*.RTF` |
| `REFERRAL_CVG` | coverage(s) attached | 10 | `(REFERRAL_ID, LINE, CVG_ID)`, `AUTH_REQUIRED_YN`, `CVG_AUTH_STATUS_C_NAME` |
| `REFERRAL_CVG_AUTH` | per-coverage auth/cert detail | 4 | 78 cols; precert **status/agency/dates** (`PRE_CERT_STATUS_C_NAME`, `PRE_CERT_AGENCY_*`, `AUTH_FROM_DT`/`AUTH_TO_DT`) — **no auth-number column** |
| `REFERRAL_APT` | appointments fulfilling the referral | 3 | **internal** visit via `SERIAL_NUMBER`=CSN, **external** via `EXT_SVC_*` |
| `ASSOCIATED_REFERRALS` | encounter→referral link | 2 | keyed by `PAT_ENC_CSN_ID`; `ASSOCIATED_REFERRAL_ID` |
| `REFERRAL_CROSS_ORG` | cross-organization (Care Everywhere) referral | 2 | external org name + OID; the "leaked"/community-connect dimension |
| `REFERRAL_SOURCE` | referring-provider lookup | 6 | `REFERRING_PROV_ID` → `REFERRING_PROV_NAM` (REF master; here = SER ids) |
| `REFERRAL_NOTIF_HIS` | transfer-of-care notification log | 1 | letter/notification events (`SEND TRANSFER OF CARE IMMEDIATELY`) |
| `REFERRAL_ORG_FILTER_SA` | authorized service-area filter | 10 | routing metadata, not clinical |
| `RFL_REF_TO_REGIONS` | referred-to geographic regions | 9 | steering metadata |
| `ORDER_PROC` (+`_2`) | the referral **order** | 42 (11 are referral/imaging orders) | `ORDER_PROC_2.REFERRAL_ID` is the order↔referral bridge |
| `ORDERS_ONLY_CSN` | (schema-doc'd order↔referral link) | **EMPTY** here | doc says it carries `REFERRAL_ID`; not shipped in this specimen — use `ORDER_PROC_2` instead |

## How they join

- **Order → referral (the bridge that actually keys, §24).** `REFERRAL_ID` (e.g. `9463136`) and
  `ORDER_PROC_ID` (e.g. `439060608`) are **different ID spaces** — they share no value. The bridge is
  **`ORDER_PROC.ORDER_PROC_ID = ORDER_PROC_2.ORDER_PROC_ID` and `ORDER_PROC_2.REFERRAL_ID =
  REFERRAL.REFERRAL_ID`.** Verified: all 11 referral/imaging orders map cleanly to the 10 `REFERRAL`
  rows (one referral, `10358290`, owns **two** imaging orders → 11:10). The order also records its origin
  textually: `REFERRAL_HIST` `LINE 1` `PREVIOUS_VALUE` = "Created from Order 439060608" for every referral.
- **Referral → source encounter.** `ORDER_PROC.PAT_ENC_CSN_ID` is the **encounter the referral was
  placed in** (§2). e.g. order `439060608` sits in CSN `799951565`, a MAC APL Internal Medicine visit.
- **Referring provider.** `REFERRAL.REFERRING_PROV_ID` → `REFERRAL_SOURCE.REFERRING_PROV_ID` →
  `REFERRING_PROV_NAM`; verified to equal the denormalized companion `REFERRAL.REFERRING_PROV_ID_REFERRING_PROV_NAM`
  exactly (e.g. `144590` → "RAMMELKAMP, ZOE L"). In this specimen the REF ids equal the SER `PROV_ID`s, so
  the same id also resolves through `CLARITY_SER`.
- **Referred-to target.** `REFERRAL.PROV_SPEC_C_NAME` (specialty, e.g. "Neurology") is the usual target;
  `REFERRAL.REFD_TO_DEPT_ID` → `CLARITY_DEP.DEPARTMENT_ID` resolves the department when one was chosen
  (only 2/10 here: `101401034`→MHM OT PARK, `1700801008`→MAC APL PT). `REFERRAL.REFERRAL_PROV_ID`
  (referred-to **named** provider) is **empty for all 10** — see gotcha.
- **Referred-to encounter (in-system).** `REFERRAL_5.FIRST_PAT_ENC_CSN_ID` / `LAST_PAT_ENC_CSN_ID` →
  `PAT_ENC.PAT_ENC_CSN_ID`; also `REFERRAL_APT.SERIAL_NUMBER` (=CSN) and `ASSOCIATED_REFERRALS`
  (`PAT_ENC_CSN_ID` ↔ `ASSOCIATED_REFERRAL_ID`). All three agree: OT referral `13661714` → CSNs
  `922942674` & `922943112` (two completed OT visits at MHM OT NEURO CENTRAL, provider Gilmour).
- **Diagnoses.** `REFERRAL_DX.DX_ID` → `CLARITY_EDG.DX_ID` → `DX_NAME` (e.g. `260690` → "Post concussion
  syndrome"). Note `REFERRAL_DX.DX_TEXT` ships empty here; the name comes only from the `CLARITY_EDG` join.
- **Coverage.** `REFERRAL_CVG.CVG_ID` → `COVERAGE.COVERAGE_ID` (note the column-name mismatch; joins all
  10 rows). `REFERRAL_CVG_AUTH` carries precert **status/agency/dates** per coverage, **not** an auth
  number — there is no `AUTH_NUM`/`PRE_CERT_NUM` column on it. Those literal number columns live only on
  base `REFERRAL` (`AUTH_NUM`, `PRE_CERT_NUM`) and are blank for all 10 here, so no auth number is
  retrievable in this specimen.
- **User attribution.** `REFERRAL_HIST.CHANGE_USER_ID`, `REFERRAL_NOTES.NOTE_USER_ID` →
  `CLARITY_EMP.USER_ID` → `NAME` (alphanumeric logins like `RAMMELZL`, `KEH405`).

## Unstructured tie-back

Referral text lives in HNO notes, reached two ways that point at the **same** note ids:
- `REFERRAL_NOTES(REFERRAL_ID, LINE, NOTE_ID)` — 9 rows here. Each `NOTE_ID` resolves in `HNO_INFO`
  (`HNO_INFO.NOTE_ID`) and, for most, as an on-disk file `raw/Rich Text/HNO_<NOTE_ID>_*.RTF`
  (verified: `HNO_3557417913_*.RTF`, `HNO_2302008978_*.RTF`, … all present).
- `REFERRAL_HIST.AUTH_HX_NOTE_ID` carries the same note id on each `Create Note` audit line (e.g.
  `3416358616`, `3441333955`, `3557417913` for referral `13661714`). The count of `CHANGE_TYPE_C_NAME =
  'Create Note'` (9) equals `REFERRAL_NOTES` rows (9).
- Referral-note HNO rows have **NULL `PAT_ENC_CSN_ID`** (they belong to the referral, not an encounter) —
  so you cannot find them by walking encounter→note; come from `REFERRAL_NOTES`.
- The referred-*to* in-system visit has its **own** encounter notes: OT CSNs `922942674`/`922943112` have
  2 `HNO_INFO` rows of their own (the therapy documentation), reached normally via `HNO_INFO.PAT_ENC_CSN_ID`.

## Gotchas & quirks (chased to *why*)

- **`REFERRAL_ID` and `ORDER_PROC_ID` never join directly.** They're separate Chronicles masters (REF vs
  ORD), minted independently (§24). Naively `JOIN ... ON REFERRAL_ID = ORDER_PROC_ID` returns nothing.
  *Why:* the order is the *request artifact*; the referral is the *managed authorization/lifecycle object*
  Epic spins off from it. *Handle:* go through `ORDER_PROC_2.REFERRAL_ID`. (The schema doc advertises an
  `ORDERS_ONLY_CSN.REFERRAL_ID` link too, but that table is **empty** in this export — don't rely on it.)
- **One referral can own several orders; matching by date is a trap.** Referral `10358290` has two imaging
  `ORDER_PROC` rows (`439060612` MRI 7/21, `439060613` MRI 7/31); a fourth MRI order (`439060613`) shares
  the referral with `439060612`. Two same-day Neurology orders (`772179267`/`772179268`) cross-match by
  date into 4 spurious pairs. *Why:* `ENTRY_DATE`/`ORDERING_DATE` are not keys, and an imaging referral can
  spawn repeat studies. *Handle:* use `ORDER_PROC_2.REFERRAL_ID`, never `date = date`.
- **"MRI/CAT Scan" referrals are a different `RFL_TYPE_C_NAME` than specialty "Referral".** Imaging
  referrals (`RFL_TYPE_C_NAME = 'MRI/CAT Scan'`, `REFD_TO_SPEC_C_NAME = 'Radiology'`, blank
  `PROV_SPEC_C_NAME`) coexist with provider referrals (`RFL_TYPE_C_NAME = 'Referral'` + a
  `PROV_SPEC_C_NAME`). The order side is correspondingly `ORDER_TYPE_C_NAME = 'Imaging'` vs `'Outpatient
  Referral'`, and the imaging order's `DESCRIPTION` is the study name ("MRI BRAIN WO CONTRAST"), not "AMB
  REFERRAL TO …". *Why:* Epic models an outside-imaging authorization as a referral record. *Handle:* to
  list classic specialty referrals, filter `DESCRIPTION LIKE 'AMB REFERRAL%'` or `RFL_TYPE_C_NAME =
  'Referral'`; for all authorizations, take the whole `REFERRAL` table.
- **`REFERRAL_PROV_ID` (referred-to named provider) is empty here for every row** — but the referrals are
  clearly populated. *Why:* these were placed to a **specialty/department**, not a specific clinician, so
  Epic fills `PROV_SPEC_C_NAME` / `REFD_TO_DEPT_ID` and leaves the named-provider id null. *Handle:* read
  the target from `PROV_SPEC_C_NAME` first, `REFD_TO_DEPT_ID`→`CLARITY_DEP` second; don't expect a name.
- **SER name-companions are dropped; you must join `CLARITY_SER` yourself.** `REFERRAL.REFERRAL_PROV_ID`,
  `PCP_PROV_ID` ship as bare ids with **no** `_PROV_NAME` sibling (querying the documented `..._PROV_NAME`
  errors "no such column"). *Why:* `CLARITY_SER` "may be hidden in a public view," so the export omits SER
  name-companions (§4/§5). The **referring** side is the exception — `REFERRING_PROV_ID_REFERRING_PROV_NAM`
  *is* materialized (truncated to 32 chars, final "E" cut). *Handle:* join `CLARITY_SER` /
  `REFERRAL_SOURCE` for names.
- **`REFERRAL_HIST` is a change-audit, not a clinical history (§17).** 175 rows for 10 referrals (9–30
  each); `NEW_RFL_STATUS_C_NAME` is populated **only** on status-change lines, so most lines have it null.
  *Why:* it logs every edit (coverage refresh, scheduling auto-assign, pend-reason change), one `LINE` per
  edit. *Handle:* for the *current* status read `REFERRAL.RFL_STATUS_C_NAME`; for the *story* read
  `REFERRAL_HIST` ordered by `LINE` and watch `CHANGE_TYPE_C_NAME` / `NEW_RFL_STATUS_C_NAME`. `Create
  Referral` is always `LINE 1`; `Auto Expired by Nightly Processing` shows the batch lifecycle.
- **Everything stays "Closed", but closure is not denial.** 9/10 referrals are `Closed` and only the
  newest (Allergy, `23182184`) is `Authorized`/open. *Why:* §18 soft-delete — referrals persist after
  fulfillment/expiry; a `Closed` referral with `CLOSE_RSN_C_NAME` was completed or expired, not rejected.
  *Handle:* status alone isn't outcome; read `CLOSE_RSN_C_NAME` and the `REFERRAL_HIST` tail.

## Internal vs external referred-to encounters (the headline question)

Whether the visit you were referred *to* appears inside this export depends on whether the target is in
the same Epic instance:

- **In-system target → the visit is a real `PAT_ENC`.** OT referral `13661714` went to MeriterTherapy (a
  department in this Epic). Its fulfilling visits are full `PAT_ENC` rows (`922942674`, `922943112`,
  status Completed, dept MHM OT NEURO CENTRAL, with their own HNO notes), surfaced via
  `REFERRAL_5.FIRST/LAST_PAT_ENC_CSN_ID`, `REFERRAL_APT.SERIAL_NUMBER`, and `ASSOCIATED_REFERRALS`.
- **Cross-org target → only an external pointer.** Allergy referral `23182184` went to **UW Health**
  (`REFERRAL_CROSS_ORG`: org "UW Health, Affiliates and Community Connect Partners", OID
  `1.2.840.114350.1.13.283.2.7.2.827076`). Its `REFERRAL_APT` line has a **blank `SERIAL_NUMBER`** and a
  populated `EXT_SVC_*` block (`EXT_SVC_PROV_ID 147388`, `EXT_SVC_DTTM 5/9/2025 9:30 AM`) — that visit is
  **not** a `PAT_ENC`; no internal notes/results exist for it, only this stub. The "external" provider id
  is still resolvable, though: `EXT_SVC_PROV_ID` ships with no `_NAME` companion but joins
  `CLARITY_SER.PROV_ID` → `PROV_NAME` (`147388` → "SANDERSON, HELEN P"), so the stub is not nameless.
- *Test in SQL:* `REFERRAL_APT.SERIAL_NUMBER IN (SELECT PAT_ENC_CSN_ID FROM PAT_ENC)` → internal;
  otherwise external. Gastro/Neuro referrals here have neither (referred out, never scheduled internally,
  blank `REFERRAL_5` CSNs) — referred-to care simply isn't in the chart.

## Recipes

```sql
-- 1) All referrals: who referred, to what, status, dates, source encounter.
SELECT r.REFERRAL_ID, r.ENTRY_DATE,
       r.REFERRING_PROV_ID_REFERRING_PROV_NAM AS referred_by,
       COALESCE(NULLIF(r.PROV_SPEC_C_NAME,''), r.REFD_TO_SPEC_C_NAME) AS referred_to,
       r.RFL_TYPE_C_NAME, r.RFL_STATUS_C_NAME, r.CLOSE_RSN_C_NAME,
       r.START_DATE, r.EXP_DATE, op.PAT_ENC_CSN_ID AS source_csn
FROM REFERRAL r
LEFT JOIN ORDER_PROC_2 o2 ON o2.REFERRAL_ID = r.REFERRAL_ID
LEFT JOIN ORDER_PROC op  ON op.ORDER_PROC_ID = o2.ORDER_PROC_ID
ORDER BY CAST(r.SVC_DATE_REAL AS REAL);

-- 2) Referral order <-> referral record bridge (the join that actually keys).
SELECT op.ORDER_PROC_ID, op.DESCRIPTION, op.ORDER_TYPE_C_NAME, op.PAT_ENC_CSN_ID AS placed_in_csn,
       o2.REFERRAL_ID, r.PROV_SPEC_C_NAME, r.RFL_STATUS_C_NAME
FROM ORDER_PROC op
JOIN ORDER_PROC_2 o2 ON o2.ORDER_PROC_ID = op.ORDER_PROC_ID
JOIN REFERRAL r       ON r.REFERRAL_ID   = o2.REFERRAL_ID
ORDER BY CAST(op.ORDER_PROC_ID AS REAL);

-- 3) Referral diagnoses (resolved names).
SELECT rd.REFERRAL_ID, rd.LINE, e.DX_NAME
FROM REFERRAL_DX rd LEFT JOIN CLARITY_EDG e ON e.DX_ID = rd.DX_ID
ORDER BY CAST(rd.REFERRAL_ID AS REAL), CAST(rd.LINE AS REAL);

-- 4) Lifecycle of one referral (audit trail, chronological).
SELECT LINE, CHANGE_DATE, CHANGE_TYPE_C_NAME, NEW_RFL_STATUS_C_NAME,
       CHANGE_USER_ID, substr(PREVIOUS_VALUE,1,60) AS detail
FROM REFERRAL_HIST WHERE REFERRAL_ID = :rid ORDER BY CAST(LINE AS REAL);

-- 5) Did the referred-to visit happen inside this Epic? (internal vs external)
SELECT a.REFERRAL_ID, a.SERVICE_DATE, a.SERIAL_NUMBER,
       CASE WHEN pe.PAT_ENC_CSN_ID IS NOT NULL THEN 'internal PAT_ENC'
            WHEN a.EXT_SVC_DTTM IS NOT NULL      THEN 'external (no PAT_ENC)'
            ELSE 'unscheduled' END AS visit_location,
       d.DEPARTMENT_NAME, a.EXT_SVC_DTTM
FROM REFERRAL_APT a
LEFT JOIN PAT_ENC pe   ON pe.PAT_ENC_CSN_ID = a.SERIAL_NUMBER
LEFT JOIN CLARITY_DEP d ON d.DEPARTMENT_ID  = pe.DEPARTMENT_ID
ORDER BY CAST(a.REFERRAL_ID AS REAL);

-- 6) Referral note text pointers (join to RTF on disk / HNO_INFO).
SELECT rn.REFERRAL_ID, rn.NOTE_ID, rn.NOTE_DATETIME, rn.NOTE_USER_ID_NAME,
       'Rich Text/HNO_'||rn.NOTE_ID||'_*.RTF' AS rtf_glob
FROM REFERRAL_NOTES rn ORDER BY CAST(rn.REFERRAL_ID AS REAL), CAST(rn.LINE AS REAL);
```

## Open questions / specimen notes

- **REF vs SER id coincidence is specimen-specific.** Here `REFERRAL_SOURCE.REFERRING_PROV_ID` equals the
  `CLARITY_SER.PROV_ID` (e.g. `144590`), so the referring id resolves through either master. The schema
  treats REF (referral-source) and SER as distinct files; in a larger org they may diverge — verify before
  joining referring ids straight to `CLARITY_SER`.
- **`REFERRAL_PROV_ID` (named referred-to provider) is unobserved** — null for all 10 because every
  referral targeted a specialty/dept. Its population pattern (when a specific provider is chosen) can't be
  confirmed from this specimen.
- **`ORDERS_ONLY_CSN` is empty** in this export though its schema doc defines a `REFERRAL_ID` order link.
  Genre tables to expect but not present here: it, and a richer `REFERRAL_CVG_AUTH` population.
- **Cross-org / "leaked" referrals** appear via `REFERRAL_CROSS_ORG` — 2 rows for **two distinct
  referrals** (Allergy `23182184` *and* Neuro `15963353`, not just the Allergy one), both pointing to UW
  Health. The
  `REFERRAL_4.IS_LEAKED_YN` / `RFL_DIRECTION_C_NAME` fields that would characterize in/outbound direction
  exist but are sparsely populated here — a specimen with inbound referrals would exercise them.
- Specimen shape: 10 referrals Jan 2020–Nov 2024 — Gastroenterology, Neurology (×3), OT, PT, Allergy, plus
  3 imaging (MRI/CT) authorizations; one open (Allergy, exp 5/31/2026), rest Closed. Only the OT referral
  was fulfilled by in-system visits; the Allergy referral points to an external UW Health appointment.
</content>
</invoke>
