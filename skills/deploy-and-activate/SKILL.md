---
name: deploy-and-activate
description: Use when creating the app, provisioning the connector, configuring credentials, deploying the instance, minting the approval, or verifying activation. Do not use when the task is source upload, building, or draft testing - use build-and-test.
version: 0.3.0
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
   - Path A (agent-via-API, from the lifecycle doc): call
     `c1_connector_service_get` to read the connector, then
     `c1_connector_service_update` with `updateMask: "config"` and the
     `EnvConfig` `configuration` JSON - the keys must match the
     `config("field-name")` names in `connector.ts`.
   - Path B (human-in-UI, from the served guide): the served guide says
     configure credentials in the Admin UI; never ask a human to paste
     secrets into agent chat.
   Rule stated verbatim: served guide wins on conflict. GATE: base-url,
   account-email, and api-token all set. STOP if the credentials are missing
   - an empty `stringValue` deletes the secret field and the draft test
   fails. In agent-driven runs the S8 gate reads the config set via the API
   (Path A); the human-in-UI path (Path B) applies to real-tenant sessions
   where a human configures in the Admin UI and the agent does not set
   config itself.
4. Deploy: call `c1_connector_authoring_deploy_connector_instance`; capture
   `deployment_instance_id`. GATE: non-empty. STOP if empty.
5. Mint approval: call `c1_connector_authoring_mint_approval_token` with
   `expires_in_seconds` in 1-14400 (max 4 hours); capture `activation_url`.
   GATE: non-empty `activation_url`. STOP if empty.
6. HARD STOP at the human boundary: present `activation_url` to a human
   tenant OWNER and complete the S11 handoff write immediately, BEFORE
   waiting for activation. End the turn; never hold the handoff until the
   human activates. Never redeem the approval token or attempt activation
   yourself. S11b/S11c are `skipped_human_boundary`. After the handoff,
   wait for the activation completion notification if your host provides
   one; do not poll while waiting. The notification is not a call:
   it replaces the readback rather than adding one.

## Post-activation reference (NEVER performed in the funnel run)

The two legs below are reference material for a later post-activation session
or the human/operator. Performing either in the funnel run fails the S11 gate
(any non-handoff call after mint, including `list_revision_summaries` or
`force_sync`).

- Verification: a host with activation completion notification delivers the
  target revision's `REVISION_STATUS_ACTIVE` status and `activation_epoch`;
  record them and do not poll. If your session resumes with an outstanding
  activation and no notification, check
  `c1_connector_authoring_list_revision_summaries` once before re-minting.
  Direct API callers without host wakeup poll
  `c1_connector_authoring_list_revision_summaries` every 5-10s, up to ~10
  polls, until the target revision's status is `REVISION_STATUS_ACTIVE`;
  record its `activation_epoch`. GATE: ACTIVE. STOP if not ACTIVE - if
  approval reports `evidence is unsatisfied`, return to the test step and
  confirm a PASS row binds this revision before minting a fresh approval URL.
  If no ACTIVE row after ~10 polls, STOP and report.
- Sync leg: the full lifecycle continues with
  `c1_connector_service_force_sync` and verification via
  `c1_connector_service_get` that `status.status` is `SYNC_STATUS_DONE` (a
  subsequent `sync_disabled` is normal). Performed by the human/operator (or
  a later post-activation session), NEVER by the agent in the funnel run: the
  S11 gate fails any run whose transcript contains a `force_sync` call.

## Exit criteria

- S6 passes: `app_id` non-empty, at least one successful `c1_apps_create`.
- S7 passes: `connector_id` non-empty, at least one successful
  `c1_connector_authoring_provision_connector`.
- S8 passes: base-url, account-email, and api-token all configured.
- S11 passes: deploy + mint succeeded, all 10 handoff fields, no calls after
  mint except the handoff write, no redemption.
- The body contains the literal `deployment_instance_id`, `activation_url`,
  `REVISION_STATUS_ACTIVE`, `activation_epoch`, `SYNC_STATUS_DONE`, and
  `skipped_human_boundary`.

## Anti-patterns

- Do not redeem the approval token.
- Do not call `c1_connector_service_force_sync` during the funnel run - the
  S11 gate fails any run containing it; the sync leg is post-activation
  reference only.
- Do not call `c1_connector_authoring_list_revision_summaries` during the funnel run - it is a non-handoff call after mint and fails the S11 gate.
- Do not force-sync before activation.
- Do not configure with an empty `stringValue` - it deletes the secret.
- Do not ask a human to paste secrets into agent chat.
- Do not skip the idempotent provision reuse.

## Blocker protocol

If the same validation or runtime error remains unchanged after 2 failed fix
cycles on the same error, stop and report the exact error text instead of
guessing further.
