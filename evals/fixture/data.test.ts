// data.test.ts — unit smoke pinning the exact fixture seed (locked L15).
// The seed is the eval's ground truth: the fixture, the scenario file, and
// the parity expectations all derive from it.
import {test} from "node:test"
import assert from "node:assert/strict"
import {USERS, GROUPS, MEMBERSHIPS, UNSCOPED_SUBSET, NULL_TITLE_USER_IDS, FIXTURE_BASIC_USERNAME, FIXTURE_BASIC_PASSWORD, FIXTURE_BEARER_TOKEN} from "./data.ts"

test("the fixture seed is exactly 23 users / 5 groups / 23 memberships", () => {
  assert.equal(USERS.length, 23)
  assert.equal(GROUPS.length, 5)
  assert.equal(MEMBERSHIPS.length, 23)
  assert.equal(UNSCOPED_SUBSET.length, 3)
  assert.equal(NULL_TITLE_USER_IDS.length, 3)
})

test("user ids are user-001..user-023 with deterministic titles", () => {
  assert.equal(USERS[0].id, "user-001")
  assert.equal(USERS[22].id, "user-023")
  for (const u of USERS) {
    assert.match(u.id, /^user-\d{3}$/)
    assert.equal(u.name, `User ${u.id.slice(5)}`)
    assert.equal(u.email, `${u.id}@example.com`)
  }
  // Null titles: user-003, user-011, user-019.
  assert.equal(USERS[2].title, null)
  assert.equal(USERS[10].title, null)
  assert.equal(USERS[18].title, null)
  // Disabled: user-007, user-013.
  assert.equal(USERS[6].active, false)
  assert.equal(USERS[12].active, false)
  assert.equal(USERS[0].active, true)
})

test("memberships map to the locked groups (5 users each, last group 3)", () => {
  const byGroup = new Map<string, number>()
  for (const m of MEMBERSHIPS) byGroup.set(m.groupId, (byGroup.get(m.groupId) ?? 0) + 1)
  assert.equal(byGroup.get("group-001"), 5)
  assert.equal(byGroup.get("group-002"), 5)
  assert.equal(byGroup.get("group-003"), 5)
  assert.equal(byGroup.get("group-004"), 5)
  assert.equal(byGroup.get("group-005"), 3)
})

test("fixture credentials are the locked constants", () => {
  assert.equal(FIXTURE_BASIC_USERNAME, "connector@example.com")
  assert.equal(FIXTURE_BASIC_PASSWORD, "fixture-token")
  assert.equal(FIXTURE_BEARER_TOKEN, "fixture-token")
})
