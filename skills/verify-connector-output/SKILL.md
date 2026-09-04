---
name: verify-connector-output
description: Use when verifying a post-activation connector's sync output: resource/entitlement/grant counts, grant wiring, ID stability across re-sync, and the UI spot-check. Do not use when updating or rolling back a live connector - use update-and-rollback; do not use when diagnosing a failed build, draft test, or sync - use diagnose-authoring-failure.
version: 0.1.0
---

# verify-connector-output

Post-sync verification for an activated authored connector. Runs in a
post-activation session - never during the funnel run. Tool names below are
the exact tenant MCP titles.

## Checklist

1. Read the connector: call `c1_connector_service_get`; confirm
   `status.status` is `SYNC_STATUS_DONE` (a subsequent `sync_disabled` is
   normal for authored connectors). GATE: DONE. STOP if the status row
   reports an error - read `status.lastError` and route through
   diagnose-authoring-failure. If `status.status` is `SYNC_STATUS_RUNNING`,
   poll with backoff (e.g. every 5-10s) until DONE or ERROR; if no
   DONE/ERROR after ~10 polls, STOP and report. `SYNC_STATUS_DISABLED` is
   normal (see above); any other unexpected status value routes through
   diagnose-authoring-failure.
2. Counts: inspect the resource, entitlement, and grant counts for the
   intended scope. Assert count parity against the live tenant API, not
   against a seed list - the live product may own extra rows (default
   users, bootstrap objects). GATE: counts match the intended scope.
3. Grant wiring: verify that every grant principal references an emitted resource
   and every grant entitlement ID references an emitted entitlement. GATE: no
   dangling principal or entitlement ID.
4. ID stability: re-sync and confirm the emitted resource and entitlement
   IDs are stable across the re-sync - no churn in identity fields.
   GATE: IDs unchanged.
5. UI spot-check: open `/admin/connector/<catalog_id>/<app_id>/<connector_id>`
   on the product base URL and confirm the connector's resources and grants
   appear. GATE: resources and grants visible.

Investigate empty or unexpected results; never invent data to make a demo appear complete.

## Exit criteria

- `c1_connector_service_get` reports `SYNC_STATUS_DONE` (a subsequent
  `sync_disabled` is normal).
- Resource, entitlement, and grant counts match the intended scope.
- Every grant principal references an emitted resource; every grant
  entitlement ID references an emitted entitlement.
- IDs are stable across a re-sync.
- The UI spot-check at `/admin/connector/<catalog_id>/<app_id>/<connector_id>`
  shows the connector's resources and grants.
- The body contains the literals `SYNC_STATUS_DONE`, `sync_disabled`,
  `ID stability`, and `/admin/connector/`.

## Anti-patterns

- Never invent data to make a demo appear complete - investigate empty or
  unexpected results instead.
- Do not assert fixture counts as the expected counts; query the live API
  for count parity.
- Do not run this during the funnel run - it is a post-activation session
  skill.
- Do not skip the grant-wiring check because counts look right.

## Blocker protocol

If the same validation or runtime error remains unchanged after 2 failed
fix cycles on the same error, stop and report the exact error text instead
of guessing further.
