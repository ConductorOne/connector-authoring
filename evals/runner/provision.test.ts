// provision.test.ts — unit smoke for the create_env args builder (D14).
// The omp reasoning-effort pin is an ENV-level field: provisionEnvArgs must
// carry scenario.reasoningEffort into create_env's omp_reasoning_effort.
import {test} from "node:test"
import assert from "node:assert/strict"
import {provisionEnvArgs} from "./provision.ts"
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
  reasoningEffort: "high",
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

test("provisionEnvArgs carries the scenario reasoning-effort pin into omp_reasoning_effort", () => {
  const args = provisionEnvArgs(SCENARIO, "evals-tier1-directory-20260902-120000-000")
  assert.equal(args.omp_reasoning_effort, "high")
  assert.equal(args.image, "c1")
  assert.equal(args.idle_timeout_minutes, 60)
  assert.equal(args.auto_delete_minutes, 360)
  assert.ok(String(args.initial_prompt).includes("tier1-directory"))
})

test("provisionEnvArgs follows a low reasoning-effort scenario", () => {
  const args = provisionEnvArgs({...SCENARIO, reasoningEffort: "low"}, "r")
  assert.equal(args.omp_reasoning_effort, "low")
})
