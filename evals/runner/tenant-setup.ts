// tenant-setup.ts — manage-ff provisioning step for the eval tenant (CXF-217, D21).
// Runs between create_env and the readiness probe: fresh c1-image eval envs in
// this region do not expose the c1_connector_authoring_* tools until the eval
// tenant is an internal account with the CONNECTOR_AUTHORING flag effective.
import {getTask, taskCreate, type CallOpts} from "./squire.ts"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function isTerminal(state: unknown): boolean {
  return state === "completed" || state === "failed" || state === "canceled"
}

// The COMPLETE setup script (verbatim, D21). Idempotent: it pre-checks
// effective_flags before mutating anything, so a re-run on an already-set
// tenant exits 0 at step 2.
export function buildTenantSetupPrompt(runId: string): string {
  return `You are the tenant-setup task for eval run ${runId}. Run this exact sequence and report the result:

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

// Create the tenant-setup task in the eval env and wait for its terminal
// state (the same nested field path + 10 s poll cadence as
// fixture-install.ts's waitForSetupTerminal). Timeout after 10 min.
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
  if (!taskId) throw new Error(`tenant setup task create returned no id: ${JSON.stringify(res)}`)

  const deadline = Date.now() + 10 * 60 * 1000
  while (Date.now() < deadline) {
    try {
      const task = (await getTask(envId, taskId, opts)) as Record<string, unknown> | null
      const state = ((task?.task as Record<string, unknown> | undefined)?.state) as string | undefined
      if (state && isTerminal(state)) return
    } catch (err) {
      // Transient gateway failure: log and keep polling.
      console.error(`WARNING: get_task poll failed: ${(err as Error).message}`)
    }
    await sleep(10_000)
  }
  throw new Error(`tenant setup for ${envId} timed out after 10 min`)
}
