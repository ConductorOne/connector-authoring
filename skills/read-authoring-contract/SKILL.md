---
name: read-authoring-contract
description: Use when starting a connector authoring session and you need the authoritative contract before writing any source. Do not use when you already hold a fresh get_authoring_guide response for this session and are mid-funnel.
version: 0.1.0
---

# read-authoring-contract

Read the authoritative authoring contract before composing any source file.
Tool names below are the exact tenant MCP titles; the served guide
abbreviates them (e.g. `get_authoring_guide` for
`c1_connector_authoring_get_authoring_guide`).

## Checklist

1. Call `c1_connector_authoring_get_authoring_guide` (no arguments). GATE:
   the response is the served guide; read it once before composing any
   source. STOP if the call errors or returns no guide body.
   Served-guide-wins rule (verbatim): when the served guide conflicts with
   any other doc (including this skill or the lifecycle doc), the served
   guide wins.
2. If `c1_connector_authoring_list_sdk_types_versions` is present in this
   session, call it. GATE: capture `default_tag` and `runtime_pin_matched`
   from the response; STOP if either field is missing. If the tool is
   absent, proceed - the served guide is the contract.
3. If `c1_connector_authoring_get_sdk_types` is present, call it with
   `tag: default_tag`. GATE: the returned `.d.ts` files are received; STOP
   if the response carries no declaration files. If the tool is absent,
   proceed - the served guide is the contract.
4. Apply the `runtime_pin_matched` decision table:

   | `runtime_pin_matched` | Meaning and action |
   |---|---|
   | `true` | The tagged declarations are the compatibility contract for the tenant's pinned runtime. Proceed. |
   | `false` | `default_tag` is the latest release, NOT a confirmed runtime match. Surface that limitation rather than claiming compatibility. |

5. Resume-existing-work check BEFORE creating anything: if
   `c1_connector_authoring_list_authored_catalog_entries` and
   `c1_connector_authoring_list_drafts` are present, call them (list_drafts
   with the returned `catalog_id`). GATE: if an existing `catalog_id` +
   `draft_id` is found, reuse it and report it to the orchestrator; if none
   exists, report "no existing draft - return to the orchestrator for S1"
   (`create_draft` is orchestrator-owned). Record every returned ID. STOP
   if the listing calls error. If the tools are absent, proceed - the served
   guide is the contract. In a fresh tenant the resume check finds nothing,
   so the orchestrator runs S1; the reuse path is for real resumed sessions
   only.

## Exit criteria

- S0 passes: at least one successful
  `c1_connector_authoring_get_authoring_guide` call in the transcript.
- The skill body instructs the resume check
  (`c1_connector_authoring_list_authored_catalog_entries` +
  `c1_connector_authoring_list_drafts`) before any
  `c1_connector_authoring_create_draft` call (string check; the scorer's S1
  gate does not enforce it).
- The body contains the literal tool names `list_sdk_types_versions`,
  `get_sdk_types`, `list_authored_catalog_entries`, `list_drafts`, and the
  literal strings `runtime_pin_matched` and `default_tag`.

## Anti-patterns

- Do not skip the guide read and compose source from memory.
- Do not create a draft before the resume check.
- Do not trust model memory over the served guide.
- Do not claim compatibility when `runtime_pin_matched` is false.

## Blocker protocol

If the same validation or runtime error remains unchanged after 2 failed fix
cycles on the same error, stop and report the exact error text instead of
guessing further.
