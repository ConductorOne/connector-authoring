---
name: update-and-rollback
description: Use when shipping a change to an activated connector (same-catalog rerun) or rolling back to a previously activated revision. Do not use when verifying a healthy connector's sync output - use verify-connector-output; do not use when diagnosing a failed build, draft test, or sync - use diagnose-authoring-failure.
version: 0.1.0
---

# update-and-rollback

Update and rollback for an activated authored connector. Runs in a
post-activation session - never during the funnel run. Tool names below are
the exact tenant MCP titles.

## Update flow (same-catalog rerun)

1. Reuse the existing `catalog_id` and `draft_id`; update the draft source
   (lifecycle step 2) and build a new revision (steps 4-5).
2. Reuse the existing managed runtime instance ONLY when its image digest
   matches the target revision's pinned runtime image digest. GATE: image
   digest match. STOP if the digests differ - see the rotation limitation
   below.
3. Pass a fresh draft test with the instance credentials (steps 9-10).
   GATE: durable PASS evidence binds the new revision.
4. Mint a new approval URL with `c1_connector_authoring_mint_approval_token`
   (`expires_in_seconds` 1-14400). GATE: non-empty `activation_url`.
5. HARD STOP at the human boundary: present the URL to a human tenant OWNER
   and stop. Do not redeem the approval token.
6. After the OWNER activates, poll
   `c1_connector_authoring_list_revision_summaries` until the target
   revision is `REVISION_STATUS_ACTIVE`; record its `activation_epoch`.
   GATE: ACTIVE. STOP if not ACTIVE - if approval reports `evidence is unsatisfied`,
   return to the draft-test step and confirm a fresh PASS row binds this
   revision before minting a new approval URL. Poll with backoff (e.g. every
   5-10s); if no ACTIVE row after ~10 polls, STOP and report.
7. Call `c1_connector_service_force_sync`; verify via
   `c1_connector_service_get` that `status.status` is `SYNC_STATUS_DONE`.

## Rotation STOP (known limitation)

An active update can fail with `serve image does not match the revision-pinned runtime image`. The deployed instance's image digest must
match the target revision's pinned runtime image digest. There is no
supported customer, MCP, or Support Dashboard recovery today: deploy and
teardown are pre-activation-only, and rollback enforces the same image
binding.

**STOP.** Do not clear runtime fields, call the provisioner directly, or
mutate the deployment or AWS resources. Record the tenant, catalog, app,
connector, and target revision IDs, then escalate to Connector Authoring /
managed-runtime engineering.

## Rollback (REST-only, OWNER-gated)

To roll back to a previously activated revision, mint an approval token for
the rollback target revision and redeem it against the rollback endpoint -
unlike activation, rollback is REST-only and OWNER-gated. Use the product
base URL and OWNER bearer token:

```
POST /api/v1/connector-authoring/rollbacks
{
  "catalog_id": "<catalog_id>",
  "target_revision_id": "<revision to roll back to>",
  "instance_app_id": "<app_id>",
  "instance_connector_id": "<connector_id>",
  "approval_token_id": "<token_id>"
}
```

The rollback re-points the published and instance pointers at the target
revision under a strictly greater activation epoch. The rolled-back-from
revision's serve state is untouched - the pointer move alone stops it
serving.

If the rollback call fails closed (e.g. a precondition error), read the
error text and route through diagnose-authoring-failure.

## Exit criteria

- Same-catalog rerun: new revision ACTIVE with a recorded `activation_epoch`,
  fresh PASS evidence, and a completed force sync.
- The rotation STOP fired verbatim (`serve image does not match the revision-pinned runtime image`) with the escalation record: tenant,
  catalog, app, connector, and target revision IDs.
- Rollback: `POST /api/v1/connector-authoring/rollbacks` accepted with
  `target_revision_id`, `instance_app_id`, `instance_connector_id`, and
  `approval_token_id`; the target revision is ACTIVE under a strictly
  greater activation epoch.
- The body contains the literals `serve image does not match the revision-pinned runtime image`, `/api/v1/connector-authoring/rollbacks`,
  `target_revision_id`, `approval_token_id`, `activation_epoch`, and
  `image digest`.

## Anti-patterns

- Do not redeem the activation approval token - activation is a human OWNER step.
- Do not reuse the managed runtime instance when the image digest does not
  match the target revision's pinned runtime image digest.
- Do not clear runtime fields, call the provisioner directly, or mutate the
  deployment or AWS resources on the rotation STOP.
- Do not roll back via the activation endpoint - rollback is REST-only.
- Do not force-sync before the target revision is ACTIVE.
- Do not print, log, or otherwise expose the OWNER bearer token value -
  reference it only by variable or placeholder in any command or
  diagnostic output.

## Blocker protocol

If the same validation or runtime error remains unchanged after 2 failed
fix cycles on the same error, stop and report the exact error text instead
of guessing further.
