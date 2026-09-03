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

test("setupOutcome: terminal SETUP DONE wins over an early transient SETUP FAIL echo", () => {
  // Regression for the observed false failure (preflight2 attempt 1): the
  // agent's first attempt echoed "SETUP FAIL: no tenants" before it adapted
  // (found dev-util, ran `dev-util ensure`) and completed with SETUP DONE.
  const transcript = [
    "CALL bash: TENANT=$(dev-util list-tenants --format=json | jq -r '.[0].tenant_id // empty')",
    "RESULT: error: command not found: dev-util",
    "SETUP FAIL: no tenants",
    "CALL bash: dev-util ensure",
    "RESULT: ok",
    "SETUP DONE",
  ].join("\n")
  assert.deepEqual(setupOutcome(transcript), {status: "done"})
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
