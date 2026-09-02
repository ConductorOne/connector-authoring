/**
 * The scenario runner: one run = provision a fresh c1-image Squire env, gate
 * on full readiness, run the agent under test against the fixture provider,
 * collect tenant state, score deterministically, append a JSONL run record.
 *
 * A run that cannot reach full readiness is aborted and retried with a fresh
 * env (up to maxEnvAttempts) and is never scored.
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { expectations as fixtureExpectations } from "../fixture/directory-api/src/data.ts";
import { buildAgentPrompt } from "./agentPrompt.ts";
import { buildCollectorPrompt, collectionPath, parseCollection, sourceArchivePath } from "./collector.ts";
import { runIdFor, type RunConfig } from "./config.ts";
import { awaitReadiness, buildProbePrompt, detectToolAbsence } from "./readiness.ts";
import { appendRunRecord, RUN_RECORD_SCHEMA_VERSION, type RunRecord } from "./records.ts";
import { scoreRun } from "./scorer/index.ts";
import type { Collection, Scenario, Score } from "./scorer/types.ts";
import { loadSkillBundle } from "./skills.ts";
import { fsReadBase64, fsReadText, squire } from "./squire.ts";
import { normalizeTranscript, type NormalizedTranscript } from "./transcript.ts";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function loadScenario(path: string): Scenario {
  const doc: unknown = JSON.parse(readFileSync(path, "utf8"));
  // The scenario file is operator-authored; a malformed one is a config error.
  return doc as Scenario;
}

/** Refresh scenario expectations from the live fixture (count parity, not fixture counts). */
async function refreshExpectations(scenario: Scenario, fixtureUrl: string): Promise<Scenario> {
  const res = await fetch(`${fixtureUrl.replace(/\/+$/, "")}/_fixture/expectations`);
  if (!res.ok) throw new Error(`fixture expectations endpoint returned ${res.status}`);
  const expectations = (await res.json()) as Scenario["expectations"];
  return { ...scenario, expectations };
}

async function healthCheckFixture(fixtureUrl: string): Promise<void> {
  const res = await fetch(`${fixtureUrl.replace(/\/+$/, "")}/healthz`);
  if (!res.ok) throw new Error(`fixture health check failed: ${res.status}`);
}

interface StreamDrain {
  sinceSeq: number;
  events: Array<Record<string, unknown>>;
}

/**
 * Drain new firehose events. The stream retains only the most recent ~1000
 * events per task, so the runner drains on every wait cycle during the run
 * instead of reading once at the end.
 */
async function drainStream(taskId: string, envId: string, drain: StreamDrain): Promise<void> {
  for (;;) {
    const page = await squire.taskStream(taskId, drain.sinceSeq, envId);
    const batch = Array.isArray(page.events) ? page.events : [];
    drain.events.push(...(batch as Array<Record<string, unknown>>));
    const next = page.next_seq;
    if (batch.length === 0 || typeof next !== "number" || next <= drain.sinceSeq) return;
    drain.sinceSeq = next;
  }
}

const TERMINAL_TASK_TYPES = new Set(["task.completed", "task.failed", "task.canceled", "task.cancelled"]);

/** Wait for a task to go terminal, draining its stream on every cycle. */
async function waitTaskTerminal(taskId: string, envId: string, timeoutMs: number, drain: StreamDrain): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let cursor: string | undefined;
  while (Date.now() < deadline) {
    await drainStream(taskId, envId, drain);
    const remaining = Math.max(Math.min(deadline - Date.now(), 50_000), 5_000);
    const res = await squire.waitEvents({
      timeout_seconds: Math.round(remaining / 1000),
      task_ids: [taskId],
      ...(cursor ? { since: cursor } : {}),
    });
    if (typeof res.next === "string") cursor = res.next;
    const events = Array.isArray(res.events) ? res.events : [];
    const terminal = events.find((e) => TERMINAL_TASK_TYPES.has(e.type) || TERMINAL_TASK_TYPES.has(`task.${e.status}`));
    if (terminal) {
      await drainStream(taskId, envId, drain);
      return terminal.type.replace(/^task\./, "") || String(terminal.status);
    }
    const task = await squire.getTask(taskId, envId);
    if (["completed", "failed", "canceled", "cancelled"].includes(task.status)) {
      await drainStream(taskId, envId, drain);
      return task.status;
    }
  }
  throw new Error(`task ${taskId} did not reach a terminal state within ${Math.round(timeoutMs / 60000)}m`);
}

