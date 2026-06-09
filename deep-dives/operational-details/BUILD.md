# Operational details - build recipe

## Target Schema

```ts
interface ViewModel {
  meta: {
    title: string;
    subtitle: string;
    counts: {
      appointment_skeleton_rows: number;
      real_appointments: number;
      completed_appointments: number;
      echeckin_step_rows: number;
      audit_rows: number;
      audit_items: number;
      adt_events: number;
      ed_event_lines: number;
      room_assignments_present: number;
      order_rows: number;
      note_file_rows: number;
      note_file_after_hours: number;
      clinic_vital_delta_median_min: number | null;
    };
  };
  summary: string[];
  statusCounts: StatusCount[];
  surfaceRows: SurfaceRow[];
  appointmentRows: AppointmentFlow[];
  auditMonths: AuditMonth[];
  auditItemRows: AuditItem[];
  previsitTiles: WorkflowTile[];
  questionnaireRows: QuestionnaireRow[];
  kioskRows: KioskRow[];
  orderTimingRows: OrderTimingRow[];
  orderTimingSummary: OrderTimingSummary[];
  noteTimingSummary: NoteTimingSummary;
  noteHourRows: NoteHourRow[];
  noteTypeRows: NoteTypeRow[];
  noteSlotContext: NoteSlotContext;
  noteAfterHoursRows: NoteAfterHoursRow[];
  negativeFindings: NegativeFinding[];
  echeckinSummary: EcheckinStatus[];
  echeckinSteps: EcheckinStep[];
  adtRows: AdtEvent[];
  adtEpisodes: AdtEpisode[];
  edEventGroups: EdEventGroup[];
  sections: Section[];
  evidence: Record<string, Evidence>;
}

interface SurfaceRow {
  label: string;
  raw: string;
  rows: number;
  present: number;
  interpretation: string;
}

interface AuditMonth {
  month: string;
  label: string;
  patient_record: number;
  hospital_account: number;
  total: number;
}

interface AuditItem {
  source: "Patient record" | "Hospital account";
  item: string;
  n: number;
  users: number;
  encounters: number | null;
}

interface WorkflowTile {
  label: string;
  value: number;
  detail: string;
}

interface QuestionnaireRow {
  form: string;
  status: string;
  n: number;
}

interface KioskRow {
  form: string;
  n: number;
}

interface OrderTimingRow {
  type: string;
  display: string;
  status: string;
  date: string | null;
  order: string | null;
  offsets: Record<"proc_begin" | "proc_start" | "proc_end" | "result" | "charge", number | null>;
  useful: boolean;
}

interface OrderTimingSummary {
  type: string;
  status: string;
  n: number;
  order_time: number;
  procedure_times: number;
  result_time: number;
  creators: number;
}

interface NoteTimingSummary {
  clinical_notes: number;
  entry_local_rows: number;
  filed_local_rows: number;
  update_author_local_rows: number;
  created_after_hours: number;
  entry_after_hours: number;
  filed_after_hours: number;
  update_after_hours: number;
  filed_weekend: number;
}

interface NoteHourRow {
  hour: number;
  label: string;
  entry: number;
  filed: number;
  updated: number;
}

interface NoteTypeRow {
  type: string;
  status: string;
  n: number;
  filed: number;
  after_hours_filed: number;
  weekend_filed: number;
}

interface NoteSlotContext {
  after_hours_filed: number;
  same_day: number;
  morning_slot: number;
  afternoon_slot: number;
  late_slot: number;
  no_slot: number;
}

interface NoteAfterHoursRow {
  type: string;
  department: string | null;
  slot: string | null;
  file: string | null;
  slot_bucket: "Morning slot" | "Afternoon slot" | "Late slot" | "No slot";
  minutes_after_slot: number | null;
  same_day: boolean;
  file_hour: number | null;
}

interface NegativeFinding {
  label: string;
  present: number;
  total: number;
  note: string;
}

interface AppointmentFlow {
  csn: string;
  date: string;
  date_iso: string;
  date_real: number;
  slot: string | null;
  status: string;
  kind: "clinic" | "lab" | "radiology" | "therapy" | "canceled" | "future";
  department: string;
  provider: string;
  checkin_user: string | null;
  checkout_user: string | null;
  echeckin_status: string | null;
  avs_time: string | null;
  first_flowsheet_time: string | null;
  last_flowsheet_time: string | null;
  first_core_vital_time: string | null;
  first_core_vital_label: string | null;
  first_core_delta_min: number | null;
  flow_measure_count: number;
  hsp_class: string | null;
  effective_start: string | null;
  note: string;
}

interface StatusCount {
  status: string;
  n: number;
  checkin: number;
  checkout: number;
  echeckin: number;
  avs: number;
}

interface EcheckinStatus {
  status: string;
  appts: number;
  step_rows: number;
}

interface EcheckinStep {
  step: string;
  completed: number;
  not_started: number;
  filtered_or_not_offered: number;
  not_needed: number;
  total: number;
}

interface AdtEvent {
  csn: string;
  event: string;
  patient_class: string;
  department: string;
  effective: string;
  recorded: string;
  user: string;
}

interface AdtEpisode {
  csn: string;
  date: string;
  department: string;
  patient_class: string;
  in_effective: string;
  out_effective: string;
  discharge_recorded: string;
  administrative_duration_min: number | null;
  discharge_user: string;
}

interface EdEventGroup {
  event_id: string;
  lines: number;
  first: string;
  last: string;
  users: string[];
}

interface Section {
  id: string;
  title: string;
  narrative: Array<{ text: string; cites?: string[] }>;
}

interface Evidence {
  kind: "fact";
  text: string;
}
```

