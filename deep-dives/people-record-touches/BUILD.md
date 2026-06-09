# People behind the record — build recipe

## Target Schema

```ts
interface ViewModel {
  meta: {
    title: string;
    subtitle: string;
    generatedAt: string;
    generatedBy: string;
    dateSpan: string;
    counts: {
      touchEvents: number;
      namedHumans: number;
      systemActors: number;
      actorsTotal: number;
      departments: number;
      taskGroups: number;
      rawSourceTables: number;
      dualIdHumans: number;
    };
  };
  summary: string[];
  sections: Array<{ id: string; title: string; narrative: Array<{ text: string; cites?: string[] }> }>;
  taskGroups: Array<{ id: string; label: string; color: string; touches: number; humans: number; systems: number }>;
  rollups: {
    domains: CountRow[];
    departments: CountRow[];
    tasks: CountRow[];
    roles: CountRow[];
    actorKinds: CountRow[];
    sourceTables: CountRow[];
    eventsByYear: CountRow[];
  };
  actors: Actor[];
  topActors: Actor[];
  dualIdHumans: Actor[];
  topDepartments: CountRow[];
  visualData: {
    domainTaskLinks: LinkRow[];
    taskActorKindLinks: LinkRow[];
    deptTaskLinks: LinkRow[];
    actorTaskLinks: LinkRow[];
    taskCooccurrence: Array<{ source: string; target: string; weight: number; people: number }>;
    topBridgeActors: Array<{
      name: string;
      touches: number;
      taskGroupCount: number;
      taskGroups: Record<string, number>;
      bridgeScore: number;
      sourceIds: string[];
    }>;
    yearTaskGrid: Array<{ year: number; taskGroup: string; count: number }>;
    topActorTaskMatrix: Array<{ actorKey: string; actorName: string; actorKind: string; taskGroup: string; count: number }>;
  };
  events: DisplayEvent[];
  evidence: Record<string, { kind: "fact"; date?: string; text: string }>;
}

interface Actor {
  key: string;
  name: string;
  kind: "Human" | "System / placeholder" | "External source";
  touches: number;
  taskGroupCount: number;
  domainCount: number;
  departmentCount: number;
  firstYear: number | null;
  lastYear: number | null;
  idSpaces: string[];
  sourceIds: string[];
  taskGroups: Record<string, number>;
  topDomains: CountRow[];
  topDepartments: CountRow[];
  topRoles: CountRow[];
  samples: Array<{ date: string; task: string; role: string; department: string; record: string; domain: string }>;
}

interface CountRow { key: string; count: number }
interface LinkRow { source: string; target: string; count: number }
interface DisplayEvent {
  dateIso: string | null;
  date: string;
  actorName: string;
  actorKind: string;
  idSpace: string;
  domain: string;
  taskGroup: string;
  task: string;
  role: string;
  department: string;
  record: string;
  sourceTable: string;
}
```

## Recipe From Raw Export

Run the projection implementation with:

```bash
bun deep-dives/people-record-touches/scripts/assemble-viewmodel.ts
```

The script is one implementation of the recipe below; the recipe is the source logic.

### Actor Resolution

Projection. Source: `CLARITY_SER`, `CLARITY_EMP`, `CLARITY_DEP`, `CLARITY_DEP_4`.

Resolve any `*_PROV_ID` through `CLARITY_SER.PROV_ID`; resolve any `*_USER_ID` through
`CLARITY_EMP.USER_ID`, preferring populated inline `*_USER_ID_NAME` when available. Normalize names to merge
the same human across provider and user id spaces, but retain the source id list. Classify system, batch,
generic MyChart, EDI, external-data, and seeded placeholder actors separately from named humans. Resolve
department ids to patient-facing external names when available.

### Touch Event Vocabulary

Projection. Source tables and roles:

- `PAT_ENC`, `PAT_ENC_3`, `PAT_PCP`, `TREATMENT_TEAM`: visit/rendering provider, PCP on contact,
  encounter creator, check-in, checkout, cancellation, encounter closure, AVS user, longitudinal PCP, and
  treatment-team member.
- `ORDER_MED`: medication order creator, prescriber, authorizing/ordering/refill provider, discontinuing
  user, pending approver.
- `ORDER_PROC`: procedure/lab/imaging order creator, authorizing provider, billing provider, referring
  provider, technologist, interpreting user, instantiating user.
- `HNO_INFO`, `NOTE_ENC_INFO`: note entry user, current/linked author, author user, updater, editor,
  cosigner, cosign recipient, comment editor, note deleter.
- `MYC_MESG`: message sender, recipient, provider of record, questionnaire provider contexts when present.
- `IP_FLWSHT_MEAS` plus `IP_FLWSHT_REC`: vitals/flowsheet taken-by, entered-by, pended-by users.
- `ALLERGY`, `PROBLEM_LIST`, `PROBLEM_LIST_HX`, `IMMUNE`: allergy/problem/immunization entry,
  administration, and dual-sign actors.
- `REFERRAL`, `REFERRAL_HIST`: referring/referral providers, PCP on referral, preauthorization changer,
  referral-history changer.
- `ARPB_TRANSACTIONS`, `ARPB_TRANSACTIONS2`, `ARPB_TX_ACTIONS`: service provider, billing provider,
  transaction poster, billing/referral override users, billing action users.

Each populated actor field becomes one touch event. The unit is therefore an attributable role-field on a
record row, not a chart-open event.

### Dates And Departments

Projection. Prefer `*_DATE_REAL` for encounter-backed records, casting to a number and converting from the
Epic 1840-12-31 epoch. Fall back to rendered date text when a real date is absent. Carry future scheduled
contacts as real record facts; do not reinterpret them as completed care. Department comes from the source
row when present, otherwise from a clear context label such as note author service, flowsheets, referral
workqueue, immunizations, or problem/allergy list.

### Rollups

Synthesis. Aggregate touch events by actor, actor kind, task group, task, role, department, domain, source
table, year, domain→task, task→actor kind, department→task, and actor→task. For the chord diagram, compute
task-group co-occurrence over named humans: when one human has touches in two task groups, add a symmetric
edge weighted by the smaller of that person's two task counts and count the person once on that edge. Sort
counts descending, retain top samples per actor, calculate broad bridge actors, and emit all visual-ready
arrays in `visualData`.

### Evidence

Judgment. Evidence entries are structured statements about the projection scope, the provider/user id-space
split, system actors, top department/task rollups, and interpretation limits. They cite counts from the
view model rather than raw rows. No raw patient identifiers are emitted.

### Invariants

- Every event has exactly one actor, task group, domain, source table, date label, and department/context.
- Every actor count equals the number of events with that actor key.
- Task-group counts equal event counts by task group.
- Zero-count task groups are not rendered.
- The app never imports SQLite, TSV, intermediate parts, or raw table rows.
