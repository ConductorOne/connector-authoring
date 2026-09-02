/**
 * connector-authoring eval harness CLI.
 *
 *   node evals/src/cli.ts run --scenario tier1-directory [--bundle guide-only] [--runs N]
 *   node evals/src/cli.ts score --scenario tier1-directory --transcript t.json [--collection c.json] [--source-dir dir] [--handoff h.json]
 *   node evals/src/cli.ts fixture [--port 8080]
 *   node evals/src/cli.ts expectations [--fixture-url http://localhost:8080]
 *   node evals/src/cli.ts bundles
 *   node evals/src/cli.ts summarize [--results evals/results/runs.jsonl] [--scenario tier1-directory]
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULTS, type RunConfig } from "./config.ts";
import { readRunRecords, summarize } from "./records.ts";
import { runScenario } from "./runner.ts";
import { scoreRun } from "./scorer/index.ts";
import type { Collection, Scenario } from "./scorer/types.ts";
import { listBundles } from "./skills.ts";
import { normalizeTranscript } from "./transcript.ts";
import { parseCollection } from "./collector.ts";
import { start as startFixture } from "../fixture/directory-api/src/server.ts";

const die = (msg: string): never => {
  console.error(`error: ${msg}`);
  process.exit(2);
};

function scenarioPath(idOrPath: string): string {
  if (existsSync(idOrPath)) return resolve(idOrPath);
  const candidate = join(DEFAULTS.scenariosDir, `${idOrPath}.json`);
  if (existsSync(candidate)) return candidate;
  return die(`scenario "${idOrPath}" not found (tried ${idOrPath} and ${candidate})`);
}

function readSourceDir(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isFile()) out[entry] = readFileSync(p, "utf8");
  }
  return out;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "run": {
      const { values } = parseArgs({
        args: rest,
        options: {
          scenario: { type: "string" },
          model: { type: "string", default: process.env.EVALS_MODEL ?? DEFAULTS.model },
          "reasoning-effort": { type: "string" },
          bundle: { type: "string", default: DEFAULTS.bundle },
          runs: { type: "string", default: String(DEFAULTS.runs) },
          image: { type: "string", default: process.env.EVALS_IMAGE ?? DEFAULTS.image },
          "fixture-url": { type: "string" },
          "fixture-in-env": { type: "boolean", default: false },
          "keep-env": { type: "boolean", default: false },
          results: { type: "string", default: DEFAULTS.resultsPath },
          "max-env-attempts": { type: "string", default: String(DEFAULTS.maxEnvAttempts) },
        },
        strict: true,
      });
      const scenario = values.scenario ?? die("--scenario is required");
      // Tier-0 scenarios have no fixture; tier-1 runs need one of the flags.
      const fixture = values["fixture-in-env"]
        ? { mode: "in-env" as const, url: null }
        : { mode: "external" as const, url: values["fixture-url"] ?? null };
      const cfg: RunConfig = {
        scenarioPath: scenarioPath(scenario),
        image: values.image ?? DEFAULTS.image,
        model: values.model ?? DEFAULTS.model,
        reasoningEffort: values["reasoning-effort"] ?? null,
        bundleSpec: values.bundle ?? DEFAULTS.bundle,
        runs: Number(values.runs ?? DEFAULTS.runs),
        maxEnvAttempts: Number(values["max-env-attempts"] ?? DEFAULTS.maxEnvAttempts),
        readinessTimeoutMs: DEFAULTS.readinessTimeoutMs,
        agentTimeoutMs: DEFAULTS.agentTimeoutMs,
        collectorTimeoutMs: DEFAULTS.collectorTimeoutMs,
        resultsPath: values.results ?? DEFAULTS.resultsPath,
        bundlesDir: DEFAULTS.bundlesDir,
        fixtureDir: DEFAULTS.fixtureDir,
        fixture,
        keepEnv: values["keep-env"],
        idleTimeoutMinutes: 180,
        autoDeleteMinutes: 720,
      };
      const outcomes = await runScenario(cfg);
      for (const o of outcomes) {
        const s = o.score;
        console.log(
          `${o.record.run_id}: ${s ? `agentComplete=${s.funnel.agentComplete} reached=${s.funnel.reached} firstPassRate=${s.metrics.firstPassRate?.toFixed(2) ?? "n/a"}` : `ABORTED (${o.record.readiness.abort_reason ?? o.record.error})`}`,
        );
      }
      console.log(`records appended to ${cfg.resultsPath}`);
      return;
    }

    case "score": {
      const { values } = parseArgs({
        args: rest,
        options: {
          scenario: { type: "string" },
          transcript: { type: "string" },
          collection: { type: "string" },
          "source-dir": { type: "string" },
          handoff: { type: "string" },
          "fixture-url": { type: "string" },
        },
        strict: true,
      });
      const scenarioId = values.scenario ?? die("--scenario is required");
      const transcriptPath = values.transcript ?? die("--transcript is required");
      let scenario = JSON.parse(readFileSync(scenarioPath(scenarioId), "utf8")) as Scenario;
      if (values["fixture-url"]) {
        const res = await fetch(`${values["fixture-url"].replace(/\/+$/, "")}/_fixture/expectations`);
        if (!res.ok) die(`fixture expectations endpoint returned ${res.status}`);
        scenario = { ...scenario, expectations: (await res.json()) as Scenario["expectations"] };
      }
      const rawEvents = JSON.parse(readFileSync(transcriptPath, "utf8")) as Array<Record<string, unknown>>;
      const transcript = normalizeTranscript(rawEvents);
      const collection: Collection | null = values.collection
        ? parseCollection(readFileSync(values.collection, "utf8"))
        : null;
      const sourceFiles = values["source-dir"] ? readSourceDir(values["source-dir"]) : {};
      const handoff = values.handoff
        ? (JSON.parse(readFileSync(values.handoff, "utf8")) as Record<string, string>)
        : null;
      const secretValues = Object.entries(scenario.provider.auth.fields)
        .filter(([f]) => scenario.provider.credentialFields.includes(f))
        .map(([, v]) => v);
      const score = scoreRun({ scenario, transcript, collection, sourceFiles, handoff, secretValues });
      console.log(JSON.stringify(score, null, 2));
      return;
    }

    case "fixture": {
      const { values } = parseArgs({
        args: rest,
        options: { port: { type: "string", default: "8080" } },
        strict: true,
      });
      startFixture(Number(values.port), "0.0.0.0");
      console.log(`directory-api fixture listening on :${values.port}`);
      return;
    }

    case "expectations": {
      const { values } = parseArgs({
        args: rest,
        options: { "fixture-url": { type: "string", default: "http://localhost:8080" } },
        strict: true,
      });
      const res = await fetch(`${values["fixture-url"]}/_fixture/expectations`);
      if (!res.ok) die(`fixture returned ${res.status}`);
      console.log(JSON.stringify(await res.json(), null, 2));
      return;
    }

    case "bundles": {
      for (const b of listBundles(DEFAULTS.bundlesDir)) console.log(b);
      return;
    }

    case "summarize": {
      const { values } = parseArgs({
        args: rest,
        options: {
          results: { type: "string", default: DEFAULTS.resultsPath },
          scenario: { type: "string" },
        },
        strict: true,
      });
      let records = readRunRecords(values.results);
      if (values.scenario) records = records.filter((r) => r.scenario === values.scenario);
      console.log(JSON.stringify(summarize(records), null, 2));
      return;
    }

    default:
      die(`unknown command "${command ?? ""}" — expected run | score | fixture | expectations | bundles | summarize`);
  }
}

await main();
