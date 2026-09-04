// driver.ts — driver contracts (Provisioner, AgentDriver, RunChannel).
import type {ParsedStream} from "./stream.ts"
import type {Scenario} from "./scenario.ts"

export class ReadinessError extends Error {
  constructor(message: string) {
    super(`READINESS FAILURE: ${message}`)
    this.name = "ReadinessError"
  }
}

// The full funnel tool surface — the 14 authoring tools a Tier-1 tenant must
// expose. The runner derives the record's `funnel_tools_present` from the
// driver's declared `toolSurface` against this list; it is never a driver
// assertion.
export const FUNNEL_TOOLS: string[] = [
  "c1_connector_authoring_create_draft_source_upload",
  "c1_connector_authoring_finalize_draft_source_upload",
  "c1_connector_authoring_get_draft",
  "c1_connector_authoring_build_bundle",
  "c1_connector_authoring_get_run",
  "c1_apps_create",
  "c1_connector_authoring_provision_connector",
  "c1_connector_service_get",
  "c1_connector_service_update",
  "c1_connector_authoring_run_draft_test_sync",
  "c1_connector_authoring_get_test_run_evidence",
  "c1_connector_authoring_deploy_connector_instance",
  "c1_connector_authoring_mint_approval_token",
  "c1_connector_authoring_list_revision_summaries",
]

export interface TenantHandle {
  baseUrl: string
  credentials: Record<string, string>
  toolSurface: string[]
  meta?: Record<string, unknown>
}

export interface ProvisionContext {
  scenario: Scenario
  runId: string
  // The git ref under test (--ref); driver-interpreted — a driver may use it
  // to provision the tenant at that ref. Tier-0 ignores it.
  ref: string
}

export interface Provisioner {
  provision(ctx: ProvisionContext): Promise<TenantHandle>
  // Concrete tenant-reachability check ONLY. The runner verifies the
  // scenario's readiness tools and derives funnel_tools_present from the
  // declared toolSurface (never from a driver assertion).
  checkReadiness(handle: TenantHandle): Promise<void>
  // Best-effort: never throws.
  teardown(handle: TenantHandle): Promise<void>
}

export interface RunChannel {
  runDir: string
  handoffPath: string
  scoreInputPath: string
  transcriptPath: string
  pre1Path: string
  handoffInstructions: string
  completionInstructions: string
  pre1Instructions: string
}

export interface AgentRunRequest {
  kind: "agent" | "collector"
  prompt: string
  toolSurface: string[]
  channel: RunChannel
  timeoutMs: number
  model: string
  // The scenario id (pre-1 runs use it to select the canned replay set).
  scenarioId?: string
  // The scenario kind (pre-1 runs use it to fail loudly when the canned
  // replay set is missing instead of silently replaying the funnel set).
  scenarioKind?: "funnel" | "pre1"
  // Declared scenario reasoning-effort pin; driver-interpreted — a driver
  // that can set agent reasoning effort applies it. Tier-0 ignores it.
  reasoningEffort?: "high" | "medium" | "low"
  // The git ref under test (--ref); driver-interpreted — a driver may use it
  // to set up the agent's environment. Tier-0 ignores it.
  ref: string
}

export interface AgentRunResult {
  transcript: ParsedStream
  timedOut: boolean
  wallTimeMs: number
  // Set by the driver when it knows the stream collection failed (e.g. the
  // transport dropped the stream). The runner treats an empty transcript
  // with collectionFailed as an infrastructure outage (no record) rather
  // than a scored all-fail outcome; a genuine zero-tool-call stall without
  // this signal stays a scored exit-0 outcome.
  collectionFailed?: boolean
}

export interface AgentDriver {
  runAgent(req: AgentRunRequest): Promise<AgentRunResult>
}

export interface Driver {
  name: string
  provisioner: Provisioner
  agentDriver: AgentDriver
  channelInstructions(channel: RunChannel): {handoffInstructions: string; completionInstructions: string; pre1Instructions: string}
}
