/**
 * Directory API — Tier-1 eval fixture provider.
 *
 * A small, deterministic, dependency-free HTTP service that extends the
 * fictional contract in `examples/http` into a live target for eval runs:
 *
 *   - offset pagination (`/v1/users`, `/v1/groups`, `/v1/groups/{id}/members`)
 *   - RFC 5988 link pagination (`/v1/roles`) — the second pagination kind the
 *     baton DSL supports
 *   - basic auth (`/v1/*`) and bearer auth (`/v2/*`) variants over the same data
 *   - deliberate traps mirroring documented authoring failure modes:
 *       1. `/users` silently under-syncs without `?domain=all`
 *       2. nullable `email` forces a projection/display-name decision
 *       3. pending membership rows must not produce grants
 *       4. grant/revoke endpoints carry an explicit idempotency signal
 *
 * Zero dependencies; runs on Node >= 22.18 (type stripping) via `node
 * src/server.ts`, or in the container from the adjacent Dockerfile.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  expectations,
  FIXTURE_ACCOUNT_EMAIL,
  FIXTURE_API_TOKEN,
  groups,
  memberships,
  roles,
  users,
} from "./data.ts";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";

const OPENAPI = readFileSync(
  fileURLToPath(new URL("../openapi.json", import.meta.url)),
  "utf8",
);

/** Grant/revoke mutations live only in process memory; sync reads stay seeded. */
const revoked = new Set<string>();
const granted = new Set<string>();
const memberKey = (groupId: string, userId: string) => `${groupId}:${userId}`;
/** Effective membership: (seeded ∪ granted) − revoked. */
const isMember = (groupId: string, userId: string) => {
  const key = memberKey(groupId, userId);
  return (memberships.some((m) => memberKey(m.groupId, m.userId) === key) || granted.has(key)) && !revoked.has(key);
};

type AuthScheme = "basic" | "bearer";

interface AuthedRequest {
  scheme: AuthScheme;
}

function checkAuth(req: IncomingMessage, scheme: AuthScheme): boolean {
  const header = req.headers.authorization;
  if (!header) return false;
  if (scheme === "basic") {
    if (!header.startsWith("Basic ")) return false;
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    return decoded === `${FIXTURE_ACCOUNT_EMAIL}:${FIXTURE_API_TOKEN}`;
  }
  if (!header.startsWith("Bearer ")) return false;
  return header.slice(7) === FIXTURE_API_TOKEN;
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, status: number, code: string, message: string, headers: Record<string, string> = {}): void {
  sendJson(res, status, { error: { code, message } }, headers);
}

interface Page<T> {
  items: T[];
  offset: number;
  limit: number;
  total: number;
}

const MAX_LIMIT = 100;

function paginate<T>(all: readonly T[], url: URL): Page<T> | { error: string } {
  const offsetRaw = url.searchParams.get("offset") ?? "0";
  const limitRaw = url.searchParams.get("limit") ?? String(MAX_LIMIT);
  const offset = Number(offsetRaw);
  const limit = Number(limitRaw);
  if (!Number.isInteger(offset) || offset < 0) return { error: "offset must be a non-negative integer" };
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return { error: `limit must be an integer between 1 and ${MAX_LIMIT}` };
  }
  return { items: all.slice(offset, offset + limit), offset, limit, total: all.length };
}

/**
 * Trap 1: the `domain` query param scopes the user listing. Omitting it does
 * NOT error — it silently returns only the corp domain, with `total` matching
 * the subset, so a connector that skips the spec under-syncs while looking
 * complete. `domain=all` returns the full directory.
 */
function scopedUsers(url: URL) {
  const domain = url.searchParams.get("domain") ?? "corp";
  if (domain === "all") return users;
  if (domain === "corp" || domain === "partners") {
    return users.filter((u) => u.domain === domain);
  }
  return null;
}

