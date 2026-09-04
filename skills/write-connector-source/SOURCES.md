# Sources — write-connector-source

Authored against the pinned sources below (decision 11: nothing written from
model memory). Source-of-truth precedence: (a) MCP-served guide, (b)
`authoring.proto`, (c) lifecycle doc, (d) in-repo `baton/*.d.ts` +
`examples/`.

| Source | Pin / SHA | What this skill quotes |
|---|---|---|
| MCP-served guide | c1 `92f1c2e54ec6ca1371c988e580a8cd4865a4c283` | The required-source-files table; entrypoint rules (root `connector.ts` wins); config-schema secrets spellings (`is_secret`/`isSecret`/`IsSecret`); caps table (262144/1048576/16 MiB/12 MiB/256); ticketing caveat; evidence-and-credentials. |
| Authoring proto | c1 `92f1c2e54ec6ca1371c988e580a8cd4865a4c283` | The authoring RPC surface context: the create/update-draft source-file contract, `required_source_files`, and the build rejection rules. |
| Connector capabilities proto | c1 `92f1c2e54ec6ca1371c988e580a8cd4865a4c283` | The `ConnectorCapabilities` contract (`connectorCapabilities`, `resourceTypeCapabilities[]`, `Capability` enum `CAPABILITY_SYNC`/`CAPABILITY_PROVISION`/`CAPABILITY_ACCOUNT_PROVISIONING`). This contract lives in the vendor_baton proto, not in `authoring.proto`. |
| Lifecycle doc | c1 `92f1c2e54ec6ca1371c988e580a8cd4865a4c283` | The source-file contract section; the dual config schema section; the common-failures table; the Okta worked example. |
| In-repo SDK declarations + examples | connector-authoring `84a5832bb1417ea646a2db84ea2b01f6a5242ccf` | `baton/*.d.ts` module surface; `examples/{static,http}` skeletons. |
| `runtime-gotchas.md` | claude-marketplace `0cc5ac2a2dbe60b430444c59e53016da2c72b3d1` | The 12 traps (opaque config refs, transport registration, slot identity, ES5). |
| shopify `Makefile` | baton-axiomatic-shopify `6ea2834043832f7bb21ca59111de2cf021c17518` | The `capabilities` target (`CAPABILITIES_ENV` placeholder pattern). |
| Investigation | `/shared/src-hv96/investigation.md` | §3.1 source-file contract, §5 skill 5, §8 build order step 4. |
