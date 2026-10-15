# Skill bundle

This directory is the skill-bundle mount point for the eval harness.

## v0.12.3 - the content-pin gate

Each manifest entry now pins the SHA-256 of its entire SKILL.md file. The local
eval gate detects content drift even when the frontmatter and manifest versions
still agree. This closes the gap found reviewing #19, where unbumped body changes
passed all checks. No skill content changed in this release, so all skill
versions remain unchanged.

## v0.12.2 - the typed Output Contract release

This patch narrows two skill bodies to what the scorer and declarations
enforce (CXF-274):

- `source-openapi-spec` types every Output Contract field: `authority_rung`
  is a string naming the rung, `spec_version_checked` is the bare version,
  and `missing_paths` is a non-empty array of literal path templates.
- `write-connector-source` names the `Grant` trap: `provisioningResponse.grant`
  takes the `@baton/types` `Grant` (no `"@type"`), not the proto-shaped
  `sdk-types` one.

Two body-changed skills advance one patch: `source-openapi-spec` (`0.1.1`)
and `write-connector-source` (`0.2.5`).

## v0.12.1 - the docs-alignment release

This patch aligns the existing skill bodies with the current authoring contract:

- Credential gates derive required fields from `config-schema.json`.
- `owner_judgment_required` is a terminal outcome requiring a human handoff.
- The single post-activation verification sync is the ID-stability baseline;
  `verify-connector-output` waits for the next human-run sync or reports pending.
- SOURCES.md uses checkout-relative references without self-SHA, branch pins,
  or historical SDK baseline rows.
- The HTTP example uses `http.v2` with an explicit pagination stopping condition.

Eight body-changed skills advance one patch: `author-in-app-connector` (`0.3.7`),
`read-authoring-contract` (`0.2.2`), `write-connector-source` (`0.2.4`),
`build-and-test` (`0.3.3`), `deploy-and-activate` (`0.3.6`),
`verify-connector-output` (`0.1.4`), `update-and-rollback` (`0.2.4`), and
`diagnose-authoring-failure` (`0.1.3`). `design-access-model` and
`source-openapi-spec` retain their versions because only SOURCES.md changed.

## v0.12.0 - current authoring contract

The current bundle targets the 25-tool tenant MCP surface and teaches four
build-required files plus two test-required frozen files (`openapi.json`,
`reviewed-ops.json`). This supersedes the tool-count and source-file contract
descriptions in the earlier bundle-version entries below.

- Draft testing requires a top-level `connect` entry naming the registered
  HTTP transport (a C1 probe/serve contract, not a runtime directive) and
  typed reviewed operations with `output_slice` on every projection.
- Activation, update, and failure diagnosis require matching PASS evidence
  with `transport_judge_verdict == "accepted"`; non-accepted or missing
  verdicts follow the build-and-test stop rules rather than just re-minting.
- Hosted-only operation review is an S3b step; without review reads are
  GET-only, and source edits invalidate review.
- Credential configuration distinguishes the external API path from the
  human UI path required by the hosted C1AI specialist.
- Verification uses `/admin/connectors/authoring/<catalog_id>`.
- The fictional HTTP example includes the frozen pair; the eval upload and
  evidence instructions match this contract.

Skill versions advance for all seven changed bodies, including the
failure-diagnosis correction. See each skill's SOURCES.md for public sources.

## v0.4.0 - the ten skills

The bundle ships ten skills: the seven prior skills plus three post-funnel
and cross-cutting skills at `0.1.0`:

- `verify-connector-output` - post-11: post-sync verification (counts,
  grant wiring, ID stability against the next human-run sync (or reported pending), UI spot-check).
- `update-and-rollback` - post-activation: same-catalog update flow with
  the image-digest reuse rule, the rotation STOP/escalate limitation, and
  REST-only OWNER-gated rollback.
- `diagnose-authoring-failure` - cross-cutting: symptom -> cause -> fix
  router over the common-failures table, the draft-test FAIL reading, and
  where logs live.

The seven prior skills were unchanged in this release; the bundle version
was `0.4.0`. Each skill's SOURCES.md references in-repo declarations and examples
by checkout-relative path and distinguishes them from tenant-served behavior.

## v0.3.0 — the seven skills

The bundle ships seven skills: the five funnel skills plus two new pre-1
judgment skills at `0.1.0`:

- `design-access-model` — pre-1: access-model design for net-new providers
  (resource types, traits, entitlements, grants, provisioning scope).
- `source-openapi-spec` — pre-1: OpenAPI spec sourcing + the IAM go/no-go
  gate, with park-with-evidence as a success outcome.

The five funnel skills are unchanged; the bundle version is `0.3.0`.

## v0.2.0 — the five funnel skills

The bundle ships five skills, authored against the DSL contract and
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

The funnel skills were grounded in the tenant-served contract and public SDK
declarations. Capability validation is a real metadata contract, not a
presence-only file check; see `write-connector-source/SOURCES.md`.

## Mount contract

`bundle.json` is a **manifest**, not a directory copy: each `skills[]` entry
names a skill and a `path` relative to this directory pointing into
`skills/` (the canonical home). Drivers mount per the manifest -
the manifest indirection is the contract, not a directory copy. The scenario
file selects the bundle via `skillBundle.mode` (`full`) and pins
`skillBundle.version` (`0.12.3`); the runner records both in every run record.

## Content-pin gate and updates

`npm run eval:test` checks every entry's `sha256` against SHA-256 of the **whole
SKILL.md file's raw bytes**, including frontmatter, whitespace, line endings, and
the final newline. There is no decoding or newline normalization before hashing.
This deliberately catches metadata-only edits as well as body edits; SOURCES.md
is not part of this pin. Existing frontmatter/version consistency, content
literals, relative-path resolution, and no self-SHA/branch-pin assertions remain.
These are content digests, not Git commit pins.

After editing a skill, bump its numeric `major.minor.patch` frontmatter version,
then run from the repository root:

```sh
npm run bundle:update
```

The updater refreshes manifest versions and content pins together. For existing
skills, it refuses changed files unless their frontmatter version is greater
than the recorded version. For a new skill path, add the entry with the
frontmatter version and no `sha256`; the updater pins it and reports a first pin.
Paths already present in HEAD's manifest must retain their recorded hash;
deleting an existing pin is an error, not a first pin.
The updater requires Git HEAD's committed manifest to distinguish new paths and
fails closed if it is unavailable or invalid; the eval gate remains git-free.
All entries are validated before writing, and SKILL.md files are left alone.
Unchanged files keep their versions. Also bump the bundle version, update its
scenario/test pins, and add a history entry here as for any bundle release.

The hash is a **drift detector**, not proof of a historical version bump: someone
manually replacing a digest could keep both version strings unchanged. The
guarded updater makes the intended bump-and-pin path the easy path. Unlike a
PR-base diff check, this gate works offline and without Git history in every
local eval run; no fetch depth or pull-request event is required.
