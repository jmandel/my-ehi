# Order lifecycle details — Epic EHI field guide

**Scope.** The workflow plumbing *around* an order — how it moved through the system, not what it
ordered: preference-list/template provenance, pend-and-release, the signed-order summary, second/specialty
signatures, instantiation of future/standing orders into per-instance children, order-specific questions
and clinical indications captured at signing, process instructions shown in Order Composer, result
review and read-acknowledgment, first/last scheduling, anatomical regions, and department-of-patient-care
attribution. For the *content* side — what was ordered, dosing, results, images — see
**medications-and-orders**, **lab-results**, **imaging-and-media** (and **referrals** /
**procedures-and-surgeries** for those order families).

**Where it sits.** Every table here keys on `ORDER_ID` — and that is the **unified ORD master id**:
the same id space holds both procedure orders (`ORDER_PROC.ORDER_PROC_ID`) and medication orders
(`ORDER_MED.ORDER_MED_ID`). The `ORDER_PROC`/`ORDER_MED` split is the *export's* presentation, not two
Chronicles masters (§41 — same concept, one id space, two spines). None of these tables carry `PAT_ID`
or a CSN of their own (except `DEPT_PAT_CARE_SELECTION` and `ORDER_PARENT_INFO`, which embed one); you
reach the patient/encounter by joining the order spine and reading its `PAT_ENC_CSN_ID` (§3).

## Tables

The **keys on** column is the headline: which spine(s) each table's `ORDER_ID` actually resolves in
(verified by `IN (SELECT ORDER_PROC_ID …)` / `IN (SELECT ORDER_MED_ID …)`; one specimen had 42 proc +
20 med = 62 orders).

| table | keys on | rows in one specimen | what it carries |
|---|---|---|---|
| `ORD_PRFLST_TRK` | **both** (all 42 proc + all 20 med) | 62 | Preference-list / order-template provenance: `ORDER_TMPLTE_OTL_I` → `CL_OTL`, `MOD_FROM_OTL_YN` (modified from template?), `ORDER_TEMPLATE_ID` (Beacon treatment-plan OTP only — null here) |
| `ORD_SECOND_SIGN` | **both** (all 62) | 62 | Second-signature workflow: status/requirement, first+second sign instants, signer, reject reason/comment. **All-NULL placeholder here** (§46) — one row per order regardless |
| `CL_ORD_FST_LST_SCH` | **both** (all 62) | 62 | First/last scheduled date+time (split date/time columns, §20) and `LET_EXPIRE_TYPE_C_NAME` review-notice type. **All-NULL placeholder here** (§46) |
| `ORDER_SUMMARY` | **both** (52 of 62) | 53 | `(ORDER_ID, LINE)` → `ORD_SUMMARY`: the human-readable summary sentence built when the order was **signed**. Missing = never signed in this system (see gotcha 3) |
| `ORDER_PENDING` | **both**, med-leaning (6 med + 2 proc orders) | 10 | `(ORDER_ID, LINE)` pend-and-release audit: who pended, when, who released; plus a separate `SH_*` signed-and-held block (nearly empty here — only its `SH_*_PROV_ID` slots carry ids on a few rows) |
| `ORD_SPEC_QUEST` | **proc only** (29/29) | 29 | `(ORDER_ID, LINE)` order-specific questions at signing: `ORD_QUEST_ID` (bare — see gotcha 7), `ORD_QUEST_DATE` (question-*version* date), `ORD_QUEST_RESP`, `ORD_QUEST_CMT`, `IS_ANSWR_BYPROC_YN` |
| `ORD_CLIN_IND` | **proc only** (12/12) | 12 | `(ORDER_ID, LINE)` clinical indication (reason for exam) free text + a comment column that is a provenance stamp here (gotcha 8) |
| `ORDER_REVIEW` | **proc only** (14/14) | 14 | `(ORDER_ID, LINE)` who reviewed the order's result and `REVIEW_ACCEPTED_YN`. Also in the **lab-results** guide's matrix; the workflow mechanics live here |
| `ORDER_READ_ACK` | **proc only** (13/13) | 13 | `(ORDER_ID, CONTACT_DATE_REAL, LINE)` result read/acknowledgment: exact UTC view instant + viewing user. The only table in this guide keyed on an **order contact** (§18; gotcha 4) — the shared `ORDER_STATUS` table (covered elsewhere) is also order-contact-keyed |
| `ORDER_INSTANTIATED` | **proc only** (11/11) | 11 | Parent→child bridge: `ORDER_ID` = the future/standing parent, `INSTNTD_ORDER_ID` = the per-instance child created at release. Both sides are real `ORDER_PROC` rows |
| `ORDER_PARENT_INFO` | **proc only** (all 42) | 42 | Child→parent denormalization: `PARENT_ORDER_ID` (self-referential when no parent), plus the *ordering-context* `PAT_ENC_CSN_ID` / `ORDERING_DTTM` / login+contact department ids — "use the parent's info if one exists, else my own" (per its schema doc) |
| `ORDER_ANATOMICAL_REGION` | **proc only** (imaging) | 10 (4 orders) | `(ORDER_ID, LINE)` → `ANATOMICAL_REGION_C_NAME`; 1–3 region lines per study (e.g. a spine film tagging adjacent regions) — §9 LINE child rows |
| `ORD_PROC_INSTR` | **proc only** | 9 (1 order) | `(ORDER_ID, LINE)` line-chunked SmartText "process instructions" shown in Order Composer at signing (§11; gotcha 10) |
| `ORD_SPECIALTY_SIGNATURES` | **proc only** (imaging) | 1 | `(ORDER_ID, LINE)`: specialties required to *result* the study (`REQ_SPECIALTIES_C_NAME`, reading-physician roles), `NUM_SIG_REQ_BY_SPECIALTY`, `BILLING_SPECIALTY_YN` |
| `DEPT_PAT_CARE_SELECTION` | **med only here** (2) | 2 | `(ORDER_ID, LINE)` department-of-patient-care attribution history: department id, the CSN it was chosen from, selection logic, instant, user. Last `LINE` = current (§35-style collapse onto the tail line) |

