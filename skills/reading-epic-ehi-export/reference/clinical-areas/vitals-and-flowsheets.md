# Vitals & flowsheets — Epic EHI field guide

**Scope.** Flowsheet-captured measurements: vital signs (BP, pulse, weight, height, BMI, SpO2, temp/resp
when present), Epic's auto-calculated derived rows (BSA, IBW, tidal volumes), and structured screening
questionnaires charted as flowsheet rows (PHQ-2 depression screen, COVID symptom/travel screens, adult
wellness screens). This is the "vitals" half of the labs/vitals split — *not* lab analytes (those are
`ORDER_RESULTS`; see the lab-results guide). It is also one half of the screening-instrument split:
instruments *charted in the encounter* file here as flowsheet rows, while patient-submitted questionnaire
*forms* (the HQA answer records behind eCheck-in/MyChart) live in `questionnaires-and-assessments.md`.

**Where it sits.** A measurement carries no CSN of its own. It hangs off a flowsheet-data record
(`FSD_ID`) → a stay record (`INPATIENT_DATA_ID`) → `PAT_ENC.INPATIENT_DATA_ID` → the encounter's
`PAT_ENC_CSN_ID`. The patient (`PAT_ID`) is stamped directly on `IP_FLWSHT_REC`.

## Tables

| table | role | rows in specimen | notes |
|---|---|---|---|
| `IP_FLWSHT_MEAS` | **Spine.** One row per measurement (the WHO/WHEN/metadata side). Key `(FSD_ID, LINE)`. | 305 | Carries `FLO_MEAS_ID`(+`_DISP_NAME`), `RECORDED_TIME`, `ENTRY_TIME`, `TAKEN_USER_ID_NAME`, `ABNORMAL_C_NAME`, `FLT_ID`, `MEAS_COMMENT`. **The value column itself is excluded** — get it from the view. |
| `V_EHI_FLO_MEAS_VALUE` | **Spine.** The export view that re-exposes the value (§47). Key `(FSD_ID, LINE)`, 1:1 with MEAS. | 305 | `MEAS_VALUE_EXTERNAL` (the actual reading), `UNITS`, `VALUE_TYPE_C_NAME`. **This is where you read a vital's value.** |
| `IP_FLWSHT_REC` | **Spine.** Links a flowsheet-data record to its stay + patient + date. Key `FSD_ID`. | 26 | `FSD_ID → INPATIENT_DATA_ID`, `RECORD_DATE`, `PAT_ID`, `DAILY_NET` (empty here). The hop from a measurement up to its encounter goes through this. |
| `IP_FLOWSHEET_ROWS` | Catalog of which flowsheet ROWS (layout) exist for a stay. Key `(INPATIENT_DATA_ID, LINE)`. | 372 | `FLO_MEAS_ID`(+`_DISP_NAME`), `FLOWSHT_ROW_NAME`, `ROW_VARIANCE_C_NAME` ('Add'), `IP_LDA_ID` (bridge to an LDA record — see below). Defines the *row layout per stay*, not values — includes rows that were never filled. |
| `IP_FLO_GP_DATA` | Global `FLO_MEAS_ID → DISP_NAME` dictionary (patient-agnostic master file). | 103 | e.g. `5`=BP, `8`=Pulse, `10`=SpO2, `11`=Height, `14`=Weight, `5445`=BMI. |
| `IP_FLT_DATA` | Flowsheet TEMPLATE dictionary `TEMPLATE_ID → DISPLAY_NAME`. | 12 | e.g. `20`/`171`=Encounter Vitals, `30`=Patient-Reported Data, `281`=ADULT WELLNESS SCREENINGS. Joins from `IP_FLWSHT_MEAS.FLT_ID`. |
| `IP_FLOW_DATERNG` | Which flowsheet date-templates were active for a stay. Key `(INPATIENT_DATA_ID, LINE)`. | 51 | `FLOWSHEET_DATE_ID`(+display), e.g. 'Travel', 'Disease Screening', 'Encounter Vitals' — one row per (stay, date-template) the stay activated. Peripheral. |
| `IP_FS_ORD_IX_ID` | Index tying flowsheet rows to *medication orders* charted against them. Key `(INPATIENT_DATA_ID, GROUP_LINE, VALUE_LINE)`. | 8 | `IX_FLOW_RW_ORD_ID` is a **med-order id** (§41 two ID spaces): it joins `ORDER_MED.ORDER_MED_ID` (8/8 here), NOT `ORDER_PROC.ORDER_PROC_ID` (0 matches — the classic ORD/MED id-space split). `(INPATIENT_DATA_ID, GROUP_LINE)` is the documented FK to `IP_FLOWSHEET_ROWS.(INPATIENT_DATA_ID, LINE)` — med orders attached to a flowsheet row. |
| `FLWSHT_SINGL_COL` | Last-filed instant per row on single-column flowsheet templates. Key `(FSD_ID, LINE)`. | 3 | `FSD_ID → IP_FLWSHT_REC`, `SINGLE_FLO_ID → IP_FLO_GP_DATA.FLO_MEAS_ID`. `SINGLE_RCRD_IN_DTTM` is a **UTC instant** (§19) — unlike the local-time `RECORDED_TIME` on MEAS. |
| `PEF_NTFY_INSTR` | Care Companion *patient-entered-flowsheet* alert config. Key `EPISODE_ID` (joins `EPISODE`). | 1 | `PEF_PAT_SPEC_INSTR` (free-text instructions; empty here), `PEF_SNOOZE_ALRT_YN`. Config, not measurements — related to the domain via the patient-entered mechanism (gotcha 10), not via FSD keys. |

