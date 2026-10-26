---
name: diagnose-authoring-failure
description: Use when a build, draft test, activation, or production sync fails and you need the symptom-to-cause-to-fix route. Do not use when the connector is healthy and you are verifying sync output - use verify-connector-output; do not use when updating or rolling back a healthy live connector - use update-and-rollback.
version: 0.1.4
---

# diagnose-authoring-failure

Symptom -> cause -> fix router for authored-connector failures. Built on the
served guide's common-failures table, the draft-test evidence reading, and
where logs live. Ports a symptom-first taxonomy; repo-local CLI tooling is
replaced by the tenant MCP tools named below.

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
| Draft test: `credential re-entry required: <fields>` | Configure the instance credentials before the draft test. |
| Draft test: `connector config field X is missing type` | Add `"type": "string"` (etc.) to the field in `runtime.config_schema`. |
| Sync error mentions an `unregistered transport` | A `node` or `reuse` references a transport missing from `connector({ transports: ... })`. Register that same transport object, rebuild, and retest. |
| Draft test: `ticketing.enabled must be true when ticketing is configured` | The runtime-schema carries a `ticketing` block the connector code does not back. Remove the block (and any `actions` / `policy_surface` entries referencing dropped code); `enabled: false` is not a valid off-switch. |
| Activation reports `activation evidence is unsatisfied` | No matching PASS evidence, or `transport_judge_verdict` missing/not accepted. Follow the build-and-test verdict table: correct the verdict's cause; do not just re-mint. Confirm a new accepted PASS row binds this revision before asking the OWNER to review a fresh approval URL. |
| Production sync `Invalid token provided` | The API token is wrong or truncated. Re-configure with the full token, then re-run. |

## Draft-test FAIL reading

The evidence row is authoritative: wait for the draft test as build-and-test
describes, then read `c1_connector_authoring_get_test_run_evidence` - the
`result` (PASS or FAIL) and the `error` field. The FAIL reason
lives on the evidence row; it is not always logged when the read activity
succeeds but the outcome evaluation returns FAIL. PASS requires all of:

- `ConnectionOK` - Validate succeeded
- `HostCallOK` - GetMetadata succeeded
- No read error and no write attempt
- The config version handle matches the candidate revision
- The runtime image digest matches the revision-pinned image
- `transport_judge_verdict == "accepted"` exactly
- Both frozen files (`openapi.json`, `reviewed-ops.json`) are present
- Nonempty declared projections have full coverage

A FAIL row, missing evidence, or a missing/non-accepted verdict keeps activation
`evidence is unsatisfied` until a new accepted PASS row binds the revision.

Do not silently filter out rows, drop declared projections, or weaken coverage
to turn FAIL into PASS; fix the mapping or report the blocker. Classify the
underlying error and consult the staged SDK declarations before any fix, per
the Blocker protocol; changing the error text does not grant another retry.

## Where logs live

Use the product's connector activity and sync logs - the same surface you
use to view any connector in your tenant. There is no separate
operator-only log surface. The connector's status row
(`c1_connector_service_get` -> `status.status`, `status.lastError`) is the
authoritative outcome for a sync.

## Exit criteria

- Every one of the nine common-failures rows routes to its documented fix.
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
- Also stop as soon as any error class recurs, even when the text changes. Classify by underlying cause, not message text; symptom patches, re-uploads, fresh run/revision IDs, and stage changes do not reset tracking.
- Before any fix, grep the staged SDK declarations (including `runtime.d.ts`) for every field a diagnostic names; read its type and surrounding contract. If unavailable or ambiguous, stop rather than guess.
- At the stop, report the error class, exact latest error text, failed attempts, declaration evidence, and blocker; do not retry or patch past it.
