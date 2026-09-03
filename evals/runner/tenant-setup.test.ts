// tenant-setup.test.ts — unit smoke for the tenant-setup prompt (locked D21).
// The prompt is the manage-ff provisioning contract: every mutation and
// marker the runner depends on must be present.
import {test} from "node:test"
import assert from "node:assert/strict"
import {buildTenantSetupPrompt} from "./tenant-setup.ts"

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