## Recipe From Raw

Run one projection:

```bash
bun deep-dives/operational-details/scripts/assemble-viewmodel.ts
```

That script is an implementation of the recipe below; the recipe itself is the raw-data logic.

### `surfaceRows` and `negativeFindings` - projection

Source: `PAT_ENC`, `PAT_ENC_APPT`, `PAT_ENC_3`, `PAT_ENC_4`, `ECHKIN_STEP_INFO`, `IP_FLWSHT_REC`,
`IP_FLWSHT_MEAS`, `V_EHI_FLO_MEAS_VALUE`, `CLARITY_ADT`, `PAT_ENC_HSP`, and `PATIENT_ENC_VIDEO_VISIT`.

Logic: enumerate the operational surfaces and count rows where the relevant field is populated. Use
`APPT_STATUS_C_NAME IS NOT NULL` or `PROV_START_TIME IS NOT NULL` to identify real scheduled appointments;
do not count every `PAT_ENC_APPT` row as an appointment because skeleton rows exist. Count room/bed fields
from `CLARITY_ADT` and `PAT_ENC_HSP`, but keep the interpretation separate from the count because columns
can exist with zero populated room values.

The UI no longer renders `surfaceRows` as a giant bar list. It uses `negativeFindings` as compact searched-
but-not-found counters for ordinary office room-in/out, ED flow timing, room/bed values, and OR/procedure
presence billing times.

### `appointmentRows` - projection

Source: scheduled encounters from `PAT_ENC` joined to `PAT_ENC_APPT`, `PAT_ENC_3`, `PAT_ENC_4`,
`PAT_ENC_HSP`, `CLARITY_DEP`, and `CLARITY_SER`.

Logic: one row per status-bearing appointment, ordered by `CAST(PAT_ENC_DATE_REAL AS REAL)`. Resolve
department and provider names through the master tables. Classify rows by status and department text:
clinic, lab, radiology, therapy, canceled, future. Carry slot time from `PROV_START_TIME`, check-in actor
from `PAT_ENC.CHECKIN_USER_ID_NAME`, checkout actor from `PAT_ENC_3.CHKOUT_USER_ID_NAME`, AVS print from
`PAT_ENC.AVS_PRINT_TM`, and eCheck-in rollup from `PAT_ENC_4.ECHKIN_STATUS_C_NAME`.

### `first_core_vital_time` - projection

Source: `IP_FLWSHT_REC -> IP_FLWSHT_MEAS -> V_EHI_FLO_MEAS_VALUE` bridged back to `PAT_ENC` by
`INPATIENT_DATA_ID`.

