// tenant-setup.ts — manage-ff provisioning step for eval envs (CXF-217, D21).
// Runs ONLY on the Phase-B exit-2 branch: fresh c1-image eval envs expose no
// c1_connector_authoring_* tools until the eval tenant is an internal
// account with the CONNECTOR_AUTHORING flag effective. The setup task runs
// the idempotent manage-ff sequence in the eval env itself (it pre-checks
// effective_flags before mutating).
import {getTask, taskCreate, taskStream, type CallOpts} from "./squire.ts"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function isTerminal(state: unknown): boolean {
  return state === "completed" || state === "failed" || state === "canceled"
}

// The COMPLETE tenant-setup script (locked D21, verbatim with ${runId}
// substituted). Idempotent: step 2 pre-checks effective_flags and exits 0
// when CONNECTOR_AUTHORING is already effective.
export function buildTenantSetupPrompt(runId: string): string {
  return `You are the tenant-setup task for eval run ${runId}. Run this exact sequence and report the result:

0. Run these commands EXACTLY as written, in order, without modification or investigation:
   squire-tool call squire.wait_for_services '{}'
   set -a; . /data/squire/src/c1/.dev/env/dev-shell.env; set +a
   export PATH="/data/squire/src/c1/build/$(go env GOOS)_$(go env GOARCH)/dev-util:$PATH"
   for i in 1 2 3; do dev-util ensure && break; sleep 5; done
   if [ -z "$(dev-util list-tenants --format=json | jq -r '.[0].tenant_id // empty')" ]; then echo "SETUP FAIL: ensure failed"; exit 1; fi

1. TENANT=$(dev-util list-tenants --format=json | jq -r '.[] | select(.tenant_domain=="c1dev") | .tenant_id' | head -1)
   if [ -z "$TENANT" ]; then TENANT=$(dev-util list-tenants --format=json | jq -r '.[0].tenant_id // empty'); fi
   if [ -z "$TENANT" ]; then echo "SETUP FAIL: no tenants"; exit 1; fi
2. STATE=$(dev-util manage-ff get --tenant-id="$TENANT" --json)
   if jq -e '.effective_flags | index("CONNECTOR_AUTHORING")' <<<"$STATE" >/dev/null 2>&1; then echo "SETUP DONE"; exit 0; fi
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
5. squire-tool call squire.task.complete '{"summary": "tenant setup finished"}'`
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

// Provisioning-time step between create_env and the readiness probe: run the
// manage-ff sequence in the eval env so the authoring tools surface. Throws
// on timeout, task failure, or a missing SETUP DONE marker.
export async function runTenantSetup(
  envId: string,
  runId: string,
  opts: CallOpts = {},
): Promise<void> {
  const setup = (await taskCreate(
    {
      env_id: envId,
      prompt: buildTenantSetupPrompt(runId),
      title: `eval-tenant-setup-${runId}`,
    },
    opts,
  )) as Record<string, unknown>
  const setupTaskId = setup.id as string
  if (!setupTaskId) throw new Error(`tenant setup task create returned no id: ${JSON.stringify(setup)}`)

  const {state, timedOut} = await waitForSetupTerminal(envId, setupTaskId, 10 * 60 * 1000, opts)
  if (timedOut) {
    throw new Error("tenant setup timed out after 10 min")
  }

  const stream = await readSetupStream(setupTaskId, opts)
  // SETUP DONE wins: the sequence prints it only on real success, while the
  // prompt text (which contains the SETUP FAIL literals) can leak into the
  // transcript via agent narration or ps output — a false positive.
  if (stream.includes("SETUP DONE")) return
  if (stream.includes("SETUP FAIL")) {
    const failLine = stream.split("\n").find((l) => l.includes("SETUP FAIL")) ?? "SETUP FAIL"
    throw new Error(`tenant setup failed: ${failLine} (task state ${state})`)
  }
  const tail = stream.split("\n").slice(-5).join("\n")
  throw new Error(`tenant setup failed: no SETUP DONE marker (task state ${state}; transcript tail: ${tail})`)
}
