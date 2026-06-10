# Health maintenance & screening — Epic EHI field guide

**Scope.** Epic's Health Maintenance (HM) engine: the preventive-care reminder system that tracks
*topics* (Influenza vaccine, Cholesterol screening, Annual Wellness Visit…), forecasts when each is next
due, records due/overdue status over time, and logs how each was satisfied (a shot, a lab result, a
visit code). This is the "are you up to date on your screenings/vaccines?" layer that sits *on top of* the
actual immunization and lab data.

**Where it sits.** Almost every HM table is keyed by `PAT_ID` (the EPT patient, §1) — HM is a per-patient
rollup, not a per-encounter fact. (The exception is `PAT_HM_LETTER`, which is CSN-keyed, not `PAT_ID`-keyed;
the two masterfiles carry no patient key at all.) It connects *out* to encounters only weakly: the reminder-letter tables
carry a `PAT_ENC_CSN_ID` (§2), and completions correlate to `IMMUNE`/`ORDER_RESULTS` rows **by date, not
by foreign key**. Think of HM as a derived dashboard computed from immunizations, labs, and visits.

## Tables

| table | role | rows in specimen | notes |
|---|---|---|---|
| `HM_HISTORICAL_STATUS` | **spine** — status-change log per topic over time | 84 | One row per (topic, status-transition). `LINE` is a global running sequence = chronology. No explicit snapshot-date column. |
| `PATIENT_HMT_STATUS` | **current** per-topic state | 23 | One row per active topic = the "now" view. Carries the concrete active plan, last-update date, postpone/series fields. |
| `HM_HISTORY` | completion ledger (how topics were satisfied) | 53 | Type (`Immunization`/`Result Component`/`LOS Code`/`E/M Code`) + completion instant. **No topic id** — only `(PAT_ID, LINE)`. |
| `HM_FORECAST_INFO` | next-completion forecast per topic | 7 | Topic id + `EARLIEST_VALID_DATE` (when the next dose/screen first becomes valid). |
| `PAT_HM_CUR_GUIDE` | HM **plans** in force at last update | 24 | One row per enrolled plan (concrete protocol). |
| `HM_PLAN_INFO` | **masterfile** — HM plan/protocol id → name | 24 | Concrete plans, e.g. "Hepatitis B 0-60y", "COVID-19: Age 6mo-64y". Display column is `HM_PLAN_NAME`. |
| `CLARITY_HM_TOPIC` | **masterfile** — HM topic id → name | 24 | Abstract topics, e.g. "COVID-19 Vaccine", "Lab-Diabetes Screening". Display column is `NAME`. **Different id space from plans** (see gotchas). |
| `PAT_HM_LETTER` | reminder-letter events (topic + due) | 1 | CSN-keyed; ties a letter to a topic and encounter. |
| `HM_ENC_DATE` | the encounter a letter was sent for | 1 | `PAT_ID` + `HM_LET_PAT_ENC_CSN_ID` (→ `PAT_ENC`). |

No `ZC_HM*` tables ship; all HM categories arrive pre-resolved as `_C_NAME` labels (§13 genre
variation). There is no separate "HM order" table here — HM ties to ordering only via the satisfying
immunization/lab data, not a dedicated link table.

## How they join

All joins below were run against the specimen and confirmed.

- **Patient anchor.** The six patient-level HM tables carry `PAT_ID` (single value `Z#######` here);
  `PAT_HM_LETTER` is keyed by `PAT_ENC_CSN_ID` instead, and the two masterfiles have no patient key. HM is
  per-patient; there is no CSN on the spine tables (§1). Verified: `count(DISTINCT PAT_ID)=1` on all six
  patient-level tables.
- **Current state → plan masterfile.** `PATIENT_HMT_STATUS.ACTIVE_HM_PLAN_ID` →
  `HM_PLAN_INFO.HM_PLAN_ID`. Verified: 23/23 rows match, and the inline companion
  `ACTIVE_HM_PLAN_ID_HM_PLAN_NAME` (§4) equals `HM_PLAN_INFO.HM_PLAN_NAME` on every row. The column
  `ACTIVE_SUBTOPIC_ID` (which the schema doc treats as the topic pointer) is **entirely NULL** here — the
  active plan lives in `ACTIVE_HM_PLAN_ID`, not the subtopic column.
- **Enrolled plans → plan masterfile.** `PAT_HM_CUR_GUIDE.HM_CURRENT_GUIDE_ID` →
  `HM_PLAN_INFO.HM_PLAN_ID`. Verified all 24 resolve; 23 of these 24 plan ids also appear as an
  `ACTIVE_HM_PLAN_ID` in `PATIENT_HMT_STATUS` (the 24th, "COVID-19: Recipient of 1+ Dose", is an eligible
  alternate plan not the currently-active one).
