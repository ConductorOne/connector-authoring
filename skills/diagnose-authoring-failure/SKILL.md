---
name: diagnose-authoring-failure
description: Use when a build, draft test, activation, or production sync fails and you need the symptom-to-cause-to-fix route. Do not use when the connector is healthy and you are verifying sync output - use verify-connector-output; do not use when updating or rolling back a healthy live connector - use update-and-rollback.
version: 0.1.10
---

# diagnose-authoring-failure

Symptom -> cause -> fix router for authored-connector failures. Built on the
served guide's common-failures table, the draft-test evidence reading, and
where logs live. Ports a symptom-first taxonomy; repo-local CLI tooling is
replaced by the tenant MCP tools named below.

State only what a tool response field in this session returned; absent evidence
is NOT VERIFIED. Counts/type shapes do not establish per-record principal
resolution, IDs, or field values. Check file presence; a flag is not content
validation. Stage equivalence: cross-cutting; use `author-in-app-connector`'s table
to route the failing checklist step to its served stage.

## Workflow

1. Start from the symptom: the exact error text, the failing step (build,
   draft test, activation, production sync), and the IDs at hand.
2. Route the symptom through the table below; collect the smallest evidence
   needed for that cause.
3. Subject to the Blocker protocol, apply the fix and re-run the failed step.
4. Output a chat diagnostic summary: failure summary, classified cause,
   evidence used, likely owner (source, schema, runtime, credentials, or
   platform), one concrete next fix, and the smallest verification command.

## Symptom -> cause -> fix

| Symptom | Cause / fix |
|---------|-------------|
| Build rejected: `connector source exceeds the 262144 byte compile limit` | The esbuild-bundled source is over 256 KiB. Trim the source set; large OpenAPI-derived spec assets are the usual weight. |
| Build rejected: `connector bundle with embedded runtime specs is <N> bytes, above the 1048576 byte limit` | The bundled `connector.js` plus its embedded runtime specs is over 1 MiB - a separate cap from the 256 KiB source limit, hit after bundling. Trim the source or the generated spec assets it embeds. |
| Build rejected: `credential-class config field must be marked is_secret` | A token/secret/password-named field in `runtime-schema.json` lacks `is_secret: true`. The `secret:` spelling is not read. |
| Draft test: `credential re-entry required: <fields>` | Follow deploy-and-activate's credential form rule: explain the field and reason before opening; reopen only for fresh `AUTH_OR_SCOPE` evidence or a stored value failing its own rules. |
| Draft test: `connector config field X is missing type` | Add `"type": "string"` (etc.) to the field in `runtime.config_schema`. |
| Sync error mentions an `unregistered transport` | A `node` or `reuse` references a transport missing from `connector({ transports: ... })`. Register that same transport object, rebuild, and retest. |
| Draft test: `ticketing.enabled must be true when ticketing is configured` | The runtime-schema carries a `ticketing` block the connector code does not back. Remove the block (and any `actions` / `policy_surface` entries referencing dropped code); `enabled: false` is not a valid off-switch. |
| Activation reports `activation evidence is unsatisfied` | No matching PASS evidence, or `transport_judge_verdict` is missing or neither `accepted` nor `owner_judgment_required`. Follow the build-and-test verdict table: correct the verdict's cause; do not just re-mint. Confirm a new matching PASS row binds this revision before asking the OWNER to review a fresh approval URL. |
| Draft test: `SELECTOR_NOT_FOUND` at `operations[N].pagination.select.<name>` | The response lacked a required pagination value, usually because the vendor omits it on the last page. In `reviewed-ops.json`, make that selector an explicit `select` entry with `"optional": true` (replace a `cursorPath` shorthand with `select.cursor`), rebuild, and retest. If the value should be present, fix the selector path. |
| Production sync `Invalid token provided` | Confirm fresh `AUTH_OR_SCOPE` evidence or a stored value violating its rules; follow deploy-and-activate's explain-before-reopening credential form rule. Never request secrets in chat. |

## Judge decline -> cause -> fix

Read `transport_judge_diagnostics` (`origin`, `code`, `decline_basis`,
`operation_id`, `finding_class`) as returned; never fabricate an absent class.
`GUARD_REJECTION` with `EVIDENCE_ERROR_OBJECT_IN_SUCCESS` means the server guard
found a structured vendor error in a 2xx response, before model judgment.
The class may be absent on older rows and on declines other than `needs_author`;
then route by `decline_basis` and the named `operation_id`. Report missing
diagnostics rather than guessing a source defect.

Class names below omit `CONNECTOR_JUDGE_FINDING_CLASS_`; basis names omit
`CONNECTOR_JUDGE_DECLINE_BASIS_`. Proto JSON may use `transportJudgeDiagnostics`
and camelCase `declineBasis`, `operationId`, `findingClass`.
`REQUEST_METADATA_ABSENT` routes to request observation;
`READ_INCOMPLETE_WITHIN_WINDOW` to missing retained pages/events;
`BODY_DEFECT` to response structure; `BINDING_DEFECT` to declared bindings.
`BEYOND_PROBE_WINDOW` is a sampling limit, not proof of an unseen defect;
`OTHER` needs the recorded diagnostics. Never infer a basis from reason text.

