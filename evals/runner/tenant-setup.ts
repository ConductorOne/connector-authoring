// tenant-setup.ts — manage-ff provisioning step for eval envs (CXF-217, D21).
// Runs ONLY on the Phase-B exit-2 branch: fresh c1-image eval envs expose no
// c1_connector_authoring_* tools until the eval tenant is an internal
// account with the CONNECTOR_AUTHORING flag effective. The setup task runs
// the idempotent manage-ff sequence in the eval env itself (it pre-checks
// effective_flags before mutating).
//
// Outcome signalling (ratified amendment, round 2): the runner trusts ONLY
// arena-FS outcome markers written by the setup task — never the transcript.
// The prompt text itself contains the SETUP DONE/SETUP FAIL literals, so a
// stream-based check could false-pass on prompt leakage; the arena file
// exists only as a tool_result side effect of the task actually running the
// sequence. Same fail-closed pattern as readiness.ts's probe-tools.txt.
import {fsRead, getTask, taskCreate, taskStream, type CallOpts} from "./squire.ts"

function sleep(ms: number): Promise<void> {
  const {promise, resolve} = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

function isTerminal(state: unknown): boolean {
  return state === "completed" || state === "failed" || state === "canceled"
}

export function setupOkPath(runId: string): string {
  return `/current-tasks/evals/${runId}/tenant-setup-ok`
}

export function setupFailPath(runId: string): string {
  return `/current-tasks/evals/${runId}/tenant-setup-fail`
}

// The COMPLETE tenant-setup script (locked D21, verbatim with ${runId}
// substituted, plus the ratified round-2 amendments: fail-closed tenant
// resolution, arena-FS outcome markers on every exit path). Idempotent:
// step 2 pre-checks effective_flags and exits 0 when CONNECTOR_AUTHORING is
// already effective.
export function buildTenantSetupPrompt(runId: string): string {
  return `You are the tenant-setup task for eval run ${runId}. Run this exact sequence and report the result:

0. Run these commands EXACTLY as written, in order, without modification or investigation:
   set -a; . /data/squire/src/c1/.dev/env/dev-shell.env; set +a
   export PATH="/data/squire/src/c1/build/$(go env GOOS)_$(go env GOARCH)/dev-util:$PATH"
   for i in 1 2 3 4 5; do dev-util ensure && break; sleep 30; done
   if [ -z "$(dev-util list-tenants --format=json | jq -r '.[0].tenant_id // empty')" ]; then echo "SETUP FAIL: ensure failed"; exit 1; fi
   If any step prints SETUP FAIL, write the failure reason to the arena FS at ${setupFailPath(runId)} using:
   squire-tool call squire.fs.write '{"path": "${setupFailPath(runId)}", "content": "<the exact SETUP FAIL line>"}'
   Then still complete the task afterwards with: squire-tool call squire.task.complete '{"summary": "tenant setup failed"}'

1. TENANT=$(dev-util list-tenants --format=json | jq -r '.[] | select(.tenant_domain=="c1dev") | .tenant_id' | head -1)
   if [ -z "$TENANT" ]; then echo "SETUP FAIL: no c1dev tenant"; exit 1; fi
2. STATE=$(dev-util manage-ff get --tenant-id="$TENANT" --json)
   if jq -e '.effective_flags | index("CONNECTOR_AUTHORING")' <<<"$STATE" >/dev/null 2>&1; then echo "SETUP DONE"; squire-tool call squire.fs.write '{"path": "${setupOkPath(runId)}", "content": "ok"}'; exit 0; fi
3. FLAG=$(dev-util manage-ff list-flags --json | jq '.flags[] | select(.id=="CONNECTOR_AUTHORING")')
   STATUS=$(jq -r '.status' <<<"$FLAG")
   SKU=$(jq -r '.skus[0] // empty' <<<"$FLAG")
   case "$STATUS" in
     DISABLED|RETIRED) echo "SETUP FAIL: CONNECTOR_AUTHORING not enableable (status=$STATUS)"; exit 1 ;;
     SKU_ALL|SKU_MANUAL)
       if [ -z "$SKU" ]; then echo "SETUP FAIL: no SKU grants CONNECTOR_AUTHORING"; exit 1; fi
       if ! jq -e --arg sku "$SKU" '.sku_bindings | index($sku)' <<<"$STATE" >/dev/null 2>&1; then
         CURRENT=$(jq -r '.sku_bindings | join(",")' <<<"$STATE")
         dev-util manage-ff set-skus --tenant-id="$TENANT" --sku="\${CURRENT:+$CURRENT,}$SKU"
       fi
       if [ "$STATUS" = "SKU_MANUAL" ]; then dev-util manage-ff enable --tenant-id="$TENANT" --flag=CONNECTOR_AUTHORING; fi
       ;;
     DEV_MANUAL)
       if ! jq -e '.is_internal_account == true' <<<"$STATE" >/dev/null 2>&1; then
         dev-util manage-ff set-account-type --tenant-id="$TENANT" --type=INTERNAL
       fi
       dev-util manage-ff enable --tenant-id="$TENANT" --flag=CONNECTOR_AUTHORING
       ;;
     *) echo "SETUP FAIL: unknown status $STATUS"; exit 1 ;;
   esac
4. if dev-util manage-ff get --tenant-id="$TENANT" --json | jq -e '.effective_flags | index("CONNECTOR_AUTHORING")' >/dev/null 2>&1; then
     echo "SETUP DONE"
   else
     echo "SETUP FAIL: CONNECTOR_AUTHORING not effective"
     exit 1
   fi
5. Write the success marker to the arena FS at ${setupOkPath(runId)} using:
   squire-tool call squire.fs.write '{"path": "${setupOkPath(runId)}", "content": "ok"}'
   Then complete the task: squire-tool call squire.task.complete '{"summary": "tenant setup finished"}'`
}

// Injectable I/O surface so the decision logic is unit-testable without a
// live gateway (round-2 fix for the untested-marker finding).
export interface TenantSetupDeps {
  taskCreate: (args: Record<string, unknown>, opts?: CallOpts) => Promise<Record<string, unknown>>
  getTask: (envId: string, taskId: string, opts?: CallOpts) => Promise<Record<string, unknown>>
  taskStream: (
    taskId: string,
    streamOpts?: {sinceSeq?: number; limit?: number},
    opts?: CallOpts,
  ) => Promise<Record<string, unknown>>
  fsRead: (path: string, opts?: CallOpts) => Promise<unknown>
}

const defaultDeps: TenantSetupDeps = {taskCreate, getTask, taskStream, fsRead}

export interface SetupTiming {
  timeoutMs: number
  pollMs: number
}

const DEFAULT_TIMING: SetupTiming = {timeoutMs: 15 * 60 * 1000, pollMs: 10_000}

// Pure decision: the outcome markers are the ONLY success signal; a
// failed/canceled task state is failed even if an ok marker exists
// (fail-closed — the marker write precedes the complete call, so a terminal
// failure with an ok marker is contradictory).
export type SetupOutcome = "success" | "failed" | "no-marker"

export function setupOutcome(state: string, okMarker: string | null, failMarker: string | null): SetupOutcome {
  if (state === "failed" || state === "canceled") return "failed"
  if (okMarker !== null) return "success"
  if (failMarker !== null) return "failed"
  return "no-marker"
}

async function waitForSetupTerminal(
  envId: string,
  taskId: string,
  timing: SetupTiming,
  opts: CallOpts,
  deps: TenantSetupDeps,
): Promise<{state: string; timedOut: boolean}> {
  const deadline = Date.now() + timing.timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await deps.getTask(envId, taskId, opts)
      const state = ((res as Record<string, unknown> | null)?.task as Record<string, unknown> | undefined)?.state as string | undefined
      if (state && isTerminal(state)) return {state, timedOut: false}
    } catch (err) {
      // Transient gateway failure: log and keep polling.
      console.error(`WARNING: get_task poll failed: ${(err as Error).message}`)
    }
    await sleep(timing.pollMs)
  }
  return {state: "running", timedOut: true}
}

