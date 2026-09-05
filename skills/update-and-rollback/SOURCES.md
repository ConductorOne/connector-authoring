# Sources - update-and-rollback

Authored against the pinned sources below (decision 5: nothing written from
model memory). Source-of-truth precedence: (a) MCP-served guide, (b)
`authoring.proto`, (c) lifecycle doc.

| Source | Pin / SHA | What this skill quotes |
|---|---|---|
| MCP-served guide | c1 `2e5f53eb441a93087d9754085ca17a5061e125ea` | The "Updating an active connector" contract: reuse the existing managed runtime instance, update the draft source, build a new revision, fresh PASS evidence, mint a new approval URL, human OWNER activates, poll `list_revision_summaries` until ACTIVE, record `activation_epoch`, force sync. |
| Authoring proto | c1 `2e5f53eb441a93087d9754085ca17a5061e125ea` | `MintApprovalToken` (`expires_in_seconds` 1-14400, `activation_url`); `ListRevisionSummaries` + `RevisionStatus` enum (`REVISION_STATUS_ACTIVE` = 1, `activation_epoch` on the ACTIVE row). The proto exposes no rollback RPC - its service comment notes rollback is the REST-only endpoint; the rollback contract lives in the lifecycle doc row below. |
| Lifecycle doc | c1 `2e5f53eb441a93087d9754085ca17a5061e125ea` | The "Updating and rolling back a live connector" section: the image-digest reuse rule; the rotation STOP verbatim (`serve image does not match the revision-pinned runtime image`; do not clear runtime fields, call the provisioner directly, or mutate the deployment or AWS resources; record tenant/catalog/app/connector/target-revision IDs; escalate to Connector Authoring / managed-runtime engineering); the REST-only OWNER-gated rollback body and the strictly-greater-activation-epoch pointer move. |
| c1 Go source (same pin) | c1 `2e5f53eb441a93087d9754085ca17a5061e125ea` | The `SYNC_STATUS_ERROR` / `SYNC_STATUS_DISABLED` terminal-state semantics: `ConnectorStatusToAPI` derives DISABLED only from an ERROR-classified sync; `sync_disabled_reason` distinguishes the data-anomaly auto-pause from deliberate pauses. |
| SDK contract (`baton/*.d.ts`) | connector-authoring git tag `v0.0.26` (sync commit `01a69d8d` "Sync baton runtime types for v0.0.26") | The `.d.ts` module surface this skill is authored against. `runtime_pin_matched`: not verifiable offline — no tenant MCP surface is reachable from the authoring env; repo tag v0.0.26 is the served default_tag when the tenant runtime pin matches (see `read-authoring-contract` for the runtime check). |
| baton-axiomatic DSL contract | baton-axiomatic `docs/DSL.md` + `runtime/baton/*.d.ts` @ v0.0.26 (`825e55166ea24b44f075500eec0df7d3f461a7ac`) | The DSL semantics ground truth the in-repo `.d.ts` are synced from. |
