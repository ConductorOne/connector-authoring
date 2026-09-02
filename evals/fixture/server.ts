// Zero-dependency Directory API fixture server (CXF-216 PR 1).
// Implements the L16 route/auth/pagination matrix exactly:
//   /v1/* = basic auth + offset pagination, page object {items, offset, limit, total}
//   /v2/* = bearer auth + bare JSON array + Link rel="next" pagination
// Traps: (a) /v1/users without account_id -> 3-row unscoped subset;
//        (b) user.title nullable; (c) replayed grant POST -> X-Idempotency-Replay: true.
import {createServer, type IncomingMessage, type ServerResponse} from "node:http"
import {readFileSync} from "node:fs"
import {argv, stdout} from "node:process"
import {
  FIXTURE_BASIC_PASSWORD,
  FIXTURE_BASIC_USERNAME,
  FIXTURE_BEARER_TOKEN,
  GROUPS,
  MEMBERSHIPS,
  UNSCOPED_SUBSET,
  USERS,
  type DirectoryUser,
} from "./data.ts"

const OPENAPI = readFileSync(new URL("./openapi.json", import.meta.url), "utf8")

// --- args: --port (default 18080), --host (default 127.0.0.1) ---
let port = 18080
let host = "127.0.0.1"
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--port") port = Number(argv[++i])
  else if (argv[i] === "--host") host = argv[++i]
}

// --- runtime membership state (seeded from the deterministic MEMBERSHIPS) ---
const memberships = new Map<string, Set<string>>()
for (const m of MEMBERSHIPS) {
  let set = memberships.get(m.groupId)
  if (!set) {
    set = new Set()
    memberships.set(m.groupId, set)
  }
  set.add(m.userId)
}

const DEFAULT_LIMIT = 100

function page<T>(items: readonly T[], offset: number, limit: number, total: number) {
  return {items, offset, limit, total}
}

function slice<T>(all: readonly T[], offset: number, limit: number): T[] {
  return all.slice(offset, offset + limit)
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  res.writeHead(status, {"Content-Type": "application/json", ...headers})
  res.end(JSON.stringify(body))
}

function sendEmpty(res: ServerResponse, status: number, headers: Record<string, string> = {}) {
  res.writeHead(status, headers)
  res.end()
}

function unauthorized(res: ServerResponse, scheme: "Basic" | "Bearer") {
  const challenge = scheme === "Basic" ? 'Basic realm="fixture"' : "Bearer"
  res.writeHead(401, {"WWW-Authenticate": challenge})
  res.end()
}

function parseBasicAuth(req: IncomingMessage): {username: string; password: string} | null {
  const header = req.headers.authorization
  if (!header || !header.startsWith("Basic ")) return null
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8")
  const idx = decoded.indexOf(":")
  if (idx < 0) return null
  return {username: decoded.slice(0, idx), password: decoded.slice(idx + 1)}
}

function checkBearer(req: IncomingMessage): boolean {
  return req.headers.authorization === `Bearer ${FIXTURE_BEARER_TOKEN}`
}

function readBody(req: IncomingMessage): Promise<string> {
  const {promise, resolve, reject} = Promise.withResolvers<string>()
  const chunks: Buffer[] = []
  req.on("data", (c: Buffer) => chunks.push(c))
  req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
  req.on("error", reject)
  return promise
}

function parseOffsetLimit(url: URL): {offset: number; limit: number} {
  const offset = Number(url.searchParams.get("offset") ?? "0")
  const limit = Number(url.searchParams.get("limit") ?? String(DEFAULT_LIMIT))
  return {
    offset: Number.isFinite(offset) && offset >= 0 ? Math.floor(offset) : 0,
    limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_LIMIT,
  }
}

function linkHeader(url: URL, nextOffset: number, limit: number): string {
  const next = new URL(url)
  next.searchParams.set("offset", String(nextOffset))
  next.searchParams.set("limit", String(limit))
  return `<${next.toString()}>; rel="next"`
}