| `finding_class` | Evidence to inspect / next fix |
|---|---|
| `ID_FIELD_MISSING` | Check the declared `id_path` and schema for absent, null, wrong-type, or empty IDs. Do not infer invalid formats from hashed IDs. |
| `ENVELOPE_MISMATCH` | For non-error data, align `output_slice` and runtime `itemsPath` with the declared response envelope. |
| `PAGINATION_INCONSISTENT` | Check pagination selectors, request parameters, continuation and stopping rules against the vendor contract; do not hand-loop. |
| `TOTAL_MISMATCH` | Reconcile the declared total path, scope and returned counts; do not invent rows. |
| `VENDOR_ERROR` | Fix the vendor's 2xx error payload or auth/scope/setup cause first; this takes precedence over a missing data envelope. |
| `PARENT_MISMATCH` | Check `parent.operation_id`, `id_path`, `param` and the child path binding; token/raw IDs are not comparable evidence. |
| `RECORD_MALFORMED` | Check record structure, JSON types and required fields against the schema, not a token's apparent contents. |
| `SPEC_MISMATCH` | Reconcile the frozen spec with observed structure/types and unredacted values; never guess a token's meaning. |
| `SIDE_EFFECT` | Stop; remove an unreviewed write/side effect and re-review changed operations. |
| `OTHER` | Report the returned basis and operation; isolate the smallest evidence before selecting a fix. |

C1 judges each reviewed operation separately when evidence is too large; a
decline can name one `operation_id`. Do not drop operations to shrink evidence.

## Draft-test FAIL reading

Wait for the draft test as build-and-test describes, then read
`c1_connector_authoring_get_test_run_evidence`. Completion is not PASS.
Use returned fields, not inferred internal checks:

| Returned evidence | What it establishes |
|---|---|
| `result`, `error`, `error_kind` | Durable PASS/FAIL and the reported failure category; route `AUTH_OR_SCOPE` to credentials/scope checks. |
| `state` | Evidence lifecycle; `EXPIRED` requires a fresh test, not minting. |
| `execution_leg.stats`, `execution_leg.resource_types_reached`, `execution_leg.truncated_reason`, `execution_leg.run_duration` | Executed scope, aggregate activity, reachability and sampling limits when returned, not individual rows. |
| `shape_summary` and coverage | Counts/type shapes and projection coverage, not IDs or resolved principals. |
| `transport_judge_verdict`, `transport_judge_diagnostics` | Decision and its returned basis, origin, class and operation. |

The separate activation gate requires `result == CONNECTOR_TEST_RUN_RESULT_PASS`
and `transport_judge_verdict` equal to `accepted` or `owner_judgment_required`
on matching, unexpired evidence for this revision. `owner_judgment_required`
means not model-judged, not a waiver of mechanical checks. A FAIL, missing
evidence, or any other/missing verdict blocks activation until a
new matching PASS row binds the revision. Do not claim internal Validate,
GetMetadata, config-version, image-digest, frozen-file or coverage checks passed
unless the corresponding response field actually evidences that claim.

Do not silently filter out rows, drop declared projections, or weaken coverage
to turn FAIL into PASS; fix the mapping or report the blocker. Classify the
underlying error and consult the staged SDK declarations before any fix, per
the Blocker protocol; changing the error text does not grant another retry.

## Where logs live

Use `c1_connector_sync_diagnostics_service_get_sync_status` for `live_counts`,
`c1_connector_sync_diagnostics_service_get_sync_history` for completed runs,
`c1_connector_sync_diagnostics_service_get_sync_error_digest` for grouped errors,
`c1_connector_sync_diagnostics_service_compare_sync_stats` for aggregate changes,
and `c1_connector_sync_diagnostics_service_get_sync_change_timeline` for timing.
These in-app-allowlisted reads expose diagnostics, not per-record grants.
`c1_connector_service_get` -> `status.status`, `status.lastError` remains the
authoritative sync outcome. Ask the owner to inspect product activity/sync logs
if deeper UI inspection is needed; do not claim browser access in-app.

## Exit criteria

- Common failures and all ten finding classes route to a fix or an explicit blocker.
- A draft-test FAIL is read from the evidence row, not from completion.
- The logs location and the status row are named.

## Anti-patterns

- Do not start with broad full-suite runs when a small probe can isolate
  the issue.
- Do not hide unresolved drift with waivers or mock shaping.
- Do not expose auth material, tokens, or customer data in diagnostics.
- Do not guess a fix without reading the evidence row first.

## Blocker protocol

- Track validation/runtime FAILs on one revision line (a draft and its successive source/build revisions); stop after 3 consecutive FAILs. Only a verified PASS ends that FAIL streak.
- Also stop as soon as any error class recurs, even when the text changes. Classify by underlying cause, not message text: the same field failing extraction with rephrased messages is one class; an auth failure and a schema failure are different classes. Symptom patches, re-uploads, fresh run/revision IDs, and stage changes do not reset tracking; abandoning the draft and creating a fresh one does not reset tracking for the same underlying failure.
- Before any fix, grep the staged SDK declarations (including `runtime.d.ts`) for every field a diagnostic names; read its type and surrounding contract. If unavailable or ambiguous, stop rather than guess.
- At the stop, report the error class, exact latest error text, failed attempts, declaration evidence, and blocker; do not retry or patch past it.
