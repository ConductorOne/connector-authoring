# Directory API — Tier-1 eval fixture provider

A small, deterministic, dependency-free container that extends the fictional
contract in [`examples/http`](../../../examples/http) into a live API an
authored connector can sync against. This is the workhorse tier of the eval
harness:

- **Tier 0** — `examples/static` (in-repo): proves the file contract and build
  path without credentials.
- **Tier 1** — this service: full lifecycle including draft test and force
  sync against seeded data, with count-parity scoring.
- **Tier 2** — a real sandbox provider (future; nightly realism tier).

## Running

```sh
docker build -t c1-eval-directory-api .
docker run --rm -p 8080:8080 c1-eval-directory-api
```

or directly (Node >= 22.18, no dependencies, no build step):

```sh
node src/server.ts        # PORT=8080 HOST=0.0.0.0 by default
```

## Credentials (eval-only, deterministic)

| Config field    | Value                                  |
| --------------- | -------------------------------------- |
| `account-email` | `connector@fixture.example`            |
| `api-token`     | `fx_tok_7c1f3a9d5e2b48f0a6c1d3e5f7a9b2c4` |

`/v1/*` requires HTTP basic auth (email as username, token as password).
`/v2/*` serves the same data behind bearer auth (`Authorization: Bearer
<api-token>`). Wrong or missing credentials return 401 with a
`www-authenticate` hint.

## Surface

- `GET /openapi.json` — the published spec (also committed next to this file).
- `GET /v1/users` — offset pagination (`offset`/`limit`; page shape
  `{items, offset, limit, total}`).
- `GET /v1/groups` — offset pagination.
- `GET /v1/groups/{groupId}/members` — offset pagination; rows
  `{userId, state}`.
- `GET /v1/roles` — **link pagination** (RFC 5988 `Link: ...; rel="next"`,
  default page size 5).
- `PUT /v1/groups/{groupId}/members/{userId}` — grant.
- `DELETE /v1/groups/{groupId}/members/{userId}` — revoke.
- The same routes under `/v2` with bearer auth.
- `GET /_fixture/expectations` — harness-only expected counts derived from the
  seed. Deliberately absent from `openapi.json`; the scorer queries it for
  count parity ("count parity, not fixture counts") and the agent under test
  never learns it exists.

## Seeded data

Deterministic (pure function of row index; identical across restarts):

- 230 users `u0001`–`u0230` across two domains (`corp`: 218, `partners`: 12).
- 12 groups `g01`–`g12`.
- ~330 membership rows plus 6 `pending` rows.
- 8 roles `r01`–`r08` (two link pages at the default page size).

## Deliberate traps

These mirror the documented authoring failure modes; each maps to a
deterministic scorer check.

1. **Silent under-sync without a scoping param.** `GET /v1/users` without
   `?domain=all` returns only the `corp` domain — HTTP 200 with a subset
   `total`, so the response looks complete. `openapi.json` documents the
   parameter; a connector that does not read the spec syncs 218 of 230 users
   and fails parity.
2. **Nullable field needing a projection decision.** `u0007` and `u0113` have
   `email: null`; `u0013` has `managerId: null`. A connector that blindly
   projects `user.email` into login produces broken resources.
3. **Membership rows that must not produce grants.** Pending rows
   (`state: "pending"`) are listed by the members endpoint but are not
   members. Grant parity counts only `active` rows.
4. **Idempotency signal for grant/revoke.** Replaying `PUT` returns
   `200 {changed: false, idempotentReplay: true}` (first grant returns 201);
   replaying `DELETE` returns `404 {error.code: "not_member"}` instead of a
   silent success.
5. **Disabled object.** `u0042` has `active: false` and must map to
   `STATUS_DISABLED`, not be dropped.

## Auth strictness (negative space the scorer can assert)

- No credentials → 401.
- Bearer token against `/v1` (or basic against `/v2`) → 401.
- `limit=0`, `limit>100`, or a negative `offset` → 400.
