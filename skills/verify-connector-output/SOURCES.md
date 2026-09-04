# Sources - verify-connector-output

Authored against the pinned sources below (decision 5: nothing written from
model memory). Source-of-truth precedence: (a) MCP-served guide, (b)
`authoring.proto`, (c) lifecycle doc, (d) marketplace `probe-contracts.md`.

| Source | Pin / SHA | What this skill quotes |
|---|---|---|
| MCP-served guide | c1 `2e5f53eb441a93087d9754085ca17a5061e125ea` | The Production-sync verification contract verbatim: inspect resource/entitlement/grant counts for the intended scope; every grant principal references an emitted resource; every grant entitlement ID references an emitted entitlement; "Investigate empty or unexpected results; never invent data to make a demo appear complete". |
| Authoring proto | c1 `2e5f53eb441a93087d9754085ca17a5061e125ea` | The authoring RPC surface the post-activation session must not call during verification (the funnel tools; verification uses the tenant connector tools). |
| Lifecycle doc | c1 `2e5f53eb441a93087d9754085ca17a5061e125ea` | "What success looks like": `SYNC_STATUS_DONE` via `c1_connector_service_get` (a subsequent `sync_disabled` is normal); the UI spot-check path `/admin/connector/<catalog_id>/<app_id>/<connector_id>`. |
| Marketplace `probe-contracts.md` | claude-marketplace `0cc5ac2a2dbe60b430444c59e53016da2c72b3d1` | The assertion-inventory adaptations: per-resource-type sync counts; count parity against the live API, not the seed list; ID stability across re-sync. |
