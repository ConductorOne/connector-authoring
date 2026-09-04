// scenario.ts — scenario loader + validation.
import {readFileSync} from "node:fs"
import {fileURLToPath} from "node:url"

export interface FixtureConfig {
  port: number
  baseUrl: string
  auth: "basic" | "bearer"
  openapiPath: string
  basicAuth: {username: string; password: string}
  bearerToken: string
}

export interface SeedConfig {
  users: number
  groups: number
  memberships: number
  nullTitleUsers: number
  unscopedSubset: number
  disabledUsers: number
}

export interface ExpectedConfig {
  users: number
  groups: number
  memberships: number
}

export interface SkillBundleConfig {
  mode: "none" | "guide-only" | "full"
  version: string
}

export interface ExpectedAccessModel {
  resource_types: {id: string; traits: string[]}[]
  entitlements: {slug: string}[]
  grants: {resource_type: string; entitlement: string; principal_type: string}[]
}

export interface ExpectedParkEvidence {
  spec_version_checked: string
  missing_paths: string[]
  vendor_doc: string
  revisit_trigger: string
}

export interface Scenario {
  id: string
  name: string
  fixture: FixtureConfig
  // kind is optional in the interface so the existing SCENARIO literals in
  // the test files compile unchanged; loadScenario always returns it
  // (default "funnel").
  kind?: "funnel" | "pre1"
  // Funnel-only fields are optional in the interface for the same reason;
  // loadScenario returns them for funnel and omits them for pre1.
  seed?: SeedConfig
  expected?: ExpectedConfig
  skillBundle: SkillBundleConfig
  model: string
  reasoningEffort: "high" | "medium" | "low"
  requiredSourceFiles?: string[]
  readinessTools?: string[]
  // Pre-1 fields (kind === "pre1" only).
  providerBrief?: string
  expectedDecision?: "proceed" | "park"
  expectedAccessModel?: ExpectedAccessModel
  expectedParkEvidence?: ExpectedParkEvidence
}

// Canonical record guard for the evals/runner package (no shared type-guard
// module exists; this is the one canonical definition, exported for reuse).
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function requireString(obj: Record<string, unknown>, key: string, where: string): string {
  const v = obj[key]
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`scenario field ${where}.${key} missing or not a non-empty string`)
  }
  return v
}

function requireNumber(obj: Record<string, unknown>, key: string, where: string): number {
  const v = obj[key]
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`scenario field ${where}.${key} missing or not a finite number`)
  }
  return v
}

function requireStringArray(obj: Record<string, unknown>, key: string, where: string): string[] {
  const v = obj[key]
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || x.length === 0)) {
    throw new Error(`scenario field ${where}.${key} missing or not a non-empty string array`)
  }
  return v as string[]
}

// Single source for skillBundle validation + the bundle-version drift check —
// shared by the funnel and pre-1 branches so the pin check cannot diverge.
function parseSkillBundle(data: Record<string, unknown>): SkillBundleConfig {
  if (!isRecord(data.skillBundle)) throw new Error("scenario field skillBundle missing or not an object")
  const mode = data.skillBundle.mode
  if (mode !== "none" && mode !== "guide-only" && mode !== "full") {
    throw new Error('scenario field skillBundle.mode must be "none", "guide-only", or "full"')
  }
  const skillBundle = {
    mode: mode as "none" | "guide-only" | "full",
    version: requireString(data.skillBundle, "version", "skillBundle"),
  }
  if (skillBundle.mode === "full") {
    // Fail fast when the scenario's bundle version drifts from the mounted
    // bundle: run records must never be stamped with a version that does not
    // match the skills actually mounted (bundle.json is the single source).
    // Resolve relative to this module so the check is not cwd-dependent, and
    // wrap read/parse errors like the scenario file's own.
    const bundlePath = fileURLToPath(new URL("../skills-bundle/bundle.json", import.meta.url))
    let bundleRaw: string
    try {
      bundleRaw = readFileSync(bundlePath, "utf8")
    } catch (err) {
      throw new Error(`cannot read skill bundle ${bundlePath}: ${(err as Error).message}`)
    }
    let bundle: {version?: unknown}
    try {
      bundle = JSON.parse(bundleRaw) as {version?: unknown}
    } catch (err) {
      throw new Error(`skill bundle ${bundlePath} is not valid JSON: ${(err as Error).message}`)
    }
    if (typeof bundle.version !== "string" || bundle.version !== skillBundle.version) {
      throw new Error(
        `scenario skillBundle.version ${skillBundle.version} does not match evals/skills-bundle/bundle.json version ${bundle.version}`,
      )
    }
  }
  return skillBundle
}

