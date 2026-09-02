/**
 * Builds the prompt for the agent under test. The prompt is the eval's
 * controlled input: identical structure across runs, varying only the
 * scenario's provider brief and the skill-bundle condition.
 */
import type { Scenario } from "./scorer/types.ts";
import type { SkillBundle } from "./skills.ts";

export function buildAgentPrompt(opts: {
  runId: string;
  scenario: Scenario;
  bundle: SkillBundle;
  fixtureBaseUrl: string;
}): string {
  const { runId, scenario, bundle, fixtureBaseUrl } = opts;
  const p = scenario.provider;
  const credRows = Object.entries(p.auth.fields)
    .map(([field, value]) => `| \`${field}\` | \`${field === "base-url" ? fixtureBaseUrl : value}\` |`)
    .join("\n");

  const skillSection =
    bundle.name === "none"
      ? `## Skill condition: none

You receive no authoring guidance beyond this prompt. Do the task however you see fit.`
      : bundle.name === "guide-only"
        ? `## Skill condition: guide-only

Before composing any source file, call \`c1_connector_authoring_get_authoring_guide\` and read the returned contract in full. It is the authoritative source-file and lifecycle contract — follow it exactly. If anything elsewhere disagrees with the served guide, the served guide wins.`
        : `## Skill condition: full skill set (version ${bundle.version})

Read and follow the skill documents below. They are the authoritative procedure for this task.

${bundle.documents.map((d) => `### ${d.path}\n\n${d.content}`).join("\n\n")}`;

  return `You are authoring an in-app ConductorOne connector for the provider below, end to end, through the tenant MCP tools (\`mcp__c1dev__*\`). This is the in-app authoring flow: drafts, source upload, hosted build, draft test evidence, deploy, and activation handoff — not a repo flow.

## Readiness self-check (do this first)

Your first action must be a call to \`c1_connector_authoring_get_authoring_guide\`. If that tool does not exist or errors because the MCP server is not connected, reply with exactly \`READINESS_FAILED\` and stop — do not attempt any workaround.

## Provider brief

| | |
|---|---|
| Name | ${p.displayName} |
| Connector name | \`${p.name}\` |
| API documentation | ${p.docsUrl} (fetch and read it before writing source) |
| Auth scheme | ${p.auth.scheme} |

Configuration values for the connector instance:

| Config field | Value |
|---|---|
${credRows}

## Hard rules

1. Write the connector source files into a local directory named \`${scenario.sourceDirName}/\` in your home directory (\`~/${scenario.sourceDirName}/\`). The four required files are \`connector.ts\`, \`config-schema.json\`, \`runtime-schema.json\`, \`capabilities.json\`.
2. Maintain a handoff table at the arena FS path \`/shared/${runId}/handoff.json\`. After EVERY lifecycle step, update it with the IDs returned by that step. Shape:
   \`{"catalog_id":"","draft_id":"","revision_id":"","build_run_id":"","app_id":"","connector_id":"","test_run_id":"","deployment_instance_id":"","activation_epoch":""}\`
   Write it with: \`squire-tool call squire.fs.write '{"path":"/shared/${runId}/handoff.json","content":"<json>"}'\`
3. Follow the lifecycle in order: guide → draft → upload → finalize → build → poll → app → provision → configure → draft test → PASS evidence → deploy → mint approval → hand off activation → (after a human activates) force sync. Do not skip ahead; each step's stop-if gate must pass before the next.
4. Configure credentials BEFORE the draft test. An empty stringValue deletes a secret field.
5. After a FAIL evidence row, fix the source and re-run from the upload step with a FRESH test_run_id. Never re-mint an approval token on a failed test run.
6. Activation is human-only. After minting the approval token, present the activation_url in your final message and STOP. Do not redeem the token, do not call the rollback endpoint, do not force sync before observing REVISION_STATUS_ACTIVE.
7. Blocker protocol: after 2 failed fix cycles on the same error, stop and report the exact error text instead of guessing further.
8. Never invent data to make the run appear complete. Never log or paste secret values into files or messages beyond the single connector_service_update call that configures them.

${skillSection}

## Output contract

Your final message must state: the furthest lifecycle step completed, the activation_url (if reached), and any blockers with exact error text. The handoff.json file is the machine-read record — keep it current through your last step.`;
}
