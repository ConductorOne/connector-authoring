# Sources - design-access-model

The resource/trait mapping, stable-ID rules, entitlement definitions, grant
source map, provisioning scope, and compatibility table were informed by
internal design discussion. That discussion is not a fetchable public source;
the public declarations and worked examples below ground the SDK shapes.

| Source | Public pin / access | What this skill uses |
|---|---|---|
| SDK declarations and examples | [connector-authoring at 8c5d8bd](https://github.com/ConductorOne/connector-authoring/tree/8c5d8bd1e48fbdb2e1502420cdf3d7939fb1010d) | `baton/types.d.ts` trait constants and `examples/{static,http}` resource, entitlement, and grant mappings. |
| Historical SDK baseline | [v0.0.26](https://github.com/ConductorOne/connector-authoring/tree/v0.0.26) | Historical declaration release, not proof of compatibility with the current tenant runtime. |
| Spec-sourcing skill | `../source-openapi-spec/SKILL.md` | IAM go/no-go and park-with-evidence handoff. |
| Tenant-served authoring guide | Read through `c1_connector_authoring_get_authoring_guide` | Current lifecycle requirements and bundle caps. |

## Eval wiring

- The pre-1 eval checks that `id_compatibility` is non-empty and every `provisioning` entry has a non-empty `justification`.
