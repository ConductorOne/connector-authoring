/**
 * Run configuration: CLI flags with env-var fallbacks and pinned defaults.
 */
import { fileURLToPath } from "node:url";

export const EVALS_ROOT = fileURLToPath(new URL("..", import.meta.url));

export const DEFAULTS = {
  image: "c1",
  model: "together/deepseek-ai/DeepSeek-V4-Flash-0731",
  bundle: "guide-only",
  runs: 1,
  maxEnvAttempts: 2,
  readinessTimeoutMs: 20 * 60_000,
  agentTimeoutMs: 3 * 3_600_000,
  collectorTimeoutMs: 30 * 60_000,
  resultsPath: `${EVALS_ROOT}/results/runs.jsonl`,
  scenariosDir: `${EVALS_ROOT}/scenarios`,
  bundlesDir: `${EVALS_ROOT}/skill-bundles`,
  fixtureDir: `${EVALS_ROOT}/fixture/directory-api`,
} as const;

export interface RunConfig {
  scenarioPath: string;
  image: string;
  model: string;
  reasoningEffort: string | null;
  bundleSpec: string;
  runs: number;
  maxEnvAttempts: number;
  readinessTimeoutMs: number;
  agentTimeoutMs: number;
  collectorTimeoutMs: number;
  resultsPath: string;
  bundlesDir: string;
  fixtureDir: string;
  fixture: { mode: "external" | "in-env"; url: string | null };
  keepEnv: boolean;
  idleTimeoutMinutes: number;
  autoDeleteMinutes: number;
}

export function runIdFor(scenarioId: string, model: string, bundle: string, startedAt: Date): string {
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19) + "Z";
  const modelSlug = model.split("/").pop()?.toLowerCase().replace(/[^a-z0-9]+/g, "-") ?? "model";
  const rand = Math.random().toString(36).slice(2, 8);
  return `${stamp}_${scenarioId}_${modelSlug}_${bundle.replace(/[^a-z0-9@.-]+/gi, "-")}_${rand}`;
}
