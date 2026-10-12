# Declarative HTTP directory example

This is a fictional compile-time fixture, not a vendor connector or hosted
test service. An API implementing the contract below would be configured with
a full base URL such as `https://directory.example`, without a trailing slash.
The fixed `/v1` prefix stays in each request path.

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

The connector declares a graph:

1. `config(...)` creates opaque public and secret references.
2. `http.v1(...)` declares native basic authentication. Connector code never
   reads the account email or API token.
3. Each `node` returns a `directory.GET(...)` descriptor with offset
   pagination. The hosted runtime executes requests and advances pages.
4. Node results populate slots. Walks map slot rows to users and groups, then
   map membership rows to grants.
5. `connector({ transports: {directory} })` registers the same transport
   object referenced by every node.

The companion files describe how the graph is hosted:

- [`capabilities.json`](./capabilities.json) declares connector and resource-type capabilities.
- [`config-schema.json`](./config-schema.json) declares the tenant configuration form.
- [`runtime-schema.json`](./runtime-schema.json) declares the hosted bundle entrypoint,
  runtime configuration contract, and top-level `connect.directory` HTTP transport.
- [`openapi.json`](./openapi.json) freezes the fictional endpoint and response contract.
- [`reviewed-ops.json`](./reviewed-ops.json) freezes the three GET projections,
  each with `output_slice: "items"` and camelCase offset pagination
  (`style`, `pageParam`, `sizeParam`). Group members bind `{groupId}` from
  the parent groups projection.

The first three companion files plus `connector.ts` are build-required.
The two frozen files are optional for build but required for a draft-test
PASS and activation. They do not turn this fixture into a live test service:
testing requires an API implementing this contract and configured credentials,
with non-empty records covering every declared projection. Activation also
requires an `accepted` transport judge verdict alongside matching PASS evidence.

This example is read-only. It declares sync surfaces and emits membership
entitlements and grants, but it does not implement grant or revoke operations.
