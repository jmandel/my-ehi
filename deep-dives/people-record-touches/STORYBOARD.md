# People behind the record — storyboard

## Purpose

This deep dive answers a question the usual patient portal cannot: **who, in the provider site's operational
system, is responsible for touching different parts of the health record?** Not just doctors. Staff,
clinicians, medical assistants, coders, billing users, referral workers, lab/radiology actors, MyChart
senders, batch jobs, EDI feeds, and placeholders all appear as actors.

The central design rule is the Epic distinction between:

- **provider of record** (`*_PROV_ID` → `CLARITY_SER`) — the clinical or billing actor attached to the row;
- **user/login actor** (`*_USER_ID` → `CLARITY_EMP`) — the login that created, edited, signed, closed,
  routed, posted, or otherwise moved the row.

The page merges those spaces by normalized name so the same human can be seen across both identities, while
system and placeholder actors remain visible.

## What The Page Shows

### 1. Record Production Network

A custom alluvial view maps **record domain → task group → actor kind**. It is the first view because it
prevents the common misread that a health record is primarily a doctor-authored document. The chart shows
where documentation, results, orders, referrals, billing, scheduling, and communication are produced, and
which parts are human vs system/external.

### 2. Task-Bridge Chord And People × Task Matrix

A D3 chord diagram places task groups around a circle and connects task pairs that are performed by the same
named humans. This is the non-obvious people view: it reveals which responsibilities share human bridges,
such as documentation/order/referral work in primary care or result-production/documentation work in medical
assistant workflows. A side ledger lists the broadest human bridges.

A D3 heatmap places the top actors on rows and task groups on columns. This makes role breadth visible:
primary care clinicians span encounters, notes, messages, orders, referrals, billing attribution, and list
maintenance; billing and referral workers concentrate in narrower but high-volume operational lanes; medical
assistants dominate vitals/flowsheet production.

### 3. Department Fingerprints

A horizontal department/task fingerprint shows the operational character of each department/context. Internal
medicine carries the broadest mix; flowsheets are result-production heavy; business services and referral
workqueues have their own signatures; note author service is documentation-heavy and not a conventional
patient-facing department. The row form keeps long department names legible and makes task mix comparable.

### 4. Dual Identity Ledger

A compact ledger lists humans who appear in both SER and EMP id spaces. This is a non-obvious but essential
mechanism: the same person can be "the provider" in one table and "the user" in another.

### 5. Time Surface

A year-by-task strip shows when different kinds of work appear over the export. It keeps future scheduled
contacts visible rather than silently dropping them.

### 6. Evidence And Limits

The evidence drawer cites clean structured facts. The explicit limitation is that this is **not** a chart
access audit log. It shows actors named on exported record objects, not everyone who opened the chart.

## Structural Rules

- The app imports only `./viewmodel.json`.
- Raw table names may appear only as provenance labels, never as a raw row dump.
- Names, roles, dates, departments, counts, and task labels must be display-clean in the view model.
- System and external actors are retained, not filtered, because they explain data movement.
- Direct identifiers such as MRN, address, phone, email, and SSN are not emitted.
