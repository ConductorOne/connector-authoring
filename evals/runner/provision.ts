// provision.ts — eval env provisioning + teardown (CXF-216 PR 1).
import {createEnv, stopEnv, type CallOpts} from "./squire.ts"
import type {Scenario} from "./scenario.ts"
import {ReadinessError} from "./readiness.ts"
import {runTenantSetup} from "./tenant-setup.ts"

// Locked D14: the omp reasoning-effort pin is an ENV-level field on
// squire.create_env (the gateway's squire.task.create has no such field),
// so the scenario's reasoningEffort is passed at provisioning time.
export function provisionEnvArgs(scenario: Scenario, runId: string): Record<string, unknown> {
  return {
    image: "c1",
    idle_timeout_minutes: 60,
    auto_delete_minutes: 360,
    initial_prompt: `Eval environment for connector-authoring scenario ${scenario.id}. Await task instructions.`,
    omp_reasoning_effort: scenario.reasoningEffort,
  }
}

export async function provisionEnv(
  scenario: Scenario,
  runId: string,
  opts: CallOpts = {},
): Promise<{envId: string}> {
  const res = await createEnv(provisionEnvArgs(scenario, runId), opts)
  const envId = (res.env_id ?? res.id) as string | undefined
  if (!envId) {
    throw new Error(`create_env returned no env id: ${JSON.stringify(res)}`)
  }
  return {envId}
}

export async function teardownEnv(envId: string, opts: CallOpts = {}): Promise<void> {
  try {
    await stopEnv(envId, opts)
  } catch (err) {
    console.error(`teardown of ${envId} failed (best-effort): ${(err as Error).message}`)
  }
}

// Injectable I/O surface so the readiness-gating decision is unit-testable.
export interface ProvisionDeps {
  runTenantSetup: (envId: string, runId: string, opts?: CallOpts) => Promise<void>
}

const defaultDeps: ProvisionDeps = {runTenantSetup}

// D21 (ratified round-2 amendment): the manage-ff step runs ONLY when the
// readiness gate fails — a healthy env (flag already effective) skips the
// setup task entirely, so the setup's failure mode and wall-clock bound
// never touch the clean path. A non-ReadinessError (transient gateway
// failure) propagates without triggering the setup.
export async function provisionWithReadiness(
  envId: string,
  runId: string,
  readiness: (envId: string) => Promise<void>,
  opts: CallOpts = {},
  deps: ProvisionDeps = defaultDeps,
): Promise<void> {
  try {
    await readiness(envId)
  } catch (err) {
    if (!(err instanceof ReadinessError)) throw err
    await deps.runTenantSetup(envId, runId, opts)
    await readiness(envId)
  }
}

// Provision a fresh env and run the readiness gate; on readiness failure
// tear down and retry with a fresh env (max `attempts` total).
export async function retryProvision(
  scenario: Scenario,
  runId: string,
  readiness: (envId: string) => Promise<void>,
  attempts = 3,
  opts: CallOpts = {},
  deps: ProvisionDeps = defaultDeps,
): Promise<{envId: string}> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    let envId = ""
    try {
      const provisioned = await provisionEnv(scenario, runId, opts)
      envId = provisioned.envId
      await provisionWithReadiness(envId, runId, readiness, opts, deps)
      return {envId}
    } catch (err) {
      lastErr = err
      console.error(`attempt ${i + 1}/${attempts} failed for ${envId || "(create_env)"}: ${(err as Error).message}`)
      if (envId) await teardownEnv(envId, opts)
    }
  }
  throw lastErr
}