- **Historical status → topic masterfile.** `HM_HISTORICAL_STATUS.HM_TOPIC_ID` →
  `CLARITY_HM_TOPIC.HM_TOPIC_ID`. Verified; the inline `HM_TOPIC_ID_NAME` (§4) matches the masterfile.
- **Forecast → topic masterfile.** `HM_FORECAST_INFO.HM_FORECAST_TOPIC_ID` →
  `CLARITY_HM_TOPIC.HM_TOPIC_ID`. Verified 7/7 (e.g. 80→Influenza, 66→COVID-19, 94→RSV Adult).
- **Letter → topic + encounter.** `PAT_HM_LETTER.HM_LET_TOPIC_LST_ID` → `CLARITY_HM_TOPIC.HM_TOPIC_ID`
  (verified, 50→Annual Wellness Visit); `HM_ENC_DATE.HM_LET_PAT_ENC_CSN_ID` →
  `PAT_ENC.PAT_ENC_CSN_ID` (verified, CSN `1018439080`, 8/3/2023). The two letter tables share the same
  `LINE`/event.
- **Completion → real clinical data (no FK — date only).** `HM_HISTORY` rows of type `Immunization`
  carry a UTC instant that, converted to local, matches an `IMMUNE.IMMUNE_DATE` exactly; `Result
  Component` instants match `ORDER_RESULTS` result instants. There is **no id linking HM_HISTORY to
  IMMUNE/ORDER** — you correlate by date. (See gotchas.)

## Unstructured tie-back

Mostly **n/a** — HM is structured-only. The one bridge to the document/encounter world is the **reminder
letter**: `PAT_HM_LETTER` + `HM_ENC_DATE` record that a letter for a topic was generated for a specific
encounter CSN. The letter's rendered text is not in these tables; if a generated-letter document exists it
would live under the notes/media corpus tied to that CSN (`HNO_INFO`/`DOC_INFORMATION` via the CSN), not
in HM. The HM "completions" point at clinical events (shots/labs) whose narratives live in their own
domains (immunizations, labs); HM itself stores only the status/date rollup.

## Gotchas & quirks (chased to *why*)

1. **Topic ids and plan ids are two different id spaces that collide numerically (§24).** `HM_TOPIC_ID`
   (in `HM_HISTORICAL_STATUS`/`HM_FORECAST_INFO`/`PAT_HM_LETTER`) indexes `CLARITY_HM_TOPIC` (abstract
   topics). `ACTIVE_HM_PLAN_ID`/`HM_CURRENT_GUIDE_ID` index `HM_PLAN_INFO` (concrete plans). **The same
   integer means different things in each:** id `66` is *"COVID-19 Vaccine"* as a **topic** but *"HPV
   Vaccine (9-26YO)"* as a **plan** (both verified). Mechanism: a topic is the abstract preventive goal;
   a plan is the specific protocol chosen to satisfy it, and Chronicles numbers them independently. Join
   each id to *its own* masterfile; never cross them. The denormalized `_NAME` companions (§4) on every id
   are your safety check — if the joined name disagrees with the inline name, you joined the wrong table.

2. **`HM_HISTORICAL_STATUS` has no snapshot-date column — `LINE` *is* the timeline (§7, §10 inverted).**
   The table records "status of topic X at moment T" but ships no T column. Mechanism: it's an append-only
   event log; each status transition for *any* topic appends the next global `LINE`, so `LINE` ascending =
   chronological order across all topics interleaved. Verified: ordering by `CAST(LINE AS INT)`,
   `LAST_COMPLETED_DATE` increases monotonically and the Influenza Due-On→Overdue→Completed→Not-Due cycle
   repeats cleanly year over year. **To reconstruct one topic's history, filter `HM_TOPIC_ID` and order by
   `CAST(LINE AS INT)`.** The earliest LINEs (1–15 here) are a one-time baseline snapshot of all known
   topics; later LINEs are individual transitions. Do not expect `LINE` to align across tables.