export function loadScenario(path: string): Scenario {
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch (err) {
    throw new Error(`cannot read scenario file ${path}: ${(err as Error).message}`)
  }
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch (err) {
    throw new Error(`scenario ${path} is not valid JSON: ${(err as Error).message}`)
  }
  if (!isRecord(data)) throw new Error(`scenario ${path} must be a JSON object`)

const id = requireString(data, "id", "scenario")
  // scenario.id flows into the output filename — restrict
  // to a safe charset (path traversal via a malicious scenario file).
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new Error(`scenario field scenario.id invalid: ${id} (must match [A-Za-z0-9._-]+)`)
  }
  const name = requireString(data, "name", "scenario")

  if (!isRecord(data.fixture)) throw new Error("scenario field fixture missing or not an object")
  const fixture = data.fixture
  const port = requireNumber(fixture, "port", "fixture")
  const baseUrl = requireString(fixture, "baseUrl", "fixture")
  const auth = fixture.auth
  if (auth !== "basic" && auth !== "bearer") {
    throw new Error('scenario field fixture.auth must be "basic" or "bearer"')
  }
  const openapiPath = requireString(fixture, "openapiPath", "fixture")
  if (!isRecord(fixture.basicAuth)) throw new Error("scenario field fixture.basicAuth missing or not an object")
  const basicAuth = {
    username: requireString(fixture.basicAuth, "username", "fixture.basicAuth"),
    password: requireString(fixture.basicAuth, "password", "fixture.basicAuth"),
  }
  const bearerToken = requireString(fixture, "bearerToken", "fixture")

  const kind = data.kind === undefined ? "funnel" : data.kind
  if (kind !== "funnel" && kind !== "pre1") {
    throw new Error('scenario field kind must be "funnel" or "pre1"')
  }

  if (kind === "funnel") {
    // Funnel validation — VERBATIM (same field checks, same error messages,
    // same order; funnel behavior is byte-identical).
    if (!isRecord(data.seed)) throw new Error("scenario field seed missing or not an object")
    const seed = {
      users: requireNumber(data.seed, "users", "seed"),
      groups: requireNumber(data.seed, "groups", "seed"),
      memberships: requireNumber(data.seed, "memberships", "seed"),
      nullTitleUsers: requireNumber(data.seed, "nullTitleUsers", "seed"),
      unscopedSubset: requireNumber(data.seed, "unscopedSubset", "seed"),
      disabledUsers: requireNumber(data.seed, "disabledUsers", "seed"),
    }

    if (!isRecord(data.expected)) throw new Error("scenario field expected missing or not an object")
    const expected = {
      users: requireNumber(data.expected, "users", "expected"),
      groups: requireNumber(data.expected, "groups", "expected"),
      memberships: requireNumber(data.expected, "memberships", "expected"),
    }

    const skillBundle = parseSkillBundle(data)
    const reasoningEffort = data.reasoningEffort
    if (reasoningEffort !== "high" && reasoningEffort !== "medium" && reasoningEffort !== "low") {
      throw new Error('scenario field reasoningEffort must be "high", "medium", or "low"')
    }

    const model = requireString(data, "model", "scenario")
    const requiredSourceFiles = requireStringArray(data, "requiredSourceFiles", "scenario")
    if (requiredSourceFiles.length !== 4) {
      throw new Error("scenario field requiredSourceFiles must have exactly 4 entries")
    }
    const readinessTools = requireStringArray(data, "readinessTools", "scenario")
    if (readinessTools.length !== 5) {
      throw new Error("scenario field readinessTools must have exactly 5 entries")
    }

    return {
      id,
      name,
      fixture: {port, baseUrl, auth, openapiPath, basicAuth, bearerToken},
      seed,
      expected,
      skillBundle,
      model,
      reasoningEffort: reasoningEffort as "high" | "medium" | "low",
      requiredSourceFiles,
      readinessTools,
      kind: "funnel",
    }
  }

  // --- pre1 branch ---
  const providerBrief = requireString(data, "providerBrief", "scenario")
  const expectedDecision = data.expectedDecision
  if (expectedDecision !== "proceed" && expectedDecision !== "park") {
    throw new Error('scenario field expectedDecision must be "proceed" or "park"')
  }
  const hasAccessModel = data.expectedAccessModel !== undefined
  const hasParkEvidence = data.expectedParkEvidence !== undefined
  if (hasAccessModel === hasParkEvidence) {
    throw new Error("scenario field expectedAccessModel/expectedParkEvidence: exactly one must be present for kind pre1")
  }
  for (const key of ["seed", "expected", "requiredSourceFiles"]) {
    if (data[key] !== undefined) {
      throw new Error(`scenario field ${key} is funnel-only and must be absent for kind pre1`)
    }
  }
  // readinessTools is optional for pre1: absent -> [], present tolerated and
  // validated as a string array.
  let readinessTools: string[] = []
  if (data.readinessTools !== undefined) {
    readinessTools = requireStringArray(data, "readinessTools", "scenario")
  }

  const skillBundle = parseSkillBundle(data)
  const reasoningEffort = data.reasoningEffort
  if (reasoningEffort !== "high" && reasoningEffort !== "medium" && reasoningEffort !== "low") {
    throw new Error('scenario field reasoningEffort must be "high", "medium", or "low"')
  }

  const model = requireString(data, "model", "scenario")

  // Validate the expected-shape halves (defensive: a malformed scenario must
  // fail at load time, not at score time).
  let expectedAccessModel: ExpectedAccessModel | undefined
  let expectedParkEvidence: ExpectedParkEvidence | undefined
  if (hasAccessModel) {
    const am = data.expectedAccessModel as Record<string, unknown>
    if (!isRecord(am)) throw new Error("scenario field expectedAccessModel missing or not an object")
    if (!Array.isArray(am.resource_types) || am.resource_types.length === 0) {
      throw new Error("scenario field expectedAccessModel.resource_types must be a non-empty array")
    }
    for (const rt of am.resource_types) {
      if (!isRecord(rt)) throw new Error("scenario field expectedAccessModel.resource_types entry must be an object")
      if (typeof rt.id !== "string" || rt.id.length === 0) {
        throw new Error("scenario field expectedAccessModel.resource_types entry id missing or not a non-empty string")
      }
      if (!Array.isArray(rt.traits) || rt.traits.length === 0 || rt.traits.some((t) => typeof t !== "string" || t.length === 0)) {
        throw new Error("scenario field expectedAccessModel.resource_types entry traits missing or not a non-empty string array")
      }
    }
    if (!Array.isArray(am.entitlements) || am.entitlements.length === 0) {
      throw new Error("scenario field expectedAccessModel.entitlements must be a non-empty array")
    }
    for (const ent of am.entitlements) {
      if (!isRecord(ent)) throw new Error("scenario field expectedAccessModel.entitlements entry must be an object")
      if (typeof ent.slug !== "string" || ent.slug.length === 0) {
        throw new Error("scenario field expectedAccessModel.entitlements entry slug missing or not a non-empty string")
      }
    }
    if (!Array.isArray(am.grants) || am.grants.length === 0) {
      throw new Error("scenario field expectedAccessModel.grants must be a non-empty array")
    }
    for (const g of am.grants) {
      if (!isRecord(g)) throw new Error("scenario field expectedAccessModel.grants entry must be an object")
      for (const key of ["resource_type", "entitlement", "principal_type"]) {
        if (typeof g[key] !== "string" || (g[key] as string).length === 0) {
          throw new Error(`scenario field expectedAccessModel.grants entry ${key} missing or not a non-empty string`)
        }
      }
    }
    expectedAccessModel = am as unknown as ExpectedAccessModel
  }
  if (hasParkEvidence) {
    const pe = data.expectedParkEvidence as Record<string, unknown>
    if (!isRecord(pe)) throw new Error("scenario field expectedParkEvidence missing or not an object")
    for (const key of ["spec_version_checked", "vendor_doc", "revisit_trigger"]) {
      if (typeof pe[key] !== "string" || (pe[key] as string).length === 0) {
        throw new Error(`scenario field expectedParkEvidence.${key} missing or not a non-empty string`)
      }
    }
    if (!Array.isArray(pe.missing_paths) || pe.missing_paths.length === 0 || pe.missing_paths.some((p) => typeof p !== "string" || p.length === 0)) {
      throw new Error("scenario field expectedParkEvidence.missing_paths missing or not a non-empty string array")
    }
    expectedParkEvidence = pe as unknown as ExpectedParkEvidence
  }

  return {
    id,
    name,
    fixture: {port, baseUrl, auth, openapiPath, basicAuth, bearerToken},
    skillBundle,
    model,
    reasoningEffort: reasoningEffort as "high" | "medium" | "low",
    readinessTools,
    kind: "pre1",
    providerBrief,
    expectedDecision: expectedDecision as "proceed" | "park",
    expectedAccessModel,
    expectedParkEvidence,
  }
}
