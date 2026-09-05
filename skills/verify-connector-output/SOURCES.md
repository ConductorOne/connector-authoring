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
| c1 Go source (same pin) | c1 `2e5f53eb441a93087d9754085ca17a5061e125ea` | The `SYNC_STATUS_DISABLED` semantics: `ConnectorStatusToAPI` derives DISABLED only from an ERROR-classified sync; `sync_disabled_reason` distinguishes the data-anomaly auto-pause (`Sync paused due to significant drop in sync data` prefix) from deliberate pauses (`system`, `system-customer-opt-out`). |
| SDK contract (`baton/*.d.ts`) | connector-authoring git tag `v0.0.26` (sync commit `01a69d8d` "Sync baton runtime types for v0.0.26") | The `.d.ts` module surface this skill is authored against. `runtime_pin_matched`: not verifiable offline — no tenant MCP surface is reachable from the authoring env; repo tag v0.0.26 is the served default_tag when the tenant runtime pin matches (see `read-authoring-contract` for the runtime check). |
| baton-axiomatic DSL contract | baton-axiomatic `docs/DSL.md` + `runtime/baton/*.d.ts` @ v0.0.26 (`825e55166ea24b44f075500eec0df7d3f461a7ac`) | The DSL semantics ground truth the in-repo `.d.ts` are synced from. |