**LDA mini-family.** `IP_LDA_NOADDSINGLE` (1 row here) is the LDA — lines/drains/airways — master
record, unusually rich for this domain: it carries `PAT_ID`, `PAT_ENC_CSN_ID` (resolves to `PAT_ENC`),
`FSD_ID`, and `FLO_MEAS_ID` directly. `LINES_DRAINS_LIST.(PAT_ID, IP_LDA_ID)` lists a patient's LDAs;
`IP_LDA_INPS_USED.(IP_LDA_ID, INP_ID)` names the stays it was charted on (`INP_ID` =
`INPATIENT_DATA_ID`, joining `IP_FLWSHT_REC`/`PAT_ENC`); `IP_FLOWSHEET_ROWS.IP_LDA_ID` bridges a
row-layout row back to its LDA. Genre twist: the LDA master is not only invasive lines — in an
outpatient export it can hold a travel "Trip" record (`TRIP_REGION_ID`/`TRIP_BEGIN_DATE`/`TRIP_END_DATE`
populated, `PLACEMENT_INSTANT`/`REMOVAL_INSTANT` null) tied to the 'Trips'/'Travel' templates; inpatient
exports use the same shape for placement/removal-instant line, drain, and wound records.

No `IP_FLWSHT_MEAS` supplement tables (`_2`, `_3`) are populated here, and no flowsheet-related table is
fully empty in this specimen.

## How they join

All verified against rows in this specimen.

- **Measurement value (the mandatory pairing):** `IP_FLWSHT_MEAS.(FSD_ID, LINE) = V_EHI_FLO_MEAS_VALUE.(FSD_ID, LINE)`.
  Exactly 1:1 (both 305 rows, 0 orphans either direction, 0 `FLO_MEAS_ID` mismatches). MEAS gives
  who/when, the view gives the reading. The view's own schema doc says it "should be used in tandem with
  IP_FLWSHT_MEAS." (see §47 `V_EHI_*` export views.)
- **Measurement → stay/date/patient:** `IP_FLWSHT_MEAS.FSD_ID = IP_FLWSHT_REC.FSD_ID` → gives
  `INPATIENT_DATA_ID`, `RECORD_DATE`, `PAT_ID`. One `INPATIENT_DATA_ID` can own **multiple** `FSD_ID`s
  (a stay straddling two calendar days — see gotchas).
