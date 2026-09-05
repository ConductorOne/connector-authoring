// skills_bundle.test.ts — unit smoke for the skill bundle (locked D10/E1).
// Covers: frontmatter contract of the five SKILL.md files, bundle.json path
// resolution, section markers + line bound, the full-mode scenario parse,
// and the CLI end-to-end record meta for the full-mode Tier-0 run.
import {test} from "node:test"
import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {promisify} from "node:util"
import {existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join, resolve, sep} from "node:path"
import {loadScenario} from "./scenario.ts"

const execFileAsync = promisify(execFile)
const RUN = "evals/runner/run.ts"
const BUNDLE = "evals/skills-bundle/bundle.json"
const SKILLS = ["author-in-app-connector", "read-authoring-contract", "write-connector-source", "build-and-test", "deploy-and-activate", "design-access-model", "source-openapi-spec", "verify-connector-output", "update-and-rollback", "diagnose-authoring-failure"]
const VERSION = "0.4.0"

function readBundle(): {version: string; skills: {name: string; version: string; path: string}[]} {
  return JSON.parse(readFileSync(BUNDLE, "utf8")) as {version: string; skills: {name: string; version: string; path: string}[]}
}

// The repo has no YAML dependency: parse the frontmatter block (between the
// first two `---` lines) line by line.
function parseFrontmatter(file: string): Record<string, string> {
  const parts = file.split("---")
  assert.ok(parts.length >= 3, "frontmatter delimiters missing")
  const out: Record<string, string> = {}
  for (const line of parts[1].split("\n")) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line)
    if (m) out[m[1]] = m[2]
  }
  return out
}

test("(a) each SKILL.md exists with the locked frontmatter contract", () => {
  const bundle = readBundle()
  const bundleVersions: Record<string, string> = Object.fromEntries(bundle.skills.map((s) => [s.name, s.version]))
  for (const name of SKILLS) {
    const file = readFileSync(join("skills", name, "SKILL.md"), "utf8")
    const fm = parseFrontmatter(file)
    assert.equal(fm.name, name, `${name}: frontmatter name must equal the directory name`)
    assert.ok(fm.description, `${name}: frontmatter description missing`)
    assert.ok(fm.description.includes("Use when"), `${name}: description must carry the trigger sentence`)
    assert.ok(fm.description.includes("Do not use when"), `${name}: description must carry the anti-trigger sentence`)
    // bundle.json is the single source for per-skill versions: every bundled
    // skill must carry a version entry, and the SKILL.md frontmatter must
    // match it — bumping a skill body without bumping its bundle entry fails.
    const entryVersion = bundleVersions[name]
    assert.ok(entryVersion !== undefined, `${name}: no version entry in bundle.json`)
    assert.equal(fm.version, entryVersion, `${name}: frontmatter version must equal the bundle.json entry version`)
  }
})

test("(b) every bundle.json path resolves to an existing file", () => {
  const bundle = readBundle()
  assert.equal(bundle.version, VERSION)
  assert.equal(bundle.skills.length, 10)
  assert.deepEqual(bundle.skills.map((s) => s.name), SKILLS)
  const skillsRoot = resolve("skills")
  for (const skill of bundle.skills) {
    const target = resolve("evals/skills-bundle", skill.path)
    assert.ok(target.includes(`/${skill.name}/SKILL.md`), `bundle entry ${skill.name} must point at its own SKILL.md: ${skill.path}`)
    assert.ok(target.startsWith(skillsRoot + sep), `bundle path escapes the skills root: ${skill.path}`)
    assert.ok(existsSync(target), `bundle path does not resolve: ${skill.path}`)
    assert.ok(readFileSync(target, "utf8").length > 0, `bundle path is empty: ${skill.path}`)
  }
})

