---
name: source-openapi-spec
description: Use when sourcing the OpenAPI spec for a net-new provider and running the IAM go/no-go gate before any access-model design. Do not use when the spec is already sourced - invoke design-access-model instead.
version: 0.1.3
---

# source-openapi-spec

An in-app connector is spec-driven: the sourced OpenAPI document is the
contract the access model and the source are built from. Sourcing it wrong
ships wrong request shapes; skipping the IAM go/no-go gate ships a shell
connector with no governance value.

## Step 1 - Find candidates, rank by the authority ladder

From most to least authoritative:

1. **Official published spec at a stable URL** (e.g. the provider's
   `https://<host>/openapi.json`). Keep the original verbatim; record URL + fetch date.
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

## Step 3 - Fetch through storage, then size for review

When `web_request` is available, call it as a DIRECT tool. It is unavailable
inside `execute` or code-mode scripts by design: those programs have no external
web egress. Do not retry it inside code mode.
If a direct fetch is denied before staging, use an explicitly permitted external
fetch-and-upload route or a smaller vendor-published spec; never bypass a guard.

In hosted sessions, large responses are automatically staged to file storage
with a returned path. Process and upload from storage, never through the
conversation: in one `execute` program, read that path with OPFS, parse the
fetch envelope, extract `body` as UTF-8 bytes or decode `body_base64`, write
the exact bytes to a non-system source directory, and compute SHA-256.
The model sees the returned path/summary, not the full spec; copying errors are
not a reason to reconstruct or trim it. Retain the fetch record (URL, fetch
time, and digest) and verify the saved bytes against its digest where supplied.
If the response arrives inline rather than staged (auto-staging can be disabled),
use the permitted out-of-band upload fallback, not conversation copying.
The hosted storage path is roughly three tool steps: fetch, process, transfer;
budget for those steps instead of retrying code-mode fetch.

After preparing all files in storage, use the storage-to-draft source transfer
to copy the complete source directory server-side. External agents may use
their own web-fetch and file tools. If storage transfer is unavailable or
denied, use only an explicitly permitted out-of-band source upload for files
exceeding inline transport: declare the complete set and exact byte lengths,
upload bytes with the supplied headers, then finalize. Otherwise stop and
report the blocker; never reconstruct a spec from memory or docs.

Run `wc -c` on the saved files. These are DIFFERENT limits:

- Source upload admission: 12 MiB (12582912 bytes) per file, 16 MiB total.
- Direct `web_request` response: at most 8 MiB; larger fetches require the
  permitted external fetch-and-upload route or a smaller vendor-published spec.
- Recorded declarative artifact: `openapi.json` must be at most 4 MiB
  (4194304 bytes); a larger file can upload successfully but fail the build.
- Review/evidence context budget: model-dependent, on the order of 1 MB TOTAL
  for the spec, reviewed operations, and probe evidence, with additional prompt
  and output reservations. Upload/build success does not establish activation
  readiness; over-budget evidence cannot receive acceptance.
- The raw spec is not embedded whole in `connector.js`; the 262144-byte
  connector source compile cap and 1048576-byte compiled bundle cap are not
  raw-spec limits.

Preserve the original whole spec as `openapi.full.json` when it fits source
upload caps. Review and evidence consume `openapi.json`, not that extra source
file; do not import the full spec into connector code or inline it into reviewed
operations. A 2.5 MB whole spec fits storage and recording but needs filtering
for the usual activation context budget.

If the original exceeds the review/evidence allocation, use a reproducible
filter script to create `openapi.json` with the needed paths and their transitive
referenced schemas (`$ref` closure). Retain fetch-URL and digest provenance,
the original digest, the script, and the filtered digest. Keep the original in
storage even if it exceeds draft-upload caps. Re-run the filter from that
original as the expand loop adds operations; never silently overwrite it.
For real drafts, store this provenance in the digest-bound `runtime-manifest.json`:
original URL/fetch time, original and filtered SHA-256, and filter-script path
and SHA-256. Keep the script and original bytes, not just conversation notes.
Keep a small spec whole only when it fits BOTH recording and context budgets.
Allocate `spec_budget_bytes` from the active context budget after reserving
space for reviewed operations, evidence, prompts, and outputs; it is not a
universal platform cap. Follow the served guide and actual budget feedback.

## Output Contract

Emit the `sourcing` and `park_evidence` halves of the pre1.json artifact:

- `sourcing`: `{spec_url, fetched_at, authority_rung, spec_bytes, spec_budget_bytes}`.
  - `spec_url` (string) and `fetched_at` (string, ISO-8601).
  - `authority_rung` (string, NOT a number) - the rung named in words, e.g.
    `"official published spec at a stable URL"` for rung 1.
  - `spec_bytes` (integer) - `wc -c` on the review-ready `openapi.json`, above
    0 and at most 4194304 AND `spec_budget_bytes`. Retain the original byte
    count separately in the fetch record.
  - `spec_budget_bytes` (positive integer) - the spec allocation left in the
    active review/evidence context after reserving the other inputs and outputs.
    This is a planning check, not proof of later evidence acceptance.
- `park_evidence`: `{spec_version_checked, missing_paths, vendor_doc, revisit_trigger}`.
  - `spec_version_checked` (string) - the provider's bare version value and
    nothing else, e.g. `"1.2.0"`. Not a sentence, and not a composite carrying
    hashes, byte counts, or fetch timestamps; those belong in `sourcing`.
  - `missing_paths` (non-empty array of non-empty strings) - the literal
    OpenAPI path templates that are absent, e.g. `["/v1/users", "/v1/groups",
    "/v1/groups/{groupId}/members"]`. Not prose descriptions of the missing
    capability families.
  - `vendor_doc` (string) and `revisit_trigger` (string), both non-empty.

## Exit criteria

- The spec is sourced from the highest authority-ladder rung available.
- The IAM go/no-go gate ran programmatically against the spec's paths.
- `spec_bytes` fits both the 4 MiB recording cap and its context allocation.
- A park decision carries all four `park_evidence` fields.

## Anti-patterns

- Do not source from docs or memory - verify paths programmatically.
- Do not ship a whoami-shell connector when the IAM surface is missing.
- Do not apply the compiled bundle cap to the raw spec or edit away its provenance.
- Do not vendor an unverified checked-in spec snapshot.

## Blocker protocol

- Track validation/runtime FAILs on one revision line (a draft and its successive source/build revisions); stop after 3 consecutive FAILs. Only a verified PASS ends that FAIL streak.
- Also stop as soon as any error class recurs, even when the text changes. Classify by underlying cause, not message text; symptom patches, re-uploads, fresh run/revision IDs, and stage changes do not reset tracking.
- Before any fix, grep the staged SDK declarations (including `runtime.d.ts`) for every field a diagnostic names; read its type and surrounding contract. If unavailable or ambiguous, stop rather than guess.
- At the stop, report the error class, exact latest error text, failed attempts, declaration evidence, and blocker; do not retry or patch past it.
