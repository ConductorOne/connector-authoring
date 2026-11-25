# Declarative HTTP directory example

This is a fictional Directory API pattern, not a vendor connector or bundled
hosted test service. An API implementing the contract below is configured with
a full base URL such as `https://directory.example`, without a trailing slash.
The fixed `/v1` prefix stays in each request path.

This pattern serves both hosted and BYO authors. Fetch it with declarations at
the tenant's runtime-compatible release tag or a reviewed commit; the served
authoring guide and tool descriptions, not this example, govern hosted gates.
For one-base-URL OAuth client credentials, see
[`../oauth-client-credentials`](../oauth-client-credentials).

Every endpoint returns this page shape:

```json
{
  "items": [],
  "offset": 0,
  "limit": 100,
  "total": 0
}
```

The fictional endpoints are:

- `GET /v1/users`: item `{ "id", "name", "email", "active" }`
- `GET /v1/groups`: item `{ "id", "name" }`
- `GET /v1/groups/{groupId}/members`: item `{ "userId" }`
- Pagination uses the `offset` and `limit` query parameters; responses carry
  `offset`, `limit`, and `total`.

`config-schema.json` and `runtime-schema.json`'s `runtime.config_schema`
declare the same tenant inputs using different JSON shapes. Keep their field
names and UI/security metadata aligned; do not copy the camelCase
configuration-proto shape into the snake_case runtime schema.
The Base URL form field supplies `stringField.suggestedValue` and a
`WELL_KNOWN_STRING_URI` rule; enter the full URL, not a bare host.

**Fixture-only exception:** the fictional `https://directory.example`
`stringField.suggestedValue` demonstrates the full-URI metadata shape; it is
not a sourced vendor URL or a production default. Do not copy this prefill
into a real per-instance connector: replace it with a Field-level `placeholder`
(a sibling of `stringField`). In production, use `suggestedValue` only for
fixed-host vendors with a sourced URL.

The connector declares a graph:

1. `config(...)` creates opaque public and secret references.
2. `http.v2(...)` declares native basic authentication. Connector code never
   reads the account email or API token.
3. Each `node` returns a `directory.GET(...)` descriptor with offset
   pagination and `itemsPath: ["items"]` to select records from each page
   envelope, matching `output_slice: "items"` in `reviewed-ops.json`.
   The hosted runtime executes requests and advances pages; `result({response})`
   receives each page's records array, not the page envelope, so it maps
   `response` directly. Without `itemsPath`, an object body becomes one record
   rather than extracting its `items` array. The runtime does not derive
   `itemsPath` from `output_slice`; declare both.
   v2 requires an explicit stopping condition: this example uses
   `totalPath: ["total"]` with `pageSize: 100` (and the response's `limit`
   through `maxResultsPath`). It does not infer completion from a short page.
   For other APIs use `isLastPath`, or opt into `shortPage: true` only when
   the API guarantees full pages until the last. `http.v1` is deprecated.
4. Node results populate slots. Walks map slot rows to users and groups, then
   map membership rows to grants.
5. `connector({ transports: {directory} })` registers the same transport
   object referenced by every node.

The companion files describe how the graph is hosted:

- [`capabilities.json`](./capabilities.json) declares connector and resource-type capabilities.
- [`config-schema.json`](./config-schema.json) declares the tenant configuration form.
- [`runtime-schema.json`](./runtime-schema.json) declares the hosted bundle entrypoint,
  runtime configuration contract, and top-level `connect.directory` HTTP transport
  (read by C1's draft-test probe and host-grant derivation; the runtime itself
  takes transports from `connector.ts`).
- [`openapi.json`](./openapi.json) freezes the fictional endpoint and response contract.
- [`reviewed-ops.json`](./reviewed-ops.json) freezes the three GET projections,
  each with `output_slice: "items"`, `resource_type` (`user`, `group`, `user`),
  and camelCase offset pagination (`style`, `pageParam`, `sizeParam`).
  Group members bind `{groupId}` from the parent groups projection and declare
  `resource_type: "user"` even though their rows only feed grants: child reads
  returning user schemas require explicit user typing (J5). This typing and a
  resolvable response schema also prevent degraded, hash-every-string evidence.
  This single-HTTP example omits transport names in the frozen operation list;
  the operations use the default binding to `connect.directory`.

The first three companion files plus `connector.ts` are build-required.
The two frozen files are optional for build but required for a draft-test
PASS and activation. They do not turn this fixture into a live test service:
testing requires an API implementing this contract and configured credentials,
with non-empty records covering every declared projection. Activation also
requires `accepted` or `owner_judgment_required` alongside matching PASS evidence;
the latter is not model-judged and leaves the decision to the OWNER.

This example is read-only. It declares sync surfaces and emits membership
entitlements and grants, but it does not implement grant or revoke operations.

## Dev-tenant validation

On 2026-11-25, the six source files were built and draft-tested on a dev tenant.
The build succeeded with runtime `baton-axiomatic` v0.4.2 and SDK declarations
v0.4.1 (the reported `SDK_TYPES_CHANNEL_LAG` warning). Draft evidence was
`PASS`, state `COMPLETE`, with transport judge `accepted` and all three
projections covered. Execution/shape counts were 2 users, 1 group,
1 entitlement and 2 grants; the principal resource type was `user`.

Validated source digest:
`b51528175082f1c0c3127a766f308429c56405054959123e18c54731952d853b`.
All six local source-file hashes matched the hosted build's source reference.
This is bounded fixture proof, not a live-vendor or production guarantee.
Counts and type shapes do not verify individual grant-principal resolution or
ID stability. No activation or production sync was performed.