// Locked content literals per skill (plan B1c/B3f/C1c/C3c string checks).
// The security negations are asserted too: a regression stripping the
// never-redeem / never-force_sync / never-list_revision_summaries
// instructions while keeping the marker literals must fail the gate.
const SKILL_LITERALS: Record<string, string[]> = {
  "author-in-app-connector": [
    "skipped_human_boundary",
    "catalog_id", "draft_id", "upload_id", "run_id", "revision_id",
    "app_id", "connector_id", "test_run_id", "deployment_instance_id", "activation_url",
    "Do not redeem the approval token",
    "write-connector-source",
  ],
  "read-authoring-contract": [
    "list_sdk_types_versions", "get_sdk_types", "list_authored_catalog_entries", "list_drafts",
    "runtime_pin_matched", "default_tag",
  ],
  "build-and-test": [
    "required_source_files", "upload_targets", "required_headers", "RUN_STATE_SUCCEEDED", "test_run_id",
  ],
  "deploy-and-activate": [
    "deployment_instance_id", "activation_url", "REVISION_STATUS_ACTIVE", "activation_epoch",
    "SYNC_STATUS_DONE", "skipped_human_boundary",
    "Do not redeem the approval token",
    "Do not call `c1_connector_service_force_sync` during the funnel run",
    "Do not call `c1_connector_authoring_list_revision_summaries` during the funnel run",
  ],
  "write-connector-source": [
    "Do not call fetch",
    "is_secret: true",
    "Do not use the secret: spelling",
    "WithExternalID is DEPRECATED",
    "Do not write plaintext secrets into",
    "Do not paste JSON Schema into",
    "transports:",
    "connector.js",
    "CAPABILITY_SYNC",
    "baton-axiomatic capabilities",
    "ticketing.enabled",
    "account_id",
    "user.title",
    "totalPath",
    "newUserResource",
    "user.id",
    "config(\"base-url\")",
  ],
  "design-access-model": [
    "TRAIT_USER",
    "TRAIT_GROUP",
    "WithExternalID is DEPRECATED",
    "because the API lacks",
    "source-openapi-spec",
    "write-connector-source",
    "id_compatibility",
    "provisioning",
  ],
  "source-openapi-spec": [
    "262144",
    "1048576",
    "wc -c",
    "missing_paths",
    "revisit_trigger",
    "vendor_doc",
    "Parking with evidence",
    "authority ladder",
  ],
  "verify-connector-output": [
    "never invent data to make a demo appear complete",
    "SYNC_STATUS_DONE",
    "SYNC_STATUS_RUNNING",
    "terminal status after ~10 polls, STOP and report",
    "data-anomaly auto-pause",
    "significant drop in sync data",
    "sync_disabled",
    "every grant principal references an emitted resource",
    "entitlement ID references an emitted entitlement",
    "ID stability",
    "/admin/connector/",
  ],
  "update-and-rollback": [
    "serve image does not match the revision-pinned runtime image",
    "/api/v1/connector-authoring/rollbacks",
    "target_revision_id",
    "approval_token_id",
    "activation_epoch",
    "image digest",
    "Do not redeem the approval token",
    "Do not clear runtime fields, call the provisioner directly, or mutate the",
    "evidence is unsatisfied",
    "if no ACTIVE row after ~10 polls, STOP and report",
    "no terminal status after ~10 polls, STOP and report",
    "SYNC_STATUS_ERROR",
    "SYNC_STATUS_DISABLED",
    "Do not print, log, or otherwise expose the OWNER bearer token value",
  ],
  "diagnose-authoring-failure": [
    "262144 byte compile limit",
    "1048576 byte limit",
    "is_secret",
    "credential re-entry required",
    "missing type",
    "unregistered transport",
    "ticketing.enabled must be true when ticketing is configured",
    "activation evidence is unsatisfied",
    "Invalid token provided",
    "ConnectionOK",
    "HostCallOK",
    "Poll with backoff",
    "row after ~10 polls, stop and report",
    "c1_connector_service_get",
    "status.lastError",
  ],
}

test("(c) each SKILL.md carries the locked section markers, content literals, ASCII-only bodies, and stays <= 200 lines", () => {
  for (const name of SKILLS) {
    const file = readFileSync(join("skills", name, "SKILL.md"), "utf8")
    for (const marker of ["## Exit criteria", "## Anti-patterns", "## Blocker protocol"]) {
      assert.ok(file.includes(marker), `${name}: missing section marker ${marker}`)
    }
    for (const literal of SKILL_LITERALS[name]) {
      assert.ok(file.includes(literal), `${name}: missing locked literal ${literal}`)
    }
    assert.ok(/^[\x00-\x7F]*$/.test(file), `${name}: body must be ASCII-only (locked body contract)`)
    assert.ok(file.split("\n").length <= 200, `${name}: exceeds the 200-line bound`)
  }
})

