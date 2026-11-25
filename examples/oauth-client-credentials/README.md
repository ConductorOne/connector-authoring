# Single-base-URL OAuth client credentials

A minimal, user-only Directory API skeleton for hosted and BYO authors.
Fetch examples and declarations at the tenant's runtime-compatible release tag
or a reviewed commit. The tenant-served guide and tool descriptions control
hosted gates; skills are reference, not a C1 contract, for BYO agents.

## One origin, not three URL fields

The trusted credentials form asks for one URL, `base-url`, plus
`directory-client-id` and secret `directory-client-secret`. The app prefix avoids
the runtime-reserved SDK defaults `client-id` / `client-secret`.
The Base URL field has a suggested full URL and a
`WELL_KNOWN_STRING_URI` rule. Enter the service origin including `https://`,
without a trailing slash (for example `https://directory.example`); that
fictional domain is documentation, not a test service.

`connector.ts` retains a **bare** `config("base-url")` reference as the
transport's `baseUrl`. This lets C1 derive the egress host at serve time; an
expression-only token URL is not sufficient for host derivation. Opaque config
references are not strings to inspect or interpolate in JavaScript.
`strings.concat` declares runtime-resolved expressions:

- token URL: `<base-url>/oauth/token`;
- audience: `<base-url>/v1/`.

Use this pattern only when the provider's documented token URL and audience
really derive from the same origin. A provider with a distinct authorization
host or audience needs its actual contract, not these fictional suffixes.
Before opening a credential form, explain which field is needed and why.
Reopen only when fresh test evidence names `AUTH_OR_SCOPE`, or a stored value
fails its own field rules; never collect credentials in agent chat.

## Response and authentication contract

The runtime, not connector code, POSTs JSON to `/oauth/token`:

```json
{
  "grant_type": "client_credentials",
  "client_id": "<configured client identifier>",
  "client_secret": "<configured secret>",
  "audience": "<base-url>/v1/"
}
```

The token endpoint returns `access_token` (string), `token_type: "Bearer"`
and `expires_in` (seconds). The runtime applies the bearer token to
`GET /v1/users?offset=0&limit=100`. Each page returns:

```json
{
  "items": [{"id": "user-1", "name": "Example User", "email": "user@example.com", "active": true}],
  "offset": 0,
  "limit": 100,
  "total": 1
}
```

Pagination uses the explicit total, not short-page inference. The frozen
`reviewed-ops.json` declares one `user` projection with `output_slice: "items"`
and `resource_type: "user"`; `openapi.json` resolves the user response schema.
Accurate typing avoids degraded hash-every-string evidence. Human-identifying
strings are still redacted when evidence is sealed; counts and type shapes
cannot establish per-record resolution or ID stability.

Upload all six companion files. Four are build-required; the frozen spec and
reviewed operations are additionally required for draft-test PASS. The target
API must implement the contract above with at least one user. Activation needs
matching PASS evidence and `accepted` or `owner_judgment_required`; the latter
is not model-judged. Only the human OWNER activates.

## Validation boundary

Repository typechecks exercise declarations only; they do not execute OAuth.
On 2026-11-25, the six source files above were also built and draft-tested on a
dev tenant against a prepared synthetic OAuth fixture, not a live vendor:

| Check | Observed result |
|---|---|
| Hosted build | `RUN_STATE_SUCCEEDED`, runtime `baton-axiomatic` v0.4.2 |
| Hosted SDK declarations | v0.4.1, with the reported `SDK_TYPES_CHANNEL_LAG` warning |
| Draft test | `CONNECTOR_TEST_RUN_RESULT_PASS`, state `COMPLETE`, judge `accepted` |
| Execution/shape counts | 2 user resources; the `users` projection was covered |
| Fixture authentication | JSON client-credentials POST to `/oauth/token`, exact derived `<origin>/v1/` audience, then authorized bearer GET `/v1/users` |

Validated source digest:
`369a23677cab509c8ba48e40c06948be07338940e9a75ac9d0a9b692d8180d2a`.
All six local source-file hashes matched the hosted build's source reference.
The two-user fixture fits one page: this does not prove multi-page traversal,
live-vendor compatibility, credential-form UI enforcement, or post-activation
serve behavior. No activation or production sync was performed.
