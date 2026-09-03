// tenant-setup.test.ts — unit smoke for the manage-ff provisioning prompt (D21).
// The prompt is the unblock contract: it must carry the full manage-ff flow
// (list-tenants, set-account-type, set-skus, enable) and the SETUP DONE/FAIL
// markers the runner's transcript check keys on.
import {test} from "node:test"
import assert from "node:assert/strict"
import {buildTenantSetupPrompt} from "./tenant-setup.ts"

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
