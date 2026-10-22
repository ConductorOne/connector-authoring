// agent.test.ts — unit smoke for the agent prompt builder (locked C1).
// The prompt is the eval's instruction contract: the stop rule, the handoff
// path, and the credentials must all be present and consistent.
import {test} from "node:test"
import assert from "node:assert/strict"
import {buildPrompt} from "./agent.ts"
import type {Scenario} from "./scenario.ts"
import type {RunChannel} from "./driver.ts"

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
}

const CHANNEL: RunChannel = {
  runDir: "/tmp/evals-run",
  handoffPath: "/tmp/evals-run/handoff.json",
  scoreInputPath: "/tmp/evals-run/score-input.json",
  transcriptPath: "/tmp/evals-run/transcript.json",
  pre1Path: "/tmp/evals-run/pre1.json",
  handoffInstructions: 'Write it with driver.write_file: args {path: "<path>", content: "<the full handoff JSON>"}.',
  completionInstructions: 'Then terminate the run with driver.complete_run: args {summary: "handoff written; funnel complete to human-activation boundary"}.',
  pre1Instructions: 'Write it with driver.write_file: args {path: "<path>", content: "<the full pre1.json>"}. Then terminate the run with driver.complete_run: args {summary: "pre1 artifact written"}.',
}

test("buildPrompt carries the stop rule, handoff path, and credentials", () => {
  const prompt = buildPrompt(SCENARIO, "evals-tier1-directory-20260902-120000-000", "http://127.0.0.1:18080", CHANNEL)
  assert.ok(prompt.includes("http://127.0.0.1:18080"))
  assert.ok(prompt.includes("connector@example.com"))
  assert.ok(prompt.includes("fixture-token"))
  assert.ok(prompt.includes("/tmp/evals-run/handoff.json"))
  // The hard stop rule: write the handoff, terminate, never redeem.
  assert.ok(prompt.includes("driver.complete_run"))
  assert.ok(prompt.includes("Never redeem the approval token"))
  assert.ok(prompt.includes("never call c1_connector_service_force_sync"))
  // The under-sync trap is spelled out.
  assert.ok(prompt.includes("account_id"))
  assert.ok(prompt.includes("3-user unscoped subset"))
  // The page-envelope trap is spelled out.
  assert.ok(prompt.includes('itemsPath: ["items"]'))
})

test("buildPrompt uploads the build-required files and frozen test contract", () => {
  const prompt = buildPrompt(SCENARIO, "run", "http://fixture", CHANNEL)
  const upload = prompt.split("\n").find((line) => line.startsWith("Step 2:"))!
  assert.ok(SCENARIO.requiredSourceFiles)
  for (const file of [...SCENARIO.requiredSourceFiles, "openapi.json", "reviewed-ops.json"]) {
    assert.ok(upload.includes(file), `upload instruction missing ${file}`)
  }
  assert.ok(upload.includes("four build-required files"))
  assert.ok(upload.includes("two test-required frozen files"))
  assert.ok(upload.includes("output_slice"))
  assert.ok(upload.includes("camelCase"))
})

test("buildPrompt requires matching PASS and accepted evidence before deploy or mint", () => {
  const prompt = buildPrompt(SCENARIO, "run", "http://fixture", CHANNEL)
  const evidence = prompt.split("\n").find((line) => line.startsWith("Step 10:"))!
  assert.ok(evidence.includes("Before Step 11 deploy or mint"))
  assert.ok(evidence.includes("same durable evidence"))
  assert.ok(evidence.includes('result == CONNECTOR_TEST_RUN_RESULT_PASS and transport_judge_verdict == "accepted"'))
  assert.ok(evidence.includes("stop on any other or missing verdict"))
  assert.ok(evidence.includes("build-and-test verdict table"))
})

test("buildPrompt skill-bundle modes render", () => {
  const none = buildPrompt({...SCENARIO, skillBundle: {mode: "none", version: "0.0.0"}}, "r", "http://x", CHANNEL)
  assert.ok(none.includes("No skill bundle"))
  const full = buildPrompt({...SCENARIO, skillBundle: {mode: "full", version: "1.2.3"}}, "r", "http://x", CHANNEL)
  assert.ok(full.includes("Skill bundle (version 1.2.3)"))
})

test("buildPrompt pre1 branch names the pre1Path, both skills, and the output contract", () => {
  const pre1: Scenario = {
    id: "pre1-directory-proceed",
    name: "Pre-1: Directory API access model + spec sourcing (proceed)",
    fixture: {
      port: 18080,
      baseUrl: "http://127.0.0.1:18080",
      auth: "basic",
      openapiPath: "/openapi.json",
      basicAuth: {username: "connector@example.com", password: "fixture-token"},
      bearerToken: "fixture-token",
    },
    skillBundle: {mode: "full", version: "0.12.5"},
    model: "together/deepseek-ai/DeepSeek-V4-Flash-0731",
    reasoningEffort: "high",
    kind: "pre1",
    providerBrief: "A directory service exposes users, groups, and memberships over REST.",
    expectedDecision: "proceed",
    expectedAccessModel: {
      resource_types: [{id: "user", traits: ["TRAIT_USER"]}],
      entitlements: [{slug: "member"}],
      grants: [{resource_type: "group", entitlement: "member", principal_type: "user"}],
    },
  }
  const prompt = buildPrompt(pre1, "r", "http://127.0.0.1:18080", CHANNEL)
  // The pre1 artifact target, the two pre-1 skills, and the completion verb
  // must all be present — a regression that drops any of them silently
  // breaks real pre1 runs (agents write malformed artifacts or never stop).
  assert.ok(prompt.includes("/tmp/evals-run/pre1.json"))
  assert.ok(prompt.includes("source-openapi-spec"))
  assert.ok(prompt.includes("design-access-model"))
  assert.ok(prompt.includes("driver.write_file"))
  assert.ok(prompt.includes("driver.complete_run"))
  // The output contract names the schema halves.
  assert.ok(prompt.includes("park_evidence"))
  assert.ok(prompt.includes("spec_bytes"))
  assert.ok(prompt.includes("missing_paths"))
})
