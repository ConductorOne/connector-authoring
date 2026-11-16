---
name: update-and-rollback
description: Use when shipping a change to an activated connector (same-catalog rerun) or rolling back to a previously activated revision. Do not use when verifying a healthy connector's sync output - use verify-connector-output; do not use when diagnosing a failed build, draft test, or sync - use diagnose-authoring-failure.
version: 0.2.10
---

# update-and-rollback

Update and rollback for an activated authored connector. Runs only after the
OWNER has activated the connector. Tool names below are the exact tenant MCP
titles.

## Update flow (same-catalog rerun)

1. Reuse the existing `catalog_id` and `draft_id`; update the draft source
   (lifecycle step 2) and build a new revision (steps 4-5).
2. Reuse the existing managed runtime instance. Activation can admit rotation
   to a serviceable candidate runtime image; a digest difference alone is not
   a STOP. For any readiness blocker, follow Runtime readiness below.
3. Pass a fresh draft test with the instance credentials (steps 9-10).
   GATE: durable evidence binds the new revision with both
   `result == CONNECTOR_TEST_RUN_RESULT_PASS` and
   `transport_judge_verdict` equal to `accepted` or `owner_judgment_required`.
   STOP on any other or missing verdict and follow the build-and-test table before minting.
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
   `transport_judge_verdict` equal to `accepted` or `owner_judgment_required` before minting a new approval URL.
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

## Runtime readiness

Act on the readiness codes and exact diagnostics from
`c1_connector_authoring_get_revision_summary`, not on an inferred cause.
Admitted rotation skips no step of the update flow above.

### Deploy, wait, or rebuild

- `CODE_SERVE_DEPLOYMENT_MISSING` before first activation is a normal prerequisite:
  after matching PASS, call `c1_connector_authoring_deploy_connector_instance`,
  then re-check readiness.
- `CODE_SERVE_DEPLOYMENT_DELETING` means wait for teardown and re-check before
  deploying. `CODE_DEPLOYMENT_OUTSTANDING` and `CODE_ACTIVATION_PENDING` mean
  wait for admitted work; do not start duplicate work. Report these as routine
  status, not as needing engineering action.
- If the diagnostic says the revision has no pinned runtime image digest,
  rebuild and test to establish the pin, even though the code is
  `CODE_IMAGE_INCOMPATIBLE`. Never edit a sealed revision.
- `serve image does not match the revision-pinned runtime image` is
  a real image-binding mismatch, not a missing-deployment prerequisite. For a
  first-activation image mismatch, redeploy through the supported DEPLOY step
  and re-check. Do not repeat an unchanged failed repair.

### Platform action

`c1_connector_authoring_deploy_connector_instance` is pre-activation-only.
A missing deployment on an already-activated installation,
`CODE_DEPLOYMENT_UNMANAGED`, an unresolved `CODE_IMAGE_INCOMPATIBLE`, or
`CODE_RUNTIME_FLOOR` needs ConductorOne platform action. Report the exact code and
diagnostic and say: "This needs ConductorOne platform action; I cannot repair it from this session."
Do not describe a permanent blocker as routine or pending, claim internal routing
occurred, or tell the human a repair is running when none was dispatched.

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
  fresh PASS evidence with verdict `accepted` or `owner_judgment_required`, and a
  completed force sync.
- Readiness blocker: reported with its exact code and diagnostic, either as
  routine status with the re-check outcome or with the platform-action statement.
- Rollback handoff: non-empty `activation_url` presented to a human tenant
  OWNER and stopped at the human boundary. After the OWNER completes the
  rollback, the target revision is ACTIVE under a strictly greater
  `activation_epoch`, with one completed verification sync and
  `verify-connector-output` checks reported.

## Anti-patterns

- Do not redeem the approval token for activation or rollback - both are human OWNER steps.
- Do not treat an image digest difference alone as a rotation refusal.
- Do not clear runtime fields, call the provisioner directly, or mutate the
  deployment or cloud resources; do not lower a floor, bypass approval, or retry
  a permanent failure in a loop.
- Do not call the rollback endpoint or use the activation endpoint to roll back.
- Do not force-sync before activation or repeat the post-activation verification sync; subsequent syncs belong to the human/operator.
- Never read or handle OWNER credentials. Never ask a human to paste secrets
  into chat.

## Blocker protocol

- Track validation/runtime FAILs on one revision line (a draft and its successive source/build revisions); stop after 3 consecutive FAILs. Only a verified PASS ends that FAIL streak.
- Also stop as soon as any error class recurs, even when the text changes. Classify by underlying cause, not message text: the same field failing extraction with rephrased messages is one class; an auth failure and a schema failure are different classes. Symptom patches, re-uploads, fresh run/revision IDs, and stage changes do not reset tracking; abandoning the draft and creating a fresh one does not reset tracking for the same underlying failure.
- Before any fix, grep the staged SDK declarations (including `runtime.d.ts`) for every field a diagnostic names; read its type and surrounding contract. If unavailable or ambiguous, stop rather than guess.
- At the stop, report the error class, exact latest error text, failed attempts, declaration evidence, and blocker; do not retry or patch past it.