- **Stay → encounter (the CSN bridge):** `IP_FLWSHT_REC.INPATIENT_DATA_ID = PAT_ENC.INPATIENT_DATA_ID`,
  then read `PAT_ENC.PAT_ENC_CSN_ID`. Verified: all 24 distinct `INPATIENT_DATA_ID`s resolve to a
  `PAT_ENC` (100% tie-back). This is how a BP gets back to "the 9/28/2023 office visit." (see §2 CSN.)
- **Measure code → name:** `IP_FLWSHT_MEAS.FLO_MEAS_ID = IP_FLO_GP_DATA.FLO_MEAS_ID` (display name).
  Every measured `FLO_MEAS_ID` (71 distinct) is present in the dictionary. The `_DISP_NAME` companion is
  also denormalized inline on MEAS and the view (§6), so you usually don't need the join.
- **Measure → template:** `IP_FLWSHT_MEAS.FLT_ID = IP_FLT_DATA.TEMPLATE_ID` (template display name).
  Also denormalized as `FLT_ID_DISPLAY_NAME` on MEAS.
- **Row layout for a stay:** `IP_FLOWSHEET_ROWS.INPATIENT_DATA_ID = IP_FLWSHT_REC.INPATIENT_DATA_ID`.
  This is layout, not values — it lists rows that were *available* in the flowsheet, including ones never
  measured (32 of 100 catalog `FLO_MEAS_ID`s have no measurement here).

## Unstructured tie-back

Largely **n/a** for this domain — flowsheet values are themselves structured.

- The only free-text slot is `IP_FLWSHT_MEAS.MEAS_COMMENT`, and it is **empty for all 305 rows** in this
  specimen. When populated it is a short per-measurement nurse comment, inline (not a chunked note).
- Screening questionnaire *answers* are the closest thing to "narrative," and they sit as plain strings
  in `V_EHI_FLO_MEAS_VALUE.MEAS_VALUE_EXTERNAL` (`VALUE_TYPE_C_NAME = 'Custom List'`). Multi-select
  answers are stored **semicolon-joined** in one cell, e.g. `Chills;Cough;Fever;Runny nose;Sore throat`.
- No RTF / Media file in `raw/` references a flowsheet row. Narrative vitals review lives in the visit's
  clinical note (HNO), reachable only through the shared encounter CSN, not a flowsheet key.

## Gotchas & quirks (chased to *why*)

1. **The value isn't in the spine table — it's in a view.** `IP_FLWSHT_MEAS` deliberately ships *without*
   its raw `MEAS_VALUE` column (Epic stores it internally packed/encoded). **Mechanism:** the exporter
   adds `V_EHI_FLO_MEAS_VALUE` to externalize it into display form (§47). **Handle:** never read a vital
   from MEAS alone — always join the view on `(FSD_ID, LINE)`. A query that selects only from MEAS gets
   metadata and no reading.

2. **`VALUE_TYPE_C_NAME` decides how to read `MEAS_VALUE_EXTERNAL`.** The one string column holds vitals,
   calculated fields, and questionnaire answers. **Mechanism:** flowsheets are a generic key-value store;
   the value type tells you the shape. Seen here: `Numeric Type` (Pulse, BMI, SpO2 — a bare number),
   `Blood Pressure` (a pre-rendered `'132/64'` string, **not** two columns), `Patient Weight` /
   `Patient Height` (numbers in special units — see #3), `Custom List` (human-readable answer text stored
   directly), `String Type`, `Category Type`, `Date`, and `Networked` (a reading fed from a device —
   `FLO_NETWORKED_INI` / `CAPTURE_DEVICE_ID` on MEAS name the source; not every value is human-entered or
   calculated). **Handle:** branch on `VALUE_TYPE_C_NAME`; to parse BP, split `MEAS_VALUE_EXTERNAL` on `/`.

