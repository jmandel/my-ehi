# Export shape and quality oddities storyboard

## Purpose

This dive is a field report on export-shape problems in this Epic EHI specimen: joins that look natural but
fail, parent/header rows whose detail is absent, schema pages that disagree with the live TSV, and populated
tables whose rows are mostly shells.

It is not a clinical quality report. A case belongs here only when the export's structure, linkage, schema,
or payload availability is the problem being explained.

## Reader

An informaticist or analyst asking: "What assumptions would break if I tried to reconstruct this record from
the exported tables?"

## Case lanes

- **Payload/detail gaps**: a header, pointer, or supplement row survives, but the expected detail rows,
  media file, note body, or payload fields are missing.
- **Join/key traps**: a field name suggests a join target, but the values belong to another key domain, are
  blank, or require optional rather than inner joins.
- **Schema/doc mismatch**: the Epic schema HTML documents a column shape that the actual TSV does not ship.

## Page shape

1. **Opening thesis**: the artifact focuses on concrete export-shape failures and table/model oddities.
2. **Problem split**: three lanes separate missing payload, misleading joins, and schema drift.
3. **Case register**: each card states the failed expectation, shows a raw check snippet, and gives the safe
   interpretation.
4. **Rulebook**: compact working rules for future analysis of this export.

## Evidence rule

Each case needs a raw check: table counts, columns, joined row counts, sample IDs, or filesystem payload
checks. The prose may interpret the cause, but the card must show what was actually observed.
