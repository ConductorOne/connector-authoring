# Sources - source-openapi-spec

The five-rung authority ladder, programmatic IAM go/no-go gate, and
park-with-evidence contract were informed by internal design discussion.
That discussion is not a fetchable public source. Record the exact provider
spec URL, fetch time, and byte count for each authoring run; a provider name
or a moving branch alone is not a reproducible spec pin.

In-repo content is referenced by relative path and is always current with the checkout; skills and examples evolve in the same commit.

| Source | Public pin / access | What this skill uses |
|---|---|---|
| SDK declarations and examples | `../../baton/*.d.ts`, `../../examples/http/openapi.json` (this checkout) | `baton/*.d.ts` and `examples/http/openapi.json` for the source shapes a frozen spec feeds. |
| Historical SDK baseline | [v0.0.26](https://github.com/ConductorOne/connector-authoring/tree/v0.0.26) | Historical declaration release, not proof of compatibility with the current tenant runtime. |
| Tenant-served authoring guide | Read through `c1_connector_authoring_get_authoring_guide` | Current source and bundle limits and lifecycle requirements. |

Provider specs must be verified at their authoritative source during the run;
no unlinked historical provider artifact is presented here as a public pin.
