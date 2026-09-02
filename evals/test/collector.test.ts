import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCollection } from "../src/collector.ts";

describe("parseCollection", () => {
  it("parses a full collection", () => {
    const c = parseCollection(
      JSON.stringify({
        connector: { status: "SYNC_STATUS_DONE", lastError: null },
        revisions: [{ revisionId: "rev1", status: "REVISION_STATUS_ACTIVE", activationEpoch: "3" }],
        counts: { users: 230, groups: 12, roles: 8, entitlements: 12, grants: 336 },
        grantWiring: { checked: 336, unresolvedPrincipal: 0, unresolvedEntitlement: 0 },
        idStability: { stable: true, added: [], removed: [] },
        userSample: [{ id: "u0007", hasLogin: true }],
        pendingRowGrants: [],
      }),
    );
    assert.ok(c);
    assert.equal(c.connector.status, "SYNC_STATUS_DONE");
    assert.equal(c.counts.users, 230);
    assert.equal(c.revisions[0].status, "REVISION_STATUS_ACTIVE");
    assert.equal(c.idStability?.stable, true);
  });

  it("tolerates null optional sections", () => {
    const c = parseCollection(
      JSON.stringify({
        connector: { status: null, lastError: null },
        revisions: [],
        counts: { users: null, groups: null, roles: null, entitlements: null, grants: null },
        grantWiring: null,
        idStability: null,
        userSample: null,
        pendingRowGrants: [],
      }),
    );
    assert.ok(c);
    assert.equal(c.counts.users, null);
    assert.equal(c.grantWiring, null);
    assert.equal(c.idStability, null);
  });

  it("rejects malformed documents", () => {
    assert.equal(parseCollection("not json"), null);
    assert.equal(parseCollection('{"noCounts":true}'), null);
    assert.equal(parseCollection("[1,2,3]"), null);
  });
});
