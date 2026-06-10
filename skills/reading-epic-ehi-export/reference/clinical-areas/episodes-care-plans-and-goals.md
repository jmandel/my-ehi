# Episodes, care plans & goals — Epic EHI field guide

**Scope.** The longitudinal layer *above* the encounter: episodes of care (named, dated threads that group
visits — §16), outpatient care-plan records and their enrollment/task/contact satellites, discrete patient
goals (the IGO master) with their update trail and compliance cache, plus the long tail that rides along —
registry/reporting crumbs (RDI), the radiation-therapy episode companion, community-resource review, and the
external-data reconciliation timestamps. In a light ambulatory record (like this specimen) this whole domain is **thin**: a
handful of real rows surrounded by always-emitted placeholder companions (§46) — knowing which is which is
most of the value here.

**Where it sits.** Four small masters, none of them encounter-rooted:
- **Episodes are HSB ("Summary Block") records** — `EPISODE` and friends; `EPISODE_OT` and several
  satellites key by `SUMMARY_BLOCK_ID` (= `EPISODE_ID`). Episode *types* are EPISODE_DEF records.
- **Care plans are Care Integrator records** (`CARE_INTG_ID`), per-encounter/episode plan objects.
- **Goals are IGO ("Discrete Goals") records** (`GOAL_ID`), reached from the patient via `PATIENT_GOALS`
  exactly the way `PAT_ALLERGIES` reaches LPL (§3).
- **Registry data are RDI records** (`REGISTRY_DATA_ID`), one per report sent to an external registry.

## Tables

