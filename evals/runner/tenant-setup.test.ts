// tenant-setup.test.ts — unit smoke for the manage-ff provisioning prompt (D21).
// The prompt is the unblock contract: it must carry the full manage-ff flow
// (list-tenants, set-account-type, set-skus, enable) and the SETUP DONE/FAIL
// markers the runner's transcript check keys on.
import {test} from "node:test"
import assert from "node:assert/strict"
import {buildTenantSetupPrompt, setupOutcome} from "./tenant-setup.ts"

test("buildTenantSetupPrompt carries the full manage-ff flow", () => {
  const prompt = buildTenantSetupPrompt("r")
  assert.ok(prompt.includes("list-tenants"))
  assert.ok(prompt.includes("set-account-type"))
  assert.ok(prompt.includes("set-skus"))
  assert.ok(prompt.includes("manage-ff enable"))
  assert.ok(prompt.includes("--flag=CONNECTOR_AUTHORING"))
  assert.ok(prompt.includes("effective_flags"))
  assert.ok(prompt.includes("SETUP DONE"))
  assert.ok(prompt.includes("SETUP FAIL"))
})

test("buildTenantSetupPrompt substitutes the run id", () => {
  const prompt = buildTenantSetupPrompt("evals-tier1-directory-20260902-120000-000")
  assert.ok(prompt.includes("eval run evals-tier1-directory-20260902-120000-000"))
})

test("setupOutcome: real stream shape — early transient SETUP FAIL, step-4 SETUP DONE, trailing task.complete result — is done", () => {
  // Regression for the observed false failure (preflight2 attempt 1): the
  // agent's first attempt echoed "SETUP FAIL: no tenants" before it adapted
  // (found dev-util, ran `dev-util ensure`) and completed with SETUP DONE.
  // The D21 script's step 5 (squire.task.complete) ALWAYS trails the step-4
  // "SETUP DONE" echo, so a real successful transcript ends with the
  // task.complete tool_result JSON, never "SETUP DONE" (evidence:
  // tenant-setup-stream.txt). Last-marker-occurrence semantics must classify
  // this as done.
  const transcript = [
    "CALL bash: TENANT=$(dev-util list-tenants --format=json | jq -r '.[0].tenant_id // empty')",
    "RESULT: error: command not found: dev-util",
    "error: command not found: dev-util",
    "SETUP FAIL: no tenants",
    "CALL bash: set -a",
    ". /data/squire/src/c1/.dev/env/dev-shell.env",
    "set +a",
    'DEV_UTIL="/data/squire/src/c1/build/linux_arm64/dev-util/dev-util"',
    'TENANT="3InRh3BS5Ingv56NYxnf9IZFnRj"',
    'STATE=$("$DEV_UTIL" manage-ff get --tenant "$TENANT" --flag CONNECTOR_AUTHORING --format=json | jq -r \'.effective_flags.CONNECTOR_AUTHORING // "disabled"\')',
    "RESULT: SETUP DONE",
    "CALL bash: squire-tool call squire.task.complete '{\"summary\": \"tenant setup finished\"}'",
    'RESULT: {"arena_id":"arena_bdd04bc8-ff8","terminal_state":"completed"}',
  ].join("\n")
  assert.deepEqual(setupOutcome(transcript), {status: "done"})
})

test("setupOutcome: a SETUP FAIL after SETUP DONE is a failure (fail-closed)", () => {
  const transcript = ["SETUP DONE", "SETUP FAIL: CONNECTOR_AUTHORING not effective"].join("\n")
  assert.deepEqual(setupOutcome(transcript), {status: "failed", line: "SETUP FAIL: CONNECTOR_AUTHORING not effective"})
})

test("setupOutcome: terminal SETUP FAIL is a failure", () => {
  const transcript = "SETUP FAIL: CONNECTOR_AUTHORING not effective"
  assert.deepEqual(setupOutcome(transcript), {status: "failed", line: "SETUP FAIL: CONNECTOR_AUTHORING not effective"})
})

test("setupOutcome: no markers is a failure", () => {
  const outcome = setupOutcome("some unrelated output")
  assert.equal(outcome.status, "failed")
  assert.match(outcome.line, /no SETUP DONE marker/)
})

test("setupOutcome: empty transcript is a failure", () => {
  const outcome = setupOutcome("")
  assert.equal(outcome.status, "failed")
  assert.match(outcome.line, /no SETUP DONE marker/)
})
