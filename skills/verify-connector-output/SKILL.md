---
name: verify-connector-output
description: Use when verifying sync status, counts and principal type shapes after owner activation, and requesting an owner spot-check. Per-record resolution and ID stability are not verified by count-only tools. Do not use when diagnosing failed syncs or changing a live connector - use diagnose-authoring-failure or update-and-rollback.
version: 0.1.9
---

# verify-connector-output

Post-sync verification for an activated authored connector. Runs only after
the OWNER has activated the connector. Tool names below are exact tenant MCP
titles. Stage equivalence: post-owner activation output checks = VERIFY.

## Evidence grounding

Follow the evidence-grounding rule in `author-in-app-connector` (Session communication).

## Checklist

1. Read the connector: call `c1_connector_service_get`; confirm
   `status.status` is `SYNC_STATUS_DONE` (a subsequent `sync_disabled` is
   normal for authored connectors). GATE: DONE. STOP on `SYNC_STATUS_ERROR`:
   read `status.lastError` and route through `diagnose-authoring-failure`.
   If `SYNC_STATUS_RUNNING`, poll with backoff (every 5-10s) until DONE,
   ERROR, or DISABLED; if no terminal status after ~10 polls, STOP and report.
   For `SYNC_STATUS_DISABLED`, read `sync_disabled_reason`. A data-anomaly
   auto-pause (reason starting `Sync paused due to significant drop in sync data`)
   needs investigation of counts and the drop reason. A deliberate customer/ops
   pause is normal; an empty or unexpected reason/status routes to diagnosis.
2. Counts: call `c1_connector_sync_diagnostics_service_get_sync_status` and
   read `live_counts`; use `c1_connector_sync_diagnostics_service_get_sync_history`
   to select completed syncs and `c1_connector_sync_diagnostics_service_compare_sync_stats`
   to compare their aggregate counts. The draft test's `shape_summary` has
   resource, entitlement, and grant counts by resource type, but is bounded
   sample evidence, not the full production inventory. `c1_connector_service_get`
   is status evidence, not count evidence. GATE: returned counts are consistent
   with the intended scope and observed live API totals where available.
   Report the actual counts and sampling limits; if no comparable live totals
   were returned, count parity is NOT VERIFIED. Never assert seed-list parity.
3. Type-level grant wiring: read the draft-test `shape_summary` from
   `c1_connector_authoring_get_test_run_evidence`. Compare each entitlement
   shape's `grant_principal_resource_types` with emitted resource types and
   counts by type. GATE: principal types have corresponding emitted types;
   investigate missing/zero types in context of bounded sampling. This proves
   types and counts only, not that every grant principal references an emitted
   resource or that each entitlement ID resolves. These tools do not enumerate
   per-record grants/principals. Report per-record resolution as NOT VERIFIED
   and request an owner spot-check. C1 permits grants with unemitted principals
   and skips them at uplift; a PASS or successful sync does not prove resolution.
4. ID stability: do not trigger another sync here. Compare counts/shapes from
   the single post-activation verification sync with the next human/operator-run
   completed sync using the diagnostics above, when available. Aggregate
   stability is not ID stability: no returned per-record IDs means ID stability
   is NOT VERIFIED, even if counts match. Ask the owner to compare specific
   resource/entitlement IDs across those syncs; if there is no later sync,
   report the comparison pending and ID stability NOT VERIFIED.
5. Owner UI spot-check: ask the owner to open
   `/admin/connectors/authoring/<catalog_id>` on the product base URL and check
   expected resources, memberships/grants, and representative IDs. The legacy
   `/admin/connector/<catalog_id>/<app_id>/<connector_id>` alias renders the authored
   connector view when authoring is enabled. The in-app agent has no browser
   tool: report the owner check pending until the owner returns observations;
   never claim to have opened or verified the UI yourself.

Investigate empty or unexpected results; never invent data to make a demo appear complete.

## Exit criteria

- Sync status and actual returned counts are reported with scope/sampling limits.
- Principal types are checked against emitted resource types and counts by type.
- Per-record resolution and ID stability are explicitly NOT VERIFIED unless
  separately evidenced by an owner spot-check, identified as owner-reported.
- The owner UI spot-check is requested; pending checks are not agent PASS gates.

## Anti-patterns

- Never invent data to make a demo appear complete.
- Do not infer per-record resolution or stable IDs from counts or type shapes.
- Do not run this before the OWNER activates the connector.
- Do not call `c1_connector_service_force_sync` here; the one verification sync
  belongs to deploy-and-activate / update-and-rollback, and subsequent syncs belong to the human/operator.

## Blocker protocol

- Track validation/runtime FAILs on one revision line (a draft and its successive source/build revisions); stop after 3 consecutive FAILs. Only a verified PASS ends that FAIL streak.
- Also stop as soon as any error class recurs, even when the text changes. Classify by underlying cause, not message text: the same field failing extraction with rephrased messages is one class; an auth failure and a schema failure are different classes. Symptom patches, re-uploads, fresh run/revision IDs, and stage changes do not reset tracking; abandoning the draft and creating a fresh one does not reset tracking for the same underlying failure.
- Before any fix, grep the staged SDK declarations (including `runtime.d.ts`) for every field a diagnostic names; read its type and surrounding contract. If unavailable or ambiguous, stop rather than guess.
- At the stop, report the error class, exact latest error text, failed attempts, declaration evidence, and blocker; do not retry or patch past it.
