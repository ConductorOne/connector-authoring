# Skill bundle

This directory is the skill-bundle mount point for the eval harness.

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
`write-connector-source` pins them at `92f1c2e5…` (the SHA at authoring
time). The split is intentional: the new skill quotes the capabilities
contract correction that landed after the earlier pin.

## Mount contract

`bundle.json` is a **manifest**, not a directory copy: each `skills[]` entry
names a skill and a `path` relative to this directory pointing into
`skills/` (the canonical home). Private drivers mount per the manifest —
the manifest indirection is the contract, not a directory copy. The scenario
file selects the bundle via `skillBundle.mode` (`full`) and pins
`skillBundle.version` (`0.2.0`); the runner records both in every run record.
