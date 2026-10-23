---
name: author-in-app-connector
description: Use when driving the full in-app connector authoring funnel end to end, from guide read through the human-activation handoff. Do not use when you are already mid-funnel and only need one stage's procedure - invoke the stage skill directly.
version: 0.3.10
---

# author-in-app-connector

The 12-step funnel as the S0-S11 checklist. One numbered item per stage; every
gate is a pass/fail check you confirm explicitly. Keep IDs in tool calls,
using the response of the step that produces each ID - never guess or reuse
one from a previous run. Tool names below are the exact tenant MCP titles;
the served guide abbreviates them (e.g. `get_authoring_guide` for
`c1_connector_authoring_get_authoring_guide`).

## Checklist

0. S0 guide read: call `c1_connector_authoring_get_authoring_guide` (no
   arguments) and read the served guide. STOP if it errors.
1. S1 draft: call `c1_connector_authoring_create_draft`; extract `catalog_id`
   and `draft_id`. STOP if either is empty.
   Before S2: invoke `write-connector-source` for a minimal four-file skeleton
   (connector.ts, config-schema.json, runtime-schema.json, capabilities.json)
   plus the frozen openapi.json and reviewed-ops.json. Declare exactly one
   projection with `output_slice` and `resource_type`, backed by one confirmed
   resource read; match it in connector.ts and capabilities.json.
   Build and draft-test this skeleton first; defer remaining resource types
   to the expand loop after the first green draft test.
2. S2 upload: hosted sessions use the storage-to-draft source transfer as the
   primary path per `build-and-test`; record the returned source digest.
   Do not route staged bytes through conversation or presigned PUTs in code mode.
   External/BYO path: `wc -c` each source file, call
   `c1_connector_authoring_create_draft_source_upload` with the complete file list,
   PUT each file to its `upload_targets` URL with `required_headers` verbatim,
   then `c1_connector_authoring_finalize_draft_source_upload`.
   STOP if transfer fails, any PUT is not 200, or finalization fails.
   For hosted storage transfer, `upload_id` is N/A; retain the returned source
   digest in tool context instead. Never fabricate an upload ID.
3. S3 required source files: call `c1_connector_authoring_get_draft`; all
   four `required_source_files` (connector.ts, config-schema.json,
   runtime-schema.json, capabilities.json) must be true. STOP if any is
   false.
   S3b: follow build-and-test's hosted-only review; reads are GET-only without it; source edits invalidate review.
4. S4 build: call `c1_connector_authoring_build_bundle`; extract `run_id`.
   STOP if empty.
5. S5 build result: wait for the completion notification if your host provides
   one; do not poll while waiting. If your session resumes with an outstanding
   dispatch and no completion notification, check `get_run` once before
   re-dispatching. Otherwise (direct API callers): poll
   `c1_connector_authoring_get_run` with `run_id` every 5-10s, up to ~10 polls.
   GATE: `RUN_STATE_SUCCEEDED`; extract the immutable
   `revision_id`. STOP on failure - fix source; if the source changed,
   re-run from S2 (re-upload) with a fresh `run_id`, otherwise re-run from
   the failing step per build-and-test.
6. S6 app: call `c1_apps_create`; extract `app_id`. STOP if empty.
7. S7 provision: call `c1_connector_authoring_provision_connector` under the
   app; extract `connector_id`. STOP if empty.
8. S8 credentials: configure every credential field named in
   `config-schema.json` (e.g. base-url, account-email, api-token for the
   directory example; see deploy-and-activate). STOP if any is missing.
9. S9 draft test: call `c1_connector_authoring_run_draft_test_sync`; extract
   `test_run_id`. STOP if empty.
