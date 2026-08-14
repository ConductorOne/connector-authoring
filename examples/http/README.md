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

This example is read-only. It declares sync surfaces and emits membership
entitlements and grants, but it does not implement grant or revoke operations.