function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  auth: AuthedRequest,
  parts: string[],
  url: URL,
  body: string,
): void {
  const [resource, a, b, c] = parts;

  if (req.method === "GET" && resource === "users" && parts.length === 1) {
    const scoped = scopedUsers(url);
    if (!scoped) return sendError(res, 400, "invalid_param", "domain must be one of corp, partners, all");
    const page = paginate(scoped, url);
    if ("error" in page) return sendError(res, 400, "invalid_param", page.error);
    return sendJson(res, 200, page);
  }

  if (req.method === "GET" && resource === "groups" && parts.length === 1) {
    const page = paginate(groups, url);
    if ("error" in page) return sendError(res, 400, "invalid_param", page.error);
    return sendJson(res, 200, page);
  }

  if (resource === "groups" && a && b === "members" && parts.length === 3) {
    const group = groups.find((g) => g.id === a);
    if (!group) return sendError(res, 404, "not_found", `no group ${a}`);

    if (req.method === "GET") {
      const seeded = memberships.filter((m) => m.groupId === a && !revoked.has(memberKey(m.groupId, m.userId)));
      const added = [...granted]
        .filter((key) => key.startsWith(`${a}:`) && !revoked.has(key) && !seeded.some((m) => memberKey(m.groupId, m.userId) === key))
        .map((key) => ({ groupId: a, userId: key.slice(a.length + 1), state: "active" as const }));
      const page = paginate([...seeded, ...added], url);
      if ("error" in page) return sendError(res, 400, "invalid_param", page.error);
      // Members are listed as {userId, state}; pending rows appear here and
      // must not become grants downstream.
      return sendJson(res, 200, {
        ...page,
        items: page.items.map((m) => ({ userId: m.userId, state: m.state })),
      });
    }
    return sendError(res, 405, "method_not_allowed", "use GET on this collection");
  }

  // Grant/revoke: PUT|DELETE /{v}/groups/{groupId}/members/{userId}
  if (resource === "groups" && a && b === "members" && c && parts.length === 4) {
    const group = groups.find((g) => g.id === a);
    if (!group) return sendError(res, 404, "not_found", `no group ${a}`);
    const user = users.find((u) => u.id === c);
    if (!user) return sendError(res, 404, "not_found", `no user ${c}`);
    const key = memberKey(a, c);

    if (req.method === "PUT") {
      if (isMember(a, c)) {
        // Idempotency signal: replaying a grant is safe and says so.
        return sendJson(res, 200, { changed: false, idempotentReplay: true, groupId: a, userId: c });
      }
      granted.add(key);
      revoked.delete(key);
      return sendJson(res, 201, { changed: true, groupId: a, userId: c });
    }
    if (req.method === "DELETE") {
      if (!isMember(a, c)) {
        return sendError(res, 404, "not_member", `${c} is not a member of ${a}`);
      }
      revoked.add(key);
      granted.delete(key);
      res.writeHead(204);
      res.end();
      return;
    }
    return sendError(res, 405, "method_not_allowed", "use PUT or DELETE on this resource");
  }

  // Link-paginated resource: follows RFC 5988 Link headers, rel="next".
  if (req.method === "GET" && resource === "roles" && parts.length === 1) {
    const limitRaw = url.searchParams.get("limit") ?? "5";
    const limit = Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return sendError(res, 400, "invalid_param", `limit must be an integer between 1 and ${MAX_LIMIT}`);
    }
    const startAfter = url.searchParams.get("after") ?? "";
    const start = startAfter ? roles.findIndex((r) => r.id === startAfter) + 1 : 0;
    if (startAfter && start === 0) return sendError(res, 400, "invalid_param", `unknown cursor ${startAfter}`);
    const page = roles.slice(start, start + limit);
    const headers: Record<string, string> = {};
    if (start + limit < roles.length) {
      const last = page[page.length - 1];
      const next = new URL(`${url.pathname}?limit=${limit}&after=${last.id}`, "http://fixture");
      headers.link = `<${next.pathname}${next.search}>; rel="next"`;
    }
    return sendJson(res, 200, { items: page }, headers);
  }

  sendError(res, 404, "not_found", `no route ${req.method} /${parts.join("/")}`);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const parts = path.split("/").filter(Boolean);

    // Unauthenticated infrastructure routes.
    if (req.method === "GET" && path === "/healthz") return sendJson(res, 200, { ok: true });
    if (req.method === "GET" && path === "/openapi.json") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(OPENAPI);
    }
    // Harness-only expected counts. Deliberately absent from openapi.json;
    // the agent under test never learns it exists.
    if (req.method === "GET" && path === "/_fixture/expectations") {
      return sendJson(res, 200, expectations());
    }

    const version = parts[0];
    const scheme: AuthScheme | null = version === "v1" ? "basic" : version === "v2" ? "bearer" : null;
    if (!scheme) return sendError(res, 404, "not_found", `no route ${req.method} ${path}`);

    if (!checkAuth(req, scheme)) {
      const hint = scheme === "basic" ? 'Basic realm="directory"' : "Bearer";
      return sendError(res, 401, "unauthenticated", `valid ${scheme} credentials required`, {
        "www-authenticate": hint,
      });
    }
    handleApi(req, res, { scheme }, parts.slice(1), url, body);
  });
});

export function start(port = PORT, host = HOST) {
  server.listen(port, host);
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  start();
  console.log(`directory-api fixture listening on ${HOST}:${PORT}`);
}
