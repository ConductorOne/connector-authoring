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
