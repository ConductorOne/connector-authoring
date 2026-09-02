/**
 * Post-run collector: a sibling task in the eval env that snapshots tenant
 * state deterministically and returns it through the arena FS. Kept as a
 * task (not direct REST from the runner) so the env's self-auth credentials
 * never leave the env.
 *
 * The prompt pins the exact tool calls; the runner validates the output shape
 * and retries once on a malformed collection before declaring the run
 * collection-failed (never silently scored).
 */
import type { Collection } from "./scorer/types.ts";
import type { Scenario } from "./scorer/types.ts";

export function collectionPath(runId: string): string {
  return `/shared/${runId}/collection.json`;
}

export function sourceArchivePath(runId: string): string {
  return `/shared/${runId}/source.tar.b64`;
}

export function buildCollectorPrompt(opts: {
  runId: string;
  scenario: Scenario;
  handoff: Record<string, string> | null;
}): string {
  const { runId, scenario, handoff } = opts;
  const appId = handoff?.app_id ?? "";
  const connectorId = handoff?.connector_id ?? "";
  const catalogId = handoff?.catalog_id ?? "";
  const pendingRows = scenario.expectations?.memberships.pendingRows ?? [];

  return `You are a deterministic data collector for an eval run. Execute the steps below EXACTLY as written, using the mcp__c1dev__* tools directly. Do not improvise, do not explore, do not fix anything. Write two files to the arena FS, then stop.

Context: an agent authored a connector in this environment. handoff IDs (may be empty if the run ended early):
- catalog_id: ${catalogId || "(none)"}
- app_id: ${appId || "(none)"}
- connector_id: ${connectorId || "(none)"}

STEP 1 — archive the agent's source directory:
  cd ~ && tar czf - ${scenario.sourceDirName} 2>/dev/null | base64 -w0 > /tmp/source.b64
  squire-tool call squire.fs.write '{"path":"${sourceArchivePath(runId)}","content_base64":"<contents of /tmp/source.b64>"}'
  (If the directory does not exist, write the file with content_base64 of an empty tar: still write the file.)

STEP 2 — snapshot tenant state with these MCP tool calls (skip any whose IDs are empty; record nulls):
  a. c1_connector_service_get {"appId":"${appId}","id":"${connectorId}"} → record status.status and status.lastError.
  b. c1_connector_authoring_list_revision_summaries {"catalogId":"${catalogId}","pageSize":100} → record every revision's {revisionId, status, activationEpoch}.
  c. c1_app_resource_search_search_app_resources {"appId":"${appId}","resourceTypeId":"user","pageSize":1000} → count; also record for each of the fixture's null-email user IDs (${(scenario.expectations?.users.nullEmail ?? []).join(", ") || "none"}) whether the resource exists and has a login/profile value.
  d. c1_app_resource_search_search_app_resources {"appId":"${appId}","resourceTypeId":"group","pageSize":1000} → count.
  e. c1_app_resource_search_search_app_resources {"appId":"${appId}","resourceTypeId":"role","pageSize":1000} → count (0 or null if the connector declares no roles).
  f. c1_app_entitlement_search_service_search {"appId":"${appId}","pageSize":1000} → count.
  g. c1_app_entitlement_search_service_search_grants {"appId":"${appId}","pageSize":1000} → count; for every grant check the principal and entitlement ids are non-empty and resolve (count unresolved); ALSO check whether any grant corresponds to these pending membership rows (groupId:userId): ${pendingRows.join(", ") || "none"} — list the offending grant ids (expected: none).
  h. ID stability: record the sorted list of user resource IDs from step (c). Then call c1_connector_service_force_sync {"appId":"${appId}","connectorId":"${connectorId}"} ONLY IF step (a) showed SYNC_STATUS_DONE once already (i.e. the connector is activated); wait 30s, re-run step (c), and diff the two sorted ID lists (added/removed). If the connector was never activated, set idStability to null.

STEP 3 — write the collection:
  squire-tool call squire.fs.write with path "${collectionPath(runId)}" and content a JSON object of EXACTLY this shape (nulls where data was unavailable):
  {
    "connector": {"status": "...", "lastError": null},
    "revisions": [{"revisionId": "...", "status": "...", "activationEpoch": null}],
    "counts": {"users": 0, "groups": 0, "roles": 0, "entitlements": 0, "grants": 0},
    "grantWiring": {"checked": 0, "unresolvedPrincipal": 0, "unresolvedEntitlement": 0},
    "idStability": {"stable": true, "added": [], "removed": []},
    "userSample": [{"id": "u0007", "hasLogin": true}],
    "pendingRowGrants": []
  }

Then stop. Do not summarize, do not editorialize.`;
}

/** Validate a collection.json document; null when malformed. */
export function parseCollection(text: string): Collection | null {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof doc !== "object" || doc === null) return null;
  if (!("counts" in doc) || typeof doc.counts !== "object" || doc.counts === null) return null;
  const counts = doc.counts as Record<string, unknown>;
  const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

  const connector =
    "connector" in doc && typeof doc.connector === "object" && doc.connector !== null
      ? (doc.connector as Record<string, unknown>)
      : {};
  const revisions = "revisions" in doc && Array.isArray(doc.revisions) ? doc.revisions : [];
  const wiring =
    "grantWiring" in doc && typeof doc.grantWiring === "object" && doc.grantWiring !== null
      ? (doc.grantWiring as Record<string, unknown>)
      : null;
  const stability =
    "idStability" in doc && typeof doc.idStability === "object" && doc.idStability !== null
      ? (doc.idStability as Record<string, unknown>)
      : null;
  const sample = "userSample" in doc && Array.isArray(doc.userSample) ? doc.userSample : null;
  const pending = "pendingRowGrants" in doc && Array.isArray(doc.pendingRowGrants) ? doc.pendingRowGrants : [];

  return {
    connector: {
      status: typeof connector.status === "string" ? connector.status : null,
      lastError: typeof connector.lastError === "string" ? connector.lastError : null,
    },
    revisions: revisions
      .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
      .map((r) => ({
        revisionId: typeof r.revisionId === "string" ? r.revisionId : "",
        status: typeof r.status === "string" ? r.status : "",
        activationEpoch: typeof r.activationEpoch === "string" ? r.activationEpoch : null,
      })),
    counts: {
      users: numOrNull(counts.users),
      groups: numOrNull(counts.groups),
      roles: numOrNull(counts.roles),
      entitlements: numOrNull(counts.entitlements),
      grants: numOrNull(counts.grants),
    },
    grantWiring: wiring
      ? {
          checked: numOrNull(wiring.checked) ?? 0,
          unresolvedPrincipal: numOrNull(wiring.unresolvedPrincipal) ?? 0,
          unresolvedEntitlement: numOrNull(wiring.unresolvedEntitlement) ?? 0,
        }
      : null,
    idStability: stability
      ? {
          stable: stability.stable === true,
          added: Array.isArray(stability.added) ? stability.added.filter((x): x is string => typeof x === "string") : [],
          removed: Array.isArray(stability.removed) ? stability.removed.filter((x): x is string => typeof x === "string") : [],
        }
      : null,
    userSample: sample
      ? sample
          .filter((u): u is Record<string, unknown> => typeof u === "object" && u !== null)
          .map((u) => ({ id: typeof u.id === "string" ? u.id : "", hasLogin: u.hasLogin === true }))
      : null,
    pendingRowGrants: pending.filter((x): x is string => typeof x === "string"),
  };
}