| table | rows in one specimen | what it carries |
|---|---|---|
| `EPISODE` | 1 | **Episode spine.** Name, type id, start/end, status, last-editing user — then ~40 specialty columns (pregnancy smoking/drinking, delivery plans, `MCS_*` dates) that are NULL for any non-matching specialty (§16) |
| `EPISODE_2` | 1 | Supplement (§8): program-enrollment axes — `CMGMT_*` (care management), `RXENROLL_*` (rx program), hospice-discussion, pregnancy-planning columns. All NULL here |
| `EPISODE_ALL` | 1 | §13 generic superset: id, name, status, dates for *every* episode type (+ `CARE_INTG_ID` when a care plan owns it) |
| `EPISODE_OT` | 1 | The HSB record's own over-time **contact** row: `(SUMMARY_BLOCK_ID, CONTACT_DATE_REAL, CONTACT_SERIAL_NUM)` — see gotcha 4 |
| `PAT_EPISODE` | 1 | **EPT→HSB bridge** `(PAT_ID, LINE, EPISODE_ID)` — the patient link, because `EPISODE` ships no `PAT_ID` at all |
| `V_EHI_HSB_LINKED_PATS` | 1 | Export view (§47) duplicating the episode→patient link (`EPISODE_ID, PAT_ID`) |
| `ALL_EPISODE_CSN_LINKS` | 2 | The §16 episode↔record link bridge `(EPISODE_ID, LINE)` — but the EHI cut ships **only** the transplant columns (`TREATMENT_PLAN_ID/_CSN_ID`), NULL here. See the headline gotcha |
| `EPISODE_DEF` | 1 | Episode-type master: `EPISODE_DEF_ID` → `EPISODE_DEF_NAME`, `EPISODE_TYPE_C_NAME` (e.g. "Outpatient Rehab") |
| `RAD_THERAPY_EPISODE_INFO` | 1 (all NULL) | §46 companion: radiation-therapy goal/technique/planned start for an **oncology** episode. Emitted for any episode; populated only if it *is* a rad-onc episode |
| `REHAB_REVIEW_CHOICE`, `OCCURRENCE_CODES`, `CATARACT_PLANNING_INFO`, `CATARACT_PLANNING_GOALS`, `PEF_NTFY_INSTR` | 1 each (all NULL) | More §46 episode satellites keyed `SUMMARY_BLOCK_ID`/`EPISODE_ID`: rehab utilization review, therapy plan/treatment occurrence dates, cataract surgical planning & refraction goals, patient-entered-flowsheet (home-monitoring) notification instructions |
| `CAREPLAN_INFO` | 4 | **Care-plan spine** (`CARE_INTG_ID`): type, the documenting encounter `PAT_ENC_CSN_ID`, `PATIENT_ID`, patient-vs-episode level flag, pointer to the paired "Reading" record |
| `CARE_INTEGRATOR` | 4 | The care-plan record's contact-date row (`CARE_INTG_ID, CONTACT_DATE_REAL`); display name NULL here |
| `CAREPLAN_CNCT_INFO` | 2 | Per-contact detail (`CAREPLAN_ID, CONTACT_DATE_REAL, CTCT_SERIAL_NUM`) — only the non-Reading plans have rows here |
| `CAREPLAN_ENROLLMENT_INFO` | 4 (all NULL) | §46: how/who enrolled (workflow, enrolling user, MyChart signup, triggering pregnancy episode, surgical CSN) — populated for program-style care plans, not these |
| `CAREPLAN_PT_TASK_INFO` | 4 (all NULL) | §46: patient-assigned task counters (`TOTAL_PT_INST_CNT`, `COMP_PT_INST_CNT`) for Care Companion-style plans |
| `GOAL` | 1 | **Goal spine** (IGO): goal-template pointer (+ denormalized name §6), linked problem, deleted flag, evaluation-note pointer, HH episode link — mostly NULL apart from the template |
| `PATIENT_GOALS` | 1 | EPT→IGO bridge `(PAT_ID, LINE, GOAL_ID)` |
| `PT_GOALS_INFO` | 1 | IGO **no-add** (single-valued) items: creating user, create instant, usage/type/status categories, and the live compliance cache (`MOST_RECENT_VALUE`, `REC_VAL_COMPLIAN_YN`, check instants) — see gotcha 7 |
| `PT_GOALS_UPDATES` | 1 | IGO **over-time** items: one row per edit contact — status, display name, editing user, the encounter CSN (`PAT_CSN`), patient-stated and long-range flags |
| `GOAL_CONTACT` | 1 | IGO **contact-specific** items: priority, start/end, outcome, care-plan contact link, `UPDATED_GOAL_ID` resolution chain |
| `GOAL_TEMPLATES` | 1 | Goal-template master: `GOAL_TEMPLATE_ID` → `GOAL_TEMPLATE_NAME` |
| `RDI_PAT_CSN` | 1 | Registry-data → encounter link `(REGISTRY_DATA_ID, LINE, PAT_CSN)` |
| `NSQIP_OPIOIDS_DISCHARGE` | 1 | RDI sibling; carries `REGISTRY_TYPE_C_NAME` — the **only** populated identity column for the registry record (gotcha 8) — plus NSQIP opioid columns (NULL here) |
| `RYAN_WHITE_SERVICE_DATA` | 1 (all NULL) | RDI sibling: Ryan White HIV/AIDS program service date/qty/price/category. §46 placeholder unless the registry is a Ryan White report |
| `COMMUNITY_RESRC_REVIEWED` | 1 (all NULL) | Per-patient "community resources last reviewed" stamp (instant, user, CSN). Emitted even when never reviewed (§46) |
| `EXT_DATA_LAST_DONE` | 1 | Per-patient, one wide row: last time each **external-data type** (allergies, meds, problems, immunizations) was marked Done in Reconcile Outside Information — UTC instant + user per domain, plus a last-*queried* instant for immunizations |

Encounter-side columns that belong to this domain: `PAT_ENC.IP_EPISODE_ID` and `PAT_ENC_2.OTHER_BLOCK_ID`
(per-encounter HSB pointers — gotcha 2), `HSP_ACCOUNT_4.EPISODE_ID`/`COCM_EPISODE_ID` (bundled-episode /
care-management billing links; NULL here), `GOAL.HH_EPISODE_ID` (home-health episode for a care-plan goal),
`TIMEOUT.PXPASS_EPISODE_ID`, `ORDER_DISP_INFO_3.FILL_EPISODE_ID` (all NULL here).

