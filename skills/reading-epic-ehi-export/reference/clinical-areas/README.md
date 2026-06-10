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
- [social-determinants-and-smartdata](social-determinants-and-smartdata.md) — the `SDD_*` Social Drivers
  store (domain rows, screening entries, the `V_EHI_SDD_ENTRY_INTERPRETATION` view), the
  derived-vs-source split with `SOCIAL_HX`/flowsheets, and the unshipped generic `SMRTDTA_*` SmartData
  family.
- [medications-and-orders](medications-and-orders.md) — the `ORDER_MED` family, prescription lifecycle,
  `PAT_ENC_CURR_MEDS`, the med-vs-order id spaces, building a true current-med list.
- [lab-results](lab-results.md) — `ORDER_PROC`→`ORDER_RESULTS` (the value cluster + `9999999` sentinel,
  reference ranges, flags), `ORDER_NARRATIVE`, the status matrix, imaging results are narrative-only.
- [order-lifecycle-details](order-lifecycle-details.md) — how an order moved through the workflow (not
  what it ordered): preference-list/template provenance, pend-and-release, future-order instantiation
  (parent vs child CSNs), order questions, result review/read-ack, the unified `ORDER_ID` space across
  `ORDER_PROC`/`ORDER_MED`.
- [vitals-and-flowsheets](vitals-and-flowsheets.md) — `IP_FLOWSHEET_ROWS`/`IP_FLWSHT_MEAS` +
  `V_EHI_FLO_MEAS_VALUE` (value lives only in the view), units-in-a-column, packed BP values, screening
  instruments (PHQ-2).
- [questionnaires-and-assessments](questionnaires-and-assessments.md) — the LQF/LQL/HQA id spaces
  (`CL_QFORM1`/`CL_QQUEST`/`CL_QANSWER` + `V_EHI_HQA_QUEST_ANSWER`); answer records carry no patient,
  form, or CSN — the *channel* tables (`MYC_MESG_QUESR_ANS`, `MYC_APPT_QNR_DATA`) supply the links;
  order-entry questions (`ORD_SPEC_QUEST`) share the same question dictionary.
- [allergies](allergies.md) — `ALLERGY`(+`_REACTIONS`), the LPL master sharing, label-lies on
  `SEVERITY_C_NAME`, inline free-text, the dangling-pointer delete variant.
- [immunizations](immunizations.md) — the administered record (`IMMUNE`/`IMM_ADMIN` families),
  components, due/forecast, the DXR document-masterfile origin.
- [health-maintenance](health-maintenance.md) — the `HM_*` tables, status-over-time, forecasting, links to
  immunizations and screening orders (sparse in many ambulatory exports).
- [episodes-care-plans-and-goals](episodes-care-plans-and-goals.md) — the HSB episode layer above
  encounters (`EPISODE*`, the unshipped CSN bridge), care-plan records + their §46 satellites, discrete
  goals (IGO) fanned across three tables, registry/reconciliation long tail.
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
- [communication-preferences](communication-preferences.md) — the OYO per-concept channel-consent matrix
  (`COMMUNICATION_PREFERENCES` + `COMM_PREFERENCES_APRV`), reached only via `PATIENT_4.PREFERENCES_ID`
  (no `PAT_ID` anywhere in the domain), current-state only.
- [providers-and-care-teams](providers-and-care-teams.md) — `CLARITY_SER`/`CLARITY_EMP`/`CLARITY_DEP` as
  the universal id-resolution layer (~51 tables depend on it), the SER-vs-EMP split, external sentinels.
- [referrals](referrals.md) — the ~20 `REFERRAL*` tables, status over time, the order↔referral bridge on a
  supplement (`ORDER_PROC_2.REFERRAL_ID`), internal vs external referred-to care.
- [coverage-and-billing](coverage-and-billing.md) — PB (`ARPB_*`/ETR) vs HB (`HSP_*`/HAR), the
  charge/payment/adjustment triad + matching, claims/EOB/remittance, the universal invoice-number key, the
  void→reverse→rebill saga, reaching the patient via the guarantor bridge.
- [benefits-and-eligibility](benefits-and-eligibility.md) — what the insurance *will* cover: BEN benefit
  snapshots (`BENEFITS`/`COVERAGE_BENEFITS`/`SERVICE_BENEFITS` by service type), per-encounter
  pharmacy-eligibility verification (`PAT_ENC_ELIG_HISTORY`/`EXT_PHARM_TYPE_COVERED`), and the RTPB
  `MED_CVG_*` request/response/alternatives conversation with the PBM.

### Operational & audit
- [alerts-and-decision-support](alerts-and-decision-support.md) — BPA/OPA firings as ALT contacts
  (`ALERT_CRITERIA`/`ALERT_ACTION`, the `ALT_CSN_ID` key), the med-order bridge `ORDER_MED_ALTCSN`, and
  why the domain ships as a key *skeleton* — no payload, no `PAT_ID`, no encounter CSN.
- [record-access-audit](record-access-audit.md) — the `V_EHI_REG_ITEM_AUDIT_EPT`/`_HAR` field-level
  change ledger (typically the single biggest table by row count): event → changed-item → mapped-column
  fan-out, external before/after values; a *change* audit, not a who-viewed log.
- [infrastructure-and-plumbing](infrastructure-and-plumbing.md) — the negative-space map: the long tail of
  populated tables no other guide claims, triaged into seven families (lookup slices, numbered supplements,
  placeholder shells, ID crosswalks, export machinery, config echoes, micro-domains) — what's safe to skip
  *by mechanism*, and the plumbing that's secretly load-bearing (`LNC_DB_MAIN` is the only home of LOINC
  codes; a supplement can carry the claim-status axis its base lacks). **Read when a table appears in no
  other guide.**
