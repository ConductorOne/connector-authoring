#!/usr/bin/env bash
# verify.sh — self-check for the Directory API fixture (evals/fixture).
# Runs the server on port 18081 (never 18080) and asserts all 13 checks:
# every endpoint, both auth variants, both pagination variants, and all three
# traps. Requires curl + jq. Kills the server on exit (trap).
set -euo pipefail

PORT=18081
HOST=127.0.0.1
BASE="http://$HOST:$PORT"
LOG="$(mktemp -d)/fixture.log"
PID=""

cleanup() {
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# start the server
node --experimental-strip-types evals/fixture/server.ts --port "$PORT" --host "$HOST" >"$LOG" 2>&1 &
PID=$!

# wait for readiness (curl retry loop)
ready=0
for _ in $(seq 1 50); do
  if curl -sS -o /dev/null "$BASE/openapi.json" 2>/dev/null; then
    ready=1
    break
  fi
  sleep 0.2
done
[ "$ready" -eq 1 ] || fail "server did not become ready (log: $LOG)"

BASIC_AUTH="-u connector@example.com:fixture-token"

# (1) GET /openapi.json -> 200 with .paths["/v1/users"]
OPENAPI="$(curl -sS "$BASE/openapi.json")"
jq -e '.paths["/v1/users"]' <<<"$OPENAPI" >/dev/null || fail "openapi.json missing /v1/users path"
echo "ok: openapi.json serves /v1/users"

# (2) GET /v1/users?account_id=acct-1 (basic) -> 200, .total == 23, 23 items
USERS_SCOPED="$(curl -sS $BASIC_AUTH "$BASE/v1/users?account_id=acct-1")"
jq -e '.total == 23 and (.items | length) == 23' <<<"$USERS_SCOPED" >/dev/null || fail "scoped /v1/users != 23 rows"
echo "ok: scoped /v1/users returns 23"

# (3) GET /v1/users (basic, no account_id) -> 200, exactly 3 items (trap a)
USERS_UNSCOPED="$(curl -sS $BASIC_AUTH "$BASE/v1/users")"
jq -e '(.items | length) == 3' <<<"$USERS_UNSCOPED" >/dev/null || fail "unscoped /v1/users != 3 rows (trap a)"
echo "ok: unscoped /v1/users returns 3-row subset (trap a)"

# (4) GET /v1/groups?account_id=acct-1 -> 200, .total == 5
GROUPS_JSON="$(curl -sS $BASIC_AUTH "$BASE/v1/groups?account_id=acct-1")"
jq -e '.total == 5' <<<"$GROUPS_JSON" >/dev/null || fail "/v1/groups total != 5"
echo "ok: /v1/groups returns 5"

# (5) GET /v1/groups/group-001/members?account_id=acct-1 -> 200, .total == 5
MEMBERS="$(curl -sS $BASIC_AUTH "$BASE/v1/groups/group-001/members?account_id=acct-1")"
jq -e '.total == 5' <<<"$MEMBERS" >/dev/null || fail "/v1/groups/group-001/members total != 5"
echo "ok: /v1/groups/group-001/members returns 5"

# (6) offset pagination: offset=0&limit=10 -> 10 items; offset=10 -> 10; offset=20 -> 3; .total == 23 each
P0="$(curl -sS $BASIC_AUTH "$BASE/v1/users?account_id=acct-1&offset=0&limit=10")"
P1="$(curl -sS $BASIC_AUTH "$BASE/v1/users?account_id=acct-1&offset=10&limit=10")"
P2="$(curl -sS $BASIC_AUTH "$BASE/v1/users?account_id=acct-1&offset=20&limit=10")"
jq -e '(.items | length) == 10 and .total == 23' <<<"$P0" >/dev/null || fail "offset=0 page != 10 items"
jq -e '(.items | length) == 10 and .total == 23' <<<"$P1" >/dev/null || fail "offset=10 page != 10 items"
jq -e '(.items | length) == 3 and .total == 23' <<<"$P2" >/dev/null || fail "offset=20 page != 3 items"
echo "ok: offset pagination pages 10/10/3, total 23"

# (7) user-003 has title: null (trap b)
jq -e '.items[] | select(.id == "user-003") | .title == null' <<<"$USERS_SCOPED" >/dev/null || fail "user-003 title != null (trap b)"
echo "ok: user-003 title is null (trap b)"

# (8) /v1/users?account_id=acct-1 without basic auth -> 401 + WWW-Authenticate: Basic
CODE="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/v1/users?account_id=acct-1")"
[ "$CODE" = "401" ] || fail "/v1/users without auth != 401 (got $CODE)"
WWW="$(curl -sS -D - -o /dev/null "$BASE/v1/users?account_id=acct-1" | grep -i '^WWW-Authenticate:' | tr -d '\r' | sed 's/^[Ww][Ww][Ww]-[Aa]uthenticate: //')"
grep -q 'Basic realm="fixture"' <<<"$WWW" || fail "/v1/users 401 missing WWW-Authenticate: Basic realm=\"fixture\" (got: $WWW)"
echo "ok: /v1/users without basic auth -> 401 with Basic challenge"