3. **Weight is in OUNCES (with decimals); height in inches.** A weight reads `2880` or `2931.2`.
   **Mechanism:** Epic stores Patient Weight in its base smallest unit (ounces), and the export carries
   that bare number with the unit in a *separate* `UNITS` column (`'ounces'`) — the §29 "unit in a column"
   pattern. `2880 oz / 16 = 180 lb`; `2931.2 oz = 183.2 lb`. The fractional ounces are real precision, not
   noise. Height is in `inches` as expected (`71.25`). **Handle:** always read `UNITS`; divide weight by 16
   for pounds. Never assume a vital's unit from its name.

4. **One vitals capture explodes into dozens of auto-calculated rows.** A single FSD here has 39 measure
   lines (the specimen max is ~47), but only ~5 (Weight/Height/BP/Pulse, plus the BP location/position/cuff context) were entered by
   a human. **Mechanism:** Epic formula templates instantiate derived rows on capture — BSA (Haycock),
   IBW male/female, tidal volumes at 6/8/10 cc/kg, multiple BMI variants, "Adenosine total mg." These are
   computed, not measured, and are real `IP_FLWSHT_MEAS` rows. **Handle:** a raw `COUNT(*)` of measurements
   wildly overstates "vitals taken" (§12). Filter to the `FLO_MEAS_ID`s you care about (`5,8,10,11,14`,
   etc.); don't treat calc rows as observations. There is no clean boolean separating "entered" from
   "calculated" here — you identify them by `FLO_MEAS_ID` / display name.

5. **`FLO_CNCT_DATE_REAL` on the MEAS table is NOT a contact date — do not sort by it.** It looks like a
   `*_DATE_REAL` (§18) but converting it gives nonsense (66376 → 2022-09-24 on a row actually recorded
   9/28/2023), and it is **(near-)constant per `FLO_MEAS_ID`** across FSDs — in one specimen 63 of 71
   measures carry a single value and 8 carry two, the value stepping between charting eras.
   **Mechanism:** it is the FLO measure *definition's* own contact date_real, refreshed when the measure
   record is edited — never the time this reading was taken. **Handle:** for the
   *measurement* time use `RECORDED_TIME` (when taken) or `ENTRY_TIME` (when charted — these can differ by
   hours: a weight recorded 9:41 AM but entered 11:27 AM). For *chronological sorting* across encounters,
   join up to `PAT_ENC` and order by `CAST(PAT_ENC.PAT_ENC_DATE_REAL AS REAL)` (verified correct order).

6. **Every text date here sorts lexically and lies (§17/§18).** `RECORDED_TIME`, `ENTRY_TIME`, and
   `IP_FLWSHT_REC.RECORD_DATE` are text. `MIN(RECORD_DATE)`/`MAX(RECORD_DATE)` reports 1/9/2020–9/28/2023
   when the true span is 8/9/2018–12/4/2025 ("8/..." > "12/..." lexically). `ORDER BY RECORDED_TIME` puts
   "9/28/2023" before "8/9/2018." **Handle:** never `ORDER BY`/`MIN`/`MAX` on these text columns; route
   through `PAT_ENC.PAT_ENC_DATE_REAL` for true chronology.

7. **Vitals abnormal flags are essentially absent.** Of 305 measurements, exactly **one** carries
   `ABNORMAL_C_NAME='Yes'` / `ABNORMAL_TYPE_C_NAME='High'` (a BP `142/74`). **Mechanism:** abnormality for
   vitals is configured per-row and mostly not encoded in this org's flowsheets (unlike labs, where
   `RESULT_FLAG_C_NAME` is routinely populated). **Handle:** do not rely on `ABNORMAL_C_NAME` to find
   out-of-range vitals — compute ranges yourself from the numeric value and unit.

8. **A "stay" (`INPATIENT_DATA_ID`) can span two calendar days → two FSDs.** Two stays here own 2 `FSD_ID`s
   each, with `RECORD_DATE`s a few days apart (2/27 and 3/2) but a single `PAT_ENC.CONTACT_DATE` (3/2).
   **Mechanism:** the flowsheet data record is the inpatient-data container; vitals charted across a
   straddle land in separate daily FSDs under one stay/encounter. **Handle:** group by `INPATIENT_DATA_ID`
   (or the resulting CSN), not by `FSD_ID` or `RECORD_DATE`, when you want "one visit."