test("(d) the full-mode scenario parses with mode full and the two pinned scenarios keep their locked modes", () => {
  const full = loadScenario("evals/scenarios/tier1-directory-full.json")
  assert.equal(full.skillBundle.mode, "full")
  assert.equal(full.skillBundle.version, "0.4.0")
  assert.equal(full.id, "tier1-directory-full")
  const none = loadScenario("evals/scenarios/tier1-directory.json")
  assert.equal(none.skillBundle.mode, "none")
  const guideOnly = loadScenario("evals/scenarios/tier1-directory-guide-only.json")
  assert.equal(guideOnly.skillBundle.mode, "guide-only")
})

test("(d2) a full-mode scenario pinning a version other than bundle.json's throws", () => {
  const dir = mkdtempSync(join(tmpdir(), "skills-bundle-"))
  try {
    const scenario = JSON.parse(readFileSync("evals/scenarios/tier1-directory-full.json", "utf8")) as Record<string, unknown>
    scenario.skillBundle = {...(scenario.skillBundle as Record<string, unknown>), version: "9.9.9"}
    const bad = join(dir, "tier1-directory-full-bad.json")
    writeFileSync(bad, JSON.stringify(scenario))
    assert.throws(() => loadScenario(bad), /does not match/)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("(e) CLI end-to-end: full-mode Tier-0 run exits 0 and the record meta carries the bundle mode", async () => {
  const dir = mkdtempSync(join(tmpdir(), "skills-bundle-"))
  try {
    let code: number
    let stdout: string
    let stderr: string
    try {
      const res = await execFileAsync(
        "node",
        ["--experimental-strip-types", RUN, "--scenario", "evals/scenarios/tier1-directory-full.json", "--driver", "tier0", "--out", dir],
        {cwd: process.cwd(), timeout: 120_000},
      )
      code = 0
      stdout = res.stdout
      stderr = res.stderr
    } catch (err) {
      const e = err as {code?: number; stdout?: string; stderr?: string}
      code = e.code ?? 1
      stdout = e.stdout ?? ""
      stderr = e.stderr ?? ""
    }
    assert.equal(code, 0, `run.ts exited ${code}; stderr=${stderr}`)
    assert.ok(stdout.includes("record:"), `expected a record line, got stdout=${stdout}`)
    const records = readdirSync(dir).filter((f) => f.endsWith(".jsonl"))
    assert.equal(records.length, 1, `expected exactly one record, got ${records.join(", ")}`)
    const lines = readFileSync(join(dir, records[0]), "utf8").trim().split("\n")
    const meta = JSON.parse(lines[0]) as Record<string, unknown>
    assert.equal(meta.skill_bundle_mode, "full")
    assert.equal(meta.skill_bundle_version, "0.4.0")
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("(f) every skill ships a non-empty SOURCES.md naming its pinned sources", () => {
  const skillsRoot = resolve("skills")
  for (const name of SKILLS) {
    const sourcesPath = join(skillsRoot, name, "SOURCES.md")
    assert.ok(existsSync(sourcesPath), `missing SOURCES.md: ${name}`)
    const content = readFileSync(sourcesPath, "utf8")
    assert.ok(content.length > 0, `empty SOURCES.md: ${name}`)
  }
  // The three new skills must name the c1 pin (decision 5: nothing written
  // from model memory) so a dropped or truncated pin fails the gate.
  const c1Pin = "2e5f53eb441a93087d9754085ca17a5061e125ea"
  for (const name of ["verify-connector-output", "update-and-rollback", "diagnose-authoring-failure"]) {
    const content = readFileSync(join(skillsRoot, name, "SOURCES.md"), "utf8")
    assert.ok(content.includes(c1Pin), `${name}: SOURCES.md does not name the c1 pin`)
  }
})
