# Sources — write-connector-source

Authored against the pinned sources below (decision 11: nothing written from
model memory). Source-of-truth precedence: (a) MCP-served guide, (b)
`authoring.proto`, (c) lifecycle doc, (d) in-repo `baton/*.d.ts` +
`examples/{static,http}`. The `WithExternalID` deprecation and the
capabilities-as-real-contract correction come from the CXF-70 Linear
corrections (the batch's locked intent, plan decisions 4 and 7); the c1 docs
at the pinned SHA still carry the presence-only capabilities wording.

| Source | Pin / SHA | What this skill quotes |
|---|---|---|
| MCP-served guide | c1 `92f1c2e54ec6ca1371c988e580a8cd4865a4c283` | The required-source-files table; entrypoint rules (root `connector.ts` wins); config-schema secrets spellings (`is_secret`/`isSecret`/`IsSecret`); the caps table (262144-byte compile, 1048576-byte bundle); the ticketing caveat; evidence-and-credentials. |
| Authoring proto | c1 `92f1c2e54ec6ca1371c988e580a8cd4865a4c283` | The authoring RPC surface context (create_draft, upload, build, test, deploy, mint) the funnel stages map onto. |
| Connector capabilities proto | c1 `92f1c2e54ec6ca1371c988e580a8cd4865a4c283` | The `ConnectorCapabilities` contract: `connectorCapabilities`, `resourceTypeCapabilities[]` with `resourceType{id,displayName,traits}` + `capabilities[]`; the `Capability` enum (`CAPABILITY_SYNC`/`CAPABILITY_PROVISION`/`CAPABILITY_ACCOUNT_PROVISIONING`). This contract lives in the vendor_baton proto, NOT in `authoring.proto`. |
| Lifecycle doc | c1 `92f1c2e54ec6ca1371c988e580a8cd4865a4c283` | The source-file contract section (the four-file table, per-file rules, the two example shapes); the dual config schema section; the common-failures table; the Okta worked example; transport registration (every transport referenced by a `node` or `reuse` must be the same object registered under `connector({ transports: ... })`). |
| In-repo SDK declarations + examples | connector-authoring `84a5832bb1417ea646a2db84ea2b01f6a5242ccf` | The `baton/*.d.ts` module surface (`@baton/runtime` `connector`/`config`/`slot`/`node`/`walk`/`reuse`/`http.v1`); slot identity by JS reference (`runtime.d.ts`: "Identity is by JS reference: two `slot<T>()` calls are two distinct channels"); the `@baton/*` import surface (`@baton/runtime`, `@baton/types`, `@baton/helpers`); `examples/{static,http}` skeletons (zero-config; transport + offset pagination + users/groups/membership grants). |
| `runtime-gotchas.md` | claude-marketplace `0cc5ac2a2dbe60b430444c59e53016da2c72b3d1` | The traps this skill quotes: opaque config refs (`ref \|\| default` never fires for transports - trap 1), ES5 bundle target (no `u` regex flag, goja quirks - trap 3), offset-pagination `totalPath` termination (trap 6), list-call scoping (trap 7). |
| shopify `Makefile` | baton-axiomatic-shopify `6ea2834043832f7bb21ca59111de2cf021c17518` | The `capabilities` target: `env $(CAPABILITIES_ENV) BATON_CONFIG=<config> baton-axiomatic capabilities > baton_capabilities.json` with `CAPABILITIES_ENV ?= BATON_BASE_URL=https://placeholder.myshopify.com BATON_TOKEN=placeholder`; capability generation never makes network calls. |
| Investigation (internal artifact, not a fetchable pin) | `/shared/src-hv96/investigation.md` | §3.1 source-file contract, §5 skill 5, §8 build order step 4. |
| SDK contract (`baton/*.d.ts`) | connector-authoring git tag `v0.0.26` (sync commit `01a69d8d` "Sync baton runtime types for v0.0.26") | The `.d.ts` module surface this skill is authored against. `runtime_pin_matched`: not verifiable offline — no tenant MCP surface is reachable from the authoring env; repo tag v0.0.26 is the served default_tag when the tenant runtime pin matches (see `read-authoring-contract` for the runtime check). |
| baton-axiomatic DSL contract | baton-axiomatic `docs/DSL.md` + `runtime/baton/*.d.ts` @ v0.0.26 (`825e5516…`) | The DSL semantics ground truth the in-repo `.d.ts` are synced from. |
| baton-admin DSL skill | baton-admin `author-js-dsl-connector` @ `6fe6886f607ed0d2e48a616c30e7ce4bffc32489` | The JS DSL authoring rules this skill's source-file contract aligns with. |
| baton-admin DSL skill | baton-admin `author-auth-config-surface` @ `6fe6886f607ed0d2e48a616c30e7ce4bffc32489` | The auth-config surface rules this skill's config-schema contract aligns with. |