9. **PHQ-2 (and other screens) reassemble as `LINE`-numbered child rows (§9).** Within one FSD, the PHQ-2
   appears as: the two items ("1. Little interest…" = `FLO_MEAS_ID` 2100100050, "2. Feeling down…" =
   2100100051, each a `Custom List` 0–3 answer), then the total score **twice** — once as
   `FLO_MEAS_ID=16752` (`Numeric Type`) and once as `28282` (`String Type`), same value. **Mechanism:**
   Epic publishes the same scored item under multiple flowsheet rows for different downstream consumers;
   the catalog (`IP_FLOWSHEET_ROWS`) even lists a third `5856` "PHQ-2 Total Score (RETIRED)." **Handle:**
   to get one score per screening, pick a single `FLO_MEAS_ID` (16752, the live numeric) and don't sum the
   duplicates — the numeric and string totals are not always co-published (some FSDs carry only the
   numeric), another reason to standardize on 16752. Reassemble the whole instrument by ordering on
   `CAST(LINE AS INT)` within the FSD.

10. **Not every flowsheet row was charted by staff.** Rows on `IP_FLWSHT_MEAS` with `MYPT_ID` set and
   `PAT_REPORTED_STATUS_C_NAME` = 'Patient reported, not clinician validated' (27 of 305 in one specimen,
   across several questionnaire templates) are MyChart **patient-entered** data; rows with
   `ISACCEPTED_YN='N'` (with `USER_PENDED_BY_ID`/`INSTANT_PENDED_DTTM` populated) were **pended and never
   accepted**. **Mechanism:** MyChart questionnaires and Care Companion tasks file into the same flowsheet
   store as staff charting; a clinician may accept, pend, or never validate them. **Handle:** filter or
   label on `MYPT_ID` / `PAT_REPORTED_STATUS_C_NAME` / `ISACCEPTED_YN` before treating flowsheet rows as
   clinician-verified vitals.

## Recipes

```sql
-- 1. All structured vitals over time, correctly ordered, units carried, weight in lb.
SELECT e.PAT_ENC_CSN_ID, r.RECORD_DATE,
       v.FLO_MEAS_ID_DISP_NAME AS vital,
       v.MEAS_VALUE_EXTERNAL   AS value,
       v.UNITS,
       CASE WHEN v.FLO_MEAS_ID='14'
            THEN ROUND(CAST(v.MEAS_VALUE_EXTERNAL AS REAL)/16.0,1) END AS weight_lb
FROM V_EHI_FLO_MEAS_VALUE v
JOIN IP_FLWSHT_MEAS m ON v.FSD_ID=m.FSD_ID AND v.LINE=m.LINE
JOIN IP_FLWSHT_REC  r ON m.FSD_ID=r.FSD_ID
JOIN PAT_ENC        e ON r.INPATIENT_DATA_ID=e.INPATIENT_DATA_ID
WHERE v.FLO_MEAS_ID IN ('5','8','10','11','14','5445')   -- BP,Pulse,SpO2,Height,Weight,BMI
ORDER BY CAST(e.PAT_ENC_DATE_REAL AS REAL), v.FLO_MEAS_ID_DISP_NAME;
```

```sql
-- 2. Most recent value of each core vital (true "current vitals").
WITH vit AS (
  SELECT v.FLO_MEAS_ID, v.FLO_MEAS_ID_DISP_NAME, v.MEAS_VALUE_EXTERNAL, v.UNITS,
         CAST(e.PAT_ENC_DATE_REAL AS REAL) AS dr
  FROM V_EHI_FLO_MEAS_VALUE v
  JOIN IP_FLWSHT_MEAS m ON v.FSD_ID=m.FSD_ID AND v.LINE=m.LINE
  JOIN IP_FLWSHT_REC  r ON m.FSD_ID=r.FSD_ID
  JOIN PAT_ENC        e ON r.INPATIENT_DATA_ID=e.INPATIENT_DATA_ID
  WHERE v.FLO_MEAS_ID IN ('5','8','10','11','14','5445')
)
SELECT FLO_MEAS_ID_DISP_NAME, MEAS_VALUE_EXTERNAL, UNITS FROM vit v1
WHERE dr = (SELECT MAX(dr) FROM vit v2 WHERE v2.FLO_MEAS_ID=v1.FLO_MEAS_ID);
```