# (9) GET /v2/users (bearer) -> 200, array length 23
V2_USERS="$(curl -sS -H "Authorization: Bearer fixture-token" "$BASE/v2/users")"
jq -e 'length == 23' <<<"$V2_USERS" >/dev/null || fail "/v2/users length != 23"
echo "ok: /v2/users returns 23"

# (10) GET /v2/users?limit=10 -> 10 items + Link rel="next"; follow links to 23; final page no rel="next"
V2_PAGE="$(curl -sS -D - -H "Authorization: Bearer fixture-token" "$BASE/v2/users?limit=10")"
V2_BODY="$(sed -n '/^\r$/,$p' <<<"$V2_PAGE" | tail -n +2)"
V2_HEADERS="$(sed -n '1,/^\r$/p' <<<"$V2_PAGE")"
jq -e 'length == 10' <<<"$V2_BODY" >/dev/null || fail "/v2/users?limit=10 length != 10"
LINK="$(grep -i '^Link:' <<<"$V2_HEADERS" | sed 's/^[Ll]ink: //' | tr -d '\r')"
grep -q 'rel="next"' <<<"$LINK" || fail "/v2/users?limit=10 missing Link rel=\"next\""
echo "ok: /v2/users?limit=10 has Link rel=\"next\""

# follow links until no rel="next"; count total (first page included)
TOTAL="$(jq 'length' <<<"$V2_BODY")"
NEXT_URL="$(sed -n 's/^<\([^>]*\)>; rel="next".*/\1/p' <<<"$LINK" | head -1)"
while [ -n "$NEXT_URL" ]; do
  PAGE="$(curl -sS -D - -H "Authorization: Bearer fixture-token" "$NEXT_URL")"
  BODY="$(sed -n '/^\r$/,$p' <<<"$PAGE" | tail -n +2)"
  HDRS="$(sed -n '1,/^\r$/p' <<<"$PAGE")"
  COUNT="$(jq 'length' <<<"$BODY")"
  TOTAL=$((TOTAL + COUNT))
  NEXT_LINK="$(grep -i '^Link:' <<<"$HDRS" | sed 's/^[Ll]ink: //' | tr -d '\r' || true)"
  NEXT_URL="$(sed -n 's/^<\([^>]*\)>; rel="next".*/\1/p' <<<"$NEXT_LINK" | head -1)"
done
[ "$TOTAL" = "23" ] || fail "/v2/users link-follow total != 23 (got $TOTAL)"
echo "ok: /v2/users link-follow reaches 23, final page has no rel=\"next\""