3. **"Next due" / "earliest valid" dates can be birthday-anchored age boundaries, not real future dates.**
   `NEXT_DUE_DATE` and `EARLIEST_VALID_DATE` sometimes show dates decades in the past or future
   (`10/26/1987`, `10/26/2032`, `10/26/2057`). Mechanism: the forecast engine computes age-window
   boundaries as **DOB + N years**. This patient's DOB is **10/26/1982**, and *every* anomalous date is a
   `10/26` birthday: `10/26/1987`=age 5, `10/26/1998`=age 16, `10/26/2032`=age 50 (Zoster window),
   `10/26/2057`=age 75. For an aged-out or never-started series the "next due" is just the age boundary,
   landing in the deep past. **Don't read these as scheduled appointments** — read them as "the age at
   which this series' window opens/closes." Real near-term due dates (e.g. Influenza `9/1/2025`) look
   normal; the birthday-anchored ones are the tell.

4. **`HM_HISTORY` completions have no topic id and link to clinical data only by datetime.** The table is
   just `(PAT_ID, LINE, HM_COMP_TYPE_C_NAME, HM_COMP_UTC_DTTM)`. The schema doc claims `LINE` "identifies
   the health maintenance topic," but there is no topic name/id to resolve it against — the positional
   mapping is opaque in the export. Mechanism: Chronicles stores the completion as a multiple-response item
   under the patient's HM record; the topic identity lives in the parent item that wasn't extracted.
   **Practical handling:** treat `HM_HISTORY` as "list of satisfying events with type+instant," and tie a
   completion to its real clinical record by matching `HM_COMP_UTC_DTTM` (convert UTC→local) to
   `IMMUNE.IMMUNE_DATE` (for `Immunization`) or `ORDER_RESULTS` (for `Result Component`). Verified: each
   Immunization instant matches an IMMUNE administration exactly.

5. **UTC vs local on completion instants (§11).** `HM_HISTORY.HM_COMP_UTC_DTTM` is in **UTC**, while the
   matching `IMMUNE.IMMUNE_DATE` and the HM status `LAST_COMPLETED_DATE` are **local effective dates**
   (rendered at 12:00 AM). E.g. a shot on local `2/5/2019 12:00 AM` shows as `2/5/2019 6:00:00 AM` UTC
   (CST, −6) and a summer event as `…5:00:00 AM` UTC (CDT, −5). When date-matching completions to shots,
   compare the **calendar date after offset**, not the raw string, and watch the DST boundary.

6. **`HM_COMP_TYPE_C_NAME` splits into instant-bearing and instant-less completions.** `Immunization` (22)
   and `Result Component` (20) carry real instants; `LOS Code` (10) and `E/M Code` (1) have **NULL**
   instants. Mechanism: a topic can be satisfied by a *billing/visit code* rather than a discrete clinical
   result (an Annual Wellness Visit is "done" because a wellness E/M or Level-of-Service code was filed),
   and those carry no measurement instant. Don't treat NULL `HM_COMP_UTC_DTTM` as missing data — it's a
   code-based completion with no associated moment.

7. **Soft-delete / lifecycle statuses (§16, §18).** `HM_STATUS_C_NAME` includes `Hidden`, `Aged Out`, and
   blank in addition to the live cycle (`Not Due`→`Due Soon`→`Due On`→`Overdue`→`Completed`). `Hidden` /
   `Aged Out` topics (travel vaccines never indicated, pediatric series the adult patient aged past)
   persist in the export with their status, and `PATIENT_HMT_STATUS` still lists them. Treat presence as
   "this topic is tracked," not "this topic is relevant/active." Filter on status for the live list.

8. **External-completion satisfaction is its own small subsystem.** `HAS_OUTSIDE_COMPLETION_YN='Y'` plus a
   populated `EXTERNAL_CLINICAL_DATE` (vs the unused `EXTERNAL_CLAIM_DATE`/`PAT_REPORTED_DATE`/
   `EXTERNAL_HEALTH_PLAN_DATE`) means the topic was satisfied by **Care Everywhere / outside data**, not an
   in-house event. Here that's 2 rows (a COVID dose reconciled from external clinical data). The four
   external-date columns are mutually exclusive flavors of "where the satisfying record came from."

## Recipes

```sql
-- 1. Current preventive-care dashboard: every active topic, its concrete plan, and last update.
SELECT s.LINE,
       s.ACTIVE_HM_PLAN_ID_HM_PLAN_NAME AS active_plan,
       s.HMT_LAST_UPDATE_DT             AS last_update,  -- update timestamp, NOT a completion date
       s.HM_ACTIVE_SERIES_C_NAME        AS series
FROM PATIENT_HMT_STATUS s
ORDER BY CAST(s.LINE AS INT);
-- CAVEAT: HMT_LAST_UPDATE_DT is the row's last-update timestamp, blank for any topic never acted on
-- (14/23 rows here — the travel/pediatric vaccines). For the true last-completed date per topic use the
-- highest-LINE HM_HISTORICAL_STATUS.LAST_COMPLETED_DATE (Recipe 3), not this column.
```

