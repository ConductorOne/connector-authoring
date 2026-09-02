/**
 * Recovery quality: how the agent behaves after a failure. Counts fix→re-run
 * cycles and classifies whether each re-run started from the correct step:
 *
 *   - after a FAILED build run, the next build_bundle must be preceded by a
 *     source update (re-upload or inline update) — rebuilding unchanged source
 *     is an incorrect re-run;
 *   - after a FAIL evidence row, the agent must run a NEW draft test (fresh
 *     test_run_id) before minting another approval token — re-minting on a
 *     failed run is the documented anti-pattern;
 *   - polling the same failed test_run_id expecting a different outcome is a
 *     reused-failed-run event.
 */
import { extractField, type TranscriptCall } from "../transcript.ts";
import type { RecoveryEvent, StageResult, StageId } from "./types.ts";

const T = {
  upload: "c1_connector_authoring_create_draft_source_upload",
  updateSource: "c1_connector_authoring_update_draft_source",
  build: "c1_connector_authoring_build_bundle",
  getRun: "c1_connector_authoring_get_run",
  draftTest: "c1_connector_authoring_run_draft_test_sync",
  evidence: "c1_connector_authoring_get_test_run_evidence",
  mint: "c1_connector_authoring_mint_approval_token",
} as const;

export function evaluateRecovery(
  calls: TranscriptCall[],
  stages: Record<StageId, StageResult>,
): { cycles: number; correctStepReruns: number; incorrectStepReruns: number; events: RecoveryEvent[] } {
  const events: RecoveryEvent[] = [];

  // Build failures: a get_run reporting a terminal failure state.
  const failedBuildIdx: number[] = [];
  calls.forEach((c, i) => {
    if (c.tool !== T.getRun || !c.ok) return;
    const state = extractField(c.resultText, ["state", "runState", "run_state"]);
    if (state === "RUN_STATE_FAILED" || state === "RUN_STATE_CANCELED" || state === "RUN_STATE_CANCELLED") {
      failedBuildIdx.push(i);
    }
  });
  for (const failIdx of failedBuildIdx) {
    const nextBuild = calls.findIndex((c, i) => i > failIdx && c.tool === T.build);
    if (nextBuild === -1) continue;
    const sourceFixed = calls.some(
      (c, i) => i > failIdx && i < nextBuild && (c.tool === T.upload || c.tool === T.updateSource),
    );
    events.push({
      stage: "S5",
      kind: sourceFixed ? "fix_and_rerun" : "rerun_without_fix",
      correct: sourceFixed,
      detail: sourceFixed
        ? "build failure followed by source update and rebuild"
        : "build_bundle re-run without an intervening source update",
    });
  }

  // Evidence FAIL rows: require a fresh draft test before the next mint.
  const failEvidenceIdx: number[] = [];
  calls.forEach((c, i) => {
    if (c.tool !== T.evidence || !c.ok) return;
    const result = extractField(c.resultText, ["result", "outcome"])?.toUpperCase() ?? "";
    if (result.includes("FAIL")) failEvidenceIdx.push(i);
  });
  for (const failIdx of failEvidenceIdx) {
    const failedTestRun = extractField(calls[failIdx].argsText, ["testRunId", "test_run_id"]);
    const nextMint = calls.findIndex((c, i) => i > failIdx && c.tool === T.mint);
    const nextTest = calls.findIndex((c, i) => i > failIdx && c.tool === T.draftTest);
    if (nextMint !== -1 && (nextTest === -1 || nextMint < nextTest)) {
      events.push({
        stage: "S10",
        kind: "token_remint_without_retest",
        correct: false,
        detail: "approval token re-minted after FAIL evidence without a fresh draft test",
      });
    } else if (nextTest !== -1) {
      const newTestRun = extractField(calls[nextTest].resultText, ["testRunId", "test_run_id"]);
      const reused = failedTestRun !== null && newTestRun === failedTestRun;
      events.push({
        stage: "S10",
        kind: reused ? "reused_failed_test_run" : "fix_and_rerun",
        correct: !reused,
        detail: reused
          ? `draft test re-run reused failed test_run_id ${failedTestRun}`
          : "FAIL evidence followed by a fresh draft test run",
      });
    }
  }

  // Generic fix→re-run cycles: any stage that failed and later passed.
  let cycles = 0;
  for (const stage of Object.values(stages)) {
    if (stage.status === "pass" && !stage.firstPass) cycles++;
  }

  const correct = events.filter((e) => e.correct).length;
  return {
    cycles,
    correctStepReruns: correct,
    incorrectStepReruns: events.length - correct,
    events,
  };
}