## How they join

All verified against this specimen.

- **Patient → episode:** `PAT_EPISODE.PAT_ID = PATIENT.PAT_ID`, `PAT_EPISODE.EPISODE_ID =
  EPISODE.EPISODE_ID` (or `V_EHI_HSB_LINKED_PATS`, same content). `EPISODE` itself has **no PAT_ID column**
  in the shipped table — its schema even documents none — so the bridge is mandatory (§3).
- **Episode → type:** `EPISODE.SUM_BLK_TYPE_ID = EPISODE_DEF.EPISODE_DEF_ID`. The schema documents a
  denormalized `SUM_BLK_TYPE_ID_EPISODE_DEF_NAME` companion, but the shipped table has the bare id instead
  (§6/§7) — resolve via `EPISODE_DEF`.
- **Episode → its satellites:** `SUMMARY_BLOCK_ID = EPISODE.EPISODE_ID` for `EPISODE_OT`,
  `RAD_THERAPY_EPISODE_INFO`, `REHAB_REVIEW_CHOICE`, `OCCURRENCE_CODES`, `CATARACT_PLANNING_*`;
  `PEF_NTFY_INSTR.EPISODE_ID` likewise. All 1:1 companion rows here.
- **Episode → encounters:** **no exported value-level bridge** — see the headline gotcha below.
- **Care plan internal joins:** `CAREPLAN_INFO.CARE_INTG_ID` = `CARE_INTEGRATOR.CARE_INTG_ID` =
  `CAREPLAN_ENROLLMENT_INFO.CAREPLAN_ID` = `CAREPLAN_PT_TASK_INFO.CAREPLAN_ID` =
  `CAREPLAN_CNCT_INFO.CAREPLAN_ID` (one id space, two column names). The plan's documenting visit:
  `CAREPLAN_INFO.PAT_ENC_CSN_ID = PAT_ENC.PAT_ENC_CSN_ID` (§2) — resolves for all 4 rows here; in this
  specimen those CSNs are the two therapy visits that also fulfilled the OT referral (see `referrals.md`).
- **Care plan → its Reading twin:** `CAREPLAN_INFO.READING_CAREPLAN_ID = CAREPLAN_INFO.CARE_INTG_ID` (a
  self-join; gotcha 5).
- **Patient → goal:** `PATIENT_GOALS.PAT_ID = PATIENT.PAT_ID`, `PATIENT_GOALS.GOAL_ID = GOAL.GOAL_ID`.
  (`PT_GOALS_INFO` also carries `PAT_ID` directly.)
- **Goal internal joins:** `PT_GOALS_INFO.GOAL_ID = GOAL.GOAL_ID` (1:1);
  `PT_GOALS_UPDATES`/`GOAL_CONTACT` join on `(GOAL_ID, CONTACT_DATE_REAL)` — one row per IGO contact each.
- **Goal → template:** `GOAL.GOAL_TEMPLATE_ID = GOAL_TEMPLATES.GOAL_TEMPLATE_ID`; the name is also
  denormalized as `GOAL_TEMPLATE_ID_GOAL_TEMPLATE_NAME` on both `GOAL` and `PT_GOALS_INFO` (§6).
- **Goal → encounter:** `PT_GOALS_UPDATES.PAT_CSN = PAT_ENC.PAT_ENC_CSN_ID` (§4: the CSN hides as
  `PAT_CSN`) — the visit on which that edit was documented. Verified.
- **Registry record → encounter:** `RDI_PAT_CSN.PAT_CSN = PAT_ENC.PAT_ENC_CSN_ID`. Verified. Its siblings
  join on `REGISTRY_DATA_ID` (`NSQIP_OPIOIDS_DISCHARGE`, `RYAN_WHITE_SERVICE_DATA`).
