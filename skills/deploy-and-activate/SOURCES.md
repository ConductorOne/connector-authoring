# Sources — deploy-and-activate

Authored against the pinned sources below (decision 8: nothing written from
model memory). Source-of-truth precedence: (a) MCP-served guide, (b)
`authoring.proto`, (c) lifecycle doc, (d) in-repo `baton/*.d.ts` +
`examples/http`.

| Source | Path | Pin / SHA | What this skill quotes |
|---|---|---|---|
| MCP-served guide | `pkg/api/connector_authoring/authoring_guide.md` | c1 `2502b4cd8f59bf6614616013010ec4f0bf72f9ae` | The human-only activation rule (configure credentials in the Admin UI; never ask a human to paste secrets into agent chat; activation is a human-only tenant UI step); `mint_approval_token.expires_in_seconds` 1–14400. |
| Authoring proto | `protos/c1api/c1/api/connector_authoring/v1/authoring.proto` | c1 `2502b4cd8f59bf6614616013010ec4f0bf72f9ae` | `MintApprovalTokenResponse` (`token_id`, `expires_at`, `activation_url`; `expires_in_seconds` gt 0, lte 14400); `RevisionStatus` enum (`REVISION_STATUS_ACTIVE` = 1, `activation_epoch` on the ACTIVE row); `ProvisionConnector` / `DeployConnectorInstance` RPC titles. |
| Lifecycle doc | `docs/in-app-connector-authoring.md` | c1 `2502b4cd8f59bf6614616013010ec4f0bf72f9ae` | Step 8's `c1_connector_service_get` + `c1_connector_service_update` with `updateMask: "config"` and the `EnvConfig` `configuration` JSON (keys must match `config("field-name")`); the empty-`stringValue`-deletes-the-secret warning; step 11a–11d (deploy → mint → hand off to human OWNER → poll `list_revision_summaries` until `REVISION_STATUS_ACTIVE` + record `activation_epoch` → `c1_connector_service_force_sync`); "What success looks like" (`SYNC_STATUS_DONE` via `c1_connector_service_get`; a subsequent `sync_disabled` is normal); the common-failures rows (`credential re-entry required`, `activation evidence is unsatisfied`). |
| In-repo SDK declarations | `baton/*.d.ts` | connector-authoring `b7e8a616cbbb1e336b788f807a3810b08ae00bc7` | The `config("field-name")` names the `configuration` keys must match (see `examples/http/connector.ts`: `base-url`, `account-email`, `api-token`). |