```sql
-- 2. Full status history for one topic (chronological via LINE — there is no date column).
--    Replace 80 (Influenza). 66=COVID-19, 50=Annual Wellness Visit, 64=Cholesterol, 9=Diabetes.
SELECT LINE, HM_STATUS_C_NAME, NEXT_DUE_DATE, LAST_COMPLETED_DATE
FROM HM_HISTORICAL_STATUS
WHERE HM_TOPIC_ID = '80'
ORDER BY CAST(LINE AS INT);
```

```sql
-- 3. Latest status per topic (collapse the event log to "now-ish" = each topic's highest LINE).
SELECT h.HM_TOPIC_ID, h.HM_TOPIC_ID_NAME, h.HM_STATUS_C_NAME,
       h.NEXT_DUE_DATE, h.LAST_COMPLETED_DATE
FROM HM_HISTORICAL_STATUS h
JOIN (SELECT HM_TOPIC_ID, MAX(CAST(LINE AS INT)) mx
      FROM HM_HISTORICAL_STATUS GROUP BY HM_TOPIC_ID) m
  ON h.HM_TOPIC_ID = m.HM_TOPIC_ID AND CAST(h.LINE AS INT) = m.mx
ORDER BY h.HM_STATUS_C_NAME;
```

```sql
-- 4. What's forecast next, with the human topic name (forecast topic id -> topic masterfile).
SELECT f.HM_FORECAST_TOPIC_ID_NAME AS topic, f.EARLIEST_VALID_DATE
FROM HM_FORECAST_INFO f
LEFT JOIN CLARITY_HM_TOPIC t ON f.HM_FORECAST_TOPIC_ID = t.HM_TOPIC_ID
ORDER BY CAST(LINE AS INT);
-- NOTE: a birthday-anchored EARLIEST_VALID_DATE (DOB + N yrs) means an age-window boundary, not a real next dose.
```

```sql
-- 5. Tie immunization completions to the actual shot (no FK — match by date after UTC->local).
SELECT hh.LINE, hh.HM_COMP_UTC_DTTM AS completed_utc,
       i.IMMUNZATN_ID_NAME AS vaccine, i.IMMUNE_DATE AS given_local
FROM HM_HISTORY hh
LEFT JOIN IMMUNE i
  ON substr(i.IMMUNE_DATE,1,instr(i.IMMUNE_DATE,' ')-1)
   = substr(hh.HM_COMP_UTC_DTTM,1,instr(hh.HM_COMP_UTC_DTTM,' ')-1)
WHERE hh.HM_COMP_TYPE_C_NAME = 'Immunization'
ORDER BY CAST(hh.LINE AS INT);
-- Date-string match works here because UTC and local fall on the same calendar day for these morning shots;
-- for late-evening events apply the -5/-6h offset before comparing.
-- CAVEAT: a date with multiple shots (e.g. 2/5/2019 had 3) fans out one HM_HISTORY row to several IMMUNE
-- rows. Date alone is not unique; disambiguate by vaccine group/topic if you need an exact 1:1 tie.
```

## Open questions / specimen notes

- **`HM_HISTORY.LINE → topic` mapping is unresolved in the export.** The schema says `LINE` identifies the
  topic, but no topic id/name ships, so a completion can only be tied back to a topic indirectly (by
  matching its instant to a known shot/lab whose topic you already know). If your export needs an exact
  HM_HISTORY→topic map, it isn't directly available from these tables alone.
- **`ACTIVE_SUBTOPIC_ID` is 100% NULL here**, so the topic↔plan relationship *inside* `PATIENT_HMT_STATUS`
  comes only through `ACTIVE_HM_PLAN_ID`. Other patients/orgs may populate the subtopic column; verify.
- **Postpone/tentative fields are all empty** in this specimen (`HMT_PPN_UNTL_DT`, `HMT_PPN_RSN_C_NAME`,
  `HM_TENTATIVE_YN`, `HM_ORDER_STATUS_YN`). They're documented to hold "snooze until / reason" and
  order-status flags; described from schema only here.
- **Birthday-anchored dates are derived from this patient's DOB (10/26/1982).** The *mechanism* (DOB + age
  window) is genre; the specific dates are specimen. On another export, anomalous HM due-dates will anchor
  to *that* patient's birthday.
- This specimen is unusually rich for HM (84 status rows spanning 2018→2025). Many exports will have these
  tables sparse or empty for patients with little preventive-care tracking; the structure above still holds.