- **Reconciliation stamps / community-resource review → patient:** `EXT_DATA_LAST_DONE.PAT_ID`,
  `COMMUNITY_RESRC_REVIEWED.PAT_ID` → `PATIENT.PAT_ID`. One row per patient each.

## The episode↔encounter link (the headline gotcha)

§16 says an episode groups encounters via a bridge — and `ALL_EPISODE_CSN_LINKS` *is* that bridge: one
`(EPISODE_ID, LINE)` row per record linked to the episode, where per the schema doc the `LINE` "identifies
the link master file." But the EHI cut of the table ships only **one** link INI's columns — the transplant
pair `TREATMENT_PLAN_ID`/`TREATMENT_PLAN_CSN_ID` — so for an episode whose links are ordinary encounters,
the rows exist (2 here, matching the episode's two therapy visits) **with every payload column NULL** (§39
warning in reverse: the rows are real, the linked ids just aren't materialized). The membership itself is
not value-recoverable from this table in such an export.

The encounter side doesn't rescue you either: `PAT_ENC.IP_EPISODE_ID` and `PAT_ENC_2.OTHER_BLOCK_ID` are
HSB pointers, but they point at **per-encounter summary blocks** (ED/IP/OpTime/"Other" blocks minted per
visit), *not* at the episode-of-care record. In one specimen 73 of 169 encounters carry an
`OTHER_BLOCK_ID`, every one of them dangling — none of those HSB ids appears in `EPISODE`/`EPISODE_ALL`
(§15 pointer-survives-body-omitted). The two therapy visits even carry `IP_EPISODE_ID` (despite the
"inpatient" name — §24) equal to their `OTHER_BLOCK_ID`: a per-visit therapy block, again not the episode.

**Reconstructing membership** therefore takes triangulation, in preference order: (1) domain bridges that
carry both an episode-ish object and a CSN — here `CAREPLAN_INFO.PAT_ENC_CSN_ID` ties the plan-of-care
contacts to exactly the episode's two visits; (2) the date window: `PAT_ENC` rows between the episode's
`START_DATE`/`END_DATE` at the relevant department (recipe 2 — expect sibling/linked contacts to ride
along, §2); (3) referral fulfillment CSNs (`REFERRAL_5`, `REFERRAL_APT`) when the episode began as a
referral.

## Gotchas & quirks (chased to *why*)

1. **The episode master is a many-specialty union; expect a NULL sea (§16).** ~40 of `EPISODE`'s 51
   columns are pregnancy (smoking/drinking by trimester, delivery planning) or `MCS_*` program dates, NULL
   for any episode of another type; `EPISODE_2` adds care-management/rx-enrollment/hospice axes, also NULL
   here. *Why:* one Chronicles HSB master serves OB, transplant, oncology, rehab, care-management programs;
   the export ships every documented item regardless of type. *Handle:* read `NAME`, type (via
   `EPISODE_DEF`), `STATUS_C_NAME`, `START_DATE`/`END_DATE` first; treat the rest as type-conditional.
2. **`PAT_ENC.IP_EPISODE_ID` / `PAT_ENC_2.OTHER_BLOCK_ID` are NOT the episode.** See headline section:
   per-visit HSB blocks, dangling in the export, and the `IP_` prefix lies for therapy visits (§24, §15).
   *Handle:* never join these to `EPISODE` expecting membership; use them only as "this visit had an
   attached summary block" markers.
3. **The schema's `SUM_BLK_TYPE_ID_EPISODE_DEF_NAME` doesn't exist on disk.** The shipped column is bare
   `SUM_BLK_TYPE_ID` (§7 — confirm real columns; §6 — a dropped name companion). *Handle:* join
   `EPISODE_DEF`; here it ships precisely the referenced definition row(s).
4. **`EPISODE_OT.CONTACT_SERIAL_NUM` and `CAREPLAN_CNCT_INFO.CTCT_SERIAL_NUM` are not `PAT_ENC` CSNs.**
   Both columns' docs describe the universal CSN, but the values are the **HSB/Care-Integrator record's own
   contact serials** — zero of them resolve in `PAT_ENC` here (§41: same "CSN" concept, different record's
   contacts). *Why:* every Chronicles master files its contacts with serial numbers, not just EPT.
   *Handle:* treat them as internal version keys; the patient-encounter CSN in this domain is
   `CAREPLAN_INFO.PAT_ENC_CSN_ID` / `PT_GOALS_UPDATES.PAT_CSN` / `RDI_PAT_CSN.PAT_CSN`.
5. **Care plans come in pairs — don't double-count.** Each working plan (`CAREPLAN_TYPE_C_NAME =
   'Collaborative'` here) points via `READING_CAREPLAN_ID` to a second `CAREPLAN_INFO` row of type "Care
   Plan Reading" on the same CSN; here only the working plans get `CAREPLAN_CNCT_INFO` contact rows. *Why:* Epic
   splits the editable plan from a paired snapshot/readings record. *Handle:* count plans with
   `READING_CAREPLAN_ID IS NOT NULL` (or exclude the Reading type); use the twin only as the readings
   container. Also note `LINKED_PAT_CAREPLAN_YN` is **Y = patient-level, N = episode-level** — an
   episode-scoped plan whose episode pointer is *not* among the exported columns (read the doc, §24).
6. **One IGO record is fanned across three tables by Chronicles item class.** `PT_GOALS_INFO` = "no-add"
   (single-valued) items, `PT_GOALS_UPDATES` = over-time items (one row per edit contact, like a §35
   version history), `GOAL_CONTACT` = contact-specific items — all the same `GOAL_ID`. The schema
   descriptions say so verbatim ("no-add data", "over-time data"). *Handle:* the *trail* is
   `PT_GOALS_UPDATES` ordered by `CAST(CONTACT_DATE_REAL AS REAL)` (§18); current state is the last row
   plus `PT_GOALS_INFO.GOAL_STATUS_C_NAME`; a resolved-and-replaced goal chains forward via
   `GOAL_CONTACT.UPDATED_GOAL_ID`.
7. **`PT_GOALS_INFO` carries a *live* compliance cache, not history (§40).** `MOST_RECENT_VALUE` (free
   text — here a blood-pressure reading; treat as PHI), `RECENT_VALUE_I_DTTM`, `REC_VAL_COMPLIAN_YN`, and
   `REC_VALUE_CHEC_DTTM` are refreshed by a batch check long after the goal was written — in one specimen
   the cached value postdates goal creation by years and the check instant postdates the value by months.
   *Why:* ambulatory goals (type e.g. "Blood Pressure") are evaluated against incoming flowsheet/home
   readings; the IGO record caches the latest verdict. *Handle:* for the actual readings go to the
   flowsheet tables (`vitals-and-flowsheets.md`); read this cache only as "compliance as of
   `REC_VALUE_CHEC_DTTM`."
8. **The registry record's identity hides on the wrong sibling.** The RDI cluster (`RDI_PAT_CSN`,
   `RYAN_WHITE_SERVICE_DATA`, `NSQIP_OPIOIDS_DISCHARGE`) shares `REGISTRY_DATA_ID`; in this specimen the
   only populated identity column — `REGISTRY_TYPE_C_NAME`, naming a state health-department registry —
   sits on `NSQIP_OPIOIDS_DISCHARGE` even though the report has nothing to do with NSQIP, and
   `RDI_PAT_CSN`'s own table doc claims it's about "the ACC Registry." *Why:* RDI is one generic
   registry-reporting master; each registry program got its own EHI table carrying its columns *plus*
   whichever shared items landed there, emitted for every RDI record (§46, table-level §24). *Handle:*
   sweep all `REGISTRY_DATA_ID` tables for the record id; expect most to be placeholder rows.
9. **`EXT_DATA_LAST_DONE` is a one-row, column-per-domain matrix — and only the latest event survives.**
   Four `(instant, user)` pairs — `EXTALG_*` allergies, `EXTMED_*` meds, `EXTPRB_*` problems, `EXTIMM_*`
   immunizations — record when outside (Care Everywhere) data was last marked **Done** in Reconcile Outside
   Information, plus `EXTIMM_Q_UTC_DTTM` for the last immunization *query*. All UTC instants (§19); §35
   current-state collapse — no reconciliation history ships here. *Handle:* read it as "the chart's
   outside-data was last attested on these instants," not as an activity log.
10. **Placeholder satellites prove nothing about care received (§46).** A `RAD_THERAPY_EPISODE_INFO` or
    `CATARACT_PLANNING_GOALS` row does **not** mean radiation or eye surgery — the export emits a companion
    row per satellite table regardless of episode type, populated only when applicable; likewise `RYAN_WHITE_SERVICE_DATA` for any RDI
    record and `COMMUNITY_RESRC_REVIEWED`/`CAREPLAN_ENROLLMENT_INFO`/`CAREPLAN_PT_TASK_INFO` rows of pure
    NULL. *Handle:* always check a payload column is non-NULL before claiming the specialty event happened
    (recipe 6).

## Recipes

```sql
-- 1) Episode inventory: name, resolved type, status, window, owning patient.
SELECT e.EPISODE_ID, e.NAME, d.EPISODE_DEF_NAME, d.EPISODE_TYPE_C_NAME,
       e.STATUS_C_NAME, e.START_DATE, e.END_DATE, pe.PAT_ID