Logic: use flowsheet `RECORDED_TIME` as a rooming-adjacent proxy. Restrict "core vital" to BP, pulse,
SpO2, height, weight, and BMI (`FLO_MEAS_ID` 5, 8, 10, 11, 14, 5445). Compute the minute delta from
appointment slot time to first core vital timestamp when both exist. Do not call this "time in exam room";
it is a proxy for when rooming/vitals documentation happened.

### `echeckinSummary` and `echeckinSteps` - projection

Source: `PAT_ENC_4.ECHKIN_STATUS_C_NAME` and `ECHKIN_STEP_INFO`.

Logic: roll up appointments by eCheck-in status, then group step rows by step, status, and action. Collapse
step status into completed, not started/in progress, filtered/not offered, and not needed for display.
Order steps by total row count.

### `auditMonths` and `auditItemRows` - projection

Source: `V_EHI_REG_ITEM_AUDIT_EPT` and `V_EHI_REG_ITEM_AUDIT_HAR`.

Logic: union patient-record and hospital-account audit views, then aggregate by local audit month for the
heatmap and by changed-item label for the ranked list. Do not project `OLD_VALUE_EXTERNAL` or
`NEW_VALUE_EXTERNAL`; the dive shows operational activity without exposing raw value changes.

### `previsitTiles`, `questionnaireRows`, and `kioskRows` - projection

Source: `ECHKIN_STEP_INFO`, `MYC_APPT_QNR_DATA`, `KIOSK_QUESTIONNAIR`, `CL_QANSWER`,
`PAT_REVIEW_DATA`, `APPT_LETTER_RECIPIENTS`, `ARPB_TRANSACTIONS3`, and `HSP_TRANSACTIONS_3`.

Logic: summarize patient-facing operational work as compact tiles: eCheck-in rows, MyChart/kiosk
questionnaires, questionnaire workflow duration, patient review signals, appointment letter recipients,
and payment collection workflow.

### `orderTimingRows` and `orderTimingSummary` - projection

Source: `ORDER_PROC` and `CL_ORD_FST_LST_SCH`.

Logic: use `ORDER_TIME` as the origin and compute minute offsets for procedure begin/start/end, result, and
charge-drop timestamps. Keep lab, imaging, and microbiology rows with useful offsets in the trace view.
Report that `CL_ORD_FST_LST_SCH` exists but its first/last scheduled timestamps are blank in this specimen.

### `noteTimingSummary`, `noteHourRows`, `noteTypeRows`, and `noteSlotContext` - projection

Source: `HNO_INFO` joined to `NOTE_ENC_INFO`, with appointment context from `PAT_ENC_APPT` through the note's
encounter CSN.

Logic: use local lifecycle timestamps when analyzing time of day: `ENT_INST_LOCAL_DTTM`,
`NOT_FILETM_LOC_DTTM`, and `UPD_AUT_LOCAL_DTTM`. Do not use non-local filed fields for pajama-time claims.
Restrict the displayed note timing analysis to clinical note-like rows such as Progress Note, Telephone
Encounter, Patient Instructions, Consults, and signed/addended note rows. Aggregate local entry/file/update
counts by hour, note type, and after-hours status. For after-hours file times, join back to the encounter's
scheduled slot and classify the slot as morning, afternoon, late-day, or no-slot so the reader can tell
whether after-hours filing is simply explained by late-day appointments.

### `adtRows` and `adtEpisodes` - projection

Source: `CLARITY_ADT`, joined to `CLARITY_DEP`.

Logic: keep the four ADT rows as cleaned event statements. Group by CSN to form two therapy-series episodes,
linking the `Hospital Outpatient` in-event with the `Discharge` out-event. Compute administrative duration
from effective in to effective out, while stating that this is not clinical room duration.

### `evidence` and `sections` - judgment

Source: the projection counts above plus the scheduling and encounter field guides.

Rubric: every narrative claim cites one compact structured fact. Evidence entries are readable statements,
not raw rows. The key judgment is the distinction between a true stopwatch and operational evidence: the
export is rich enough to show workflow, but this specimen does not populate ordinary office room-in/room-out
fields.
