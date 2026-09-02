/**
 * Stage funnel S0–S11d: evaluates the in-app authoring lifecycle's stop-if
 * gates from the normalized tool-call transcript. Every gate is deterministic:
 * an action call succeeded AND its required IDs/states are extractable from
 * the tool result. Read-only polling calls (get_run, evidence polls, revision
 * summaries) never count as gate attempts.
 */
import { extractField, type TranscriptCall } from "../transcript.ts";
import type { Collection, Scenario, StageId, StageResult, StageStatus } from "./types.ts";
import { STAGE_IDS } from "./types.ts";

const T = {
  guide: "c1_connector_authoring_get_authoring_guide",
  createDraft: "c1_connector_authoring_create_draft",
  upload: "c1_connector_authoring_create_draft_source_upload",
  updateSource: "c1_connector_authoring_update_draft_source",
  finalize: "c1_connector_authoring_finalize_draft_source_upload",
  getDraft: "c1_connector_authoring_get_draft",
  build: "c1_connector_authoring_build_bundle",
  getRun: "c1_connector_authoring_get_run",
  appsCreate: "c1_apps_create",
  provision: "c1_connector_authoring_provision_connector",
  svcGet: "c1_connector_service_get",
  svcUpdate: "c1_connector_service_update",
  draftTest: "c1_connector_authoring_run_draft_test_sync",
  evidence: "c1_connector_authoring_get_test_run_evidence",
  deploy: "c1_connector_authoring_deploy_connector_instance",
  mint: "c1_connector_authoring_mint_approval_token",
  revSummaries: "c1_connector_authoring_list_revision_summaries",
  forceSync: "c1_connector_service_force_sync",
} as const;

const REQUIRED_SOURCE_FILES = ["connector.ts", "config-schema.json", "runtime-schema.json", "capabilities.json"];

/** Funnel order used for "reached" computation. */
const ORDER: StageId[] = [...STAGE_IDS];

const callsTo = (calls: TranscriptCall[], tool: string) => calls.filter((c) => c.tool === tool);

const firstOk = (calls: TranscriptCall[], pred: (c: TranscriptCall) => string | null) => {
  for (const c of calls) {
    if (!c.ok) continue;
    const evidence = pred(c);
    if (evidence !== null) return { call: c, evidence };
  }
  return null;
};

const id =
  (...keys: string[]) =>
  (c: TranscriptCall) =>
    extractField(c.resultText, keys);

interface Ctx {
  calls: TranscriptCall[];
  scenario: Scenario;
  collection: Collection | null;
  stoppedAtHumanBoundary: boolean;
  boundaryViolations: string[];
}

function stageResult(
  id: StageId,
  status: StageStatus,
  gate: string,
  opts: Partial<Pick<StageResult, "firstPass" | "attempts">> & { evidence?: Record<string, string>; failures?: string[] } = {},
): StageResult {
  return {
    id,
    status,
    firstPass: opts.firstPass ?? (status === "pass" || status === "human_boundary"),
    attempts: opts.attempts ?? (status === "pass" ? 1 : 0),
    gate,
    evidence: opts.evidence ?? {},
    failures: opts.failures ?? [],
  };
}

