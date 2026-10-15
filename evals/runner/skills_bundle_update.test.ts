import {test} from "node:test"
import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {createHash} from "node:crypto"
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join, resolve} from "node:path"

const UPDATE = resolve("evals/skills-bundle/update.ts")
const hash = (file: string) => createHash("sha256").update(file).digest("hex")
const original = (name: string) => `---\nname: ${name}\nversion: 1.2.3\n---\n\nOriginal body.\n`

function withBundle(check: (dir: string, manifest: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "bundle-update-"))
  try {
    mkdirSync(join(dir, "evals/skills-bundle"), {recursive: true})
    const skills = ["first", "second"].map((name) => {
      mkdirSync(join(dir, "skills", name), {recursive: true})
      writeFileSync(join(dir, "skills", name, "SKILL.md"), original(name))
      return {name, version: "1.2.3", path: `../../skills/${name}/SKILL.md`, sha256: hash(original(name))}
    })
    const manifest = join(dir, "evals/skills-bundle/bundle.json")
    writeFileSync(manifest, JSON.stringify({version: "1.0.0", skills}, null, 2) + "\n")
    check(dir, manifest)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
}

function update(dir: string) {
  return spawnSync(process.execPath, ["--experimental-strip-types", UPDATE], {cwd: dir, encoding: "utf8"})
}

test("bundle updater leaves unchanged versions and pins intact", () => {
  withBundle((dir, manifest) => {
    const before = readFileSync(manifest, "utf8")
    const result = update(dir)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(manifest, "utf8"), before)
  })
})

for (const version of ["1.2.3", "1.2.2", "1.1.9", "0.9.9"]) {
  test(`bundle updater rejects body edits with non-increasing version ${version}`, () => {
    withBundle((dir, manifest) => {
      const before = readFileSync(manifest, "utf8")
      writeFileSync(join(dir, "skills/first/SKILL.md"), original("first").replace("1.2.3", version) + "Body edit.\n")
      const result = update(dir)
      assert.equal(result.status, 1, result.stderr)
      assert.match(result.stderr, /first: bump its frontmatter version/)
      assert.equal(readFileSync(manifest, "utf8"), before)
    })
  })
}

for (const version of ["1.2.4", "1.3.0", "2.0.0"]) {
  test(`bundle updater refreshes the version and whole-file pin together for ${version}`, () => {
    withBundle((dir, manifest) => {
      const file = original("first").replace("1.2.3", version) + "Body edit.\n"
      const skillPath = join(dir, "skills/first/SKILL.md")
      writeFileSync(skillPath, file)
      const before = JSON.parse(readFileSync(manifest, "utf8"))
      const result = update(dir)
      assert.equal(result.status, 0, result.stderr)
      const after = JSON.parse(readFileSync(manifest, "utf8"))
      assert.equal(after.version, before.version)
      assert.deepEqual(after.skills[0], {...before.skills[0], version, sha256: hash(file)})
      assert.deepEqual(after.skills[1], before.skills[1])
      assert.equal(readFileSync(skillPath, "utf8"), file)
    })
  })
}

test("bundle updater validates all skills before writing any updates", () => {
  withBundle((dir, manifest) => {
    const before = readFileSync(manifest, "utf8")
    writeFileSync(join(dir, "skills/first/SKILL.md"), original("first").replace("1.2.3", "1.2.4"))
    writeFileSync(join(dir, "skills/second/SKILL.md"), original("second") + "Unversioned edit.\n")
    const result = update(dir)
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /second: bump its frontmatter version/)
    assert.equal(readFileSync(manifest, "utf8"), before)
  })
})

test("bundle updater refuses missing or malformed frontmatter versions", () => {
  withBundle((dir, manifest) => {
    const before = readFileSync(manifest, "utf8")
    for (const file of ["No frontmatter.\n", original("first").replace("1.2.3", "latest")]) {
      writeFileSync(join(dir, "skills/first/SKILL.md"), file)
      const result = update(dir)
      assert.equal(result.status, 1, result.stderr)
      assert.match(result.stderr, /expected a numeric major.minor.patch/)
      assert.equal(readFileSync(manifest, "utf8"), before)
    }
  })
})
