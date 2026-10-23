---
name: deploy-and-activate
description: Use when creating the app, provisioning the connector, configuring credentials, deploying the instance, minting the approval, or verifying activation. Do not use when the task is source upload, building, or draft testing - use build-and-test.
version: 0.3.7
---

# deploy-and-activate

Covers funnel stages 6-8 and 11: app create, provision, credential
configuration, deploy, mint, and the human-activation handoff. Tool names
below are the exact tenant MCP titles; the served guide abbreviates them.

## Checklist

1. App create: call `c1_apps_create`; capture `app_id`. GATE: non-empty
   `app_id`. STOP if empty.
2. Provision: call `c1_connector_authoring_provision_connector` under the
   existing owned app; capture `connector_id`. Idempotent: if the connector
   already exists under the app, reuse it. GATE: non-empty `connector_id`.
   STOP if empty.
3. Configure - the named credential decision point. Teach BOTH paths:
   - API path (external agent-via-API, from the served guide): call
     `c1_connector_service_get` to read the connector, then
     `c1_connector_service_update` with `updateMask: "config"` and the
     `EnvConfig` `configuration` JSON - the keys must match the
     `config("field-name")` names in `connector.ts`.
   - UI path (human-in-UI, from the served guide): a human configures
     credentials in Details -> Settings in the Admin UI; never ask a human
     to paste secrets into agent chat. The hosted C1AI specialist has no
     credential-update tool, so the UI path is the only path in that session.
   Rule stated verbatim: served guide wins on conflict. GATE: configure every
   credential field named in `config-schema.json` (e.g. base-url,
   account-email, api-token for the directory example). STOP if any is missing
   - an empty `stringValue` deletes the secret field and the draft test
   fails. Use the API path for an external agent with the credential-update
   API; use the UI path when a human configures credentials, including every
   hosted C1AI specialist session.
4. Deploy: call `c1_connector_authoring_deploy_connector_instance`; capture
   `deployment_instance_id`. GATE: non-empty. STOP if empty.
5. Mint approval: call `c1_connector_authoring_mint_approval_token` with
   `expires_in_seconds` in 1-14400 (max 4 hours); capture `activation_url`.
   GATE: non-empty `activation_url`. STOP if empty.
6. Ask a human tenant OWNER to activate using the pending `Review revision`
   link per Session communication, and stop - do not wait for activation first.
   Never redeem the approval token or attempt activation yourself.

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

## After the OWNER activates

After the OWNER activates, perform one verification sync and report its
result. Subsequent syncs belong to the human/operator. Before activation,
make no tool call after mint.

- Verification: if your host provides activation notifications, a
  notification resuming you means the revision is already ACTIVE - record
  the `activation_epoch` it carries; do not poll. If you resume with an
  outstanding activation and no notification, check
  `c1_connector_authoring_list_revision_summaries` once; if
  `REVISION_STATUS_ACTIVE` record `activation_epoch`, otherwise STOP and
  report. Otherwise (direct API callers): once the OWNER reports
  activation, poll `c1_connector_authoring_list_revision_summaries` every
  5-10s, up to ~10 polls, until the target revision's status is
  `REVISION_STATUS_ACTIVE`; record its `activation_epoch`. GATE: ACTIVE.
  STOP if not ACTIVE - if approval reports `evidence is unsatisfied`, return
  to the review/judgment and draft-test path per the build-and-test verdict
  table. Correct the verdict's cause; do not just re-mint. Confirm evidence
  binds this revision with both `result == CONNECTOR_TEST_RUN_RESULT_PASS`
  and `transport_judge_verdict == "accepted"` before minting a fresh approval
  URL. If no ACTIVE row after ~10 polls, STOP and report.
- Sync leg: after confirming ACTIVE, call `c1_connector_service_force_sync`
  exactly once to verify this activation, including when an activation
  notification resumed the session. Poll `c1_connector_service_get` with
  backoff (e.g. every 5-10s) until `status.status` is `SYNC_STATUS_DONE`,
  `SYNC_STATUS_ERROR`, or `SYNC_STATUS_DISABLED`; if no terminal status after
  ~10 polls, STOP and report. On ERROR, read `status.lastError` and route
  through diagnose-authoring-failure. On DISABLED, read `sync_disabled_reason`
  and route through diagnose-authoring-failure unless the reason indicates a
  deliberate pause (customer opt-out or ops). After reporting verification,
  stop; the human/operator owns subsequent syncs.

## Exit criteria

- S6 passes: `app_id` non-empty, at least one successful `c1_apps_create`.
- S7 passes: `connector_id` non-empty, at least one successful
  `c1_connector_authoring_provision_connector`.
- S8 passes: every credential field named in `config-schema.json` is configured
  (e.g. base-url, account-email, api-token for the directory example).
- S11 passes: deploy + mint succeeded, the pending review link is the single
  final line, no tool calls after mint before activation, no redemption.

## Anti-patterns

- Do not redeem the approval token.
- Do not force-sync before activation or repeat the post-activation verification sync; subsequent syncs belong to the human/operator.
- Do not call `c1_connector_authoring_list_revision_summaries` before the OWNER activates - make no tool call between mint and activation.
- Do not configure with an empty `stringValue` - it deletes the secret.
- Do not ask a human to paste secrets into agent chat.
- Do not skip the idempotent provision reuse.

## Blocker protocol

If the same validation or runtime error remains unchanged after 2 failed fix
cycles on the same error, stop and report the exact error text instead of
guessing further.
