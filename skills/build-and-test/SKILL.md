---
name: build-and-test
description: Use when uploading draft source, building a bundle, or running and polling a draft test sync. Do not use when the task is app/connector provisioning or activation - use deploy-and-activate.
version: 0.1.0
---

# build-and-test

Covers funnel stages 3-5 and 9-10: the required-source-files gate, the
out-of-band upload dance, the build, and the draft test. Tool names below are
the exact tenant MCP titles; the served guide abbreviates them.

## Checklist

1. Pre-build gate: call `c1_connector_authoring_get_draft` and confirm
   `required_source_files` - all four entries (connector.ts,
   config-schema.json, runtime-schema.json, capabilities.json) true - BEFORE
   building. GATE: all 4 true. STOP if any is false; fix the source set
   first.
2. Upload dance (out-of-band path): run `wc -c <file>` for each source file,
   then call `c1_connector_authoring_create_draft_source_upload` declaring
   every file the build needs (path + size_bytes), then PUT each file to its
   `upload_targets[path].url` sending `required_headers` verbatim, then call
   `c1_connector_authoring_finalize_draft_source_upload` with the same
   `catalog_id`/`draft_id`/`upload_id` and the file list with `sizeBytes`.
   GATE: every PUT returns 200. STOP if any PUT is not 200 - bare URLs
   without the signed headers fail signature validation. Caps: total <=
   16 MiB, per file <= 12 MiB, <= 256 files.
3. Build: call `c1_connector_authoring_build_bundle`, capture `run_id`, then
   poll `c1_connector_authoring_get_run` with `run_id` until the build
   reaches a terminal state (poll with backoff, e.g. every 5-10s; if no
   terminal state after ~10 polls, STOP and report the run state). GATE:
   `RUN_STATE_SUCCEEDED`; the successful run returns the immutable
   `revision_id`. STOP if the build fails - fix the source and rebuild with
   a fresh `run_id`; never reuse a failed run's id.
4. Draft test: call `c1_connector_authoring_run_draft_test_sync`, capture
   `test_run_id`, then poll `c1_connector_authoring_get_test_run_evidence`
   with the full key `(catalog_id, revision_id, test_run_id)` until the
   durable PASS/FAIL row exists (`NotFound` while pending; poll with backoff,
   e.g. every 5-10s, and STOP if no row after ~10 polls). GATE:
   `result == CONNECTOR_TEST_RUN_RESULT_PASS` (the PASS enum value on the
   real surface; the eval fixture records the string `"PASS"`). STOP if the
   row reports FAIL -
   read the error field, fix, and re-run from the correct step with a FRESH
   `test_run_id`; never re-mint on a failed run.
5. Re-run-from-correct-step rules: a failed build re-runs from the build
   step; a failed test re-runs from the test step; never re-mint a draft or
   re-upload the whole set unless the source set changed.

## Exit criteria

- S2 passes: `upload_id` non-empty, at least one successful
  `c1_connector_authoring_create_draft_source_upload`, every PUT returns 200.
- S3 passes: all 4 `required_source_files` true.
- S4 passes: `run_id` non-empty, at least one successful
  `c1_connector_authoring_build_bundle`.
- S5 passes: `RUN_STATE_SUCCEEDED` and `revision_id` non-empty.
- S9 passes: `test_run_id` non-empty, at least one successful
  `c1_connector_authoring_run_draft_test_sync`.
- S10 passes: durable evidence `result == CONNECTOR_TEST_RUN_RESULT_PASS`
  (the scorer's S10 gate checks the fixture's string `"PASS"`).
- The body contains the literal `required_source_files`, `upload_targets`,
  `required_headers`, `RUN_STATE_SUCCEEDED`, and `test_run_id`.

## Anti-patterns

- Do not PUT without `required_headers` verbatim.
- Do not reuse a failed `run_id` or `test_run_id`.
- Do not build before the required-source-files gate.
- Do not poll `get_run` for test evidence - `get_run` is build-only.

## Blocker protocol

If the same validation or runtime error remains unchanged after 2 failed fix
cycles on the same error, stop and report the exact error text instead of
guessing further.
