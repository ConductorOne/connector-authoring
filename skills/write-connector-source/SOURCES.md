# Sources — write-connector-source

Authored against the pinned sources below (decision 11: nothing written from
model memory). Source-of-truth precedence: (a) MCP-served guide, (b)
`authoring.proto`, (c) lifecycle doc, (d) in-repo `baton/*.d.ts` +
`examples/{static,http}`.

| Source | Pin / SHA | What this skill quotes |
|---|---|---|
| MCP-served guide | c1 `92f1c2e54ec6ca1371c988e580a8cd4865a4c283` | The required-source-files table; entrypoint rules (root `connector.ts` wins); config-schema secrets spellings (`is_secret`/`isSecret`/`IsSecret`); the caps table (262144-byte compile, 1048576-byte bundle); the ticketing caveat; evidence-and-credentials. |
| Authoring proto | c1 `92f1c2e54ec6ca1371c988e580a8cd4865a4c283` | The authoring RPC surface context (create_draft, upload, build, test, deploy, mint) the funnel stages map onto. |
| Connector capabilities proto | c1 `92f1c2e54ec6ca1371c988e580a8cd4865a4c283` | The `ConnectorCapabilities` contract: `connectorCapabilities`, `resourceTypeCapabilities[]` with `resourceType{id,displayName,traits}` + `capabilities[]`; the `Capability` enum (`CAPABILITY_SYNC`/`CAPABILITY_PROVISION`/`CAPABILITY_ACCOUNT_PROVISIONING`). This contract lives in the vendor_baton proto, NOT in `authoring.proto`. |
| Lifecycle doc | c1 `92f1c2e54ec6ca1371c988e580a8cd4865a4c283` | The source-file contract section (the four-file table, per-file rules, the two example shapes); the dual config schema section; the common-failures table; the Okta worked example. |
| In-repo SDK declarations + examples | connector-authoring `84a5832bb1417ea646a2db84ea2b01f6a5242ccf` | The `baton/*.d.ts` module surface (`@baton/runtime` `connector`/`config`/`slot`/`node`/`walk`/`reuse`/`http.v1`); `examples/{static,http}` skeletons (zero-config; transport + offset pagination + users/groups/membership grants). |
| `runtime-gotchas.md` | claude-marketplace `0cc5ac2a2dbe60b430444c59e53016da2c72b3d1` | The 12 traps: opaque config refs (`ref \|\| default` never fires for transports), transport registration, slot identity by JS reference, ES5 bundle target (no `u` regex flag, goja quirks), `@baton/*` resolution. |
| shopify `Makefile` | baton-axiomatic-shopify `6ea2834043832f7bb21ca59111de2cf021c17518` | The `capabilities` target: `env $(CAPABILITIES_ENV) BATON_CONFIG=<config> baton-axiomatic capabilities > baton_capabilities.json` with `CAPABILITIES_ENV ?= BATON_BASE_URL=https://placeholder.myshopify.com BATON_TOKEN=placeholder`; capability generation never makes network calls. |
| Investigation | `/shared/src-hv96/investigation.md` | §3.1 source-file contract, §5 skill 5, §8 build order step 4. |
