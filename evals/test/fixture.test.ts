/**
 * Live tests for the Directory API fixture: boots the real server on an
 * ephemeral port and exercises auth variants, both pagination kinds, every
 * deliberate trap, and the idempotency signals.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { start } from "../fixture/directory-api/src/server.ts";
import { FIXTURE_ACCOUNT_EMAIL, FIXTURE_API_TOKEN } from "../fixture/directory-api/src/data.ts";

let server: Server;
let base: string;
const basic = `Basic ${Buffer.from(`${FIXTURE_ACCOUNT_EMAIL}:${FIXTURE_API_TOKEN}`).toString("base64")}`;
const bearer = `Bearer ${FIXTURE_API_TOKEN}`;

before(async () => {
  server = start(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

const get = (path: string, auth: string | null) =>
  fetch(`${base}${path}`, auth ? { headers: { authorization: auth } } : undefined);

describe("auth variants", () => {
  it("rejects missing credentials on v1 and v2", async () => {
    assert.equal((await get("/v1/users", null)).status, 401);
    assert.equal((await get("/v2/users", null)).status, 401);
  });

  it("rejects the wrong scheme on each mount", async () => {
    assert.equal((await get("/v1/users", bearer)).status, 401);
    assert.equal((await get("/v2/users", basic)).status, 401);
  });

  it("accepts basic on v1 and bearer on v2 over the same data", async () => {
    const v1 = await (await get("/v1/groups?limit=1", basic)).json();
    const v2 = await (await get("/v2/groups?limit=1", bearer)).json();
    assert.equal(v1.total, 12);
    assert.deepEqual(v1.items, v2.items);
  });

  it("serves healthz, openapi.json, and expectations without auth", async () => {
    assert.equal((await get("/healthz", null)).status, 200);
    const spec = await (await get("/openapi.json", null)).json();
    assert.equal(spec.info.title, "Directory API (eval fixture)");
    const exp = await (await get("/_fixture/expectations", null)).json();
    assert.equal(exp.users.total, 230);
  });
});

describe("offset pagination", () => {
  it("pages deterministically with stable totals", async () => {
    const p1 = await (await get("/v1/users?limit=100&offset=0&domain=all", basic)).json();
    const p2 = await (await get("/v1/users?limit=100&offset=100&domain=all", basic)).json();
    const p3 = await (await get("/v1/users?limit=100&offset=200&domain=all", basic)).json();
    assert.equal(p1.items.length, 100);
    assert.equal(p2.items.length, 100);
    assert.equal(p3.items.length, 30);
    assert.equal(p1.total, 230);
    const ids = [...p1.items, ...p2.items, ...p3.items].map((u: { id: string }) => u.id);
    assert.equal(new Set(ids).size, 230);
  });

  it("rejects invalid pagination params", async () => {
    assert.equal((await get("/v1/users?limit=0", basic)).status, 400);
    assert.equal((await get("/v1/users?limit=101", basic)).status, 400);
    assert.equal((await get("/v1/users?offset=-1", basic)).status, 400);
  });
});

describe("trap: silent under-sync without the scoping param", () => {
  it("defaults to the corp subset while looking complete", async () => {
    const res = await get("/v1/users?limit=1", basic);
    assert.equal(res.status, 200);
    const page = await res.json();
    assert.equal(page.total, 218); // subset total — the trap
  });

  it("domain=all returns the full directory", async () => {
    const page = await (await get("/v1/users?limit=1&domain=all", basic)).json();
    assert.equal(page.total, 230);
  });

  it("domain=partners returns the partner subset; bogus domain 400s", async () => {
    const page = await (await get("/v1/users?limit=1&domain=partners", basic)).json();
    assert.equal(page.total, 12);
    assert.equal((await get("/v1/users?domain=bogus", basic)).status, 400);
  });
});

describe("trap: nullable fields", () => {
  it("u0007 has null email; u0013 has null managerId; u0042 is inactive", async () => {
    const [u7] = (await (await get("/v1/users?limit=1&offset=6&domain=all", basic)).json()).items;
    assert.equal(u7.id, "u0007");
    assert.equal(u7.email, null);
    const [u13] = (await (await get("/v1/users?limit=1&offset=12&domain=all", basic)).json()).items;
    assert.equal(u13.managerId, null);
    const [u42] = (await (await get("/v1/users?limit=1&offset=41&domain=all", basic)).json()).items;
    assert.equal(u42.active, false);
  });
});

describe("trap: pending memberships must not become grants", () => {
  it("members lists include pending rows with state markers", async () => {
    const page = await (await get("/v1/groups/g05/members?limit=100", basic)).json();
    const pending = page.items.filter((m: { state: string }) => m.state === "pending");
    assert.ok(pending.length >= 1);
    assert.ok(pending.some((m: { userId: string }) => m.userId === "u0007"));
  });
});

describe("link pagination", () => {
  it("emits RFC 5988 Link headers and traverses all roles", async () => {
    const first = await get("/v1/roles", basic);
    const link = first.headers.get("link");
    assert.ok(link, "expected a Link header");
    assert.match(link, /rel="next"/);
    const page1 = await first.json();
    assert.equal(page1.items.length, 5);

    const nextPath = link.match(/<([^>]+)>/)?.[1];
    assert.ok(nextPath);
    const second = await get(nextPath, basic);
    const page2 = await second.json();
    assert.deepEqual(
      page2.items.map((r: { id: string }) => r.id),
      ["r06", "r07", "r08"],
    );
    assert.equal(second.headers.get("link"), null);
  });
});

describe("idempotency signals", () => {
  it("PUT returns 201 on create and 200 idempotentReplay on replay", async () => {
    // Derive a user that is not a seeded member of g12 from the API itself.
    const members = await (await get("/v1/groups/g12/members?limit=100", basic)).json();
    const memberIds = new Set(members.items.map((m: { userId: string }) => m.userId));
    const allUsers = await (await get("/v1/users?limit=100&domain=all", basic)).json();
    const outsider = allUsers.items.find((u: { id: string }) => !memberIds.has(u.id));
    assert.ok(outsider, "expected at least one non-member user in the first page");

    const created = await fetch(`${base}/v1/groups/g12/members/${outsider.id}`, {
      method: "PUT",
      headers: { authorization: basic },
    });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).changed, true);

    const replay = await fetch(`${base}/v1/groups/g12/members/${outsider.id}`, {
      method: "PUT",
      headers: { authorization: basic },
    });
    assert.equal(replay.status, 200);
    const body = await replay.json();
    assert.equal(body.changed, false);
    assert.equal(body.idempotentReplay, true);
  });

  it("DELETE returns 204 then 404 not_member on replay", async () => {
    const seeded = await fetch(`${base}/v1/groups/g06/members/u0001`, {
      method: "DELETE",
      headers: { authorization: basic },
    });
    // u0001 may or may not be a seeded member of g06; only replay semantics matter.
    if (seeded.status === 204) {
      const replay = await fetch(`${base}/v1/groups/g06/members/u0001`, {
        method: "DELETE",
        headers: { authorization: basic },
      });
      assert.equal(replay.status, 404);
      assert.equal((await replay.json()).error.code, "not_member");
    } else {
      assert.equal(seeded.status, 404);
      assert.equal((await seeded.json()).error.code, "not_member");
    }
  });

  it("grant/revoke requires auth", async () => {
    const res = await fetch(`${base}/v1/groups/g01/members/u0001`, { method: "PUT" });
    assert.equal(res.status, 401);
  });
});

describe("determinism", () => {
  it("expectations match the documented seed", async () => {
    const exp = await (await get("/_fixture/expectations", null)).json();
    assert.equal(exp.users.total, 230);
    assert.equal(exp.users.byDomain.corp, 218);
    assert.equal(exp.users.byDomain.partners, 12);
    assert.equal(exp.groups, 12);
    assert.equal(exp.memberships.pending, 6);
    assert.equal(exp.roles, 8);
    assert.deepEqual(exp.users.nullEmail.sort(), ["u0007", "u0113"]);
  });
});
