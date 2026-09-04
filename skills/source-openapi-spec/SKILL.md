---
name: source-openapi-spec
description: Use when sourcing the OpenAPI spec for a net-new provider and running the IAM go/no-go gate before any access-model design. Do not use when the spec is already sourced - invoke design-access-model instead.
version: 0.1.0
---

# source-openapi-spec

An in-app connector is spec-driven: the sourced OpenAPI document is the
contract the access model and the source are built from. Sourcing it wrong
ships wrong request shapes; skipping the IAM go/no-go gate ships a shell
connector with no governance value.

## Step 1 - Find candidates, rank by the authority ladder

From most to least authoritative:

1. **Official published spec at a stable URL** (e.g. the provider's
   `https://<host>/openapi.json`). Vendor verbatim; record URL + fetch date.
2. **Runtime-generated spec from a PINNED release** - for OSS/self-hosted
   products whose server generates its own spec. Install the exact release
   and dump it; record the exact command + version as provenance so it is
   reproducible on upgrade.
3. **A live hosted docs/Swagger instance** - cross-check only. It runs
   whatever unpinned version that deployment happens to run.
4. **Hand-authored minimal spec** - only when nothing machine-readable
   exists; every operation needs cited provenance from docs/SDK/source.
5. **NEVER: a checked-in spec snapshot in the provider's repo** without
   verifying freshness.

A provider having Terraform providers or SDKs is NOT evidence of an IAM API -
inspect what they actually call.

## Step 2 - Verify the management surface exists (go/no-go gate)

Load the candidate spec and check the paths programmatically - do not skim
docs pages. Required for a meaningful connector: a member/user LISTING at
minimum; membership add/remove, role data, and key inventory determine the
provisioning story. Verify each claim someone made from docs or memory against
the spec.

**If the IAM surface is missing** (members are console-only, the only identity
endpoint is a whoami, SCIM is roadmap): recommend PARKING the connector. Write
the evidence down - exact spec version/commit checked, the paths that don't
exist, the vendor doc stating the limitation, and the concrete trigger to
revisit. Parking with evidence is a success outcome; a whoami-shell connector
in the catalog is not.

## Step 3 - Weigh the spec (in-app twist)

After sourcing, weigh the document: `wc -c` it and record the bytes. The
esbuild source cap is 262144 bytes and the bundle-plus-embedded-specs cap is
1048576 bytes. A spec whose selected operations push the bundle toward the cap
is trimmed by selection, never by editing the vendored document.

## Output Contract

Emit the `sourcing` and `park_evidence` halves of the pre1.json artifact:

- `sourcing`: `{spec_url, fetched_at, authority_rung, spec_bytes}`.
- `park_evidence`: `{spec_version_checked, missing_paths, vendor_doc, revisit_trigger}`.

## Exit criteria

- The spec is sourced from the highest authority-ladder rung available.
- The IAM go/no-go gate ran programmatically against the spec's paths.
- `spec_bytes` is recorded from `wc -c` and is under 1048576.
- A park decision carries all four `park_evidence` fields.

## Anti-patterns

- Do not source from docs or memory - verify paths programmatically.
- Do not ship a whoami-shell connector when the IAM surface is missing.
- Do not edit the vendored document to fit the bundle caps - trim by selection.
- Do not vendor an unverified checked-in spec snapshot.

## Blocker protocol

If the same validation or runtime error remains unchanged after 2 failed fix
cycles on the same error, stop and report the exact error text instead of
guessing further.
