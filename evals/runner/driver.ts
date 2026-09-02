// driver.ts — driver contracts (Provisioner, AgentDriver, RunChannel).
import type {ParsedStream} from "./stream.ts"
import type {Scenario} from "./scenario.ts"

export class ReadinessError extends Error {
  constructor(message: string) {
    super(`READINESS FAILURE: ${message}`)
    this.name = "ReadinessError"
  }
}

export interface TenantHandle {
  baseUrl: string
  credentials: Record<string, string>
  toolSurface: string[]
  meta?: Record<string, unknown>
}

export interface ProvisionContext {
  scenario: Scenario
  runId: string
}

export interface Provisioner {
  provision(ctx: ProvisionContext): Promise<TenantHandle>
  checkReadiness(handle: TenantHandle): Promise<{funnelToolsPresent: boolean}>
  // Best-effort: never throws.
  teardown(handle: TenantHandle): Promise<void>
}

export interface RunChannel {
  runDir: string
  handoffPath: string
  scoreInputPath: string
  transcriptPath: string
  handoffInstructions: string
  completionInstructions: string
}

export interface AgentRunRequest {
  kind: "agent" | "collector"
  prompt: string
  toolSurface: string[]
  channel: RunChannel
  timeoutMs: number
  model: string
}

export interface AgentRunResult {
  transcript: ParsedStream
  timedOut: boolean
  wallTimeMs: number
}

export interface AgentDriver {
  runAgent(req: AgentRunRequest): Promise<AgentRunResult>
}

export interface Driver {
  name: string
  provisioner: Provisioner
  agentDriver: AgentDriver
  channelInstructions(channel: RunChannel): {handoffInstructions: string; completionInstructions: string}
}
