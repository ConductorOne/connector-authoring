# Sources — author-in-app-connector

Authored against the pinned sources below (decision 8: nothing written from
model memory). Source-of-truth precedence: (a) MCP-served guide, (b)
`authoring.proto`, (c) lifecycle doc, (d) in-repo `baton/*.d.ts` +
`examples/http`.

| Source | Path | Pin / SHA | What this skill quotes |
|---|---|---|---|
| MCP-served guide | `pkg/api/connector_authoring/authoring_guide.md` | c1 `2502b4cd8f59bf6614616013010ec4f0bf72f9ae` | The 12-step lifecycle list; the human-only activation rule ("Activation is a human-only tenant UI step, never an agent action"); the out-of-band uploads paragraph (`upload_targets`, `required_headers`). |
| Authoring proto | `protos/c1api/c1/api/connector_authoring/v1/authoring.proto` | c1 `2502b4cd8f59bf6614616013010ec4f0bf72f9ae` | RPC titles for every funnel step (`connector_authoring_create_draft`, `connector_authoring_create_draft_source_upload`, `connector_authoring_finalize_draft_source_upload`, `connector_authoring_build_bundle`, `connector_authoring_get_run`, `connector_authoring_run_draft_test_sync`, `connector_authoring_get_test_run_evidence`, `connector_authoring_provision_connector`, `connector_authoring_deploy_connector_instance`, `connector_authoring_mint_approval_token`); `MintApprovalTokenResponse.activation_url`. |
| Lifecycle doc | `docs/in-app-connector-authoring.md` | c1 `2502b4cd8f59bf6614616013010ec4f0bf72f9ae` | The 12-step order and stop-if gates; the handoff-table discipline (fill every row from the tool response of the step that produces it); step 11's human-OWNER handoff. |
| In-repo SDK declarations | `baton/*.d.ts` | connector-authoring `b7e8a616cbbb1e336b788f807a3810b08ae00bc7` | The `.d.ts` module surface the funnel's source files are authored against. |
