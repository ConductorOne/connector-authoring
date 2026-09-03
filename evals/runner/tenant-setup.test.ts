// tenant-setup.test.ts — unit tests for the tenant-setup decision logic
// (CXF-217, D21 + ratified round-2 amendments). The arena-FS outcome markers
// are the ONLY success signal the runner trusts: the prompt text itself
// contains the SETUP DONE/SETUP FAIL literals, so a transcript-based check
// could false-pass on prompt leakage. These tests pin the fail-closed
// semantics with injected taskCreate/getTask/taskStream/fsRead.
import {test} from "node:test"
import assert from "node:assert/strict"
import {
  buildTenantSetupPrompt,
  runTenantSetup,
  setupFailPath,
  setupOkPath,
  setupOutcome,
  type TenantSetupDeps,
} from "./tenant-setup.ts"

// --- setupOutcome (pure decision logic) ---

test("setupOutcome: completed + ok marker is success", () => {
  assert.equal(setupOutcome("completed", "ok", null), "success")
})

test("setupOutcome: failed/canceled state is failed even with an ok marker (fail-closed)", () => {
  assert.equal(setupOutcome("failed", "ok", null), "failed")
  assert.equal(setupOutcome("canceled", "ok", null), "failed")
})

test("setupOutcome: fail marker is failed", () => {
  assert.equal(setupOutcome("completed", null, "CONNECTOR_AUTHORING not effective"), "failed")
})

test("setupOutcome: completed with no markers is no-marker", () => {
  assert.equal(setupOutcome("completed", null, null), "no-marker")
})

// --- buildTenantSetupPrompt ---

test("buildTenantSetupPrompt carries the full manage-ff sequence", () => {
  const prompt = buildTenantSetupPrompt("r")
  assert.ok(prompt.includes("list-tenants"))
  assert.ok(prompt.includes("set-account-type"))
  assert.ok(prompt.includes("set-skus"))
  assert.ok(prompt.includes("manage-ff enable"))
  assert.ok(prompt.includes("--flag=CONNECTOR_AUTHORING"))
  assert.ok(prompt.includes("effective_flags"))
  assert.ok(prompt.includes("eval run r"))
})

test("buildTenantSetupPrompt writes both outcome markers to the arena FS", () => {
  const prompt = buildTenantSetupPrompt("run-1")
  assert.ok(prompt.includes(setupOkPath("run-1")))
  assert.ok(prompt.includes(setupFailPath("run-1")))
  // The ok marker must be written on the idempotent path too (step 2 early exit).
  assert.ok(prompt.includes('"content": "ok"'))
})

test("buildTenantSetupPrompt resolves the tenant fail-closed (no .[0] fallback)", () => {
  const prompt = buildTenantSetupPrompt("r")
  assert.ok(prompt.includes('select(.tenant_domain=="c1dev")'))
  // Step 1 must not fall back to the first tenant: mutating a non-c1dev
  // tenant would be a cross-tenant escalation. (Step 0's ensure check
  // legitimately uses .[0].tenant_id — that is a read, not a mutation.)
  assert.ok(!prompt.includes('then TENANT=$(dev-util list-tenants --format=json | jq -r \'.[0].tenant_id // empty\')'))
  assert.ok(prompt.includes("SETUP FAIL: no c1dev tenant"))
})

// --- runTenantSetup with injected deps ---

function deps(overrides: Partial<TenantSetupDeps> = {}): TenantSetupDeps {
  return {
    taskCreate: async () => ({id: "task-1"}),
    getTask: async () => ({task: {state: "completed"}}),
    taskStream: async () => ({events: [], next_seq: 0}),
    fsRead: async () => {
      throw new Error("not found")
    },
    ...overrides,
  }
}

const FAST_TIMING = {timeoutMs: 50, pollMs: 1}

test("runTenantSetup returns on completed + ok marker", async () => {
  const d = deps({
    fsRead: async (path: string) => {
      if (path === setupOkPath("r")) return {content: "ok"}
      throw new Error("not found")
    },
  })
  await runTenantSetup("env-1", "r", {}, d, FAST_TIMING)
})

test("runTenantSetup throws on fail marker with the reason", async () => {
  const d = deps({
    fsRead: async (path: string) => {
      if (path === setupFailPath("r")) return {content: "CONNECTOR_AUTHORING not effective"}
      throw new Error("not found")
    },
  })
  await assert.rejects(
    runTenantSetup("env-1", "r", {}, d, FAST_TIMING),
    /tenant setup failed: CONNECTOR_AUTHORING not effective \(env env-1, run r, task task-1\)/,
  )
})

test("runTenantSetup throws on failed task state even with an ok marker", async () => {
  const d = deps({
    getTask: async () => ({task: {state: "failed"}}),
    fsRead: async (path: string) => {
      if (path === setupOkPath("r")) return {content: "ok"}
      throw new Error("not found")
    },
  })
  await assert.rejects(runTenantSetup("env-1", "r", {}, d, FAST_TIMING), /tenant setup failed: task state failed/)
})

test("runTenantSetup throws on no outcome marker", async () => {
  await assert.rejects(runTenantSetup("env-1", "r", {}, deps(), FAST_TIMING), /no outcome marker/)
})

test("runTenantSetup throws on task-create with no id", async () => {
  const d = deps({taskCreate: async () => ({})})
  await assert.rejects(runTenantSetup("env-1", "r", {}, d, FAST_TIMING), /task create returned no id/)
})

test("runTenantSetup throws on timeout with env/run/task ids", async () => {
  const d = deps({
    getTask: async () => ({task: {state: "running"}}),
  })
  await assert.rejects(
    runTenantSetup("env-1", "r", {}, d, FAST_TIMING),
    /timed out after \d+ min \(env env-1, run r, task task-1\)/,
  )
})

test("runTenantSetup tolerates a transient get_task failure then completes", async () => {
  let calls = 0
  const d = deps({
    getTask: async () => {
      calls++
      if (calls === 1) throw new Error("gateway blip")
      return {task: {state: "completed"}}
    },
    fsRead: async (path: string) => {
      if (path === setupOkPath("r")) return {content: "ok"}
      throw new Error("not found")
    },
  })
  await runTenantSetup("env-1", "r", {}, d, FAST_TIMING)
  assert.ok(calls >= 2)
})
