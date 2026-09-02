/**
 * Readiness gate. The lifecycle doc is explicit: a harness session connects
 * MCP servers once at session start, so an agent task started before the c1
 * stack is healthy never sees the mcp__c1dev__* tools. The gate is two-layer:
 *
 *   Layer 1 (env): the eval env's primary task is a readiness probe — it
 *   waits for every service to be healthy and HTTP-probes the local product
 *   surface, then writes /shared/<runId>/readiness.json. The runner starts
 *   the agent task only after that file reports healthy, which guarantees the
 *   agent's session connects MCP after the stack is up.
 *
 *   Layer 2 (task): the agent's prompt makes its first action a c1dev tool
 *   call and instructs it to emit READINESS_FAILED and stop if the tools are
 *   absent. The runner watches for that marker; a run that cannot reach full
 *   readiness is aborted and retried, never scored.
 */
import { fsReadText } from "./squire.ts";
import type { NormalizedTranscript } from "./transcript.ts";

export interface ReadinessReport {
  services_healthy: boolean;
  c1dev_http_ok: boolean;
  checked_at: string;
  details: string;
}

export type ReadinessOutcome =
  | { kind: "ready"; report: ReadinessReport }
  | { kind: "not_ready"; reason: string }
  | { kind: "timeout"; waited_s: number };

export function readinessPath(runId: string): string {
  return `/shared/${runId}/readiness.json`;
}

export function parseReadinessReport(text: string): ReadinessReport | null {
  try {
    const doc: unknown = JSON.parse(text);
    if (typeof doc !== "object" || doc === null) return null;
    if (!("services_healthy" in doc) || typeof doc.services_healthy !== "boolean") return null;
    if (!("c1dev_http_ok" in doc) || typeof doc.c1dev_http_ok !== "boolean") return null;
    return {
      services_healthy: doc.services_healthy,
      c1dev_http_ok: doc.c1dev_http_ok,
      checked_at: "checked_at" in doc && typeof doc.checked_at === "string" ? doc.checked_at : "",
      details: "details" in doc && typeof doc.details === "string" ? doc.details : "",
    };
  } catch {
    return null;
  }
}

/** Poll the arena FS until the probe publishes a healthy report or we time out. */
export async function awaitReadiness(
  runId: string,
  opts: {
    timeoutMs: number;
    pollMs: number;
    sleep?: (ms: number) => Promise<void>;
    /** Throws to abort the wait early (e.g. the env died while booting). */
    abortCheck?: () => Promise<void>;
  },
): Promise<ReadinessOutcome> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = Date.now() + opts.timeoutMs;
  let lastReason = "readiness probe has not reported yet";
  while (Date.now() < deadline) {
    if (opts.abortCheck) await opts.abortCheck();
    const text = await fsReadText(readinessPath(runId));
    if (text !== null) {
      const report = parseReadinessReport(text);
      if (report === null) {
        lastReason = "readiness.json is malformed";
      } else if (report.services_healthy && report.c1dev_http_ok) {
        return { kind: "ready", report };
      } else {
        lastReason = `probe reports unhealthy: ${report.details || "no details"}`;
      }
    }
    await sleep(opts.pollMs);
  }
  return { kind: "timeout", waited_s: Math.round(opts.timeoutMs / 1000) };
}

/**
 * Layer-2 detection: the agent could not see the c1dev tools. Either it
 * followed the prompt protocol and emitted READINESS_FAILED, or its tool
 * calls came back with MCP tool-not-found errors.
 */
export function detectToolAbsence(transcript: NormalizedTranscript): { absent: boolean; evidence: string | null } {
  if (/READINESS_FAILED/.test(transcript.assistantText)) {
    return { absent: true, evidence: "agent emitted READINESS_FAILED" };
  }
  const c1devFailures = transcript.calls.filter(
    (c) =>
      !c.ok &&
      /c1_connector_authoring|c1_apps_|c1_connector_service/.test(c.rawTool) &&
      /tool.*not.*found|unknown tool|no such tool|not connected|unknown MCP/i.test(c.errorText ?? c.resultText),
  );
  if (c1devFailures.length > 0) {
    return { absent: true, evidence: `c1dev tool calls failed as unknown: ${c1devFailures[0].rawTool}` };
  }
  return { absent: false, evidence: null };
}

/**
 * The readiness probe prompt (the eval env's primary task). Pinned commands;
 * the probe needs no c1dev tools itself, only squire-tool and curl.
 */
export function buildProbePrompt(runId: string, fixture: { mode: "external" | "in-env"; url: string | null }): string {
  const fixtureStep =
    fixture.mode === "in-env"
      ? `
4. Start the fixture provider the runner placed in the arena FS:
   mkdir -p /tmp/fixture
   squire-tool call squire.fs.read '{"path":"/shared/${runId}/fixture.tar.b64"}' | jq -r .content_base64 | base64 -d | tar xz -C /tmp/fixture
   cd /tmp/fixture && nohup node src/server.ts > /tmp/fixture.log 2>&1 &
   for i in $(seq 1 30); do curl -sf http://localhost:8080/healthz && break; sleep 2; done
`
      : "";
  return `You are a readiness probe for an eval environment. Your ONLY job is to verify the local c1 stack is fully healthy, then write one JSON file. Do not do anything else.

Run these steps exactly:

1. Wait for all services to be healthy (this blocks server-side):
   squire-tool call squire.wait_for_services '{"timeout_seconds": 900}'

2. Verify the local product surface answers over HTTP:
   PRODUCT_BASE_URL="https://c1dev--envoy--\${SQUIRE_ENV_ID}.\${SQUIRE_BASE_DOMAIN}"
   curl -sf -o /dev/null -w '%{http_code}' "$PRODUCT_BASE_URL/api/v1/serversettings" || true
   (A 401/403/200 all prove reachability; only a connection failure is unhealthy.)

3. Verify the connector-authoring build resources rendered: the api service logs mention connector-authoring, or at minimum the api service is running:
   squire-tool call squire.list_services '{}'
${fixtureStep}
5. Write the report (fill in the booleans from what you observed):
   squire-tool call squire.fs.write '{"path":"/shared/${runId}/readiness.json","content":"{\\"services_healthy\\": true, \\"c1dev_http_ok\\": true, \\"checked_at\\": \\"<ISO timestamp>\\", \\"details\\": \\"<one line>\\"}"}'

Set services_healthy=false or c1dev_http_ok=false if the corresponding check failed, and explain in details. Then stop.`;
}
