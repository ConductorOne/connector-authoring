# Sources — source-openapi-spec

Authored against the pinned sources below (decision 13: nothing written from
model memory). The 5-rung authority ladder, the programmatic IAM go/no-go
gate, and the park-with-evidence contract are the locked intent of this batch
(plan decisions 4-5); the port source below is what this skill quotes.

| Source | Pin / SHA | What this skill quotes |
|---|---|---|
| claude-marketplace `source-openapi-spec` | `0cc5ac2a2dbe60b430444c59e53016da2c72b3d1` | The sourcing port source: the 5-rung authority ladder, the programmatic IAM go/no-go gate (member/user LISTING at minimum), and park-with-evidence as a success outcome. |
| c1 `docs/in-app-connector-authoring.md` | `16e0e0fbf0c999e3942f1ea0f8aef95c65e6fbc3` | The bundle caps — the 262144-byte source limit and the 1048576-byte bundle limit (lines 727-728) — and the lifecycle contract the pre-1 judgment phase feeds. |
| In-repo SDK declarations + examples | connector-authoring `7dc673ac86616503acee3d45f98348370dc155cd` | The `baton/*.d.ts` module surface and the `examples/` spec-driven connector shapes the sourced spec feeds. |
| SDK contract (`baton/*.d.ts`) | connector-authoring git tag `v0.0.26` (sync commit `01a69d8d` "Sync baton runtime types for v0.0.26") | The `.d.ts` module surface this skill is authored against. `runtime_pin_matched`: not verifiable offline — no tenant MCP surface is reachable from the authoring env; repo tag v0.0.26 is the served default_tag when the tenant runtime pin matches (see `read-authoring-contract` for the runtime check). |
| baton-axiomatic DSL contract | baton-axiomatic `docs/DSL.md` + `runtime/baton/*.d.ts` @ v0.0.26 (`825e55166ea24b44f075500eec0df7d3f461a7ac`) | The DSL semantics ground truth the in-repo `.d.ts` are synced from. |
| OpenRouter official spec (evidence) | OpenRouter official published spec (openrouter.ai), vendored verbatim | The authoritative spec evidence for a SaaS provider with an official published spec. |
| LiteLLM runtime-generated spec (evidence) | `pip install "litellm[proxy]==1.92.0"` → `app.openapi()` | The runtime-generated spec evidence for a self-hosted OSS provider. |
| Shopify vendored minimal spec (evidence) | `allengrant/shopify_openapi` @ master, discoveredAt 2026-06-04 | The vendored minimal spec evidence for a provider without an official published spec. |