FROM EPISODE e
LEFT JOIN EPISODE_DEF d  ON d.EPISODE_DEF_ID = e.SUM_BLK_TYPE_ID
LEFT JOIN PAT_EPISODE pe ON pe.EPISODE_ID = e.EPISODE_ID
ORDER BY CAST(e.EPISODE_ID AS INTEGER);

-- 2) Candidate member encounters of an episode (no value bridge ships — date-window heuristic;
--    EPISODE_OT.CONTACT_DATE_REAL is the start; bound the window generously and expect
--    sibling/linked contacts of the real visits to ride along, §2).
SELECT e.EPISODE_ID, e.NAME, p.PAT_ENC_CSN_ID, p.CONTACT_DATE
FROM EPISODE e
JOIN PAT_ENC p ON CAST(p.PAT_ENC_DATE_REAL AS REAL)
     BETWEEN (SELECT CAST(o.CONTACT_DATE_REAL AS REAL) FROM EPISODE_OT o WHERE o.SUMMARY_BLOCK_ID = e.EPISODE_ID)
     AND     (SELECT CAST(o.CONTACT_DATE_REAL AS REAL) FROM EPISODE_OT o WHERE o.SUMMARY_BLOCK_ID = e.EPISODE_ID) + 60
WHERE p.IP_EPISODE_ID IS NOT NULL
   OR EXISTS (SELECT 1 FROM PAT_ENC_2 x
              WHERE x.PAT_ENC_CSN_ID = p.PAT_ENC_CSN_ID AND x.OTHER_BLOCK_ID IS NOT NULL);

