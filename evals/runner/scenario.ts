// scenario.ts — scenario loader + validation (CXF-216 PR 1).
import {readFileSync} from "node:fs"

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

export interface Scenario {
  id: string
  name: string
  fixture: FixtureConfig
  seed: SeedConfig
  expected: ExpectedConfig
  skillBundle: SkillBundleConfig
  model: string
  reasoningEffort: "high" | "medium" | "low"
  requiredSourceFiles: string[]
  readinessTools: string[]
  handoffPath: string
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
  // scenario.id flows into arena-FS paths and the output filename — restrict
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

  if (!isRecord(data.skillBundle)) throw new Error("scenario field skillBundle missing or not an object")
  const mode = data.skillBundle.mode
  if (mode !== "none" && mode !== "guide-only" && mode !== "full") {
    throw new Error('scenario field skillBundle.mode must be "none", "guide-only", or "full"')
  }
  const skillBundle = {
    mode: mode as "none" | "guide-only" | "full",
    version: requireString(data.skillBundle, "version", "skillBundle"),
  }

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
  const handoffPath = requireString(data, "handoffPath", "scenario")
  if (!handoffPath.includes("<run-id>")) {
    throw new Error('scenario field handoffPath must contain the "<run-id>" placeholder')
  }
  // The runner derives the sanitized sibling path by replacing the
  // "handoff.json" suffix; a scenario with any other filename would make
  // that replace a no-op and overwrite the agent's original handoff.
  if (!handoffPath.endsWith("handoff.json")) {
    throw new Error('scenario field handoffPath must end with "handoff.json"')
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
    handoffPath,
  }
}
