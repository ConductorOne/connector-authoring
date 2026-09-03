// provision.ts — eval env provisioning + teardown (CXF-216 PR 1).
import {createEnv, stopEnv, type CallOpts} from "./squire.ts"
import type {Scenario} from "./scenario.ts"

// Pure builder for the create_env args (D14): the omp reasoning-effort pin
// is an ENV-level field (squire.create_env.omp_reasoning_effort), not a
// task-level one — taskCreate has no such field.
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

// Provision a fresh env and run the readiness gate; on readiness failure
// tear down and retry with a fresh env (max `attempts` total).
export async function retryProvision(
  scenario: Scenario,
  runId: string,
  readiness: (envId: string) => Promise<void>,
  attempts = 3,
  opts: CallOpts = {},
): Promise<{envId: string}> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    let envId = ""
    try {
      const provisioned = await provisionEnv(scenario, runId, opts)
      envId = provisioned.envId
      await readiness(envId)
      return {envId}
    } catch (err) {
      lastErr = err
      console.error(`attempt ${i + 1}/${attempts} failed for ${envId || "(create_env)"}: ${(err as Error).message}`)
      if (envId) await teardownEnv(envId, opts)
    }
  }
  throw lastErr
}
