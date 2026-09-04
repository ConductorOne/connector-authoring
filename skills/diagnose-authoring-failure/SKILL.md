---
name: diagnose-authoring-failure
description: Use when a build, draft test, activation, or production sync fails and you need the symptom-to-cause-to-fix route. Do not use when the connector is healthy and you are verifying sync output - use verify-connector-output; do not use when updating or rolling back a healthy live connector - use update-and-rollback.
version: 0.1.0
---

# diagnose-authoring-failure

Symptom -> cause -> fix router for authored-connector failures. Built on the
lifecycle doc's common-failures table, the draft-test evidence reading, and
where logs live. Ports the taxonomy approach of baton-admin
`diagnose-connector-failure`; the baton-admin skill's repo-local CLI
tooling is replaced by the tenant MCP tools named below.

## Workflow

1. Start from the symptom: the exact error text, the failing step (build,
   draft test, activation, production sync), and the IDs at hand.
2. Route the symptom through the table below; collect the smallest evidence
   needed for that cause.
3. Apply the fix, then re-run the smallest verification step that failed.
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
| Activation reports `activation evidence is unsatisfied` | No PASS test-sync evidence binds this revision. Run the draft test (with credentials set) and confirm it passed before asking the OWNER to review a fresh approval URL. |
| Production sync `Invalid token provided` | The API token is wrong or truncated. Re-configure with the full token, then re-run. |

## Draft-test FAIL reading

The evidence row is authoritative: poll
`c1_connector_authoring_get_test_run_evidence` and read the `result` (PASS
or FAIL) and the `error` field. Poll with backoff (e.g. every 5-10s); if no
row after ~10 polls, stop and report `NotFound`/pending. The FAIL reason
lives on the evidence row; it is not always logged when the read activity
succeeds but the outcome evaluation returns FAIL. PASS requires all of:

- `ConnectionOK` - Validate succeeded
- `HostCallOK` - GetMetadata succeeded
- No read error and no write attempt
- The config version handle matches the candidate revision
- The runtime image digest matches the revision-pinned image

A FAIL row (or no row yet) means activation stays `evidence is unsatisfied`
until a new draft test writes PASS.

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
- The body contains the literals `262144 byte compile limit`,
  `1048576 byte limit`, `is_secret`, `credential re-entry required`,
  `missing type`, `unregistered transport`,
  `ticketing.enabled must be true when ticketing is configured`,
  `activation evidence is unsatisfied`, `Invalid token provided`,
  `ConnectionOK`, `HostCallOK`, `c1_connector_service_get`, and
  `status.lastError`.

## Anti-patterns

- Do not start with broad full-suite runs when a small probe can isolate
  the issue.
- Do not hide unresolved drift with waivers or mock shaping.
- Do not expose auth material, tokens, or customer data in diagnostics.
- Do not guess a fix without reading the evidence row first.

## Blocker protocol

If the same validation or runtime error remains unchanged after 2 failed
fix cycles on the same error, stop and report the exact error text instead
of guessing further.