-- 3) Care plans with their Reading twin and the documenting visit.
SELECT cp.CARE_INTG_ID, cp.CAREPLAN_TYPE_C_NAME, cp.PAT_ENC_CSN_ID,
       cp.LINKED_PAT_CAREPLAN_YN,            -- Y=patient-level, N=episode-level
       cp.READING_CAREPLAN_ID, rd.CAREPLAN_TYPE_C_NAME AS reading_type,
       cn.CONTACT_DATE
FROM CAREPLAN_INFO cp
LEFT JOIN CAREPLAN_INFO rd      ON rd.CARE_INTG_ID = cp.READING_CAREPLAN_ID
LEFT JOIN CAREPLAN_CNCT_INFO cn ON cn.CAREPLAN_ID  = cp.CARE_INTG_ID
WHERE cp.READING_CAREPLAN_ID IS NOT NULL      -- working plans only; drop to see the Reading twins too
ORDER BY CAST(cp.CARE_INTG_ID AS INTEGER);

-- 4) Goal dossier: template, type, usage, status, compliance cache.
SELECT g.GOAL_ID, gt.GOAL_TEMPLATE_NAME, i.AMB_GOAL_TYPE_C_NAME, i.GOAL_USAGE_C_NAME,
       i.GOAL_STATUS_C_NAME, i.CREATE_INST_DTTM,
       i.REC_VAL_COMPLIAN_YN, i.REC_VALUE_CHEC_DTTM   -- cache verdict + as-of instant (§40)
