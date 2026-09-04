# Directory API fixture

A zero-dependency, deterministic Directory API service for the connector-authoring
eval harness. It extends the `examples/http` connector contract: the same
`/v1/users`, `/v1/groups`, and `/v1/groups/{groupId}/members` surface, served
with a fixed seed so sync results are reproducible.

## Credentials

| Variant | Credential |
|---|---|
| Basic (`/v1/*`) | username `connector@example.com`, password `fixture-token` |
| Bearer (`/v2/*`) | `Authorization: Bearer fixture-token` |

## Endpoints

| Method | Path | Auth | Pagination |
|---|---|---|---|
| GET | `/openapi.json` | none | — |
| GET | `/noiam/openapi.json` | none | — |
| GET | `/v1/users` | basic | offset (`{items, offset, limit, total}`) |
| GET | `/v1/groups` | basic | offset |
| GET | `/v1/groups/{groupId}/members` | basic | offset |
| POST | `/v1/groups/{groupId}/members` | basic | — (idempotent grant) |
| DELETE | `/v1/groups/{groupId}/members/{userId}` | basic | — (idempotent revoke) |
| GET | `/v2/users` | bearer | Link header (`rel="next"`) |
| GET | `/v2/groups` | bearer | Link header |
| GET | `/v2/groups/{groupId}/members` | bearer | Link header |

`/v1/*` returns page objects `{items, offset, limit, total}`; `/v2/*` returns
bare JSON arrays with a `Link: <...?offset=N&limit=M>; rel="next"` header on
every non-final page (absent on the final page).

Auth failures return `401` with `WWW-Authenticate` (`Basic realm="fixture"`
on `/v1`, `Bearer` on `/v2`). Unknown paths return `404`; wrong methods `405`.

`/noiam/openapi.json` serves the no-IAM surface (whoami + business endpoints;
no member listing/roles/groups/keys) used by the pre1 park scenario.

## Seed

- 23 users (`user-001`..`user-023`), `active: false` for `user-007` and
  `user-013`.
- 5 groups (`group-001`..`group-005`).
- 23 memberships: group-001 holds user-001..005, group-002 user-006..010,
  group-003 user-011..015, group-004 user-016..020, group-005 user-021..023.

## Deliberate traps

These mirror the documented failure modes of the authoring funnel and are
asserted by `verify.sh`:

1. **Under-sync trap (a):** `GET /v1/users` without the required `account_id`
   scoping param returns only the 3-row unscoped subset (`user-001`..`user-003`),
   not the full 23. A connector that omits the scoping param silently
   under-syncs.
2. **Nullable title (b):** `user.title` is `null` for `user-003`, `user-011`,
   and `user-019` (`"Engineer"` for even-numbered ids, `"Manager"` for
   odd-numbered ids otherwise). A connector whose projection assumes a
   non-null title drops those profiles.
3. **Idempotency replay (c):** `POST /v1/groups/{groupId}/members` with
   `{"userId": "..."}` returns `201` the first time (membership added, no
   replay header) and `200` with `X-Idempotency-Replay: true` on a replay of
   an existing membership. Unknown users return `400`.

## Run locally

```bash
node evals/fixture/server.ts --port 18080
# or
npm run eval:fixture
```

Server args: `--port` (default 18080), `--host` (default 127.0.0.1). One log
line per request (`METHOD path status`) on stdout.

## Verify

Requires `curl` and `jq`:

```bash
bash evals/fixture/verify.sh
# or
npm run eval:verify
```

`verify.sh` runs the server on port 18081 (never 18080) and asserts all 19
checks: every endpoint, both auth variants, both pagination variants, all
three traps, and the no-IAM surface.

## Container

Build from the repo root (the Dockerfile copies `evals/fixture`):

```bash
docker build -f evals/fixture/Dockerfile -t directory-fixture .
docker run --rm -p 18080:18080 directory-fixture
```