# (11) GET /v2/users without bearer -> 401 + WWW-Authenticate: Bearer
CODE="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/v2/users")"
[ "$CODE" = "401" ] || fail "/v2/users without bearer != 401 (got $CODE)"
WWW2="$(curl -sS -D - -o /dev/null "$BASE/v2/users" | grep -i '^WWW-Authenticate:' | tr -d '\r' | sed 's/^[Ww][Ww][Ww]-[Aa]uthenticate: //')"
grep -q '^Bearer$' <<<"$WWW2" || fail "/v2/users 401 missing WWW-Authenticate: Bearer (got: $WWW2)"
echo "ok: /v2/users without bearer -> 401 with Bearer challenge"

# (12) POST /v1/groups/group-001/members {"userId":"user-023"} -> 201 first (no replay header);
#      replay -> 200 with X-Idempotency-Replay: true (trap c); DELETE -> 204
POST1="$(curl -sS -D - $BASIC_AUTH -X POST "$BASE/v1/groups/group-001/members" -H 'Content-Type: application/json' --data '{"userId":"user-023"}')"
POST1_CODE="$(sed -n '1s/HTTP\/[0-9.]* \([0-9]*\).*/\1/p' <<<"$POST1")"
[ "$POST1_CODE" = "201" ] || fail "first grant POST != 201 (got $POST1_CODE)"
grep -qi 'X-Idempotency-Replay' <<<"$POST1" && fail "first grant POST carried replay header"
echo "ok: first grant POST -> 201, no replay header"

POST2="$(curl -sS -D - $BASIC_AUTH -X POST "$BASE/v1/groups/group-001/members" -H 'Content-Type: application/json' --data '{"userId":"user-023"}')"
POST2_CODE="$(sed -n '1s/HTTP\/[0-9.]* \([0-9]*\).*/\1/p' <<<"$POST2")"
[ "$POST2_CODE" = "200" ] || fail "replay grant POST != 200 (got $POST2_CODE)"
grep -qi 'X-Idempotency-Replay: true' <<<"$POST2" || fail "replay grant POST missing X-Idempotency-Replay: true (trap c)"
echo "ok: replay grant POST -> 200 with X-Idempotency-Replay: true (trap c)"

DEL_CODE="$(curl -sS -o /dev/null -w '%{http_code}' $BASIC_AUTH -X DELETE "$BASE/v1/groups/group-001/members/user-023")"
[ "$DEL_CODE" = "204" ] || fail "DELETE member != 204 (got $DEL_CODE)"
echo "ok: DELETE member -> 204"

# (13) GET /v1/nope -> 404
CODE="$(curl -sS -o /dev/null -w '%{http_code}' $BASIC_AUTH "$BASE/v1/nope")"
[ "$CODE" = "404" ] || fail "/v1/nope != 404 (got $CODE)"
echo "ok: unknown path -> 404"

# (14) GET /v2/groups (bearer) -> 200, array length 5
V2_GROUPS="$(curl -sS -H "Authorization: Bearer fixture-token" "$BASE/v2/groups")"
jq -e 'length == 5' <<<"$V2_GROUPS" >/dev/null || fail "/v2/groups length != 5"
echo "ok: /v2/groups returns 5"

# (15) GET /v2/groups/group-001/members (bearer) -> 200, array length 5
V2_MEMBERS="$(curl -sS -H "Authorization: Bearer fixture-token" "$BASE/v2/groups/group-001/members")"
jq -e 'length == 5' <<<"$V2_MEMBERS" >/dev/null || fail "/v2/groups/group-001/members length != 5"
echo "ok: /v2/groups/group-001/members returns 5"

# (16) wrong method on /v1/users (POST) -> 405
CODE="$(curl -sS -o /dev/null -w '%{http_code}' $BASIC_AUTH -X POST "$BASE/v1/users?account_id=acct-1")"
[ "$CODE" = "405" ] || fail "POST /v1/users != 405 (got $CODE)"
echo "ok: wrong method -> 405"

echo "== all 16 fixture assertions passed =="