function v2List(
  res: ServerResponse,
  url: URL,
  all: readonly unknown[],
): void {
  const {offset, limit} = parseOffsetLimit(url)
  const items = slice(all, offset, limit)
  const headers: Record<string, string> = {}
  const nextOffset = offset + items.length
  if (nextOffset < all.length) {
    headers.Link = linkHeader(url, nextOffset, limit)
  }
  sendJson(res, 200, items, headers)
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const method = req.method ?? "GET"
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
  const path = url.pathname
  const log = (status: number) => stdout.write(`${method} ${path} ${status}\n`)

  try {
    // --- openapi.json: unauthenticated ---
    if (path === "/openapi.json") {
      if (method !== "GET") {
        log(405)
        sendEmpty(res, 405)
        return
      }
      log(200)
      res.writeHead(200, {"Content-Type": "application/json"})
      res.end(OPENAPI)
      return
    }

    // --- /v1/* : basic auth + offset pagination ---
    if (path.startsWith("/v1/")) {
      const creds = parseBasicAuth(req)
      if (!creds || creds.username !== FIXTURE_BASIC_USERNAME || creds.password !== FIXTURE_BASIC_PASSWORD) {
        log(401)
        unauthorized(res, "Basic")
        return
      }

      if (path === "/v1/users") {
        if (method !== "GET") {
          log(405)
          sendEmpty(res, 405)
          return
        }
        const {offset, limit} = parseOffsetLimit(url)
        if (!url.searchParams.has("account_id")) {
          // Trap (a): unscoped request returns only the 3-row subset.
          log(200)
          sendJson(res, 200, page(UNSCOPED_SUBSET, 0, limit, UNSCOPED_SUBSET.length))
          return
        }
        log(200)
        sendJson(res, 200, page(slice(USERS, offset, limit), offset, limit, USERS.length))
        return
      }

      if (path === "/v1/groups") {
        if (method !== "GET") {
          log(405)
          sendEmpty(res, 405)
          return
        }
        const {offset, limit} = parseOffsetLimit(url)
        log(200)
        sendJson(res, 200, page(slice(GROUPS, offset, limit), offset, limit, GROUPS.length))
        return
      }

      const membersMatch = path.match(/^\/v1\/groups\/([^/]+)\/members$/)
      if (membersMatch) {
        const groupId = decodeURIComponent(membersMatch[1])
        const group = GROUPS.find((g) => g.id === groupId)
        if (!group) {
          log(404)
          sendEmpty(res, 404)
          return
        }
        if (method === "GET") {
          const {offset, limit} = parseOffsetLimit(url)
          const memberIds = [...(memberships.get(groupId) ?? [])].sort()
          const items = memberIds.slice(offset, offset + limit).map((userId) => ({userId}))
          log(200)
          sendJson(res, 200, page(items, offset, limit, memberIds.length))
          return
        }
        if (method === "POST") {
          let body: {userId?: unknown}
          try {
            body = JSON.parse(await readBody(req)) as {userId?: unknown}
          } catch {
            log(400)
            sendJson(res, 400, {error: "invalid JSON body"})
            return
          }
          const userId = typeof body.userId === "string" ? body.userId : ""
          if (!USERS.some((u) => u.id === userId)) {
            log(400)
            sendJson(res, 400, {error: `unknown user: ${userId}`})
            return
          }
          const set = memberships.get(groupId)!
          if (set.has(userId)) {
            // Trap (c): replay of an existing membership.
            log(200)
            sendJson(res, 200, {userId}, {"X-Idempotency-Replay": "true"})
            return
          }
          set.add(userId)
          log(201)
          sendJson(res, 201, {userId})
          return
        }
        log(405)
        sendEmpty(res, 405)
        return
      }

      const deleteMatch = path.match(/^\/v1\/groups\/([^/]+)\/members\/([^/]+)$/)
      if (deleteMatch) {
        if (method !== "DELETE") {
          log(405)
          sendEmpty(res, 405)
          return
        }
        const groupId = decodeURIComponent(deleteMatch[1])
        const userId = decodeURIComponent(deleteMatch[2])
        memberships.get(groupId)?.delete(userId)
        log(204)
        sendEmpty(res, 204)
        return
      }

      log(404)
      sendEmpty(res, 404)
      return
    }

    // --- /v2/* : bearer auth + bare array + Link rel="next" pagination ---
    if (path.startsWith("/v2/")) {
      if (!checkBearer(req)) {
        log(401)
        unauthorized(res, "Bearer")
        return
      }

      if (path === "/v2/users") {
        if (method !== "GET") {
          log(405)
          sendEmpty(res, 405)
          return
        }
        v2List(res, url, USERS)
        log(200)
        return
      }

      if (path === "/v2/groups") {
        if (method !== "GET") {
          log(405)
          sendEmpty(res, 405)
          return
        }
        v2List(res, url, GROUPS)
        log(200)
        return
      }

      const membersMatch = path.match(/^\/v2\/groups\/([^/]+)\/members$/)
      if (membersMatch) {
        if (method !== "GET") {
          log(405)
          sendEmpty(res, 405)
          return
        }
        const groupId = decodeURIComponent(membersMatch[1])
        const group = GROUPS.find((g) => g.id === groupId)
        if (!group) {
          log(404)
          sendEmpty(res, 404)
          return
        }
        const memberIds = [...(memberships.get(groupId) ?? [])].sort()
        v2List(res, url, memberIds.map((userId) => ({userId})))
        log(200)
        return
      }

      log(404)
      sendEmpty(res, 404)
      return
    }

    log(404)
    sendEmpty(res, 404)
  } catch (err) {
    stdout.write(`${method} ${path} 500 ${String(err)}\n`)
    sendEmpty(res, 500)
  }
})

server.listen(port, host, () => {
  stdout.write(`fixture listening on http://${host}:${port}\n`)
})