// Bounded retry like readiness.ts's readProbeToolList: a transient gateway
// blip must not abort a healthy setup; a genuinely absent marker still
// fails closed after the retries.
async function readMarker(
  path: string,
  opts: CallOpts,
  deps: TenantSetupDeps,
): Promise<string | null> {
  let lastErr: unknown
  let sawEmpty = false
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = (await deps.fsRead(path, opts)) as Record<string, unknown>
      const content = res.content as string | undefined
      if (typeof content === "string" && content.length > 0) return content
      sawEmpty = true
    } catch (err) {
      lastErr = err
    }
    if (attempt < 3) await sleep(2_000)
  }
  if (lastErr !== undefined) {
    console.error(`WARNING: setup marker read failed after 3 attempts: ${(lastErr as Error).message}`)
  } else if (sawEmpty) {
    console.error("WARNING: setup marker file present but empty after 3 attempts")
  }
  return null
}

// Diagnostic fallback for the no-marker case only: extract the SETUP FAIL
// line (the task's own output) without dumping an unredacted transcript
// tail into the error.
async function readSetupStream(
  taskId: string,
  opts: CallOpts,
  deps: TenantSetupDeps,
): Promise<string> {
  let sinceSeq = 0
  const parts: string[] = []
  for (;;) {
    let page: Record<string, unknown>
    try {
      page = (await deps.taskStream(taskId, {sinceSeq, limit: 500}, opts)) as Record<string, unknown>
    } catch (err) {
      // Transient stream hiccup: return what we have.
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

// Provisioning-time step between create_env and the readiness probe: run the
// manage-ff sequence in the eval env so the authoring tools surface. Throws
// on timeout, task failure, a fail marker, or a missing outcome marker.
export async function runTenantSetup(
  envId: string,
  runId: string,
  opts: CallOpts = {},
  deps: TenantSetupDeps = defaultDeps,
  timing: SetupTiming = DEFAULT_TIMING,
): Promise<void> {
  const setup = (await deps.taskCreate(
    {
      env_id: envId,
      prompt: buildTenantSetupPrompt(runId),
      title: `eval-tenant-setup-${runId}`,
    },
    opts,
  )) as Record<string, unknown>
  const setupTaskId = setup.id as string
  if (!setupTaskId) throw new Error(`tenant setup task create returned no id: ${JSON.stringify(setup)}`)

  const {state, timedOut} = await waitForSetupTerminal(envId, setupTaskId, timing, opts, deps)
  if (timedOut) {
    const mins = Math.round(timing.timeoutMs / 60_000)
    throw new Error(`tenant setup timed out after ${mins} min (env ${envId}, run ${runId}, task ${setupTaskId})`)
  }

  const okMarker = await readMarker(setupOkPath(runId), opts, deps)
  const failMarker = await readMarker(setupFailPath(runId), opts, deps)
  const outcome = setupOutcome(state, okMarker, failMarker)
  if (outcome === "success") return
  if (outcome === "failed") {
    const reason = failMarker ?? `task state ${state}`
    throw new Error(`tenant setup failed: ${reason} (env ${envId}, run ${runId}, task ${setupTaskId})`)
  }
  // No outcome marker: the task terminated without writing either marker.
  // Pull the SETUP FAIL line from the stream for diagnostics (bounded; no
  // raw transcript tail in the error).
  const stream = await readSetupStream(setupTaskId, opts, deps)
  const failLine = stream.split("\n").find((l) => l.includes("SETUP FAIL"))
  const detail = failLine ?? `no outcome marker (${stream.split("\n").length} stream lines)`
  throw new Error(`tenant setup failed: ${detail} (env ${envId}, run ${runId}, task ${setupTaskId}, task state ${state})`)
}