function baseRecord(runId: string, cfg: RunConfig, scenario: Scenario, startedAt: Date): RunRecord {
  return {
    schema_version: RUN_RECORD_SCHEMA_VERSION,
    run_id: runId,
    scenario: scenario.id,
    skill_bundle: { name: cfg.bundleSpec.split("@")[0], version: cfg.bundleSpec.split("@")[1] ?? "0" },
    model: { id: cfg.model, reasoning_effort: cfg.reasoningEffort },
    started_at: startedAt.toISOString(),
    ended_at: startedAt.toISOString(),
    wall_time_s: 0,
    env: { env_id: null, image: cfg.image, attempt: 0 },
    readiness: {
      ok: false,
      attempts: 0,
      services_healthy_at: null,
      tools_present: null,
      aborted: false,
      abort_reason: null,
    },
    agent: { task_id: null, status: null, turns: null, tokens_in: null, tokens_out: null, tool_calls: 0, tool_errors: 0 },
    score: null,
    error: null,
  };
}

const finalize = (record: RunRecord, startedAt: Date): RunRecord => {
  const ended = new Date();
  record.ended_at = ended.toISOString();
  record.wall_time_s = Math.round((ended.getTime() - startedAt.getTime()) / 1000);
  return record;
};

function decodeSourceArchive(b64: string): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = Buffer.from(b64.trim(), "base64");
  let tar: Buffer;
  try {
    tar = gunzipSync(raw);
  } catch {
    return out;
  }
  // Minimal tar reader: 512-byte headers, ustar, regular files only.
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const sizeOctal = header.subarray(124, 136).toString("utf8").replace(/\0.*$/, "").trim();
    const type = header.subarray(156, 157).toString("utf8");
    if (name === "") break;
    const size = parseInt(sizeOctal || "0", 8);
    const bodyStart = offset + 512;
    if (type === "0" || type === "\0") {
      out[name] = tar.subarray(bodyStart, bodyStart + size).toString("utf8");
    }
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  return out;
}

export interface RunOutcome {
  record: RunRecord;
  score: Score | null;
}

