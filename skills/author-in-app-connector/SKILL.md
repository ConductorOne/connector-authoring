---
name: author-in-app-connector
description: Use when driving the full in-app connector authoring funnel end to end, from guide read through the human-activation handoff. Do not use when you are already mid-funnel and only need one stage's procedure - invoke the stage skill directly.
version: 0.1.0
---

# author-in-app-connector

The 12-step funnel as the S0-S11 checklist. One numbered item per stage; every
gate is a pass/fail check you confirm explicitly. Record every ID in the
handoff table (below) after every step, filled from the tool response of the
step that produces it - never guessed or reused from a previous run. Tool
names below are the exact tenant MCP titles; the served guide abbreviates them
(e.g. `get_authoring_guide` for `c1_connector_authoring_get_authoring_guide`).

## Checklist

0. S0 guide read: call `c1_connector_authoring_get_authoring_guide` (no
   arguments) and read the served guide. STOP if it errors.
1. S1 draft: call `c1_connector_authoring_create_draft`; extract `catalog_id`
   and `draft_id`. STOP if either is empty.
2. S2 upload: `wc -c` each source file, call
   `c1_connector_authoring_create_draft_source_upload` with the file list,
   PUT each file to its `upload_targets` URL with `required_headers`
   verbatim, then `c1_connector_authoring_finalize_draft_source_upload`.
   STOP if any PUT is not 200.
3. S3 required source files: call `c1_connector_authoring_get_draft`; all
   four `required_source_files` (connector.ts, config-schema.json,
   runtime-schema.json, capabilities.json) must be true. STOP if any is
   false.
4. S4 build: call `c1_connector_authoring_build_bundle`; extract `run_id`.
   STOP if empty.
5. S5 build result: poll `c1_connector_authoring_get_run` with `run_id` until
   terminal. GATE: `RUN_STATE_SUCCEEDED`; extract the immutable
   `revision_id`. STOP on failure - fix source; if the source changed,
   re-run from S2 (re-upload) with a fresh `run_id`, otherwise re-run from
   the failing step per build-and-test.
6. S6 app: call `c1_apps_create`; extract `app_id`. STOP if empty.
7. S7 provision: call `c1_connector_authoring_provision_connector` under the
   app; extract `connector_id`. STOP if empty.
8. S8 credentials: configure base-url, account-email, and api-token (see
   deploy-and-activate). STOP if any credential is missing.
9. S9 draft test: call `c1_connector_authoring_run_draft_test_sync`; extract
   `test_run_id`. STOP if empty.
10. S10 evidence: poll `c1_connector_authoring_get_test_run_evidence` with
    `(catalog_id, revision_id, test_run_id)` until the durable row exists.
    GATE: `result == CONNECTOR_TEST_RUN_RESULT_PASS` (the PASS enum value;
    the eval fixture records the string `"PASS"`). STOP if FAIL - fix
    source; if the source changed, re-run from S2 (re-upload) with a FRESH
    `test_run_id`, otherwise re-run from the failing step per build-and-test.
11. S11 handoff discipline: call
    `c1_connector_authoring_deploy_connector_instance` (extract
    `deployment_instance_id`), then
    `c1_connector_authoring_mint_approval_token` (extract `activation_url`),
    then write the handoff table and STOP. STOP if either ID is empty.

## Handoff table

Re-emit after every step, filled from the tool response of the step that
produces it:

| field | value |
|---|---|
| catalog_id | |
| draft_id | |
| upload_id | |
| run_id | |
| revision_id | |
| app_id | |
| connector_id | |
| test_run_id | |
| deployment_instance_id | |
| activation_url | |

## Routing

| Stage | Route |
|---|---|
| 0 | `read-authoring-contract` |
| 1-2 (create_draft, upload) | ORCHESTRATOR-OWNED - perform directly |
| 3-5, 9-10 | `build-and-test` |
| 6-8, 11 | `deploy-and-activate` |
| design/spec/write/verify/update/diagnose (not yet shipped) | follow the served guide |

Direct invocation of a stage skill is allowed; the router alone is not
trusted to recover mid-funnel.

## Human boundary

After S11's deploy + mint, present `activation_url` to a human tenant OWNER
and STOP. Never redeem the approval token, never poll `REVISION_STATUS_ACTIVE`,
never call `force_sync` - S11b/S11c are `skipped_human_boundary`.

## Exit criteria

- S0-S11 all pass per the stage table above.
- S11's handoff-discipline gate passes: all 10 handoff fields, no calls after
  mint except the handoff write, no redemption.
- The body contains the literal `skipped_human_boundary` and all 10 handoff
  field names.

## Anti-patterns

- Do not skip a stage.
- Do not fabricate handoff values.
- Do not redeem the approval token.
- Do not call `force_sync` at any point in the funnel run.
- Do not write the handoff before deploy + mint.

## Blocker protocol

If the same validation or runtime error remains unchanged after 2 failed fix
cycles on the same error, stop and report the exact error text instead of
guessing further.
