// fixture-install.ts — fixture delivery + reachability in the eval env (CXF-216 PR 1, L26).
import {getTask, taskCreate, taskStream, type CallOpts} from "./squire.ts"
import type {Scenario} from "./scenario.ts"
import {ReadinessError} from "./readiness.ts"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function isTerminal(state: unknown): boolean {
  return state === "completed" || state === "failed" || state === "canceled"
}

function buildSetupPrompt(scenario: Scenario, runId: string, ref: string): string {
  return `You are the fixture setup task for eval run ${runId}. Run this exact sequence and report the result:

1. git clone https://github.com/ConductorOne/connector-authoring /tmp/connector-authoring
2. cd /tmp/connector-authoring && git checkout ${ref}
   If the checkout fails, print "SETUP FAIL: checkout failed for ref ${ref}" and stop.
3. node --version — assert the version is >= 22.18. If lower, print "SETUP FAIL: node version below 22.18" and stop.
4. Launch the fixture: nohup node --experimental-strip-types evals/fixture/server.ts --port 18080 --host 0.0.0.0 > /tmp/fixture.log 2>&1 &
5. Reachability assert (real authenticated GET):
   curl -sS -u connector@example.com:fixture-token "http://127.0.0.1:18080/v1/users?account_id=acct-1"
   If the response contains "total":23, print "FIXTURE_BASE_URL=http://127.0.0.1:18080" and go to step 7.
   Otherwise try the pod IP: HOST=$(hostname -i | awk '{print $1}') and
   curl -sS -u connector@example.com:fixture-token "http://$HOST:18080/v1/users?account_id=acct-1"
   If that response contains "total":23, print "FIXTURE_BASE_URL=http://$HOST:18080" and go to step 7.
   Otherwise print "SETUP FAIL: fixture unreachable on 127.0.0.1 and pod IP" and stop.
6. (unreachable — see step 5)
7. Print "SETUP DONE" as your final line, then terminate the task: squire-tool call squire.task.complete '{"summary": "fixture setup finished"}'`
}

async function waitForSetupTerminal(
  envId: string,
  taskId: string,
  timeoutMs: number,
  opts: CallOpts,
): Promise<{state: string; timedOut: boolean}> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await getTask(envId, taskId, opts)
      const state = ((res as Record<string, unknown> | null)?.task as Record<string, unknown> | undefined)?.state as string | undefined
      if (state && isTerminal(state)) return {state, timedOut: false}
    } catch (err) {
      // Transient gateway failure: log and keep polling.
      console.error(`WARNING: get_task poll failed: ${(err as Error).message}`)
    }
    await sleep(10_000)
  }
  return {state: "running", timedOut: true}
}

async function readSetupStream(
  taskId: string,
  opts: CallOpts,
): Promise<string> {
  let sinceSeq = 0
  const parts: string[] = []
  for (;;) {
    let page: Record<string, unknown>
    try {
      page = (await taskStream(taskId, {sinceSeq, limit: 500}, opts)) as Record<string, unknown>
    } catch (err) {
      // Transient stream hiccup: return what we have (the setup markers are
      // usually early in the stream; a retry would re-read from scratch).
      console.error(`WARNING: setup stream read failed: ${(err as Error).message}`)
      break
    }
    const events = (page?.events ?? []) as Record<string, unknown>[]
    for (const ev of events) {
      // The real stream puts tool_result text in the TOP-LEVEL `message`
      // (data carries only tool_name/is_error) — read it first.
      if (typeof ev.message === "string" && ev.message.length > 0) parts.push(ev.message)
      const data = (ev.data ?? {}) as Record<string, unknown>
      for (const key of ["result", "output"]) {
        const v = data[key]
        if (typeof v === "string") parts.push(v)
      }
    }
    const nextSeq = page?.next_seq as number | undefined
    if (nextSeq === undefined || nextSeq <= sinceSeq) break
    sinceSeq = nextSeq
  }
  return parts.join("\n")
}

export async function installFixture(
  envId: string,
  scenario: Scenario,
  runId: string,
  ref: string,
  opts: CallOpts = {},
): Promise<{baseUrl: string}> {
  const setup = (await taskCreate(
    {
      env_id: envId,
      prompt: buildSetupPrompt(scenario, runId, ref),
      title: `fixture-setup-${runId}`,
    },
    opts,
  )) as Record<string, unknown>
  const setupTaskId = setup.id as string
  if (!setupTaskId) throw new ReadinessError(`setup task create returned no id: ${JSON.stringify(setup)}`)

  const {state, timedOut} = await waitForSetupTerminal(envId, setupTaskId, 10 * 60 * 1000, opts)
  if (timedOut) {
    throw new ReadinessError(`fixture setup for ${envId} timed out after 10 min`)
  }

  const stream = await readSetupStream(setupTaskId, opts)
  if (stream.includes("SETUP FAIL")) {
    const failLine = stream.split("\n").find((l) => l.includes("SETUP FAIL")) ?? "SETUP FAIL"
    throw new ReadinessError(`fixture setup failed in ${envId}: ${failLine} (probe state ${state})`)
  }
  // The setup prompt itself contains the literal FIXTURE_BASE_URL strings, so
  // a restatement by the setup agent can false-match. Take the LAST match
  // (the agent's actual printed line), strip surrounding quotes, and require
  // a URL with a literal host — the unexpanded `http://$HOST:18080` template
  // must not flow into buildPrompt as the fixture base-url.
  const baseUrlMatches = [...stream.matchAll(/FIXTURE_BASE_URL=(\S+)/g)]
  if (baseUrlMatches.length === 0) {
    throw new ReadinessError(`fixture setup in ${envId} produced no FIXTURE_BASE_URL (probe state ${state})`)
  }
  const raw = baseUrlMatches[baseUrlMatches.length - 1][1].replace(/^["']|["']$/g, "")
  let baseUrl: URL
  try {
    baseUrl = new URL(raw)
  } catch {
    throw new ReadinessError(`fixture setup in ${envId} produced an invalid FIXTURE_BASE_URL: ${raw} (probe state ${state})`)
  }
  if (baseUrl.hostname === "" || baseUrl.hostname.includes("$")) {
    throw new ReadinessError(`fixture setup in ${envId} produced a non-literal FIXTURE_BASE_URL host: ${raw} (probe state ${state})`)
  }
  return {baseUrl: baseUrl.toString().replace(/\/$/, "")}
}
