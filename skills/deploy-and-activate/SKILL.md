---
name: deploy-and-activate
description: Use when creating the app, provisioning the connector, configuring credentials, deploying the instance, minting the approval, or verifying activation. Do not use when the task is source upload, building, or draft testing - use build-and-test.
version: 0.3.4
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
   fails. Use Path A when you configure through the API; Path B applies
   when a human configures in the Admin UI and you do not set config
   yourself.
4. Deploy: call `c1_connector_authoring_deploy_connector_instance`; capture
   `deployment_instance_id`. GATE: non-empty. STOP if empty.
5. Mint approval: call `c1_connector_authoring_mint_approval_token` with
   `expires_in_seconds` in 1-14400 (max 4 hours); capture `activation_url`.
   GATE: non-empty `activation_url`. STOP if empty.
6. Present `activation_url` to a human tenant OWNER, record the handoff
   table, and stop - do not wait for activation first. Never redeem the
   approval token or attempt activation yourself.

## After the OWNER activates

After the OWNER activates, report the verification result below. Production
sync belongs to the human/operator, not the authoring session. Before
activation, make no call after mint other than the handoff write.

- Verification: if your host provides activation notifications, a
  notification resuming you means the revision is already ACTIVE - record
  the `activation_epoch` it carries; do not poll or force-sync in this
  authoring session. If you resume with an
  outstanding activation and no notification, check
  `c1_connector_authoring_list_revision_summaries` once; if
  `REVISION_STATUS_ACTIVE` record `activation_epoch`, otherwise STOP and
  report. Otherwise (direct API callers): once the OWNER reports
  activation, poll `c1_connector_authoring_list_revision_summaries` every
  5-10s, up to ~10 polls, until the target revision's status is
  `REVISION_STATUS_ACTIVE`; record its `activation_epoch`. GATE: ACTIVE.
  STOP if not ACTIVE - if approval reports `evidence is unsatisfied`, return
  to the test step and confirm a PASS row binds this revision before minting
  a fresh approval URL. If no ACTIVE row after ~10 polls, STOP and report.
- Sync leg: do not call `c1_connector_service_force_sync` in the authoring
  session, even if a notification resumed it. The human/operator runs it
  after the OWNER activates, then verifies with `c1_connector_service_get`
  that `status.status` is `SYNC_STATUS_DONE` (a subsequent `sync_disabled`
  is normal).

## Exit criteria

- S6 passes: `app_id` non-empty, at least one successful `c1_apps_create`.
- S7 passes: `connector_id` non-empty, at least one successful
  `c1_connector_authoring_provision_connector`.
- S8 passes: base-url, account-email, and api-token all configured.
- S11 passes: deploy + mint succeeded, all 10 handoff fields, no calls after
  mint except the handoff write, no redemption.

## Anti-patterns

- Do not redeem the approval token.
- Do not call `c1_connector_service_force_sync` in the authoring session; the human/operator runs it after the OWNER activates.
- Do not call `c1_connector_authoring_list_revision_summaries` before the OWNER activates - after mint, the only call is the handoff write.
- Do not configure with an empty `stringValue` - it deletes the secret.
- Do not ask a human to paste secrets into agent chat.
- Do not skip the idempotent provision reuse.

## Blocker protocol

If the same validation or runtime error remains unchanged after 2 failed fix
cycles on the same error, stop and report the exact error text instead of
guessing further.
