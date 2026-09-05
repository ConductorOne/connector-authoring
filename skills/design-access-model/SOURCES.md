# Sources — design-access-model

Authored against the pinned sources below (decision 13: nothing written from
model memory). The three decision tables, the stable-ID rules, and the
`WithExternalID` deprecation are the locked intent of this batch (plan
decisions 2-3); the port source below is what this skill quotes.

| Source | Pin / SHA | What this skill quotes |
|---|---|---|
| baton-admin `design-baton-access-model` | `6fe6886f607ed0d2e48a616c30e7ce4bffc32489` | The design port source: resource-type/trait mapping, stable-ID rules (never display names/emails/mutable slugs), entitlement definitions, grant source map, provisioning scope note, ID compatibility table, handoff discipline. |
| claude-marketplace `source-openapi-spec` | `0cc5ac2a2dbe60b430444c59e53016da2c72b3d1` | The IAM go/no-go + park-with-evidence contract this skill's handoff to `source-openapi-spec` carries. |
| c1 `docs/in-app-connector-authoring.md` | `16e0e0fbf0c999e3942f1ea0f8aef95c65e6fbc3` | The bundle caps (262144-byte source, 1048576-byte bundle) and the lifecycle contract the pre-1 judgment phase feeds. |
| In-repo SDK declarations + examples | connector-authoring `7dc673ac86616503acee3d45f98348370dc155cd` | The `baton/types.d.ts` TRAIT_* consts (`TRAIT_USER`, `TRAIT_GROUP`, `TRAIT_ROLE`, `TRAIT_APP`, `TRAIT_SECRET`) and the `examples/` access-model shapes. |
| SDK contract (`baton/*.d.ts`) | connector-authoring git tag `v0.0.26` (sync commit `01a69d8d` "Sync baton runtime types for v0.0.26") | The `.d.ts` module surface this skill is authored against. `runtime_pin_matched`: not verifiable offline — no tenant MCP surface is reachable from the authoring env; repo tag v0.0.26 is the served default_tag when the tenant runtime pin matches (see `read-authoring-contract` for the runtime check). |
| baton-axiomatic DSL contract | baton-axiomatic `docs/DSL.md` + `runtime/baton/*.d.ts` @ v0.0.26 (`825e55166ea24b44f075500eec0df7d3f461a7ac`) | The DSL semantics ground truth the in-repo `.d.ts` are synced from. |
| Worked build — access-model shape | baton-axiomatic-openrouter#1 | The access-model shape (resource types, traits, entitlements, grants) this worked build demonstrates. |
| Worked build — access-model shape | baton-axiomatic-litellm#1 | The access-model shape (resource types, traits, entitlements, grants) this worked build demonstrates. |
| Worked build — access-model shape | baton-axiomatic-shopify | The access-model shape (resource types, traits, entitlements, grants) this worked build demonstrates. |