FROM PATIENT_GOALS pg
JOIN GOAL g               ON g.GOAL_ID = pg.GOAL_ID
LEFT JOIN GOAL_TEMPLATES gt ON gt.GOAL_TEMPLATE_ID = g.GOAL_TEMPLATE_ID
LEFT JOIN PT_GOALS_INFO i   ON i.GOAL_ID = g.GOAL_ID
ORDER BY CAST(pg.LINE AS INTEGER);

-- 5) Goal update trail (one row per edit contact), with outcome/resolution chain.
SELECT u.GOAL_ID, u.CONTACT_DATE, u.INSTNT_OF_EDIT_DTTM, u.STATUS_C_NAME,
       u.DISPLAY_NAME_OT, u.PT_STATED_YN, u.PAT_CSN,
       gc.GOAL_OUTCOME_C_NAME, gc.UPDATED_GOAL_ID      -- forward link if resolved-and-replaced
FROM PT_GOALS_UPDATES u
LEFT JOIN GOAL_CONTACT gc ON gc.GOAL_ID = u.GOAL_ID
                         AND gc.CONTACT_DATE_REAL = u.CONTACT_DATE_REAL
ORDER BY CAST(u.CONTACT_DATE_REAL AS REAL);

-- 6) Placeholder-or-real sweep: are the §46 satellites carrying anything?
SELECT 'RAD_THERAPY_EPISODE_INFO' AS satellite, COUNT(*) AS n, COUNT(RAD_THERAPY_TREATMENT_GOAL_C_NAME) AS populated FROM RAD_THERAPY_EPISODE_INFO
UNION ALL SELECT 'REHAB_REVIEW_CHOICE',     COUNT(*), COUNT(REHAB_UTN_STATUS_C_NAME) FROM REHAB_REVIEW_CHOICE
UNION ALL SELECT 'OCCURRENCE_CODES',        COUNT(*), COUNT(OT_CAREPLAN_DATE)        FROM OCCURRENCE_CODES
UNION ALL SELECT 'CATARACT_PLANNING_INFO',  COUNT(*), COUNT(OPH_SURG_STATUS_C_NAME)  FROM CATARACT_PLANNING_INFO
UNION ALL SELECT 'CATARACT_PLANNING_GOALS', COUNT(*), COUNT(OPH_CAT_POST_VA)         FROM CATARACT_PLANNING_GOALS
UNION ALL SELECT 'PEF_NTFY_INSTR',          COUNT(*), COUNT(PEF_PAT_SPEC_INSTR)      FROM PEF_NTFY_INSTR
UNION ALL SELECT 'RYAN_WHITE_SERVICE_DATA', COUNT(*), COUNT(RW_SRV_CATEGORY_C_NAME)  FROM RYAN_WHITE_SERVICE_DATA
UNION ALL SELECT 'COMMUNITY_RESRC_REVIEWED',COUNT(*), COUNT(CBO_REVIEW_UTC_DTTM)     FROM COMMUNITY_RESRC_REVIEWED;

-- 7) Registry crumb assembled: which registry, tied to which visit.
SELECT n.REGISTRY_DATA_ID, n.REGISTRY_TYPE_C_NAME, r.PAT_CSN, pe.CONTACT_DATE
FROM NSQIP_OPIOIDS_DISCHARGE n
LEFT JOIN RDI_PAT_CSN r ON r.REGISTRY_DATA_ID = n.REGISTRY_DATA_ID
LEFT JOIN PAT_ENC pe    ON pe.PAT_ENC_CSN_ID  = r.PAT_CSN;

