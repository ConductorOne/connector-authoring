// tenant-setup.test.ts — unit smoke for the tenant-setup prompt (D21) and
// the runTenantSetup lifecycle (task-create, terminal polling, failure
// detection, timeout). The gateway client (squire.ts) is mocked via
// node:test mock.module so the poll/terminal/timeout paths are exercised
// without a live env.
import {test, mock} from "node:test"
import assert from "node:assert/strict"

// --- mock the squire.ts gateway client BEFORE importing tenant-setup.ts ---
const calls: {taskCreate: number; getTask: number; taskStream: number} = {
  taskCreate: 0,
  getTask: 0,
  taskStream: 0,
}
let taskCreateResult: Record<string, unknown> = {id: "task-1"}
let getTaskResult: Record<string, unknown> | null = {task: {state: "running"}}
let taskStreamResult: Record<string, unknown> = {events: [], next_seq: 0}

mock.module("./squire.ts", {
  namedExports: {
    // The mock replaces the whole module, so every runtime export the import
    // graph needs (tenant-setup.ts + readiness.ts) must be present.
    call: async (): Promise<unknown> => ({}),
    fsRead: async (): Promise<unknown> => ({}),
    fsWrite: async (): Promise<unknown> => ({}),
    getEnv: async (): Promise<Record<string, unknown>> => ({}),
    createEnv: async (): Promise<Record<string, unknown>> => ({}),
    stopEnv: async (): Promise<unknown> => ({}),
    taskCreate: async (): Promise<Record<string, unknown>> => {
      calls.taskCreate++
      return taskCreateResult
    },
    getTask: async (): Promise<Record<string, unknown> | null> => {
      calls.getTask++
      return getTaskResult
    },
    taskStream: async (): Promise<Record<string, unknown>> => {
      calls.taskStream++
      return taskStreamResult
    },
    listModels: async (): Promise<Record<string, unknown>> => ({}),
    resolveTaskId: (): string | undefined => undefined,
  },
})

// Dynamic import is REQUIRED here: mock.module must be registered before the
// module under test is loaded, so a static import would bypass the mock.
const {runTenantSetup, waitForSetupTerminal, buildTenantSetupPrompt} = await import("./tenant-setup.ts")

function resetCalls(): void {
  calls.taskCreate = 0
  calls.getTask = 0
  calls.taskStream = 0
}

function streamWith(...lines: string[]): Record<string, unknown> {
  return {
    events: lines.map((message) => ({message, data: {}})),
    next_seq: lines.length,
  }
}

test("buildTenantSetupPrompt carries the full manage-ff sequence", () => {
  const prompt = buildTenantSetupPrompt("r")
  assert.ok(prompt.includes("list-tenants"))
  assert.ok(prompt.includes("set-account-type"))
  assert.ok(prompt.includes("set-skus"))
  assert.ok(prompt.includes("manage-ff enable"))
  assert.ok(prompt.includes("--flag=CONNECTOR_AUTHORING"))
  assert.ok(prompt.includes("effective_flags"))
  assert.ok(prompt.includes("SETUP DONE"))
  assert.ok(prompt.includes("SETUP FAIL"))
  assert.ok(prompt.includes("eval run r"))
})

test("buildTenantSetupPrompt substitutes the run id", () => {
  const prompt = buildTenantSetupPrompt("evals-tier1-directory-20260902-120000-000")
  assert.ok(prompt.includes("eval run evals-tier1-directory-20260902-120000-000"))
})

test("buildTenantSetupPrompt resolves dev-util explicitly (not PATH-assumed)", () => {
  const prompt = buildTenantSetupPrompt("r")
  assert.ok(prompt.includes("DEV_UTIL=$(command -v dev-util"))
  assert.ok(prompt.includes("SETUP FAIL: dev-util not found"))
  // dev-util needs the dev-shell env (SQUIRE_ENV_ID etc.) — the halt-path
  // agent had to source it manually; the prompt must be self-sufficient.
  assert.ok(prompt.includes(". /data/squire/src/c1/.dev/env/dev-shell.env"))
})

test("buildTenantSetupPrompt fails closed on tenant selection (no arbitrary .[0] fallback)", () => {
  const prompt = buildTenantSetupPrompt("r")
  assert.ok(prompt.includes('select(.tenant_domain=="c1dev")'))
  assert.ok(prompt.includes("SETUP FAIL: no c1dev tenant found"))
  assert.ok(!prompt.includes(".[0].tenant_id"), "must not fall back to an arbitrary first tenant")
})

