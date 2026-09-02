/**
 * Shared types for the deterministic scorer: scenario definitions, collection
 * snapshots, and the scored run record.
 */
import type { NormalizedTranscript } from "../transcript.ts";

export const STAGE_IDS = [
  "S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10",
  "S11a", "S11b", "S11c", "S11d",
] as const;
export type StageId = (typeof STAGE_IDS)[number];

export type StageStatus =
  | "pass"
  | "fail"
  | "not_reached"
  /** Stage legitimately not attempted because an earlier stage failed. */
  | "blocked"
  /** Stage requires the human activation step; agent-side work is done. */
  | "human_boundary"
  /** Scenario declares the stage out of scope (e.g. Tier 0 past the build). */
  | "not_applicable";

export interface StageResult {
  id: StageId;
  status: StageStatus;
  /** Passed on the first attempt at the stage's gate (polling is not a retry). */
  firstPass: boolean;
  /** Gate attempts (excluding read-only polling). */
  attempts: number;
  /** Machine description of the gate that decided the outcome. */
  gate: string;
  /** Short evidence string (IDs, states) for the record. */
  evidence: Record<string, string>;
  failures: string[];
}

/** Provider brief + expectations, versioned with the scenario file. */
export interface Scenario {
  id: string;
  tier: 0 | 1 | 2;
  description: string;
  provider: {
    name: string;
    displayName: string;
    docsUrl: string;
    auth: {
      scheme: "basic" | "bearer" | "none";
      /** config-field name -> value handed to the agent (eval-only creds). */
      fields: Record<string, string>;
    };
    /** Config fields that are credential-class (is_secret expected). */
    credentialFields: string[];
  };
  /** Directory name the agent must write source files into. */
  sourceDirName: string;
  /**
   * The furthest stage the scenario expects the agent to complete. Tier 1
   * stops at the human activation boundary (S11b + handoff); Tier 0 stops at
   * a built revision (S5).
   */
  terminalStage: StageId;
  /** Fixture expectations; the runner refreshes from /_fixture/expectations. */
  expectations: {
    users: { total: number; byDomain: Record<string, number>; nullEmail: string[] };
    groups: number;
    memberships: { active: number; pending: number; pendingRows: string[] };
    roles: number;
  } | null;
}

/** Post-run tenant snapshot produced by the collector task. */
export interface Collection {
  connector: {
    status: string | null;
    lastError: string | null;
  };
  revisions: Array<{ revisionId: string; status: string; activationEpoch: string | null }>;
  counts: {
    users: number | null;
    groups: number | null;
    roles: number | null;
    entitlements: number | null;
    grants: number | null;
  };
  grantWiring: {
    checked: number;
    unresolvedPrincipal: number;
    unresolvedEntitlement: number;
  } | null;
  idStability: {
    stable: boolean;
    added: string[];
    removed: string[];
  } | null;
  /** Sampled synced users for trap checks (id + presence of login/email). */
  userSample: Array<{ id: string; hasLogin: boolean }> | null;
  /** Grant IDs observed for the seeded pending membership rows (must be none). */
  pendingRowGrants: string[];
}

export interface ScoreInput {
  scenario: Scenario;
  transcript: NormalizedTranscript;
  collection: Collection | null;
  /** Uploaded source set: path -> content. */
  sourceFiles: Record<string, string>;
  /** Agent-maintained handoff table (parsed handoff.json), if produced. */
  handoff: Record<string, string> | null;
  /** Credential values that must never appear in plaintext. */
  secretValues: string[];
}

export interface RecoveryEvent {
  stage: StageId;
  kind: "fix_and_rerun" | "rerun_without_fix" | "token_remint_without_retest" | "reused_failed_test_run";
  correct: boolean;
  detail: string;
}

export interface Score {
  stages: Record<StageId, StageResult>;
  funnel: {
    /** Furthest consecutive passed stage in funnel order. */
    reached: StageId | "none";
    /** Agent-side completion: S0..S11b pass with a clean human handoff. */
    agentComplete: boolean;
    /** Full funnel incl. activation + sync (only possible when a human activated). */
    fullPass: boolean;
  };
  metrics: {
    stagesPassed: number;
    stagesApplicable: number;
    firstPassCount: number;
    firstPassRate: number | null;
  };
  recovery: {
    cycles: number;
    correctStepReruns: number;
    incorrectStepReruns: number;
    events: RecoveryEvent[];
  };
  syncedData: {
    available: boolean;
    parity: Record<string, { expected: number | null; actual: number | null; ok: boolean | null }>;
    grantWiringOk: boolean | null;
    idStabilityOk: boolean | null;
    plaintextSecretFound: boolean;
    traps: Record<string, "avoided" | "triggered" | "unknown">;
  };
  sourceHygiene: {
    available: boolean;
    requiredFilesPresent: boolean;
    dualSchemaParity: boolean;
    isSecretOk: boolean;
    runtimeTypesOk: boolean;
    bundleCapsOk: boolean;
    connectorContractOk: boolean;
    violations: string[];
  };
  handoff: {
    tableComplete: boolean;
    stoppedAtHumanBoundary: boolean;
    violations: string[];
  };
}
