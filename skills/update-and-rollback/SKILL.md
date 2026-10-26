---
name: update-and-rollback
description: Use when shipping a change to an activated connector (same-catalog rerun) or rolling back to a previously activated revision. Do not use when verifying a healthy connector's sync output - use verify-connector-output; do not use when diagnosing a failed build, draft test, or sync - use diagnose-authoring-failure.
version: 0.2.7
---

# update-and-rollback

Update and rollback for an activated authored connector. Runs only after the
OWNER has activated the connector. Tool names below are the exact tenant MCP
titles.

## Update flow (same-catalog rerun)

1. Reuse the existing `catalog_id` and `draft_id`; update the draft source
   (lifecycle step 2) and build a new revision (steps 4-5).
2. Reuse the existing managed runtime instance ONLY when its image digest
   matches the target revision's pinned runtime image digest. GATE: image
   digest match. STOP if the digests differ - see the rotation limitation
   below.
3. Pass a fresh draft test with the instance credentials (steps 9-10).
   GATE: durable evidence binds the new revision with both
   `result == CONNECTOR_TEST_RUN_RESULT_PASS` and
   `transport_judge_verdict == "accepted"`. STOP on any other or missing
   verdict and follow the build-and-test verdict table before minting.
4. Mint a new approval URL with `c1_connector_authoring_mint_approval_token`
   (`expires_in_seconds` 1-14400). GATE: non-empty `activation_url`.
5. HARD STOP at the human boundary: present the URL to a human tenant OWNER
   and stop. Do not redeem the approval token for activation.
6. After presenting the URL: if your host provides activation
   notifications, a notification resuming you means the revision is
   ACTIVE: record the `activation_epoch` it carries; do not poll. If you
   resume with an outstanding activation and no notification, check
   `c1_connector_authoring_list_revision_summaries` once; if
   `REVISION_STATUS_ACTIVE` record `activation_epoch`, otherwise STOP and
   report. Otherwise (direct API callers): once the OWNER reports
   activation, poll `c1_connector_authoring_list_revision_summaries` every
   5-10s, up to ~10 polls, until the target revision is
   `REVISION_STATUS_ACTIVE`; record its `activation_epoch`. GATE: ACTIVE.
   STOP if not ACTIVE - if approval reports `evidence is unsatisfied`,
   return to the review/judgment and draft-test path per the build-and-test
   verdict table. Correct the verdict's cause; do not just re-mint.
   Confirm fresh evidence binds this revision with both
   `result == CONNECTOR_TEST_RUN_RESULT_PASS` and
   `transport_judge_verdict == "accepted"` before minting a new approval URL.
   If no ACTIVE row after ~10 polls, STOP and report.
7. After confirming ACTIVE, call `c1_connector_service_force_sync` exactly
   once to verify this activation, including when an activation notification
   resumed the session. Poll `c1_connector_service_get`
   with backoff (e.g. every 5-10s) until `status.status` is
   `SYNC_STATUS_DONE`, `SYNC_STATUS_ERROR`, or `SYNC_STATUS_DISABLED`; if
   no terminal status after ~10 polls, STOP and report. If the status row
   reports `SYNC_STATUS_ERROR`, read `status.lastError` and route through
   diagnose-authoring-failure; if `SYNC_STATUS_DISABLED`, read the
   connector's `sync_disabled_reason` and route through
   diagnose-authoring-failure unless the reason indicates a deliberate
   pause (customer opt-out or ops).
   After reporting verification, stop; the human/operator owns subsequent syncs.

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

1. Call `c1_connector_authoring_list_revision_summaries` and confirm the
   rollback target is `REVISION_STATUS_PREVIOUSLY_ACTIVE`. Record the current
   published revision's `activation_epoch` and explain why the rollback
   target should replace it.
2. Mint a new approval URL with `c1_connector_authoring_mint_approval_token`
   for the target revision (`catalog_id`, `revision_id`;
   `expires_in_seconds` 1-14400). GATE: non-empty `activation_url`.
3. HARD STOP at the human boundary: present the URL to a human tenant OWNER
   and stop. Do not redeem the approval token for rollback. Never call the
   rollback endpoint or read or handle OWNER credentials.
4. After the human OWNER completes rollback, follow the update flow's
   notification/resume/poll branches (step 6) for the rollback target.
   GATE: the target is `REVISION_STATUS_ACTIVE` under a strictly greater
   `activation_epoch`. STOP and report if this is not confirmed.
5. Follow the update flow's single verification sync (step 7), then invoke
   `verify-connector-output`. Subsequent syncs belong to the human/operator.

The rollback re-points the published and instance pointers at the target
revision under a strictly greater activation epoch. The rolled-back-from
revision's serve state is untouched - the pointer move alone stops it
serving.

If the OWNER reports a rollback refusal, STOP and report the exact error
text; do not attempt the rollback yourself.

## Exit criteria

- Same-catalog rerun: new revision ACTIVE with a recorded `activation_epoch`,
  fresh PASS evidence with `transport_judge_verdict == "accepted"`, and a
  completed force sync.
- The rotation STOP fired verbatim (`serve image does not match the revision-pinned runtime image`) with the escalation record: tenant,
  catalog, app, connector, and target revision IDs.
- Rollback handoff: non-empty `activation_url` presented to a human tenant
  OWNER and stopped at the human boundary. After the OWNER completes the
  rollback, the target revision is ACTIVE under a strictly greater
  `activation_epoch`, with one completed verification sync and
  `verify-connector-output` checks reported.

## Anti-patterns

- Do not redeem the approval token for activation or rollback - both are human OWNER steps.
- Do not reuse the managed runtime instance when the image digest does not
  match the target revision's pinned runtime image digest.
- Do not clear runtime fields, call the provisioner directly, or mutate the
  deployment or AWS resources on the rotation STOP.
- Do not call the rollback endpoint or use the activation endpoint to roll back.
- Do not force-sync before activation or repeat the post-activation verification sync; subsequent syncs belong to the human/operator.
- Never read or handle OWNER credentials. Never ask a human to paste secrets
  into chat.

## Blocker protocol

- Track validation/runtime FAILs on one revision line (a draft and its successive source/build revisions); stop after 3 consecutive FAILs. Only a verified PASS ends that FAIL streak.
- Also stop as soon as any error class recurs, even when the text changes. Classify by underlying cause, not message text: the same field failing extraction with rephrased messages is one class; an auth failure and a schema failure are different classes. Symptom patches, re-uploads, fresh run/revision IDs, and stage changes do not reset tracking; abandoning the draft and creating a fresh one does not reset tracking for the same underlying failure.
- Before any fix, grep the staged SDK declarations (including `runtime.d.ts`) for every field a diagnostic names; read its type and surrounding contract. If unavailable or ambiguous, stop rather than guess.
- At the stop, report the error class, exact latest error text, failed attempts, declaration evidence, and blocker; do not retry or patch past it.
