# Skill bundle

This directory is the skill-bundle mount point for the eval harness.

## v0.4.0 - the ten skills

The bundle ships ten skills: the seven prior skills plus three post-funnel
and cross-cutting skills at `0.1.0`:

- `verify-connector-output` - post-11: post-sync verification (counts,
  grant wiring, ID stability across re-sync, UI spot-check).
- `update-and-rollback` - post-activation: same-catalog update flow with
  the image-digest reuse rule, the rotation STOP/escalate limitation, and
  REST-only OWNER-gated rollback.
- `diagnose-authoring-failure` - cross-cutting: symptom -> cause -> fix
  router over the common-failures table, the draft-test FAIL reading, and
  where logs live.

The seven prior skills are unchanged; the bundle version is `0.4.0`.

## v0.3.0 — the seven skills

The bundle ships seven skills: the five funnel skills plus two new pre-1
judgment skills at `0.1.0`:

- `design-access-model` — pre-1: access-model design for net-new providers
  (resource types, traits, entitlements, grants, provisioning scope).
- `source-openapi-spec` — pre-1: OpenAPI spec sourcing + the IAM go/no-go
  gate, with park-with-evidence as a success outcome.

The five funnel skills are unchanged; the bundle version is `0.3.0`.

## v0.2.0 — the five funnel skills

The bundle ships five skills, authored against the v0.0.26 DSL contract and
the 23-tool tenant MCP surface:

- `author-in-app-connector` — the S0–S11 funnel orchestrator (routing,
  handoff table, human-boundary hard stop).
- `read-authoring-contract` — stage 0: guide read, SDK types, resume check.
- `write-connector-source` — source authoring before S2: the four-file
  source contract (connector.ts, config-schema.json, runtime-schema.json,
  capabilities.json).
- `build-and-test` — stages 2–5, 9–10: upload dance, build, draft test.
- `deploy-and-activate` — stages 6–8, 11: app, provision, configure, deploy,
  mint, handoff.

The four pre-existing skills pin the c1 contract sources at `2502b4cd…`;
`write-connector-source` pins them at `92f1c2e5…` — the SHA current at
authoring time. The capabilities-as-real-contract correction the new skill
quotes is the batch's Linear intent (see its SOURCES.md), not a doc change
between the two pins; the c1 docs at `92f1c2e5` still carry the stale
presence-only wording.

## Mount contract

`bundle.json` is a **manifest**, not a directory copy: each `skills[]` entry
names a skill and a `path` relative to this directory pointing into
`skills/` (the canonical home). Private drivers mount per the manifest —
the manifest indirection is the contract, not a directory copy. The scenario
file selects the bundle via `skillBundle.mode` (`full`) and pins
`skillBundle.version` (`0.4.0`); the runner records both in every run record.