export async function runOnce(cfg: RunConfig): Promise<RunOutcome> {
  const startedAt = new Date();
  const loaded = loadScenario(cfg.scenarioPath);
  // Tier 0 has no fixture: expectations stay null and synced-data scoring is
  // not applicable. Tier 1+: external mode queries the live fixture for
  // expectations (count parity, not fixture counts); in-env mode derives them
  // from the same seed module the fixture serves — identical values, no
  // local server needed.
  const scenario =
    loaded.tier === 0
      ? loaded
      : cfg.fixture.mode === "external" && cfg.fixture.url
        ? await refreshExpectations(loaded, cfg.fixture.url)
        : { ...loaded, expectations: fixtureExpectations() };
  const bundle = loadSkillBundle(cfg.bundlesDir, cfg.bundleSpec);
  const runId = runIdFor(scenario.id, cfg.model, bundle.name + (bundle.version !== "0" ? `@${bundle.version}` : ""), startedAt);
  const record = baseRecord(runId, cfg, scenario, startedAt);
  record.skill_bundle = { name: bundle.name, version: bundle.version };

  if (scenario.tier > 0 && cfg.fixture.mode === "external" && cfg.fixture.url) {
    await healthCheckFixture(cfg.fixture.url);
  }

  const secretValues = Object.entries(scenario.provider.auth.fields)
    .filter(([field]) => scenario.provider.credentialFields.includes(field))
    .map(([, value]) => value);

  let lastAbort = "unknown";
  for (let attempt = 1; attempt <= cfg.maxEnvAttempts; attempt++) {
    record.env.attempt = attempt;
    record.readiness.attempts = attempt;
    let envId: string | null = null;
    try {
      // 1. Provision the eval tenant: fresh c1-image env whose primary task is
      //    the readiness probe.
      if (cfg.fixture.mode === "in-env" && scenario.tier > 0) {
        const tar = execFileSync("tar", ["czf", "-", "-C", cfg.fixtureDir ?? "", "."], { maxBuffer: 64 * 1024 * 1024 });
        await squire.fsWriteBase64(`/shared/${runId}/fixture.tar.b64`, tar.toString("base64"));
      }
      const env = await squire.createEnv({
        image: cfg.image,
        initial_prompt: buildProbePrompt(runId, scenario.tier > 0 ? cfg.fixture : { mode: "external", url: null }),
        idle_timeout_minutes: cfg.idleTimeoutMinutes,
        auto_delete_minutes: cfg.autoDeleteMinutes,
        name: `eval-${runId.slice(0, 40)}`,
      });
      envId = env.id;
      record.env.env_id = envId;

      // 2. Readiness gate, layer 1: services healthy before the agent starts.
      const readiness = await awaitReadiness(runId, {
        timeoutMs: cfg.readinessTimeoutMs,
        pollMs: 15_000,
        abortCheck: async () => {
          const env = await squire.getEnv(envId as string);
          if (["failed", "stopped", "deleted", "reaped"].includes(env.status)) {
            throw new Error(`eval env ${envId} entered ${env.status} while waiting for readiness`);
          }
        },
      });
      if (readiness.kind !== "ready") {
        lastAbort = readiness.kind === "timeout" ? `readiness timeout after ${readiness.waited_s}s` : readiness.reason;
        record.readiness.abort_reason = lastAbort;
        continue;
      }
      record.readiness.services_healthy_at = readiness.report.checked_at || new Date().toISOString();

      // 3. Run the agent under test.
      const fixtureBaseUrl =
        scenario.tier === 0 ? "" : cfg.fixture.mode === "in-env" ? "http://localhost:8080" : (cfg.fixture.url ?? "");
      const agentTask = await squire.taskCreate({
        env_id: envId,
        prompt: buildAgentPrompt({ runId, scenario, bundle, fixtureBaseUrl }),
        model: cfg.model,
        title: `eval-agent-${runId.slice(0, 32)}`,
      });
      const agentTaskId = agentTask.task_id ?? agentTask.id;
      record.agent.task_id = agentTaskId;
      const drain: StreamDrain = { sinceSeq: 0, events: [] };
      const status = await waitTaskTerminal(agentTaskId, envId, cfg.agentTimeoutMs, drain);
      record.agent.status = status;

      // 4. Transcript + layer-2 readiness: c1dev tools present in the session.
      const transcript = normalizeTranscript(drain.events);
      record.agent.turns = transcript.turns;
      record.agent.tokens_in = transcript.tokensIn;
      record.agent.tokens_out = transcript.tokensOut;
      record.agent.tool_calls = transcript.calls.length;
      record.agent.tool_errors = transcript.calls.filter((c) => !c.ok).length;
      const absence = detectToolAbsence(transcript);
      record.readiness.tools_present = !absence.absent;
      if (absence.absent) {
        lastAbort = `c1dev tools absent in agent session: ${absence.evidence}`;
        record.readiness.abort_reason = lastAbort;
        continue;
      }
      record.readiness.ok = true;

      // 5. Handoff + collection.
      const handoffText = await fsReadText(`/shared/${runId}/handoff.json`);
      let handoff: Record<string, string> | null = null;
      if (handoffText) {
        try {
          handoff = JSON.parse(handoffText) as Record<string, string>;
        } catch {
          handoff = null;
        }
      }

      const collectorTask = await squire.taskCreate({
        env_id: envId,
        prompt: buildCollectorPrompt({ runId, scenario, handoff }),
        title: `eval-collector-${runId.slice(0, 28)}`,
      });
      const collectorTaskId = collectorTask.task_id ?? collectorTask.id;
      await waitTaskTerminal(collectorTaskId, envId, cfg.collectorTimeoutMs, { sinceSeq: 0, events: [] });

      const collectionText = await fsReadText(collectionPath(runId));
      const collection: Collection | null = collectionText ? parseCollection(collectionText) : null;
      const archiveB64 = await fsReadBase64(sourceArchivePath(runId));
      const sourceFiles = archiveB64 ? decodeSourceArchive(archiveB64) : {};

      // 6. Score.
      const score = scoreRun({ scenario, transcript, collection, sourceFiles, handoff, secretValues });
      record.score = score;
      return { record: finalize(record, startedAt), score };
    } catch (err) {
      lastAbort = err instanceof Error ? err.message : String(err);
      record.error = lastAbort;
      // Environment/transport failures before scoring are aborts, not scores.
      continue;
    } finally {
      if (envId && !cfg.keepEnv) {
        try {
          await squire.stopEnv(envId);
        } catch {
          // best-effort teardown; auto_delete_minutes bounds the leak
        }
      }
    }
  }

  // Exhausted attempts: aborted, never scored.
  record.readiness.aborted = true;
  record.readiness.abort_reason = lastAbort;
  record.error = record.error ?? lastAbort;
  return { record: finalize(record, startedAt), score: null };
}

export async function runScenario(cfg: RunConfig): Promise<RunOutcome[]> {
  const outcomes: RunOutcome[] = [];
  for (let i = 0; i < cfg.runs; i++) {
    const outcome = await runOnce(cfg);
    appendRunRecord(cfg.resultsPath, outcome.record);
    outcomes.push(outcome);
    // Brief pause between runs so env teardown settles.
    if (i + 1 < cfg.runs) await sleep(10_000);
  }
  return outcomes;
}
