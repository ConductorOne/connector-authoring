/**
 * Deterministic scorer entry point. Pure function of (scenario, transcript,
 * collection, source files, handoff) — no I/O, no clock — so re-scoring a
 * recorded run always reproduces the same result.
 */
import { evaluateHandoff } from "./handoff.ts";
import { evaluateRecovery } from "./recovery.ts";
import { evaluateSyncedData } from "./syncedData.ts";
import { evaluateSourceHygiene } from "./sourceHygiene.ts";
import { evaluateStages, funnelSummary } from "./stages.ts";
import { STAGE_IDS, type Score, type ScoreInput } from "./types.ts";

export function scoreRun(input: ScoreInput): Score {
  const handoff = evaluateHandoff(input.transcript.calls, input.handoff);

  const stages = evaluateStages({
    calls: input.transcript.calls,
    scenario: input.scenario,
    collection: input.collection,
    stoppedAtHumanBoundary: handoff.stoppedAtHumanBoundary,
    boundaryViolations: handoff.violations,
  });

  const recovery = evaluateRecovery(input.transcript.calls, stages);

  const syncedData = evaluateSyncedData(
    input.scenario,
    input.collection,
    input.sourceFiles,
    input.handoff ? JSON.stringify(input.handoff) : "",
    input.transcript.assistantText,
    input.secretValues,
  );

  const sourceHygiene = evaluateSourceHygiene(input.sourceFiles, input.scenario, input.secretValues);

  const funnel = funnelSummary(stages, handoff.stoppedAtHumanBoundary);

  const applicable = STAGE_IDS.filter((id) => stages[id].status !== "not_applicable");
  const passed = applicable.filter((id) => stages[id].status === "pass" || stages[id].status === "human_boundary");
  const firstPass = applicable.filter(
    (id) => (stages[id].status === "pass" || stages[id].status === "human_boundary") && stages[id].firstPass,
  );

  return {
    stages,
    funnel,
    metrics: {
      stagesPassed: passed.length,
      stagesApplicable: applicable.length,
      firstPassCount: firstPass.length,
      firstPassRate: applicable.length > 0 ? firstPass.length / applicable.length : null,
    },
    recovery,
    syncedData,
    sourceHygiene,
    handoff,
  };
}

export type { Collection, Scenario, Score, ScoreInput, StageId, StageResult } from "./types.ts";
export { STAGE_IDS } from "./types.ts";
