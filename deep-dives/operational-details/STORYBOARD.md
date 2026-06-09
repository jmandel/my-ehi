# Operational details - storyboard

## Purpose

This deep dive answers a question most clinical exports cannot: **what operational workflow around the visit
is visible in an Epic EHI export?** The interesting answer is not a perfect exam-room stopwatch. It is the
visit choreography that surrounds clinical care: scheduled slot, first rooming-adjacent vitals timestamp,
check-in actor, checkout actor, eCheck-in state, questionnaire work, order timing, note finalization timing,
audit trails, AVS print, ADT events, and room/bed fields that exist but are empty.

## What The Page Shows

### 1. Visit Clock

The opening view plots first core-vital timestamps against the scheduled slot. This is the closest ordinary
office visits get to a rooming-time visualization without pretending the export has a true exam-room timer.
Compact counters beneath it show what was searched but not found: room-in/out, ED arrival/triage/departure,
room/bed values, and OR/procedure presence billing times.

### 2. Audit Trail

A heatmap and ranked item list show timestamped patient-record and hospital-account audit events. This is
one of the strongest operational surfaces in the export, but the page shows only counts and changed-item
labels, not raw old/new values.

### 3. Visit Flow Ledger

A filtered appointment ledger shows one row per status-bearing appointment. It places slot time, check-in,
first flowsheet/vitals timestamp, AVS print, and checkout side by side. This is the closest the export gets
to rooming flow for ordinary outpatient visits.

### 4. eCheck-in Work Ledger

The eCheck-in section summarizes rollup statuses, step-level rows, MyChart/kiosk questionnaire rows,
workflow-duration seconds, patient review sidecars, appointment letter recipients, and payment workflow
signals.

### 5. Order Timing

Labs and imaging orders are drawn as timing traces from order instant to procedure/result/charge events.
This adds another operational layer distinct from appointment rooming.

### 6. Note Finalization Clock

Local note lifecycle timestamps are summarized by hour of day. The goal is to show whether there is a
meaningful after-hours/"pajama time" signal without confusing local file times with non-local/UTC-looking
filed fields.

### 7. ADT Events

The final section shows the outpatient therapy-series ADT events. It explicitly warns that ADT in/out times
are operational registration/discharge machinery, not exam-room duration.

## Structural Rules

- The app imports only `./viewmodel.json`.
- Raw table/column names appear only as provenance labels or compact source labels.
- No raw rows are shown.
- Direct identifiers such as MRN, address, phone, email, and SSN are not emitted.
- The page must distinguish "available in the EHI genre" from "populated in this specimen."
