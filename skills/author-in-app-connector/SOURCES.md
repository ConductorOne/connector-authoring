# Sources — author-in-app-connector

Authored against the pinned sources below (decision 8: nothing written from
model memory). Source-of-truth precedence: (a) MCP-served guide, (b)
`authoring.proto`, (c) lifecycle doc, (d) in-repo `baton/*.d.ts` +
`examples/http`.

| Source | Pin / SHA | What this skill quotes |
|---|---|---|
| MCP-served guide | c1 `2502b4cd8f59bf6614616013010ec4f0bf72f9ae` | The 12-step lifecycle list; the human-only activation rule ("Activation is a human-only tenant UI step, never an agent action"); the out-of-band uploads paragraph (`upload_targets`, `required_headers`). |
| Authoring proto | c1 `2502b4cd8f59bf6614616013010ec4f0bf72f9ae` | RPC titles for every funnel step (`connector_authoring_create_draft`, `connector_authoring_create_draft_source_upload`, `connector_authoring_finalize_draft_source_upload`, `connector_authoring_build_bundle`, `connector_authoring_get_run`, `connector_authoring_run_draft_test_sync`, `connector_authoring_get_test_run_evidence`, `connector_authoring_provision_connector`, `connector_authoring_deploy_connector_instance`, `connector_authoring_mint_approval_token`); `MintApprovalTokenResponse.activation_url`. |
| Lifecycle doc | c1 `2502b4cd8f59bf6614616013010ec4f0bf72f9ae` | The 12-step order and stop-if gates; the handoff-table discipline (fill every row from the tool response of the step that produces it); step 11's human-OWNER handoff. |
| In-repo SDK declarations | connector-authoring `b7e8a616cbbb1e336b788f807a3810b08ae00bc7` | The `.d.ts` module surface the funnel's source files are authored against. |
| SDK contract (`baton/*.d.ts`) | connector-authoring git tag `v0.0.26` (sync commit `01a69d8d` "Sync baton runtime types for v0.0.26") | The `.d.ts` module surface this skill is authored against. `runtime_pin_matched`: not verifiable offline — no tenant MCP surface is reachable from the authoring env; repo tag v0.0.26 is the served default_tag when the tenant runtime pin matches (see `read-authoring-contract` for the runtime check). |
| baton-axiomatic DSL contract | baton-axiomatic `docs/DSL.md` + `runtime/baton/*.d.ts` @ v0.0.26 (`825e55166ea24b44f075500eec0df7d3f461a7ac`) | The DSL semantics ground truth the in-repo `.d.ts` are synced from. |
