# Sources — read-authoring-contract

Authored against the pinned sources below (decision 8: nothing written from
model memory). Source-of-truth precedence: (a) MCP-served guide, (b)
`authoring.proto`, (c) lifecycle doc, (d) in-repo `baton/*.d.ts` +
`examples/http`.

| Source | Pin / SHA | What this skill quotes |
|---|---|---|
| MCP-served guide | c1 `2502b4cd8f59bf6614616013010ec4f0bf72f9ae` | The "SDK declarations and examples" paragraph (`list_sdk_types_versions`, `runtime_pin_matched`, `get_sdk_types` with `default_tag`); the "Recovery and iteration" paragraph (resume check before `create_draft`); the served-guide-wins rule. |
| Authoring proto | c1 `2502b4cd8f59bf6614616013010ec4f0bf72f9ae` | RPC titles `connector_authoring_get_authoring_guide`, `connector_authoring_list_sdk_types_versions`, `connector_authoring_get_sdk_types`, `connector_authoring_list_authored_catalog_entries`, `connector_authoring_list_drafts`, `connector_authoring_create_draft`; `ListSDKTypesVersionsResponse` fields `default_tag` / `runtime_pin_matched`. |
| Lifecycle doc | c1 `2502b4cd8f59bf6614616013010ec4f0bf72f9ae` | Step 0 (guide read) and the handoff-table discipline (record every returned ID). |
| In-repo SDK declarations | connector-authoring `b7e8a616cbbb1e336b788f807a3810b08ae00bc7` | The `.d.ts` module surface (`@baton/runtime`, `@baton/helpers`, `@baton/types`) the tagged declarations cover. |
| SDK contract (`baton/*.d.ts`) | connector-authoring git tag `v0.0.26` (sync commit `01a69d8d` "Sync baton runtime types for v0.0.26") | The `.d.ts` module surface this skill is authored against. `runtime_pin_matched`: not verifiable offline — no tenant MCP surface is reachable from the authoring env; repo tag v0.0.26 is the served default_tag when the tenant runtime pin matches (see `read-authoring-contract` for the runtime check). |
| baton-axiomatic DSL contract | baton-axiomatic `docs/DSL.md` + `runtime/baton/*.d.ts` @ v0.0.26 (`825e5516…`) | The DSL semantics ground truth the in-repo `.d.ts` are synced from. |
