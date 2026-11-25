---
name: build-and-test
description: Use when uploading draft source, building a bundle, or running and awaiting a draft test sync. Do not use when the task is app/connector provisioning or activation - use deploy-and-activate.
version: 0.3.10
---

# build-and-test

Covers funnel stages 2-5 and 9-10: hosted storage-to-draft transfer or external
out-of-band upload, the required-source-files gate, build, and draft test.
Tool names below are exact tenant MCP titles; the served guide abbreviates them.

## Evidence grounding

Follow the evidence-grounding rule in `author-in-app-connector` (Session communication).
Stage equivalence: S2-S5 = SKELETON-BUILD, first S9-S10 = SKELETON-TEST;
later source/build/test increments = EXPAND. See `author-in-app-connector`'s table.

## Checklist

1. Source transfer (both paths replace the entire source set):
   - **In-app:** use `c1_connector_authoring_update_draft_source_from_vfs` for
     storage-to-draft source transfer. Stage the complete source set in a
     non-system directory; copy server-side without conversation transit or
     presigned PUTs from code mode. GATE: successful transfer with a returned
     source digest; record it, then check `required_source_files` in step 2.
   - **BYO/external:** run `wc -c <file>` for each file, then call
     `c1_connector_authoring_create_draft_source_upload` declaring every file
     needed for build and test (path + size_bytes), PUT each file to its
     `upload_targets[path].url` with `required_headers` verbatim, then call
     `c1_connector_authoring_finalize_draft_source_upload` with the same
     `catalog_id`/`draft_id`/`upload_id` and file list with `sizeBytes`.
     GATE: every PUT returns 200 and finalization succeeds; STOP otherwise.
   Use only a permitted path; otherwise report the blocker. Caps: total <=
   16 MiB, per file <= 12 MiB, <= 256 files. Preserve source-digest conflict checks.
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
   requires `transport_judge_verdict` equal to `accepted` or
   `owner_judgment_required` on matching evidence; PASS alone does not authorize
   activation. STOP on any other result or verdict; use the table below.
   For FAIL, read the error field and
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

Read `transport_judge_verdict` from the durable test evidence. Activation
requires `CONNECTOR_TEST_RUN_RESULT_PASS` on matching evidence, with verdict
`accepted` or `owner_judgment_required`. A missing or any other verdict blocks activation.

| Verdict | Required action / stop rule |
|---------|-----------------------------|
| `accepted` | Proceed only with a matching PASS row; failed or incomplete evidence is not acceptance. |
| `needs_author` | Stop; correct source or operation list, re-review changed inputs, rebuild, and retest. |
| `scope_stop` | Hard stop; investigate the unreviewed call. Do not retry unchanged. |
| `insufficient_evidence` | Stop; identify missing evidence. Do not deploy or activate. |
| `owner_judgment_required` | Not model-judged. Proceed only with a matching PASS row; every mechanical check must pass. The OWNER decides at activation. |
| `setup_blocked` | Stop; resolve the named tenant/vendor setup or runtime dependency before retesting. |
| `infrastructure_failure` | Stop; resolve the infrastructure failure. Never call it connector acceptance. |
| missing | Stop; the evidence has no recorded verdict and cannot satisfy activation. |
| `state=EXPIRED` (evidence state, not a verdict) | Stop; run a fresh draft test for the same revision before deploy or mint. |

When model judging is enabled for the tenant, C1 judges external-provenance
evidence too, without attesting independence from the external author.
Otherwise, BYO runs use `owner_judgment_required` and rely on mechanical checks.
There is no separate human evidence-acceptance step; the OWNER decides at activation.

## Judge diagnostics and redaction

Read `transport_judge_diagnostics`: `origin` distinguishes server guard, model,
and infrastructure; retain `code`, `decline_basis`, `operation_id`, and
`finding_class` when returned. Route declines through `diagnose-authoring-failure`,
including `GUARD_REJECTION` / `EVIDENCE_ERROR_OBJECT_IN_SUCCESS`. A legacy class
may be absent; route by `decline_basis` and `operation_id`, never invent a class.
C1 judges each reviewed operation separately when evidence is too large; a
decline can name one `operation_id`. Do not drop operations to shrink evidence.
At seal time human-identifying strings become `redacted:<opaque>`; unbound or
unresolved read typing hashes every string and warns `REDACTION_DEGRADED`.
Recommend `resource_type` and a resolvable response schema on every reviewed read;
child reads resolving to explicit user schemas require typing, as `write-connector-source` explains.
Do not infer a token's format/meaning or compare a token to a raw value; see
`write-connector-source` for the typing and equality limits.

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
  `transport_judge_verdict` equal to `accepted` or `owner_judgment_required` on matching evidence.

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