test("runTenantSetup throws ReadinessError when the setup task fails (SETUP FAIL in stream)", async () => {
  resetCalls()
  taskCreateResult = {id: "task-fail"}
  getTaskResult = {task: {state: "failed"}}
  taskStreamResult = streamWith("CALL bash: dev-util list-tenants", "RESULT: SETUP FAIL: no c1dev tenant found")
  await assert.rejects(
    () => runTenantSetup("env-1", "r"),
    (err: Error) => {
      assert.ok(err.message.includes("READINESS FAILURE"))
      assert.ok(err.message.includes("SETUP FAIL: no c1dev tenant found"))
      assert.ok(err.message.includes("task-fail"))
      return true
    },
  )
})

test("runTenantSetup throws ReadinessError when a completed task stream still shows SETUP FAIL", async () => {
  resetCalls()
  taskCreateResult = {id: "task-completed-fail"}
  getTaskResult = {task: {state: "completed"}}
  taskStreamResult = streamWith("RESULT: SETUP FAIL: CONNECTOR_AUTHORING not effective")
  await assert.rejects(
    () => runTenantSetup("env-1", "r"),
    (err: Error) => {
      assert.ok(err.message.includes("SETUP FAIL: CONNECTOR_AUTHORING not effective"))
      return true
    },
  )
})

test("runTenantSetup succeeds when a completed task recovered from an intermediate SETUP FAIL (LAST-marker discipline)", async () => {
  resetCalls()
  // The halt-path stream shows exactly this pattern: the first attempt
  // printed SETUP FAIL (dev-util not on PATH), the agent recovered and the
  // final result was SETUP DONE. A whole-stream `includes` scan would
  // false-positive; the LAST marker is authoritative.
  taskCreateResult = {id: "task-recovered"}
  getTaskResult = {task: {state: "completed"}}
  taskStreamResult = streamWith(
    "CALL bash: dev-util list-tenants",
    "RESULT: error: command not found: dev-util",
    "RESULT: SETUP FAIL: no tenants",
    "CALL bash: $DEV_UTIL list-tenants",
    "RESULT: SETUP DONE",
  )
  await runTenantSetup("env-1", "r")
})

test("runTenantSetup throws when a completed task stream has no SETUP DONE marker (unreadable stream)", async () => {
  resetCalls()
  taskCreateResult = {id: "task-no-marker"}
  getTaskResult = {task: {state: "completed"}}
  taskStreamResult = {events: [], next_seq: 0}
  await assert.rejects(
    () => runTenantSetup("env-1", "r"),
    (err: Error) => {
      assert.ok(err.message.includes("no SETUP DONE marker"))
      return true
    },
  )
})

test("runTenantSetup returns normally on completed + SETUP DONE", async () => {
  resetCalls()
  taskCreateResult = {id: "task-ok"}
  getTaskResult = {task: {state: "completed"}}
  taskStreamResult = streamWith("RESULT: SETUP DONE")
  await runTenantSetup("env-1", "r")
  assert.equal(calls.taskCreate, 1)
  assert.equal(calls.getTask, 1)
  // readSetupStream pages once, then re-reads to observe next_seq <= sinceSeq.
  assert.equal(calls.taskStream, 2)
})

test("runTenantSetup throws when taskCreate returns no id", async () => {
  resetCalls()
  taskCreateResult = {}
  await assert.rejects(
    () => runTenantSetup("env-1", "r"),
    (err: Error) => {
      assert.ok(err.message.includes("no id"))
      return true
    },
  )
})

test("waitForSetupTerminal times out when the task never reaches terminal", async () => {
  resetCalls()
  getTaskResult = {task: {state: "running"}}
  const {state, timedOut} = await waitForSetupTerminal("env-1", "task-hung", 50, {}, 1)
  assert.equal(timedOut, true)
  assert.equal(state, "running")
})

test("waitForSetupTerminal returns terminal state on completion", async () => {
  resetCalls()
  getTaskResult = {task: {state: "completed"}}
  const {state, timedOut} = await waitForSetupTerminal("env-1", "task-ok", 50, {}, 1)
  assert.equal(timedOut, false)
  assert.equal(state, "completed")
})
