# Clinical-area guides — index

One field guide per clinical domain. Each names the tables that carry the domain, the verified joins, the
gotchas chased to *why*, how the unstructured material ties back, and ready-to-run SQL recipes. All assume
the general modeling patterns in `../patterns/general-patterns.md` and cite them by section (e.g. "§2 CSN").

Open the guide for the domain you're working in. Start with **encounters** — it's the hub every other
domain joins back to.

### The clinical core
- [encounters-and-visits](encounters-and-visits.md) — `PAT_ENC` + the `_2..8` supplement stack, the CSN
  contact model, assembling one logical visit, closure vs calculated status, inferring encounter *type*
  (not a coded field). **The hub: learn this first.**
- [appointments-and-scheduling](appointments-and-scheduling.md) — `PAT_ENC_APPT`, eCheck-in
  (`ECHKIN_STEP_INFO`), appointment status vs the encounter rollup, video/eVisit flags.
- [problems-and-diagnoses](problems-and-diagnoses.md) — `PROBLEM_LIST`(+`_ALL`/`_HX`), `PAT_ENC_DX`,
  `DX_ID`→`CLARITY_EDG`, clinician-review vs patient-review channels, soft-delete, problem↔encounter dx.
- [histories-family-social-medical](histories-family-social-medical.md) — `FAMILY_HX`(+pedigree),
  `SOCIAL_HX`, `SURGICAL_HX`, `MEDICAL_HX`; the per-encounter re-snapshot design and the two-CSN split.
- [medications-and-orders](medications-and-orders.md) — the `ORDER_MED` family, prescription lifecycle,
  `PAT_ENC_CURR_MEDS`, the med-vs-order id spaces, building a true current-med list.
- [lab-results](lab-results.md) — `ORDER_PROC`→`ORDER_RESULTS` (the value cluster + `9999999` sentinel,
  reference ranges, flags), `ORDER_NARRATIVE`, the status matrix, imaging results are narrative-only.
- [vitals-and-flowsheets](vitals-and-flowsheets.md) — `IP_FLOWSHEET_ROWS`/`IP_FLWSHT_MEAS` +
  `V_EHI_FLO_MEAS_VALUE` (value lives only in the view), units-in-a-column, packed BP values, screening
  instruments (PHQ-2).
- [allergies](allergies.md) — `ALLERGY`(+`_REACTIONS`), the LPL master sharing, label-lies on
  `SEVERITY_C_NAME`, inline free-text, the dangling-pointer delete variant.
- [immunizations](immunizations.md) — the administered record (`IMMUNE`/`IMM_ADMIN` families),
  components, due/forecast, the DXR document-masterfile origin.
- [health-maintenance](health-maintenance.md) — the `HM_*` tables, status-over-time, forecasting, links to
  immunizations and screening orders (sparse in many ambulatory exports).
- [procedures-and-surgeries](procedures-and-surgeries.md) — procedures as `ORDER_PROC` orderables
  (`ORDER_TYPE_C_NAME`, not a "proc class"), `SURGICAL_HX`, and why OpTime/OR tables are usually absent.
- [imaging-and-media](imaging-and-media.md) — imaging orders + the `Media/` pipeline
  (`DOC_INFORMATION.SCAN_FILE` as the file-to-chart key), the two media pipelines, DICOM placeholders,
  extension-lies.

### Unstructured & narrative
- [clinical-notes-and-documents](clinical-notes-and-documents.md) — the HNO family, `Rich Text/*.RTF`
  (filename = note id + an inverted-date contact key), line-chunked text, note-type coalescing, how a note
  reaches its encounter (`HNO_INFO.PAT_ENC_CSN_ID`, often NULL).
- [patient-provider-messaging](patient-provider-messaging.md) — `MYC_MESG`/`MYC_MESG_RTF_TEXT`/`MSG_TXT`,
  threads keyed by shared CSN, the two body stores split by build-era, the in-basket pool party model.

### People, places & money
- [demographics](demographics.md) — `PATIENT`(+ supplements), identity (`PAT_ID` vs MRN), the alive-status
  trap, what isn't exported, the PHI to avoid emitting.
- [providers-and-care-teams](providers-and-care-teams.md) — `CLARITY_SER`/`CLARITY_EMP`/`CLARITY_DEP` as
  the universal id-resolution layer (~51 tables depend on it), the SER-vs-EMP split, external sentinels.
- [referrals](referrals.md) — the ~20 `REFERRAL*` tables, status over time, the order↔referral bridge on a
  supplement (`ORDER_PROC_2.REFERRAL_ID`), internal vs external referred-to care.
- [coverage-and-billing](coverage-and-billing.md) — PB (`ARPB_*`/ETR) vs HB (`HSP_*`/HAR), the
  charge/payment/adjustment triad + matching, claims/EOB/remittance, the universal invoice-number key, the
  void→reverse→rebill saga, reaching the patient via the guarantor bridge.