```sql
-- 3. Reassemble one screening instrument (e.g. PHQ-2) from its line rows, in order.
SELECT CAST(m.LINE AS INT) AS ln, m.FLO_MEAS_ID,
       m.FLO_MEAS_ID_DISP_NAME AS prompt,
       v.MEAS_VALUE_EXTERNAL   AS answer, v.VALUE_TYPE_C_NAME
FROM IP_FLWSHT_MEAS m
JOIN V_EHI_FLO_MEAS_VALUE v ON m.FSD_ID=v.FSD_ID AND m.LINE=v.LINE
WHERE m.FSD_ID = :fsd_id
ORDER BY CAST(m.LINE AS INT);
```

```sql
-- 4. Blood pressure split into systolic/diastolic, with who took it.
SELECT r.RECORD_DATE,
       CAST(substr(v.MEAS_VALUE_EXTERNAL,1,instr(v.MEAS_VALUE_EXTERNAL,'/')-1) AS INT) AS systolic,
       CAST(substr(v.MEAS_VALUE_EXTERNAL,  instr(v.MEAS_VALUE_EXTERNAL,'/')+1) AS INT) AS diastolic,
       m.ABNORMAL_TYPE_C_NAME AS flag, m.TAKEN_USER_ID_NAME
FROM V_EHI_FLO_MEAS_VALUE v
JOIN IP_FLWSHT_MEAS m ON v.FSD_ID=m.FSD_ID AND v.LINE=m.LINE
JOIN IP_FLWSHT_REC  r ON m.FSD_ID=r.FSD_ID
WHERE v.VALUE_TYPE_C_NAME='Blood Pressure'
ORDER BY r.RECORD_DATE;   -- note: for true chronology join PAT_ENC and sort on PAT_ENC_DATE_REAL
```

```sql
-- 5. What flowsheet templates/screenings did a stay run? (layout, not values)
SELECT DISTINCT t.DISPLAY_NAME
FROM IP_FLWSHT_MEAS m
JOIN IP_FLT_DATA t ON m.FLT_ID=t.TEMPLATE_ID
JOIN IP_FLWSHT_REC r ON m.FSD_ID=r.FSD_ID
WHERE r.INPATIENT_DATA_ID = :inpatient_data_id;
```

## Open questions / specimen notes

- **Sparse vital coverage (specimen).** Core vitals (BP/Pulse/Weight/Height) appear at only 9 of the 24
  flowsheet stays — the majority of flowsheet stays are screening-only (Travel / Disease Screening /
  patient-reported questionnaires) with no vital at all; SpO2 appears at just 2; Temp/Resp never. A
  flowsheet encounter is NOT presumptively a vitals encounter. This is a per-visit charting choice, not a
  schema limitation — other exports will carry the full vital set.
- **`FLO_CNCT_DATE_REAL` exact semantics (genre).** Verified it is near-constant per `FLO_MEAS_ID` (it
  steps only when the measure definition is re-contacted) and never the reading time; its precise internal
  meaning (measure-definition contact date_real) is inferred, not confirmed from a schema doc. Treat it as
  "do not use as a timestamp."
- **`DAILY_NET` empty (specimen).** `IP_FLWSHT_REC.DAILY_NET` is null for every row — it is populated only
  for intake/output flowsheets, which this outpatient-heavy record never had.
- **`MEAS_COMMENT` empty (specimen).** No per-measurement free text present; the column exists and would
  hold short inline comments if used.
