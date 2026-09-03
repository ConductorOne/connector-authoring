// provision.test.ts — unit smoke for the env provisioning args builder
// (locked D14) and the readiness-gated tenant-setup wiring (D21, ratified
// round-2 amendment). The omp reasoning-effort pin is an ENV-level field on
// squire.create_env; provisionEnvArgs must carry the scenario's pin. The
// manage-ff step must run ONLY on a ReadinessError, never on the clean path
// or on transient non-readiness failures.
import {test} from "node:test"
import assert from "node:assert/strict"
import {provisionEnvArgs, provisionWithReadiness, type ProvisionDeps} from "./provision.ts"
import {ReadinessError} from "./readiness.ts"
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

test("provisionEnvArgs carries the scenario reasoning-effort pin to createEnv", () => {
  const args = provisionEnvArgs(SCENARIO, "evals-tier1-directory-20260902-120000-000")
  assert.equal(args.omp_reasoning_effort, "high")
  assert.equal(args.image, "c1")
  assert.equal(args.idle_timeout_minutes, 60)
  assert.equal(args.auto_delete_minutes, 360)
  assert.ok(String(args.initial_prompt).includes("tier1-directory"))
})

test("provisionEnvArgs reflects a low reasoning-effort scenario", () => {
  const args = provisionEnvArgs({...SCENARIO, reasoningEffort: "low"}, "r")
  assert.equal(args.omp_reasoning_effort, "low")
})

// --- readiness-gated tenant-setup wiring ---

function trackingDeps(): {deps: ProvisionDeps; setupCalls: string[]} {
  const setupCalls: string[] = []
  return {
    setupCalls,
    deps: {
      runTenantSetup: async (envId: string, runId: string) => {
        setupCalls.push(`${envId}:${runId}`)
      },
    },
  }
}

test("provisionWithReadiness skips the setup when readiness passes (clean path)", async () => {
  const {deps, setupCalls} = trackingDeps()
  await provisionWithReadiness("env-1", "r", async () => {}, {}, deps)
  assert.deepEqual(setupCalls, [])
})

test("provisionWithReadiness runs the setup on a ReadinessError then re-probes", async () => {
  const {deps, setupCalls} = trackingDeps()
  let probes = 0
  await provisionWithReadiness(
    "env-1",
    "r",
    async () => {
      probes++
      if (probes === 1) throw new ReadinessError("env env-1 missing readiness tools: c1_connector_authoring_get_authoring_guide")
    },
    {},
    deps,
  )
  assert.deepEqual(setupCalls, ["env-1:r"])
  assert.equal(probes, 2)
})

test("provisionWithReadiness propagates a non-ReadinessError without running the setup", async () => {
  const {deps, setupCalls} = trackingDeps()
  await assert.rejects(
    provisionWithReadiness("env-1", "r", async () => {
      throw new Error("gateway blip")
    }, {}, deps),
    /gateway blip/,
  )
  assert.deepEqual(setupCalls, [])
})

test("provisionWithReadiness propagates a re-probe ReadinessError (halt path)", async () => {
  const {deps, setupCalls} = trackingDeps()
  await assert.rejects(
    provisionWithReadiness(
      "env-1",
      "r",
      async () => {
        throw new ReadinessError("env env-1 missing readiness tools: c1_connector_authoring_get_authoring_guide")
      },
      {},
      deps,
    ),
    /READINESS FAILURE/,
  )
  assert.deepEqual(setupCalls, ["env-1:r"])
})