**Master-file lookups in this domain** (patient-agnostic): `CL_OTL` (+ single-column `CL_OTL_2`) — order
template / preference-list entry records (`OTL_ID`, `ORDER_DESC`, `DISPLAY_NAME`); `CL_QQUEST` — question
records (`QUEST_ID`, `QUEST_NAME`); `CL_QQUEST_OVTM` — the question's *wording over time*, one row per
question-record contact (`QUEST_ID`, `CONTACT_DATE_REAL`, `QUESTION`) — an overtime/versioned master (§35
current-vs-versions flavor, keyed by §18 decimal contact dates).

**Investigated, deliberately not covered here** (lifecycle-adjacent but owned by other guides):
`ORDER_STATUS` (shared overtime order-contact table — see the medications-and-orders gotcha "ORDER_STATUS
is NOT the medication status field"), `ORDER_SIGNED_PROC`/`ORDER_SIGNED_MED` (procedures / meds guides),
`ORDER_AUTH_INFO` and `ORD_INDICATIONS` (medications-and-orders), `ORDER_MYC_INFO`/`ORDER_MYC_RELEASE`
(MyChart result release — lab-results).

## How they join

All verified against this specimen.

- **Lifecycle table → order spine (the id-space rule).** `ANY.ORDER_ID` joins
  `ORDER_PROC.ORDER_PROC_ID` *or* `ORDER_MED.ORDER_MED_ID` — test both. For the both-space tables a
  `LEFT JOIN` to each spine with `COALESCE` works; for known proc-only tables join `ORDER_PROC` directly.
  From the spine, `PAT_ENC_CSN_ID` reaches the encounter (§2, §3).
- **Template provenance:** `ORD_PRFLST_TRK.ORDER_TMPLTE_OTL_I = CL_OTL.OTL_ID` → `ORDER_DESC`. Verified
  26/26 non-null ids resolve (23 distinct CL_OTL rows — templates are reused across orders).
- **Instantiation:** `ORDER_INSTANTIATED.ORDER_ID` (parent) and `.INSTNTD_ORDER_ID` (child) both resolve
  in `ORDER_PROC` (11/11 each). Every parent here has `FUTURE_OR_STAND = 'F'` and a `STANDING_EXP_DATE`;
  the **child** carries `INSTANTIATED_TIME` and `INSTNTOR_USER_ID`. Parent and child sit in **different
  CSNs**: the parent in the clinic visit where it was signed, the child in the later specimen-collection /
  performing contact.
- **Child → ordering context without walking the bridge:** `ORDER_PARENT_INFO.ORDER_ID = child`,
  `.PARENT_ORDER_ID = parent` (or itself), and its `PAT_ENC_CSN_ID` equals the **parent's** encounter —
  verified on every real parent/child row. 31/42 rows are self-referential (no parent).
- **Questions:** `ORD_SPEC_QUEST.ORD_QUEST_ID = CL_QQUEST.QUEST_ID` (29/29 resolve). The *wording* asked:
  convert `ORD_QUEST_DATE` to a date_real and match `CL_QQUEST_OVTM.(QUEST_ID, CONTACT_DATE_REAL)` —
  29/29 resolve (recipe 4; gotcha 7).
- **Read-ack / review:** `ORDER_READ_ACK.ORDER_ID` and `ORDER_REVIEW.ORDER_ID` → `ORDER_PROC_ID`; both
  cover the same 10 resulted orders here (Lab/Microbiology/Imaging, all Completed). Users via
  `WHO_READ_ACK_EMP_ID` / `REVIEW_USER_ID` → `CLARITY_EMP.USER_ID`.
- **Department of patient care:** `DEPT_PAT_CARE_SELECTION.DPCAR_DEPARTMENT_ID = CLARITY_DEP.DEPARTMENT_ID`
  (2/2) and `DPCAR_PAT_ENC_CSN_ID` → `PAT_ENC.PAT_ENC_CSN_ID` (2/2).
- **Anatomical regions / instructions / summary / pending:** plain `(ORDER_ID, LINE)` child lists (§9)
  under `ORDER_PROC` (regions, instructions) or either spine (summary, pending).

## Gotchas & quirks (chased to *why*)

1. **One `ORDER_ID` space, two spines — never assume which.** `ORD_PRFLST_TRK`, `ORD_SECOND_SIGN`,
   `CL_ORD_FST_LST_SCH`, `ORDER_SUMMARY`, and `ORDER_PENDING` mix med and proc ids in one column; a join
   to `ORDER_PROC` alone silently drops the med rows (and vice versa). *Why:* Chronicles has a single ORD
   master file; the export splits its *attributes* into `ORDER_PROC`/`ORDER_MED` by order type but child
   tables keep the unified key (§41). *Handle:* probe both spines (recipe 1's `side` expression), or
   `LEFT JOIN` both and `COALESCE`.

2. **62-row tables ≠ 62 events: `ORD_SECOND_SIGN` and `CL_ORD_FST_LST_SCH` are always-emit placeholders.**
   Both have exactly one row per order and **every non-key column NULL** in this specimen. *Why:* §46 —
   the exporter emits the companion row unconditionally and populates it only when the feature (second
   signatures; first/last scheduling of recurring orders) was used. *Handle:* `COUNT(*)` says nothing;
   check a payload column (`SEC_SIGN_STATUS_C_NAME`, `DATE_FIRST_ORDEREN`) before claiming the workflow
   occurred. Their genre shape is still worth knowing: second-sign carries a full who/when/why triplet
   (§37) including reject reason and comment.

3. **A missing `ORDER_SUMMARY` row usually means "not signed *here*", not "no data."** The 10 proc orders
   without a summary in one specimen were 9 × `ORDER_CLASS_C_NAME = 'Historical'` plus one clinic-performed
   immunization; every med order and every order signed in Order Composer has one. *Why:* the table's own
   doc says it holds "the summary for an order that has been **signed**" — historical/outside-entered
   orders never went through signing, so no summary sentence was built (§39: absence encodes provenance,
   not emptiness). *Handle:* use summary-absence + `ORDER_CLASS_C_NAME` to separate natively-placed orders
   from imported/historical ones. `LINE` can exceed 1 (a long sentence spills onto continuation lines — §11).

4. **`ORDER_READ_ACK` lives on order contact 2, and near-duplicates `ORDER_REVIEW` with different clocks.**
   Every `CONTACT_DATE_REAL` here ends in `.01` — the *second* contact of the order record (§18), i.e. the
   resulting contact, not the ordering one. For the same order+user, `ORDER_READ_ACK.READ_ACK_ACTUAL_UTC_DTTM`
   is second-precision while `ORDER_REVIEW.REVIEWED_TIME` is the same instant **truncated to the minute**
   (two items recording one event at different precisions; §19's suffix rule — the `_DTTM` carries the
   seconds). *Why:* read/ack tracking is a separate
   "overtime" item pair (ORD 1910/1915 per the schema doc) written by the result-viewing feature, while
   ORDER_REVIEW is the review/accept action list. *Handle:* use READ_ACK for "when was it actually seen,"
   REVIEW for "was it accepted" — and don't treat the 1-minute skew as two events. A review `LINE` with
   **NULL `REVIEW_ACCEPTED_YN`** is a view/review without (yet) an accept (§28 tri-state) — the accepting
   line follows with its own timestamp.

5. **Future/standing orders appear twice — parent and instantiated child — in different encounters.**
   Each `ORDER_INSTANTIATED` row links a signed future order (parent, `FUTURE_OR_STAND='F'`) to the child
   minted when the patient showed up and the order was released (child carries `INSTANTIATED_TIME`,
   sometimes a year-plus of gap). Results, clinical indications, accession numbers, and read/review rows hang off
   the **child**; the ordering provider/encounter story hangs off the **parent**. *Why:* releasing a future
   order creates a fresh ORD record in the release contact (§2/§12 — one clinical intent fanned across
   contacts). *Handle:* `COUNT(*)` on `ORDER_PROC` double-counts these (11 of 42 here are children); walk
   `ORDER_INSTANTIATED` or collapse via `ORDER_PARENT_INFO.PARENT_ORDER_ID`. Standing-order-in-hospital
   chains add a grandparent level via `STAND_HOV_INST_ORD` (documented in `ORDER_INSTANTIATED`'s column
   doc) — **not shipped** in this specimen (§7: expect "no such table", not zero rows).

6. **`ORD_PRFLST_TRK`'s shipped column is a bare id whose schema doc describes a name.** The real column
   is `ORDER_TMPLTE_OTL_I` (numeric OTL ids); `_schema_column` documents `ORDER_TMPLTE_OTL_I_ORDER_DESC`
   ("Description of the procedure"). *Why:* the export dropped the denormalized `_ORDER_DESC` companion
   and what remains is the FK with its name truncated at the join-prefix (§6/§7 — the dropped-companion +
   doc-vs-disk mismatch combo). *Handle:* join `CL_OTL.OTL_ID` for the template description. Population is
   meaningful: rows with an OTL id were picked from a preference list/template; `MOD_FROM_OTL_YN='Y'`
   (5 here) flags the clinician edited it after pulling it; `ORDER_TEMPLATE_ID` is a *different* id space
   (Beacon OTP treatment-plan templates) — null here; expect it populated only with treatment-plan
   (oncology) workflows.

7. **`ORD_SPEC_QUEST.ORD_QUEST_DATE` is the question-*version* date, not when the patient was asked.** All
   rows for one question carry the same old date regardless of order year. The shipped `ORD_QUEST_ID` is
   bare (its doc'd `_QUEST_NAME` companion was dropped — §6). *Why:* the ORD record stores a pointer to the
   question record *as of a master-file contact*; `ORD_QUEST_DATE` is that contact's date, which is exactly
   how you pick the right row of `CL_QQUEST_OVTM` (the wording history). *Handle:* name from `CL_QQUEST`;
   exact prompt wording from `CL_QQUEST_OVTM` via date_real conversion (recipe 4). The order's own date
   comes from the order spine, never from this column. `IS_ANSWR_BYPROC_YN` was 'Y' on all 29 rows here —
   the question was attached/answered through the procedure record rather than ad hoc.

8. **`ORD_CLIN_IND`'s "comment" can be an interface provenance stamp, not clinical text.** Here every lab
   row's `CLIN_IND_CMT_TEXT` reads "Received over interface (…)" with internal message ids, and 10 of the
   11 orders carrying indications are **instantiated children** (gotcha 5). *Why:* the performing system
   echoes the reason-for-exam back over the orders/results interface onto the instance order; the comment
   records that external origin (§44). *Handle:* treat `CLIN_IND_TEXT` as the clinical reason (free text,
   PHI) and the comment as routing metadata; look for indications on the child, not the future parent.

9. **`ORDER_PENDING`'s pending "user" is often not a person.** Several lines here were pended by interface
   and portal actors (an e-prescribing EDI user, a generic MyChart user), the rest by staff users; all were
   **released** by a human — only 1 of 10 lines has the same pend/release user. *Why:* refill requests and patient-initiated requests enter
   as pended (unsigned) orders in the staff workqueue; release = a human taking them to signing. *Handle:*
   read pend→release as a request-triage trail, ordered by `(ORDER_ID, LINE)`. The `SH_*` columns are a
   *different* feature (signed-and-held orders, with their own cosign requirement axis) sharing the table —
   nearly all NULL here (only `SH_AUTH_PROV_ID`/`SH_ORDR_PROV_ID` carry ids on a few rows); don't conflate
   "pended" with "signed and held."

10. **`ORD_PROC_INSTR` is line-chunked SmartText with markup sentinels.** One order, 9 lines: an
    `<!--EPICS-->` opener, paragraph lines, literal `<BR>` rows, `<!--EPICE-->` closer. *Why:* it is the
    procedure master's networked "Process Info" SmartText block, snapshotted onto the order at signing —
    org-authored prep/safety instructions, stored as the §11 line-chunk pattern with HTML-ish markers
    (§45-adjacent: text pretending to be markup). *Handle:* concatenate by `CAST(LINE AS INT)`, strip the
    `<!--EPICS-->`/`<!--EPICE-->` wrapper and render `<BR>` as breaks. It is **config text**, not
    patient-specific instruction — patient instructions live elsewhere (e.g. med sig, AVS).

11. **`ORDER_ANATOMICAL_REGION` fans one study across several regions.** An extremity film or spine study
    carries 2–3 region lines (adjacent/overlapping categories such as a spine segment plus the soft-tissue
    region). *Why:* regions drive image routing/relevance matching, so Epic tags every region the study
    covers (§12). *Handle:* `group_concat` per order; don't treat region rows as separate studies. Only a
    subset of imaging orders is tagged at all (4 of 9 here).

## Unstructured tie-back

No RTF or `Media/` file keys to any table in this domain. The free text is **inline**:
`ORDER_SUMMARY.ORD_SUMMARY` (the sign-time sentence), `ORD_CLIN_IND.CLIN_IND_TEXT` (reason for exam —
PHI-bearing), `ORD_SPEC_QUEST.ORD_QUEST_RESP`/`ORD_QUEST_CMT` (question answers), `ORDER_PENDING.
PENDING_COMMENTS` and the `SH_VERB_ORD_COMMENT` slot (empty here), `ORD_PROC_INSTR` (chunked config
SmartText), and `ORD_SECOND_SIGN.SEC_SIGN_MESSAGE`/`SEC_SIGN_COMMENT` (empty here). Narrative about the
order's clinical content lives in the encounter's notes, reachable only via the order spine's CSN.

## Recipes

```sql
-- 1) Workflow dossier: which lifecycle tables touched each procedure order.
--    (For med orders, run the same EXISTS battery from ORDER_MED.ORDER_MED_ID —
--     the both-space tables will hit; the proc-only ones won't.)
SELECT p.ORDER_PROC_ID AS order_id, p.ORDER_TYPE_C_NAME, p.ORDER_CLASS_C_NAME,
       EXISTS(SELECT 1 FROM ORDER_SUMMARY  s WHERE s.ORDER_ID=p.ORDER_PROC_ID) AS signed_summary,
       EXISTS(SELECT 1 FROM ORDER_PENDING  x WHERE x.ORDER_ID=p.ORDER_PROC_ID) AS pended,
       EXISTS(SELECT 1 FROM ORDER_REVIEW   x WHERE x.ORDER_ID=p.ORDER_PROC_ID) AS reviewed,
       EXISTS(SELECT 1 FROM ORDER_READ_ACK x WHERE x.ORDER_ID=p.ORDER_PROC_ID) AS read_ack,
       EXISTS(SELECT 1 FROM ORD_SPEC_QUEST x WHERE x.ORDER_ID=p.ORDER_PROC_ID) AS questions,
       EXISTS(SELECT 1 FROM ORD_CLIN_IND   x WHERE x.ORDER_ID=p.ORDER_PROC_ID) AS clin_ind
FROM ORDER_PROC p ORDER BY CAST(p.ORDER_PROC_ID AS INT);

-- 2) Future/standing-order instantiation chain: ordering encounter vs release encounter.
SELECT i.ORDER_ID AS parent_id, pp.FUTURE_OR_STAND, pp.PAT_ENC_CSN_ID AS ordering_csn,
       i.INSTNTD_ORDER_ID AS child_id, c.PAT_ENC_CSN_ID AS release_csn, c.INSTANTIATED_TIME
FROM ORDER_INSTANTIATED i
JOIN ORDER_PROC pp ON pp.ORDER_PROC_ID = i.ORDER_ID
JOIN ORDER_PROC c  ON c.ORDER_PROC_ID  = i.INSTNTD_ORDER_ID
ORDER BY CAST(i.ORDER_ID AS INT);

-- 3) Result read/review trail for one order, both ledgers merged.
--    NB: at_dttm is TEXT (§17) — same-day events interleave fine, but don't trust cross-month sorts.
SELECT ORDER_ID, kind, who, at_dttm, accepted FROM (
  SELECT r.ORDER_ID, 'review' AS kind, r.REVIEW_USER_ID_NAME AS who,
         r.REVIEWED_TIME AS at_dttm, r.REVIEW_ACCEPTED_YN AS accepted FROM ORDER_REVIEW r
  UNION ALL
  SELECT ra.ORDER_ID, 'read_ack', ra.WHO_READ_ACK_EMP_ID_NAME,
         ra.READ_ACK_ACTUAL_UTC_DTTM, NULL FROM ORDER_READ_ACK ra)
WHERE ORDER_ID = :order_id
ORDER BY CAST(ORDER_ID AS INT), at_dttm;

-- 4) Order-specific questions with the exact prompt wording the version date points at.
WITH q AS (SELECT ORDER_ID, LINE, ORD_QUEST_ID, ORD_QUEST_RESP,
                  substr(ORD_QUEST_DATE, 1, instr(ORD_QUEST_DATE,' ')-1) AS d
           FROM ORD_SPEC_QUEST),
q2 AS (SELECT *, CAST(substr(d,1,instr(d,'/')-1) AS INT) AS m,
              CAST(substr(substr(d,instr(d,'/')+1),1,
                   instr(substr(d,instr(d,'/')+1),'/')-1) AS INT) AS dy,
              CAST(substr(d,-4) AS INT) AS y FROM q)
SELECT q2.ORDER_ID, cq.QUEST_NAME, v.QUESTION AS prompt, q2.ORD_QUEST_RESP AS response
FROM q2
LEFT JOIN CL_QQUEST cq ON cq.QUEST_ID = q2.ORD_QUEST_ID
LEFT JOIN CL_QQUEST_OVTM v ON v.QUEST_ID = q2.ORD_QUEST_ID
 AND CAST(v.CONTACT_DATE_REAL AS INT) =
     CAST(julianday(printf('%04d-%02d-%02d',q2.y,q2.m,q2.dy)) - julianday('1840-12-31') AS INT)
ORDER BY CAST(q2.ORDER_ID AS INT), CAST(q2.LINE AS INT);

-- 5) Preference-list/template provenance (both id spaces), template resolved via CL_OTL.
SELECT t.ORDER_ID,
       CASE WHEN t.ORDER_ID IN (SELECT ORDER_MED_ID FROM ORDER_MED)
            THEN 'med' ELSE 'proc' END AS side,
       t.ORDER_TMPLTE_OTL_I AS otl_id, o.ORDER_DESC AS template_desc, t.MOD_FROM_OTL_YN
FROM ORD_PRFLST_TRK t
LEFT JOIN CL_OTL o ON o.OTL_ID = t.ORDER_TMPLTE_OTL_I
WHERE t.ORDER_TMPLTE_OTL_I IS NOT NULL
ORDER BY CAST(t.ORDER_ID AS INT);

-- 6) Pend-and-release triage trail (interface/portal pends vs human releases).
SELECT p.ORDER_ID,
       CASE WHEN p.ORDER_ID IN (SELECT ORDER_MED_ID FROM ORDER_MED)
            THEN 'med' ELSE 'proc' END AS side,
       p.LINE, p.USER_ID_NAME AS pended_by, p.PENDED_TIME, p.RELEASED_USER_ID_NAME AS released_by
FROM ORDER_PENDING p ORDER BY CAST(p.ORDER_ID AS INT), CAST(p.LINE AS INT);

-- 7) Anatomical regions per imaging order (one row per study).
SELECT a.ORDER_ID, p.DESCRIPTION,
       group_concat(a.ANATOMICAL_REGION_C_NAME, '; ') AS regions
FROM ORDER_ANATOMICAL_REGION a
JOIN ORDER_PROC p ON p.ORDER_PROC_ID = a.ORDER_ID
GROUP BY a.ORDER_ID ORDER BY CAST(a.ORDER_ID AS INT);

-- 8) Department-of-patient-care attribution history (last LINE = current).
SELECT d.ORDER_ID, d.LINE, dep.DEPARTMENT_NAME, d.DPCAR_SEL_LOGIC_C_NAME,
       d.DPCARE_SEL_INST_UTC_DTTM, d.DPCARE_UPDT_USER_ID_NAME
FROM DEPT_PAT_CARE_SELECTION d
LEFT JOIN CLARITY_DEP dep ON dep.DEPARTMENT_ID = d.DPCAR_DEPARTMENT_ID
ORDER BY CAST(d.ORDER_ID AS INT), CAST(d.LINE AS INT);
```

## Open questions / specimen notes

- **Second-sign and scheduling semantics are unobservable here.** `ORD_SECOND_SIGN` and
  `CL_ORD_FST_LST_SCH` ship as all-NULL placeholders; their value domains (status categories, reject
  reasons, first/last schedule shapes for recurring orders) come from schema docs only. Expect them
  populated in exports with cosign-required verbal orders or recurring/standing schedules.
- **`ORD_SPECIALTY_SIGNATURES` had a single row** (one imaging study requiring the Radiology reading
  role) with `NUM_SIG_REQ_BY_SPECIALTY` and `BILLING_SPECIALTY_YN` NULL — multi-specialty,
  multi-signature shapes unobserved.
- **`DEPT_PAT_CARE_SELECTION` appeared only on the two newest med orders** — consistent with a
  recently-enabled feature (its instants are UTC and late in the record). Whether proc orders get rows,
  and how multi-`LINE` histories accumulate when an ordering provider changes, is unobserved.
- **Proc-only vs both-space classifications are this specimen's evidence**, strong for the both-space
  tables (full 42+20 coverage) but weaker for low-row tables: e.g. `ORD_SPEC_QUEST` *can* in principle
  carry mixture-triggered med questions (`ORD_QUEST_COMP` is documented for IV/TPN components; NULL on
  all 29 rows here). Re-verify the `in_proc`/`in_med` split on a new specimen before relying on it.
- **`ORDER_REVIEW`/`ORDER_READ_ACK` covered exactly the resulted orders reviewed in-system** (10 orders).
  Whether un-acknowledged results leave a placeholder row (they do not here — absence = no recorded view)
  matters for "was this result ever seen?" questions: in this specimen, no row means no recorded
  read/review, but confirm against the In Basket tables before asserting clinical non-review.
- Specimen shape: 62 orders (42 proc, 20 med); 11 future-order instantiations; no standing
  (`FUTURE_OR_STAND='S'`) orders, so the standing/grandparent chain (`STAND_HOV_INST_ORD`) is absent.
