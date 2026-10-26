---
name: build-and-test
description: Use when uploading draft source, building a bundle, or running and awaiting a draft test sync. Do not use when the task is app/connector provisioning or activation - use deploy-and-activate.
version: 0.3.6
---

# build-and-test

Covers funnel stages 2-5 and 9-10: hosted storage-to-draft transfer or external
out-of-band upload, the required-source-files gate, build, and draft test.
Tool names below are exact tenant MCP titles; the served guide abbreviates them.

## Checklist

1. Source transfer: in hosted sessions, use the storage-to-draft source transfer
   as the primary path. Stage the complete source set in a non-system directory
   and copy it server-side per the served guide, without conversation transit or
   presigned PUTs from code mode. GATE: successful transfer with a returned source
   digest; record that digest, then check `required_source_files` in step 2.
   External/BYO path: run `wc -c <file>` for each file, then call
   `c1_connector_authoring_create_draft_source_upload` declaring every file
   needed for build and test (path + size_bytes), PUT each file to its
   `upload_targets[path].url` with `required_headers` verbatim, and call
   `c1_connector_authoring_finalize_draft_source_upload` with the same
   `catalog_id`/`draft_id`/`upload_id` and file list with `sizeBytes`.
   GATE: every PUT returns 200 and finalization succeeds; STOP otherwise.
   Use only a permitted path; if neither is available, report the blocker.
   Both paths replace the entire source set. Caps: total <= 16 MiB, per file
   <= 12 MiB, <= 256 files. Preserve source-digest conflict checks per the guide.
2. Pre-build gate: call `c1_connector_authoring_get_draft` and confirm
   `required_source_files` - all four entries (connector.ts,
   config-schema.json, runtime-schema.json, capabilities.json) true - BEFORE
   building. GATE: all 4 true. STOP if any is false; fix the source set
   first.
3. Build: call `c1_connector_authoring_build_bundle`, capture `run_id`, then
   wait for the completion notification if your host provides one; do not poll
   while waiting. If your session resumes with an outstanding dispatch and no
   completion notification, check `c1_connector_authoring_get_run` once before
   re-dispatching. Otherwise (direct API callers): poll
   `c1_connector_authoring_get_run` with `run_id` every 5-10s, up to ~10 polls;
   if no terminal state, STOP and report the run state rather than redispatching
   the build. GATE:
   `RUN_STATE_SUCCEEDED`; the successful run returns the immutable
   `revision_id`. STOP if the build fails - fix the source and rebuild with
   a fresh `run_id`; never reuse a failed run's id.
4. Draft test: call `c1_connector_authoring_run_draft_test_sync`, capture
   `test_run_id`, then wait for the completion notification if your host provides
   one; do not poll while waiting. If your session resumes with an outstanding
   dispatch and no completion notification, check
   `c1_connector_authoring_get_test_run_evidence` once before re-dispatching.
   Otherwise (direct API callers): poll
   `c1_connector_authoring_get_test_run_evidence` with the full key
   `(catalog_id, revision_id, test_run_id)` every 5-10s, up to ~10 polls
   (`NotFound` while pending); if no row, STOP and report pending rather than
   redispatching the test. GATE:
   `result == CONNECTOR_TEST_RUN_RESULT_PASS` only for S10. Activation also
   requires `transport_judge_verdict == "accepted"` on matching evidence;
   PASS alone does not authorize activation. STOP on any other result or
   verdict; use the verdict table below. For FAIL, read the error field and
   apply the Blocker protocol before fixing or rerunning with a FRESH
   `test_run_id`; never re-mint on a failed run.
5. Re-run-from-correct-step rules: a failed build re-runs from the build
   step; a failed test re-runs from the test step; never re-mint a draft or
   re-upload the whole set unless the source set changed.

## S3b: operation review

Freeze `openapi.json` and `reviewed-ops.json` before building and testing.
`review_connector_operations` is hosted-only (the C1AI assistant); external
agents do not have that tool. Without a review, reads are GET-only. Source
edits invalidate a review: re-review changed inputs in a hosted session,
then rebuild and retest.

## Transport verdict gate

Read `transport_judge_verdict` from the durable test evidence. Only
`accepted` AND `CONNECTOR_TEST_RUN_RESULT_PASS` on matching evidence permit
activation; never treat a missing or non-accepted verdict as acceptance.

| Verdict | Required action / stop rule |
|---------|-----------------------------|
| `accepted` | Proceed only with a matching PASS row; failed or incomplete evidence is not acceptance. |
| `needs_author` | Stop; correct source or operation list, re-review changed inputs, rebuild, and retest. |
| `scope_stop` | Hard stop; investigate the unreviewed call. Do not retry unchanged. |
| `insufficient_evidence` | Stop; identify missing evidence. Do not deploy or activate. |
| `owner_judgment_required` | Terminal for this run: external provenance requires human owner judgment; human evidence acceptance is not yet available. Hand off evidence and stop; retesting or re-upload does not change attribution. |
| `setup_blocked` | Stop; resolve the named tenant/vendor setup or runtime dependency before retesting. |
| `infrastructure_failure` | Stop; resolve the infrastructure failure. Never call it connector acceptance. |
| missing | Stop; the evidence has not been judged. Unjudged evidence is FAIL. |

External-provenance drafts stop at S10 until human evidence acceptance ships.
Hand off the durable evidence and recorded IDs; do not proceed to S11 deploy
or mint, even when the test result is PASS.

## Draft-test FAIL reading

Read the durable evidence's error and classify its underlying cause before
editing source. Do not silently filter out rows, drop declared projections, or
weaken coverage to turn FAIL into PASS; fix the mapping or report the blocker.
Apply the Blocker protocol across the whole revision line, not per error text.

## Exit criteria

- S2 passes: hosted storage transfer succeeds with a returned source digest; OR
  external upload has `upload_id`, every PUT 200, and successful finalization.
- S3 passes: all 4 `required_source_files` true.
- S4 passes: `run_id` non-empty, at least one successful
  `c1_connector_authoring_build_bundle`.
- S5 passes: `RUN_STATE_SUCCEEDED` and `revision_id` non-empty.
- S9 passes: `test_run_id` non-empty, at least one successful
  `c1_connector_authoring_run_draft_test_sync`.
- S10 passes: durable evidence `result == CONNECTOR_TEST_RUN_RESULT_PASS`
  only. The separate activation gate requires this PASS AND
  `transport_judge_verdict == "accepted"` on matching evidence.

## Anti-patterns

- Do not PUT without `required_headers` verbatim.
- Do not reuse a failed `run_id` or `test_run_id`.
- Do not build before the required-source-files gate.
- Do not poll `get_run` for test evidence - `get_run` is build-only.

## Blocker protocol

- Track validation/runtime FAILs on one revision line (a draft and its successive source/build revisions); stop after 3 consecutive FAILs. Only a verified PASS ends that FAIL streak.
- Also stop as soon as any error class recurs, even when the text changes. Classify by underlying cause, not message text: the same field failing extraction with rephrased messages is one class; an auth failure and a schema failure are different classes. Symptom patches, re-uploads, fresh run/revision IDs, and stage changes do not reset tracking; abandoning the draft and creating a fresh one does not reset tracking for the same underlying failure.
- Before any fix, grep the staged SDK declarations (including `runtime.d.ts`) for every field a diagnostic names; read its type and surrounding contract. If unavailable or ambiguous, stop rather than guess.
- At the stop, report the error class, exact latest error text, failed attempts, declaration evidence, and blocker; do not retry or patch past it.