-- 8) When was outside data last reconciled, per domain (unpivot the one-row matrix).
SELECT 'allergies' AS domain, EXTALG_D_UTC_DTTM AS done_utc, EXTALG_D_USER_ID AS by_user FROM EXT_DATA_LAST_DONE
UNION ALL SELECT 'medications',   EXTMED_D_UTC_DTTM, EXTMED_D_USER_ID FROM EXT_DATA_LAST_DONE
UNION ALL SELECT 'problems',      EXTPRB_D_UTC_DTTM, EXTPRB_D_USER_ID FROM EXT_DATA_LAST_DONE
UNION ALL SELECT 'immunizations', EXTIMM_D_UTC_DTTM, EXTIMM_D_USER_ID FROM EXT_DATA_LAST_DONE;
```

## Unstructured tie-back

Almost none in this specimen, but the hooks exist and are worth checking in any export:
- `GOAL.EVALUATION_NOTE_ID` and `CAREPLAN_INFO.RFL_INSTR_NOTE_ID` are HNO note pointers (→ `HNO_INFO`,
  `Rich Text/HNO_<id>_*.RTF` per §14) — both NULL here.
- `EPISODE.COMMENTS`, `PEF_NTFY_INSTR.PEF_PAT_SPEC_INSTR` (patient-specific home-monitoring instructions),
  and `PT_GOALS_INFO.MOST_RECENT_VALUE` are inline free-text columns; only the last is populated here (a
  clinical reading — PHI, don't transcribe).
- Otherwise the tie to the narrative chart is the **CSN**: the care-plan, goal-update, and registry rows
  each carry an encounter CSN whose notes you reach normally (`clinical-notes-and-documents.md`).

## Open questions / specimen notes

- **Specimen shape:** one episode (an outpatient-rehab THERAPY episode, status Resolved — the §16 anchor
  example), 2 working + 2 Reading care plans on its two therapy visits, one active blood-pressure goal with
  a single update contact, one state-registry RDI record, and one row each in the per-patient stamp tables.
  Everything else in the domain is placeholder NULLs.
- **`ALL_EPISODE_CSN_LINKS` line semantics are unconfirmed.** Two LINEs for an episode with two linked
  visits is suggestive of one-row-per-linked-encounter, but with every payload column NULL the
  correspondence (and what other link INIs would look like) can't be verified from this specimen.
- **Whether a *transplant* episode would populate `TREATMENT_PLAN_ID/_CSN_ID`** — and whether other
  episode types get additional link columns in richer exports — is untested here.
- **Care-plan "Reading" mechanics are mostly opaque:** `CAREPLAN_CNCT_INFO.READING_TYPE_C_NAME` /
  `READING_PAT_ENC_CSN_ID` and `GOAL_CONTACT.READING_UTC_DTTM` are all NULL, so how readings flow between
  the twin records (Care Companion device data, flowsheet pulls?) is not observable.
- **`EPISODE_2`'s care-management lifecycle** (`CMGMT_STATUS_C_NAME`, enrollment/decline reasons) and the
  goal lifecycle beyond "Active" (outcomes, `UPDATED_GOAL_ID` chains, MyChart-created goals via
  `MYC_CREATE_USER_ID`) are unobserved — single-row, single-state specimen.
- **Excluded from this domain after investigation:** `DEPT_PAT_CARE_SELECTION` ("Department of Patient
  Care" routing per *order* — belongs with medications/orders, not care plans);
  `HSP_ACCOUNT_4.EPISODE_ID`/`COCM_EPISODE_ID` (bundled-episode billing links, covered from the billing
  side); `CATARACT_PLANNING_GOALS` despite the name is an episode satellite (kept here), not an IGO table.
