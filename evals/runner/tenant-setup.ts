// tenant-setup.ts — manage-ff provisioning step for the eval tenant (CXF-217, D21).
// Runs between create_env and the readiness probe: fresh c1-image eval envs in
// this region do not expose the c1_connector_authoring_* tools until the eval
// tenant is an internal account with the CONNECTOR_AUTHORING flag effective.
import {getTask, taskCreate, taskStream, type CallOpts} from "./squire.ts"
import {ReadinessError} from "./readiness.ts"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function isTerminal(state: unknown): boolean {
  return state === "completed" || state === "failed" || state === "canceled"
}

// The COMPLETE setup script (D21, with two review-sanctioned safety
// amendments: dev-util is resolved explicitly because fresh eval envs do not
// put it on PATH — the D21 verbatim assumed it and the halt-path run only
// succeeded via agent improvisation; and tenant selection FAILS CLOSED on the
// c1dev tenant instead of falling back to an arbitrary first tenant, which
// could apply INTERNAL account-type + CONNECTOR_AUTHORING to the wrong tenant).
// Idempotent: it pre-checks effective_flags before mutating anything, so a
// re-run on an already-set tenant exits 0 at step 2.
export function buildTenantSetupPrompt(runId: string): string {
  return `You are the tenant-setup task for eval run ${runId}. Run this exact sequence and report the result:

0. DEV_UTIL=$(command -v dev-util || find /data/squire/src/c1/build -name dev-util -type f 2>/dev/null | head -1)
   if [ -z "$DEV_UTIL" ]; then echo "SETUP FAIL: dev-util not found on PATH or under /data/squire/src/c1/build"; exit 1; fi
1. TENANT=$("$DEV_UTIL" list-tenants --format=json | jq -r '.[] | select(.tenant_domain=="c1dev") | .tenant_id' | head -1)
   if [ -z "$TENANT" ]; then echo "SETUP FAIL: no c1dev tenant found"; exit 1; fi
2. STATE=$("$DEV_UTIL" manage-ff get --tenant-id="$TENANT" --json)
   if jq -e '.effective_flags | index("CONNECTOR_AUTHORING")' <<<"$STATE" >/dev/null 2>&1; then echo "SETUP DONE"; exit 0; fi
3. FLAG=$("$DEV_UTIL" manage-ff list-flags --json | jq '.flags[] | select(.id=="CONNECTOR_AUTHORING")')
   STATUS=$(jq -r '.status' <<<"$FLAG")
   SKU=$(jq -r '.skus[0] // empty' <<<"$FLAG")
   case "$STATUS" in
     DISABLED|RETIRED) echo "SETUP FAIL: CONNECTOR_AUTHORING not enableable (status=$STATUS)"; exit 1 ;;
     SKU_ALL|SKU_MANUAL)
       if [ -z "$SKU" ]; then echo "SETUP FAIL: no SKU grants CONNECTOR_AUTHORING"; exit 1; fi
       if ! jq -e --arg sku "$SKU" '.sku_bindings | index($sku)' <<<"$STATE" >/dev/null 2>&1; then
         CURRENT=$(jq -r '.sku_bindings | join(",")' <<<"$STATE")
         "$DEV_UTIL" manage-ff set-skus --tenant-id="$TENANT" --sku="\${CURRENT:+$CURRENT,}$SKU"
       fi
       if [ "$STATUS" = "SKU_MANUAL" ]; then "$DEV_UTIL" manage-ff enable --tenant-id="$TENANT" --flag=CONNECTOR_AUTHORING; fi
       ;;
     DEV_MANUAL)
       if ! jq -e '.is_internal_account == true' <<<"$STATE" >/dev/null 2>&1; then
         "$DEV_UTIL" manage-ff set-account-type --tenant-id="$TENANT" --type=INTERNAL
       fi
       "$DEV_UTIL" manage-ff enable --tenant-id="$TENANT" --flag=CONNECTOR_AUTHORING
       ;;
     *) echo "SETUP FAIL: unknown status $STATUS"; exit 1 ;;
   esac
4. if "$DEV_UTIL" manage-ff get --tenant-id="$TENANT" --json | jq -e '.effective_flags | index("CONNECTOR_AUTHORING")' >/dev/null 2>&1; then
     echo "SETUP DONE"
   else
     echo "SETUP FAIL: CONNECTOR_AUTHORING not effective"
     exit 1
   fi
5. squire-tool call squire.task.complete '{"summary": "tenant setup finished"}'`
}

// Create the tenant-setup task in the eval env and wait for its terminal
// state (the same nested field path + 10 s poll cadence as
// fixture-install.ts's waitForSetupTerminal). Timeout after 10 min.
// A failed/canceled setup task (or a completed one whose stream shows
// SETUP FAIL) throws a ReadinessError naming the failure line — the setup
// failure must not be masked as a generic readiness failure downstream.
export async function runTenantSetup(
  envId: string,
  runId: string,
  opts: CallOpts = {},
): Promise<void> {
  const res = (await taskCreate(
    {
      env_id: envId,
      prompt: buildTenantSetupPrompt(runId),
      title: `eval-tenant-setup-${runId}`,
    },
    opts,
  )) as Record<string, unknown>
  const taskId = res.id as string
  if (!taskId) throw new ReadinessError(`tenant setup task create returned no id: ${JSON.stringify(res)}`)

  const {state, timedOut} = await waitForSetupTerminal(envId, taskId, 10 * 60 * 1000, opts)
  if (timedOut) {
    throw new ReadinessError(`tenant setup for ${envId} timed out after 10 min (task ${taskId})`)
  }
  if (state === "failed" || state === "canceled") {
    const stream = await readSetupStream(taskId, opts)
    const failLine = stream.split("\n").find((l) => l.includes("SETUP FAIL")) ?? `task state ${state}`
    throw new ReadinessError(`tenant setup failed in ${envId}: ${failLine} (task ${taskId})`)
  }
  // completed: a task that printed SETUP FAIL but still reached completed is
  // a setup failure, not a success (the readiness gate is the final backstop).
  const stream = await readSetupStream(taskId, opts)
  if (stream.includes("SETUP FAIL")) {
    const failLine = stream.split("\n").find((l) => l.includes("SETUP FAIL")) ?? "SETUP FAIL"
    throw new ReadinessError(`tenant setup failed in ${envId}: ${failLine} (task ${taskId})`)
  }
}

export async function waitForSetupTerminal(
  envId: string,
  taskId: string,
  timeoutMs: number,
  opts: CallOpts,
  pollMs = 10_000,
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
    await sleep(pollMs)
  }
  return {state: "running", timedOut: true}
}

export async function readSetupStream(
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
      // Transient stream hiccup: return what we have (the SETUP markers are
      // usually early in the stream; a retry would re-read from scratch).
      console.error(`WARNING: tenant setup stream read failed: ${(err as Error).message}`)
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
