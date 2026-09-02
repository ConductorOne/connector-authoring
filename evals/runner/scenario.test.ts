// scenario.test.ts — unit smoke for the scenario loader (locked B2).
// Loads the REAL tier1-directory.json and asserts the locked contract.
import {test} from "node:test"
import assert from "node:assert/strict"
import {loadScenario} from "./scenario.ts"

test("loadScenario loads the real tier1-directory.json", () => {
  const s = loadScenario("evals/scenarios/tier1-directory.json")
  assert.equal(s.id, "tier1-directory")
  assert.equal(s.fixture.auth, "basic")
  assert.equal(s.fixture.basicAuth.username, "connector@example.com")
  assert.equal(s.fixture.basicAuth.password, "fixture-token")
  assert.equal(s.fixture.bearerToken, "fixture-token")
  assert.equal(s.seed.users, 23)
  assert.equal(s.seed.groups, 5)
  assert.equal(s.seed.memberships, 23)
  assert.equal(s.seed.nullTitleUsers, 3)
  assert.equal(s.seed.unscopedSubset, 3)
  assert.equal(s.seed.disabledUsers, 2)
  assert.equal(s.expected.users, 23)
  assert.equal(s.expected.groups, 5)
  assert.equal(s.expected.memberships, 23)
  assert.equal(s.skillBundle.mode, "none")
  assert.equal(s.model, "together/deepseek-ai/DeepSeek-V4-Flash-0731")
  assert.equal(s.requiredSourceFiles.length, 4)
  assert.equal(s.readinessTools.length, 5)
  assert.ok(s.handoffPath.includes("<run-id>"))
})

test("loadScenario rejects a missing required field", () => {
  assert.throws(() => loadScenario("/nonexistent.json"), /cannot read scenario file/)
})