10. S10 evidence: wait for the completion notification if your host provides
    one; do not poll while waiting. If your session resumes with an outstanding
    dispatch and no completion notification, check `get_test_run_evidence` once
    before re-dispatching. Otherwise (direct API callers): poll
    `c1_connector_authoring_get_test_run_evidence` with
    `(catalog_id, revision_id, test_run_id)` every 5-10s, up to ~10 polls.
    GATE: `result == CONNECTOR_TEST_RUN_RESULT_PASS` for S10. STOP if FAIL -
    fix source; if the source changed, re-run from S2 (re-upload) with a FRESH
    `test_run_id`, otherwise re-run from the failing step per build-and-test.
    Before S11 deploy or mint, the same durable evidence must also report
    `transport_judge_verdict == "accepted"`. STOP on any other or missing
    verdict and follow the build-and-test verdict table; PASS alone is not enough.
    External-provenance drafts receive `owner_judgment_required` and stop at
    S10 until human evidence acceptance ships. Report the durable evidence
    status in prose with display-name links; do not deploy or mint. Retesting
    or re-upload does not change attribution.
    Expand loop: only after the skeleton passes this gate, add the remaining
    confirmed resource types incrementally via `write-connector-source`.
    For each increment, update capabilities and reviewed operations together,
    re-upload from S2, re-review changed inputs, rebuild, and rerun S9-S10.
    Follow the same failure/verdict stop rules on each revision; reach S11
    only when the confirmed scope has matching green evidence.
11. S11 handoff discipline: call
    `c1_connector_authoring_deploy_connector_instance` (extract
    `deployment_instance_id`), then
    `c1_connector_authoring_mint_approval_token` (extract `activation_url`),
    then present the pending review link per Session communication and STOP.
    STOP if the deployment ID or activation URL is empty.

## Session communication

- Keep IDs in tool calls, not chat. Refer to objects by display name with a
  markdown link when available, not by raw ID.
- Report progress and status in prose. Use tables only for user-facing data,
  such as proposed operations or test counts, never for raw-ID handoffs.
- Show a handoff link only when a human must act now: `Configure credentials`
  while credentials are unsaved, or `Review revision` while activation is
  pending. Never show a handoff link merely for navigation.
- Put the handoff link on a single trailing line at the very end of the output,
  after all prose and tables; never inline or inside a table. Use the returned
  URL with the action label as markdown link text; never invent a URL.
- Never re-print activation or review URLs after activation.

## Routing

| Stage | Route |
|---|---|
| 0 | `read-authoring-contract` |
| 1 (create_draft) | ORCHESTRATOR-OWNED - perform directly |
| write (source authoring, before S2) | `write-connector-source` |
| 2-5, 9-10 | `build-and-test` |
| 6-8, 11 | `deploy-and-activate` |
| pre-1 design (net-new provider) | `design-access-model` |
| pre-1 spec sourcing | `source-openapi-spec` |
| post-activation verification | `verify-connector-output` |
| update / rollback of an active connector | `update-and-rollback` |
| failure diagnosis (any stage) | `diagnose-authoring-failure` |

Direct invocation of a stage skill is allowed; the router alone is not
trusted to recover mid-funnel.

## Pre-S1 checklist

Net-new provider: before S1, run both pre-1 skills - `source-openapi-spec`
(source the spec, IAM go/no-go) then `design-access-model` (access model).

## Human boundary

After S11's deploy + mint, ask a human tenant OWNER to activate using the
pending `Review revision` link as the single final line per Session
communication, and STOP. Never redeem the approval token.
Do not call `force_sync` or poll `REVISION_STATUS_ACTIVE` before the OWNER
activates. If an activation notification later resumes you, the revision is
already ACTIVE: record its `activation_epoch`, then run exactly one
verification sync per deploy-and-activate. Direct API callers verify once
the OWNER reports activation. After this verification, the human/operator
owns subsequent syncs.

## Exit criteria

- S0-S11 all pass per the stage table above.
- S11 handoff: deploy + mint succeeded, the pending review link is the single
  final line, no tenant/MCP tool calls after mint before activation, no redemption.
  Host-required file/terminal writes (the machine handoff artifact and run
  completion) are excepted.

## Anti-patterns

- Do not skip a stage.
- Do not fabricate IDs or URLs.
- Do not redeem the approval token.
- Do not call `force_sync` before activation or repeat the post-activation verification sync; subsequent syncs belong to the human/operator.
- Do not present the review link before deploy + mint.

## Blocker protocol

If the same validation or runtime error remains unchanged after 2 failed fix
cycles on the same error, stop and report the exact error text instead of
guessing further.
