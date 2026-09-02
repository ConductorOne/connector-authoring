// agent.test.ts — unit smoke for the agent prompt builder (locked C1).
// The prompt is the eval's instruction contract: the stop rule, the handoff
// path, and the credentials must all be present and consistent.
import {test} from "node:test"
import assert from "node:assert/strict"
import {buildPrompt} from "./agent.ts"
import type {Scenario} from "./scenario.ts"

const SCENARIO: Scenario = {
  id: "tier1-directory",
  name: "Tier 1: Directory API sync funnel",
  fixture: {
    port: 18080,
    baseUrl: "http://127.0.0.1:18080",
    auth: "basic",
    openapiPath: "/openapi.json",
    basicAuth: {username: "connector@example.com", password: "fixture-token"},
    bearerToken: "fixture-token",
  },
  seed: {users: 23, groups: 5, memberships: 23, nullTitleUsers: 3, unscopedSubset: 3, disabledUsers: 2},
  expected: {users: 23, groups: 5, memberships: 23},
  skillBundle: {mode: "none", version: "0.0.0"},
  model: "together/deepseek-ai/DeepSeek-V4-Flash-0731",
  requiredSourceFiles: ["connector.ts", "config-schema.json", "runtime-schema.json", "capabilities.json"],
  readinessTools: [
    "c1_connector_authoring_get_authoring_guide",
    "c1_connector_authoring_create_draft",
    "c1_connector_authoring_build_bundle",
    "c1_connector_authoring_run_draft_test_sync",
    "c1_connector_authoring_get_test_run_evidence",
  ],
  handoffPath: "/current-tasks/evals/<run-id>/handoff.json",
}

test("buildPrompt carries the stop rule, handoff path, and credentials", () => {
  const prompt = buildPrompt(SCENARIO, "evals-tier1-directory-20260902-120000-000", "http://127.0.0.1:18080", "am/src-81ose/src-att4-impl")
  assert.ok(prompt.includes("http://127.0.0.1:18080"))
  assert.ok(prompt.includes("connector@example.com"))
  assert.ok(prompt.includes("fixture-token"))
  assert.ok(prompt.includes("/current-tasks/evals/evals-tier1-directory-20260902-120000-000/handoff.json"))
  // The hard stop rule: write the handoff, terminate, never redeem.
  assert.ok(prompt.includes("squire.task.complete"))
  assert.ok(prompt.includes("Never redeem the approval token"))
  assert.ok(prompt.includes("never call c1_connector_service_force_sync"))
  // The under-sync trap is spelled out.
  assert.ok(prompt.includes("account_id"))
  assert.ok(prompt.includes("3-user unscoped subset"))
})

test("buildPrompt skill-bundle modes render", () => {
  const none = buildPrompt({...SCENARIO, skillBundle: {mode: "none", version: "0.0.0"}}, "r", "http://x", "ref")
  assert.ok(none.includes("No skill bundle"))
  const full = buildPrompt({...SCENARIO, skillBundle: {mode: "full", version: "1.2.3"}}, "r", "http://x", "ref")
  assert.ok(full.includes("Skill bundle (version 1.2.3)"))
})
