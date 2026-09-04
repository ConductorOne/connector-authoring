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
const SKILLS = ["author-in-app-connector", "read-authoring-contract", "write-connector-source", "build-and-test", "deploy-and-activate", "design-access-model", "source-openapi-spec"]
const VERSION = "0.3.0"
// The plan's locked versions are intentionally non-uniform: the two new
// pre-1 skills ship at 0.1.0 while the funnel skills keep their versions.
const SKILL_VERSIONS: Record<string, string> = {
  "author-in-app-connector": "0.2.1",
  "read-authoring-contract": "0.2.0",
  "write-connector-source": "0.2.0",
  "build-and-test": "0.2.0",
  "deploy-and-activate": "0.2.0",
  "design-access-model": "0.1.0",
  "source-openapi-spec": "0.1.0",
}

function readBundle(): {version: string; skills: {name: string; path: string}[]} {
  return JSON.parse(readFileSync(BUNDLE, "utf8")) as {version: string; skills: {name: string; path: string}[]}
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
  for (const name of SKILLS) {
    const file = readFileSync(join("skills", name, "SKILL.md"), "utf8")
    const fm = parseFrontmatter(file)
    assert.equal(fm.name, name, `${name}: frontmatter name must equal the directory name`)
    assert.ok(fm.description, `${name}: frontmatter description missing`)
    assert.ok(fm.description.includes("Use when"), `${name}: description must carry the trigger sentence`)
    assert.ok(fm.description.includes("Do not use when"), `${name}: description must carry the anti-trigger sentence`)
    // The plan's locked versions are intentionally non-uniform (the two new
    // pre-1 skills ship at 0.1.0); each skill's frontmatter must match its
    // locked per-skill version.
    assert.equal(fm.version, SKILL_VERSIONS[name], `${name}: frontmatter version must equal the locked per-skill version`)
  }
})

test("(b) every bundle.json path resolves to an existing file", () => {
  const bundle = readBundle()
assert.equal(bundle.version, VERSION)
  assert.equal(bundle.skills.length, 7)
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
  assert.equal(full.skillBundle.version, "0.3.0")
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
    assert.equal(meta.skill_bundle_version, "0.3.0")
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})
