// skills_bundle.test.ts — unit smoke for the skill bundle (locked D10/E1).
// Covers: frontmatter contract and content pins of the ten SKILL.md files,
// bundle.json path resolution, section markers + line bound, the full-mode scenario parse,
// and the CLI end-to-end record meta for the full-mode Tier-0 run.
import {test} from "node:test"
import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {promisify} from "node:util"
import {createHash} from "node:crypto"
import {existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join, resolve, sep} from "node:path"
import {loadScenario} from "./scenario.ts"

const execFileAsync = promisify(execFile)
const RUN = "evals/runner/run.ts"
const BUNDLE = "evals/skills-bundle/bundle.json"
const SKILLS = ["author-in-app-connector", "read-authoring-contract", "write-connector-source", "build-and-test", "deploy-and-activate", "design-access-model", "source-openapi-spec", "verify-connector-output", "update-and-rollback", "diagnose-authoring-failure"]
const VERSION = "0.12.11"

function readBundle(): {version: string; skills: {name: string; version: string; path: string; sha256: string}[]} {
  return JSON.parse(readFileSync(BUNDLE, "utf8")) as {version: string; skills: {name: string; version: string; path: string; sha256: string}[]}
}

function assertContentPin(skill: {name: string; sha256: string}, file: Buffer): void {
  assert.match(skill.sha256 ?? "", /^[0-9a-f]{64}$/, `${skill.name}: missing or malformed SHA-256 content pin`)
  assert.equal(
    createHash("sha256").update(file).digest("hex"),
    skill.sha256,
    `${skill.name}: SKILL.md content changed; bump its frontmatter version and run npm run bundle:update`,
  )
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
    // match it. Content drift is checked separately below.
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

test("(b2) every SKILL.md matches its whole-file SHA-256 content pin", () => {
  for (const skill of readBundle().skills) {
    assertContentPin(skill, readFileSync(resolve("evals/skills-bundle", skill.path)))
  }
})

test("(b3) content pins reject body-only edits, frontmatter edits, and missing or malformed pins", () => {
  const skill = readBundle().skills[0]
  const file = readFileSync(resolve("evals/skills-bundle", skill.path))
  assert.throws(() => assertContentPin(skill, Buffer.concat([file, Buffer.from("\nUnversioned body edit.\n")])), /content changed/)
  const changedFrontmatter = file.toString("utf8").replace(`version: ${skill.version}`, "version: 99.0.0")
  assert.notEqual(changedFrontmatter, file.toString("utf8"))
  assert.throws(() => assertContentPin(skill, Buffer.from(changedFrontmatter)), /content changed/)
  for (const sha256 of ["", "not-a-hash", skill.sha256.toUpperCase()]) {
    assert.throws(() => assertContentPin({...skill, sha256}, file), /missing or malformed/)
  }
})

// Required content literals per skill.
// Preserve the human-only activation boundary and the single post-activation
// verification sync; keeping marker literals without these rules must fail.
const SKILL_LITERALS: Record<string, string[]> = {
  "author-in-app-connector": [
    "catalog_id", "draft_id", "upload_id", "run_id", "revision_id",
    "app_id", "connector_id", "test_run_id", "deployment_instance_id", "activation_url",
    "Do not redeem the approval token",
    "Do not call `force_sync` before activation or repeat the post-activation verification sync",
    "owns subsequent syncs",
    "write-connector-source",
    "minimal four-file skeleton",
    "Declare exactly one",
    "after the first green draft test",
    "Expand loop",
    "hosted sessions use the storage-to-draft source transfer",
    "External/BYO path",
    "`upload_id` is N/A",
    "| post-activation verification | `verify-connector-output` |",
    "| update / rollback of an active connector | `update-and-rollback` |",
    "| failure diagnosis (any stage) | `diagnose-authoring-failure` |",
    'transport_judge_verdict == "accepted"',
  ],
  "read-authoring-contract": [
    "list_sdk_types_versions", "get_sdk_types", "list_authored_catalog_entries", "list_drafts",
    "runtime_pin_matched", "default_tag",
  ],
  "build-and-test": [
    "required_source_files", "upload_targets", "required_headers", "RUN_STATE_SUCCEEDED", "test_run_id",
    'transport_judge_verdict == "accepted"',
    "in hosted sessions, use the storage-to-draft source transfer",
    "External/BYO path",
    "external upload has `upload_id`",
  ],
  "deploy-and-activate": [
    "deployment_instance_id", "activation_url", "REVISION_STATUS_ACTIVE", "activation_epoch",
    "SYNC_STATUS_DONE",
    "Do not redeem the approval token",
    "Do not force-sync before activation or repeat the post-activation verification sync",
    "exactly once to verify this activation",
    "human/operator owns subsequent syncs",
    "Do not call `c1_connector_authoring_list_revision_summaries` before the OWNER activates",
    'transport_judge_verdict == "accepted"',
    "Correct the verdict's cause; do not just re-mint",
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
    "the build rejects any other shape",
    "Metadata only - it grants nothing at runtime",
    "not a build requirement and the hosted runtime does not read it",
    "reviewed operations declarations are invalid",
    "not read by the runtime",
    "strictly validated metadata",
    "ticketing.enabled",
    "account_id",
    "user.title",
    "totalPath",
    "itemsPath",
    "newUserResource",
    "user.id",
    "http.v2",
    "Offset pagination requires a stopping condition",
    "config(\"base-url\")",
    "minimal four-file skeleton",
    "exactly one projection",
    "until the first green draft test",
    "re-review changed inputs, rebuild, and retest",
    "copy only",
    "its user slice for the one-projection first draft",
    "hand-author the single-user block below",
    "these are not the raw OpenAPI document",
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
    "12 MiB (12582912 bytes) per file",
    "not embedded whole",
    "fetch-URL and digest provenance",
    "DIRECT tool. It is unavailable",
    "automatically staged to file storage",
    "never through the",
    "storage-to-draft source transfer",
    "out-of-band source upload",
    "4 MiB",
    "model-dependent",
    "openapi.full.json",
    "reproducible",
    "$ref",
    "spec_budget_bytes",
    "denied before staging",
    "arrives inline rather than staged",
    "roughly three tool steps",
    "at most 8 MiB",
    "digest-bound `runtime-manifest.json`",
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
    "do not trigger another sync here",
    "report ID stability as PENDING",
    "Do not call `c1_connector_service_force_sync` here",
    "subsequent syncs belong to the human/operator",
    "/admin/connector/",
    "renders the authored",
  ],
  "update-and-rollback": [
    "serve image does not match the revision-pinned runtime image",
    "REVISION_STATUS_PREVIOUSLY_ACTIVE",
    "activation_url",
    "verify-connector-output",
    "activation_epoch",
    "image digest",
    "Do not redeem the approval token",
    "Do not clear runtime fields, call the provisioner directly, or mutate the",
    "evidence is unsatisfied",
    'transport_judge_verdict == "accepted"',
    "Correct the verdict's cause; do not just re-mint",
    "If no ACTIVE row after ~10 polls, STOP and report",
    "no terminal status after ~10 polls, STOP and report",
    "SYNC_STATUS_ERROR",
    "SYNC_STATUS_DISABLED",
    "Do not force-sync before activation or repeat the post-activation verification sync",
    "human/operator owns subsequent syncs",
    "Never read or handle OWNER credentials",
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
    'transport_judge_verdict == "accepted"',
    "correct the verdict's cause; do not just re-mint",
    "Nonempty declared projections have full coverage",
    "until a new accepted PASS row binds the revision",
    "Invalid token provided",
    "ConnectionOK",
    "HostCallOK",
    "wait for the draft test as build-and-test",
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

test("(c2) rollback preserves the human-only handoff boundary", () => {
  const file = readFileSync("skills/update-and-rollback/SKILL.md", "utf8")
  const rollback = file.split("## Rollback")[1]?.split("## Exit criteria")[0]
  assert.ok(rollback, "missing rollback section")
  for (const sentinel of ["c1_connector_authoring_mint_approval_token", "activation_url", "HARD STOP", "human tenant OWNER", "verify-connector-output"]) {
    assert.ok(rollback.includes(sentinel), `rollback: missing boundary sentinel ${sentinel}`)
  }
  for (const forbidden of ["/api/v1/connector-authoring/rollbacks", "OWNER bearer token"]) {
    assert.ok(!file.includes(forbidden), `update-and-rollback: forbidden agent execution instruction ${forbidden}`)
  }
})

test("(c3) orchestrator and deployment keep raw IDs out of chat and handoff links action-only", () => {
  for (const name of ["author-in-app-connector", "deploy-and-activate"]) {
    const file = readFileSync(join("skills", name, "SKILL.md"), "utf8")
    const prose = file.replace(/\s+/g, " ")
    for (const literal of [
      "Keep IDs in tool calls, not chat",
      "Refer to objects by display name with a markdown link when available, not by raw ID",
      "Report progress and status in prose",
      "Use tables only for user-facing data",
      "Show a handoff link only when a human must act now",
      "`Configure credentials` while credentials are unsaved",
      "`Review revision` while activation is pending",
      "Never show a handoff link merely for navigation",
      "single trailing line at the very end of the output, after all prose and tables",
      "never inline or inside a table",
      "Never re-print activation or review URLs after activation",
      "no tenant/MCP tool calls after mint before activation, no redemption",
      "Host-required file/terminal writes (the machine handoff artifact and run completion) are excepted",
    ]) {
      assert.ok(prose.includes(literal), `${name}: missing communication rule ${literal}`)
    }
    for (const forbidden of ["handoff table", "all 10 handoff fields", "except the handoff write", "no tool calls after mint", "make no tool call after mint"]) {
      assert.ok(!prose.includes(forbidden), `${name}: obsolete handoff instruction ${forbidden}`)
    }
    assert.ok(prose.includes("per Session communication"), `${name}: activation handoff must use the link rules`)
  }
})

test("(c4) every stage skill stops on revision-line FAILs or recurring error classes and reads staged declarations", () => {
  const names = readdirSync("skills").filter(name => existsSync(join("skills", name, "SKILL.md")))
  assert.deepEqual(names.sort(), [...SKILLS].sort(), "every stage skill must be included in the bundle contract")
  const protocols = new Set<string>()
  for (const name of names) {
    const file = readFileSync(join("skills", name, "SKILL.md"), "utf8")
    const section = file.split("## Blocker protocol")[1]?.split("\n## ")[0]
    assert.ok(section, `${name}: missing blocker protocol`)
    protocols.add(section)
    const protocol = section.replace(/\s+/g, " ")
    for (const literal of [
      "one revision line (a draft and its successive source/build revisions)",
      "stop after 3 consecutive FAILs",
      "Only a verified PASS ends that FAIL streak",
      "stop as soon as any error class recurs, even when the text changes",
      "Classify by underlying cause, not message text",
      "the same field failing extraction with rephrased messages is one class",
      "an auth failure and a schema failure are different classes",
      "Symptom patches, re-uploads, fresh run/revision IDs, and stage changes do not reset tracking",
      "abandoning the draft and creating a fresh one does not reset tracking for the same underlying failure",
      "Before any fix, grep the staged SDK declarations (including `runtime.d.ts`) for every field a diagnostic names",
      "read its type and surrounding contract",
      "If unavailable or ambiguous, stop rather than guess",
      "report the error class, exact latest error text, failed attempts, declaration evidence, and blocker",
      "do not retry or patch past it",
    ]) {
      assert.ok(protocol.includes(literal), `${name}: missing blocker rule ${literal}`)
    }
    for (const forbidden of ["after 2 failed", "same error remains unchanged", "cycles on the same error"]) {
      assert.ok(!file.replace(/\s+/g, " ").includes(forbidden), `${name}: obsolete per-error blocker rule ${forbidden}`)
    }
  }
  assert.equal(protocols.size, 1, "all stage skills must carry a byte-identical blocker protocol")
})

test("(c5) draft-test FAIL reading forbids silent row filtering or coverage weakening", () => {
  for (const name of ["build-and-test", "diagnose-authoring-failure"]) {
    const file = readFileSync(join("skills", name, "SKILL.md"), "utf8")
    const reading = file.split("## Draft-test FAIL reading")[1]?.split("\n## ")[0]?.replace(/\s+/g, " ")
    assert.ok(reading, `${name}: missing draft-test FAIL reading`)
    for (const literal of [
      "Do not silently filter out rows, drop declared projections, or weaken coverage",
      "fix the mapping or report the blocker",
      "Blocker protocol",
    ]) {
      assert.ok(reading.includes(literal), `${name}: missing FAIL-reading rule ${literal}`)
    }
  }
})

test("(d) the full-mode scenario parses with mode full and the two pinned scenarios keep their locked modes", () => {
  const full = loadScenario("evals/scenarios/tier1-directory-full.json")
  assert.equal(full.skillBundle.mode, "full")
  assert.equal(full.skillBundle.version, "0.12.11")
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
    assert.equal(meta.skill_bundle_version, "0.12.11")
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("(f) every skill's SOURCES.md references in-repo content by resolvable relative path without self-SHA or branch pins", () => {
  const skillsRoot = resolve("skills")
  for (const name of SKILLS) {
    const sourcesPath = join(skillsRoot, name, "SOURCES.md")
    assert.ok(existsSync(sourcesPath), `missing SOURCES.md: ${name}`)
    const content = readFileSync(sourcesPath, "utf8")
    assert.ok(content.length > 0, `empty SOURCES.md: ${name}`)
    // Relative paths are the canonical in-repo reference; no immutable-release row is required.
    // Release tags exist for declaration consumers, not for skill provenance.
    // Self-SHA pins are stale by construction; branch pins are mutable.
    assert.doesNotMatch(content, /connector-authoring\/tree\/[0-9a-f]{7,40}\b/, `${name}: SOURCES.md contains a self-SHA pin`)
    assert.doesNotMatch(content, /connector-authoring\/tree\/main\b/, `${name}: SOURCES.md contains a mutable branch pin`)
    const relativePaths = [...content.matchAll(/\.\.\/\.\.\/[^\s`),|]+/g)]
    assert.ok(relativePaths.length > 0, `${name}: SOURCES.md does not reference in-repo content by relative path`)
    for (const [relativePath] of relativePaths) {
      const path = relativePath.replace(/[^/]*[*?{\[].*$/, "")
      assert.ok(existsSync(resolve(skillsRoot, name, path)), `${name}: SOURCES.md path does not resolve: ${relativePath}`)
    }
  }
})
