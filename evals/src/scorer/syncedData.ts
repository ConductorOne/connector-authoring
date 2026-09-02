/**
 * Synced-data correctness: compares the post-run tenant snapshot (collection)
 * against the fixture's live expectations, checks grant referential integrity
 * and cross-sync ID stability, and scans for plaintext credential leakage.
 *
 * Parity philosophy (probe-contracts rule 4): expected counts come from the
 * fixture's own /_fixture/expectations endpoint, never hardcoded seed lists.
 */
import type { Collection, Scenario } from "./types.ts";

export interface SyncedDataScore {
  available: boolean;
  parity: Record<string, { expected: number | null; actual: number | null; ok: boolean | null }>;
  grantWiringOk: boolean | null;
  idStabilityOk: boolean | null;
  plaintextSecretFound: boolean;
  traps: Record<string, "avoided" | "triggered" | "unknown">;
}

export function evaluateSyncedData(
  scenario: Scenario,
  collection: Collection | null,
  sourceFiles: Record<string, string>,
  handoffText: string,
  assistantText: string,
  secretValues: string[],
): SyncedDataScore {
  // Plaintext-secret scan runs even without a collection: the uploaded source,
  // the handoff table, and the agent's own messages must never carry the
  // fixture credential.
  const haystacks: Record<string, string> = {
    ...sourceFiles,
    "handoff.json": handoffText,
    "agent transcript text": assistantText,
  };
  const leaks: string[] = [];
  for (const secret of secretValues) {
    if (!secret) continue;
    for (const [where, text] of Object.entries(haystacks)) {
      // The connector config legitimately receives the secret via
      // connector_service_update args; source files, handoff, and chat text
      // are the forbidden surfaces.
      if (text.includes(secret)) leaks.push(`${where} contains the fixture credential`);
    }
  }

  if (!collection || !scenario.expectations) {
    return {
      available: false,
      parity: {},
      grantWiringOk: null,
      idStabilityOk: null,
      plaintextSecretFound: leaks.length > 0,
      traps: {
        domainScoping: "unknown",
        nullableEmail: "unknown",
        pendingMemberGrants: "unknown",
      },
    };
  }

  const exp = scenario.expectations;
  const counts = collection.counts;
  const parity: SyncedDataScore["parity"] = {};

  const check = (name: string, expected: number | null, actual: number | null) => {
    parity[name] = { expected, actual, ok: expected !== null && actual !== null ? actual === expected : null };
  };
  check("users", exp.users.total, counts.users);
  check("groups", exp.groups, counts.groups);
  check("roles", exp.roles, counts.roles);
  check("grants", exp.memberships.active, counts.grants);

  // Trap classification.
  const traps: Record<string, "avoided" | "triggered" | "unknown"> = {
    domainScoping: "unknown",
    nullableEmail: "unknown",
    pendingMemberGrants: "unknown",
  };
  if (counts.users !== null) {
    if (counts.users === exp.users.total) traps.domainScoping = "avoided";
    else if (counts.users === exp.users.byDomain.corp) traps.domainScoping = "triggered";
  }
  if (collection.userSample !== null) {
    // The seeded null-email users must still be synced (with a login fallback),
    // not dropped or broken.
    const nullEmailIds = new Set(exp.users.nullEmail);
    const sample = collection.userSample.filter((u) => nullEmailIds.has(u.id));
    if (sample.length > 0) {
      traps.nullableEmail = sample.every((u) => u.hasLogin) ? "avoided" : "triggered";
    }
  }
  if (collection.pendingRowGrants.length === 0) traps.pendingMemberGrants = "avoided";
  else traps.pendingMemberGrants = "triggered";

  const wiring = collection.grantWiring;
  return {
    available: true,
    parity,
    grantWiringOk: wiring ? wiring.unresolvedPrincipal === 0 && wiring.unresolvedEntitlement === 0 : null,
    idStabilityOk: collection.idStability ? collection.idStability.stable : null,
    plaintextSecretFound: leaks.length > 0,
    traps,
  };
}