export function evaluateStages(ctx: Ctx): Record<StageId, StageResult> {
  const { calls, scenario, collection } = ctx;
  const out = {} as Record<StageId, StageResult>;

  // S0 — read the authoring guide.
  {
    const guideCalls = callsTo(calls, T.guide);
    const ok = guideCalls.some((c) => c.ok);
    out.S0 = stageResult("S0", ok ? "pass" : guideCalls.length > 0 ? "fail" : "not_reached", "get_authoring_guide succeeds", {
      firstPass: guideCalls[0]?.ok ?? false,
      attempts: guideCalls.length,
      failures: ok || guideCalls.length === 0 ? [] : ["authoring guide unreadable — do not compose source without it"],
    });
  }

  // S1 — create draft: catalog_id + draft_id non-empty.
  {
    const dc = callsTo(calls, T.createDraft);
    const hit = firstOk(dc, (c) => {
      const catalogId = extractField(c.resultText, ["catalogId", "catalog_id"]);
      const draftId = extractField(c.resultText, ["draftId", "draft_id", "id"]);
      return catalogId && draftId ? `catalogId=${catalogId} draftId=${draftId}` : null;
    });
    out.S1 = hit
      ? stageResult("S1", "pass", "create_draft returns non-empty catalog_id and draft_id", {
          firstPass: dc[0] === hit.call,
          attempts: dc.length,
          evidence: { catalogId: extractField(hit.call.resultText, ["catalogId", "catalog_id"]) ?? "", draftId: extractField(hit.call.resultText, ["draftId", "draft_id", "id"]) ?? "" },
        })
      : stageResult("S1", dc.length > 0 ? "fail" : "not_reached", "create_draft returns non-empty catalog_id and draft_id", {
          attempts: dc.length,
          firstPass: false,
        });
  }

  // S2 — upload source: upload_id non-empty (or inline update path).
  {
    const ups = callsTo(calls, T.upload);
    const inlines = callsTo(calls, T.updateSource);
    const hit = firstOk(ups, id("uploadId", "upload_id")) ?? firstOk(inlines, () => "inline-update");
    const path = firstOk(ups, id("uploadId", "upload_id")) ? "upload" : "inline";
    out.S2 = hit
      ? stageResult("S2", "pass", "source upload accepted (upload_id non-empty or inline update ok)", {
          firstPass: (ups[0] ?? inlines[0]) === hit.call,
          attempts: ups.length + inlines.length,
          evidence: { path, uploadId: extractField(hit.call.resultText, ["uploadId", "upload_id"]) ?? "" },
        })
      : stageResult("S2", ups.length + inlines.length > 0 ? "fail" : "not_reached", "source upload accepted (upload_id non-empty or inline update ok)", {
          attempts: ups.length + inlines.length,
          firstPass: false,
        });
  }

  // S3 — finalize + verify: finalize ok and no get_draft shows a missing required file.
  {
    const fins = callsTo(calls, T.finalize);
    const drafts = callsTo(calls, T.getDraft);
    const finOk = fins.some((c) => c.ok);
    const missing = new Set<string>();
    for (const d of drafts) {
      for (const f of REQUIRED_SOURCE_FILES) {
        const re = new RegExp(`"${f.replace(".", "\\.")}"[^}]*"present"\\s*:\\s*false`);
        if (re.test(d.resultText)) missing.add(f);
      }
    }
    const failures = [...missing].map((f) => `required source file marked missing: ${f}`);
    out.S3 = finOk && missing.size === 0
      ? stageResult("S3", "pass", "finalize ok; all four required source files present", {
          firstPass: fins[0]?.ok ?? false,
          attempts: fins.length,
        })
      : stageResult("S3", fins.length > 0 || drafts.length > 0 ? "fail" : "not_reached", "finalize ok; all four required source files present", {
          attempts: fins.length,
          firstPass: false,
          failures: finOk ? failures : ["finalize_draft_source_upload did not succeed", ...failures],
        });
  }

  // S4 — build bundle: run_id non-empty.
  {
    const builds = callsTo(calls, T.build);
    const hit = firstOk(builds, id("runId", "run_id"));
    out.S4 = hit
      ? stageResult("S4", "pass", "build_bundle returns non-empty run_id", {
          firstPass: builds[0] === hit.call,
          attempts: builds.length,
          evidence: { runId: extractField(hit.call.resultText, ["runId", "run_id"]) ?? "" },
        })
      : stageResult("S4", builds.length > 0 ? "fail" : "not_reached", "build_bundle returns non-empty run_id", {
          attempts: builds.length,
          firstPass: false,
        });
  }

  // S5 — poll build: RUN_STATE_SUCCEEDED; revision_id from result.resultRef.
  {
    const polls = callsTo(calls, T.getRun);
    const runState = (c: TranscriptCall) => extractField(c.resultText, ["state", "runState", "run_state"]);
    const succeeded = polls.filter((c) => c.ok && runState(c) === "RUN_STATE_SUCCEEDED");
    const failed = polls.filter((c) => c.ok && ["RUN_STATE_FAILED", "RUN_STATE_CANCELED", "RUN_STATE_CANCELLED"].includes(runState(c) ?? ""));
    const hit = succeeded.find((c) => extractField(c.resultText, ["resultRef", "result_ref", "revisionId", "revision_id"]));
    const terminalRuns = new Set([...succeeded, ...failed].map((c) => extractField(c.argsText, ["runId", "run_id"]) ?? ""));
    if (hit) {
      out.S5 = stageResult("S5", "pass", "build run reaches RUN_STATE_SUCCEEDED; revision_id extracted", {
        firstPass: failed.length === 0,
        attempts: Math.max(terminalRuns.size, 1),
        evidence: { revisionId: extractField(hit.resultText, ["resultRef", "result_ref", "revisionId", "revision_id"]) ?? "" },
        failures: failed.length > 0 ? [`${failed.length} build run(s) failed before success`] : [],
      });
    } else {
      out.S5 = stageResult("S5", polls.length > 0 ? "fail" : "not_reached", "build run reaches RUN_STATE_SUCCEEDED; revision_id extracted", {
        attempts: terminalRuns.size,
        firstPass: false,
        failures: failed.length > 0 ? ["build run reached a terminal failure state"] : polls.length > 0 ? ["build never reached SUCCEEDED"] : [],
      });
    }
  }

  // S6 — create app: app_id non-empty.
  {
    const ac = callsTo(calls, T.appsCreate);
    const hit = firstOk(ac, id("appId", "app_id", "id"));
    out.S6 = hit
      ? stageResult("S6", "pass", "apps_create returns non-empty app_id", {
          firstPass: ac[0] === hit.call,
          attempts: ac.length,
          evidence: { appId: extractField(hit.call.resultText, ["appId", "app_id", "id"]) ?? "" },
        })
      : stageResult("S6", ac.length > 0 ? "fail" : "not_reached", "apps_create returns non-empty app_id", { attempts: ac.length, firstPass: false });
  }

  // S7 — provision connector: connector_id non-empty.
  {
    const pc = callsTo(calls, T.provision);
    const hit = firstOk(pc, id("connectorId", "connector_id"));
    out.S7 = hit
      ? stageResult("S7", "pass", "provision_connector returns non-empty connector_id", {
          firstPass: pc[0] === hit.call,
          attempts: pc.length,
          evidence: { connectorId: extractField(hit.call.resultText, ["connectorId", "connector_id"]) ?? "" },
        })
      : stageResult("S7", pc.length > 0 ? "fail" : "not_reached", "provision_connector returns non-empty connector_id", { attempts: pc.length, firstPass: false });
  }

  // S8 — configure instance: update with config mask ok; no empty stringValue on credential fields.
  {
    const updates = callsTo(calls, T.svcUpdate).filter((c) => /updateMask|update_mask/.test(c.argsText) || /"config"/.test(c.argsText));
    const emptySecretFields: string[] = [];
    for (const u of updates) {
      for (const field of scenario.provider.credentialFields) {
        const re = new RegExp(`"${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:\\s*\\{[^}]*"stringValue"\\s*:\\s*""`);
        if (re.test(u.argsText)) emptySecretFields.push(field);
      }
    }
    const okUpdate = updates.find((c) => c.ok);
    const failures = [...new Set(emptySecretFields)].map((f) => `empty stringValue for credential field "${f}" deletes the secret`);
    out.S8 = okUpdate && failures.length === 0
      ? stageResult("S8", "pass", "connector_service_update (config mask) sets non-empty credentials", {
          firstPass: updates[0] === okUpdate,
          attempts: updates.length,
        })
      : stageResult("S8", updates.length > 0 ? "fail" : "not_reached", "connector_service_update (config mask) sets non-empty credentials", {
          attempts: updates.length,
          firstPass: false,
          failures: okUpdate ? failures : ["no successful config update", ...failures],
        });
  }

  // S9 — run draft test: test_run_id non-empty.
  {
    const dts = callsTo(calls, T.draftTest);
    const hit = firstOk(dts, id("testRunId", "test_run_id"));
    out.S9 = hit
      ? stageResult("S9", "pass", "run_draft_test_sync returns non-empty test_run_id", {
          firstPass: dts[0] === hit.call,
          attempts: dts.length,
          evidence: { testRunId: extractField(hit.call.resultText, ["testRunId", "test_run_id"]) ?? "" },
        })
      : stageResult("S9", dts.length > 0 ? "fail" : "not_reached", "run_draft_test_sync returns non-empty test_run_id", { attempts: dts.length, firstPass: false });
  }

  // S10 — wait for PASS evidence (FAIL rows fail the stage until a fresh run PASSes).
  {
    const polls = callsTo(calls, T.evidence);
    const resultOf = (c: TranscriptCall) => {
      const r = extractField(c.resultText, ["result", "outcome"]);
      return r ? r.toUpperCase() : null;
    };
    const passRow = polls.find((c) => c.ok && resultOf(c)?.includes("PASS") && !resultOf(c)?.includes("FAIL"));
    const failRows = polls.filter((c) => c.ok && resultOf(c)?.includes("FAIL"));
    const testRuns = callsTo(calls, T.draftTest).filter((c) => c.ok);
    if (passRow) {
      out.S10 = stageResult("S10", "pass", "durable PASS evidence row binds this revision", {
        firstPass: failRows.length === 0,
        attempts: Math.max(testRuns.length, 1),
        evidence: { testRunId: extractField(passRow.argsText, ["testRunId", "test_run_id"]) ?? "" },
        failures: failRows.length > 0 ? [`${failRows.length} FAIL evidence row(s) before PASS`] : [],
      });
    } else {
      out.S10 = stageResult("S10", polls.length > 0 || testRuns.length > 0 ? "fail" : "not_reached", "durable PASS evidence row binds this revision", {
        attempts: testRuns.length,
        firstPass: false,
        failures: failRows.length > 0 ? ["evidence row is FAIL"] : ["no PASS evidence row"],
      });
    }
  }

  // S11a — deploy: deployment_instance_id non-empty.
  {
    const deps = callsTo(calls, T.deploy);
    const hit = firstOk(deps, id("deploymentInstanceId", "deployment_instance_id", "instanceId", "instance_id"));
    out.S11a = hit
      ? stageResult("S11a", "pass", "deploy_connector_instance returns non-empty deployment_instance_id", {
          firstPass: deps[0] === hit.call,
          attempts: deps.length,
          evidence: { deploymentInstanceId: extractField(hit.call.resultText, ["deploymentInstanceId", "deployment_instance_id", "instanceId", "instance_id"]) ?? "" },
        })
      : stageResult("S11a", deps.length > 0 ? "fail" : "not_reached", "deploy_connector_instance returns non-empty deployment_instance_id", { attempts: deps.length, firstPass: false });
  }

  // S11b — mint approval token: activation_url non-empty.
  {
    const mints = callsTo(calls, T.mint);
    const hit = firstOk(mints, id("activationUrl", "activation_url", "url"));
    out.S11b = hit
      ? stageResult("S11b", "pass", "mint_approval_token returns activation_url", {
          firstPass: mints[0] === hit.call,
          attempts: mints.length,
          evidence: { activationUrl: extractField(hit.call.resultText, ["activationUrl", "activation_url", "url"]) ?? "" },
        })
      : stageResult("S11b", mints.length > 0 ? "fail" : "not_reached", "mint_approval_token returns activation_url", { attempts: mints.length, firstPass: false });
  }

  // S11c — activation: REVISION_STATUS_ACTIVE, or a clean stop at the human boundary.
  {
    const summaryPolls = callsTo(calls, T.revSummaries);
    const activeInTranscript = summaryPolls.some((c) => c.ok && c.resultText.includes("REVISION_STATUS_ACTIVE"));
    const activeInCollection = collection?.revisions.some((r) => r.status === "REVISION_STATUS_ACTIVE") ?? false;
    const active = activeInTranscript || activeInCollection;
    const epoch = collection?.revisions.find((r) => r.status === "REVISION_STATUS_ACTIVE")?.activationEpoch ?? null;
    if (active) {
      out.S11c = stageResult("S11c", "pass", "revision reaches REVISION_STATUS_ACTIVE", {
        evidence: epoch ? { activationEpoch: epoch } : {},
      });
    } else if (out.S11b.status === "pass" && ctx.stoppedAtHumanBoundary) {
      out.S11c = stageResult("S11c", "human_boundary", "revision reaches REVISION_STATUS_ACTIVE (human OWNER action)", {
        evidence: { handoff: "activation_url handed to human OWNER; agent stopped" },
      });
    } else {
      const failures = [...ctx.boundaryViolations];
      if (out.S11b.status === "pass" && !ctx.stoppedAtHumanBoundary && failures.length === 0) {
        failures.push("agent did not stop cleanly at the human activation boundary");
      }
      out.S11c = stageResult("S11c", out.S11b.status === "pass" ? "fail" : "not_reached", "revision reaches REVISION_STATUS_ACTIVE (human OWNER action)", {
        firstPass: false,
        failures,
      });
    }
  }

  // S11d — force sync: SYNC_STATUS_DONE.
  {
    const syncs = callsTo(calls, T.forceSync);
    const syncCalled = syncs.some((c) => c.ok);
    const doneInTranscript = callsTo(calls, T.svcGet).some((c) => c.ok && c.resultText.includes("SYNC_STATUS_DONE"));
    const doneInCollection = collection?.connector.status === "SYNC_STATUS_DONE";
    const activeFirst = out.S11c.status === "pass";
    if (syncCalled && (doneInTranscript || doneInCollection)) {
      out.S11d = stageResult("S11d", "pass", "force sync completes with SYNC_STATUS_DONE", {
        firstPass: syncs[0]?.ok ?? false,
        attempts: syncs.length,
      });
    } else if (syncCalled && !activeFirst) {
      out.S11d = stageResult("S11d", "fail", "force sync completes with SYNC_STATUS_DONE", {
        attempts: syncs.length,
        firstPass: false,
        failures: ["force sync attempted before the revision was ACTIVE"],
      });
    } else if (out.S11c.status === "human_boundary" || out.S11c.status === "not_reached") {
      out.S11d = stageResult("S11d", "human_boundary", "force sync completes with SYNC_STATUS_DONE");
    } else {
      out.S11d = stageResult("S11d", syncCalled ? "fail" : "not_reached", "force sync completes with SYNC_STATUS_DONE", {
        attempts: syncs.length,
        firstPass: false,
        failures: syncCalled ? ["sync status never reached SYNC_STATUS_DONE"] : [],
      });
    }
  }

  // Mark stages beyond the scenario's terminal stage as not_applicable, and
  // stages after the first failure as blocked rather than not_reached.
  const terminalIdx = ORDER.indexOf(scenario.terminalStage);
  let sawFailure = false;
  for (let i = 0; i < ORDER.length; i++) {
    const id = ORDER[i];
    const r = out[id];
    if (i > terminalIdx && (r.status === "not_reached" || (r.status === "human_boundary" && scenario.tier === 0))) {
      out[id] = stageResult(id, "not_applicable", r.gate);
      continue;
    }
    if (r.status === "fail") sawFailure = true;
    else if (sawFailure && r.status === "not_reached") out[id] = stageResult(id, "blocked", r.gate);
  }

  return out;
}

export function funnelSummary(stages: Record<StageId, StageResult>, stoppedAtHumanBoundary: boolean) {
  let reached: StageId | "none" = "none";
  let boundarySeen = false;
  for (const id of ORDER) {
    const s = stages[id].status;
    if (s === "not_applicable") continue;
    if (s === "pass") {
      reached = id;
      continue;
    }
    // The human boundary spans S11c→S11d; only the first boundary stage
    // extends "reached" — the agent advanced to the boundary, not past it.
    if (s === "human_boundary") {
      if (!boundarySeen) {
        reached = id;
        boundarySeen = true;
      }
      continue;
    }
    break;
  }
  const throughHandoff = (["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11a", "S11b"] as StageId[])
    .every((id) => stages[id].status === "pass" || stages[id].status === "not_applicable");
  const agentComplete = throughHandoff && (stages.S11c.status === "pass" || stages.S11c.status === "human_boundary") && stoppedAtHumanBoundary;
  const fullPass = agentComplete && stages.S11c.status === "pass" && stages.S11d.status === "pass";
  return { reached, agentComplete, fullPass };
}
