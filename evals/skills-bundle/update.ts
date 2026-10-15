// Run from the repository root after bumping changed SKILL.md frontmatter versions.
import assert from "node:assert/strict"
import {execFileSync} from "node:child_process"
import {createHash} from "node:crypto"
import {readFileSync, writeFileSync} from "node:fs"
import {dirname, resolve} from "node:path"

const path = "evals/skills-bundle/bundle.json"
const bundle = JSON.parse(readFileSync(path, "utf8")) as {
  version: string
  skills: {name: string; version?: string; path: string; sha256?: string}[]
}

// Only the maintainer updater needs Git; the eval content-pin gate stays git-free.
let previousPaths: Set<string>
try {
  const previous = JSON.parse(execFileSync("git", ["show", `HEAD:${path}`], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]})) as {
    skills: {path: string}[]
  }
  previousPaths = new Set(previous.skills.map((skill) => resolve(dirname(path), skill.path)))
} catch {
  throw new Error("bundle:update: cannot read a valid committed manifest from Git HEAD; run in a checkout with evals/skills-bundle/bundle.json committed")
}
const firstPins: string[] = []

// Validate every skill before writing, so a rejected update leaves the manifest intact.
bundle.skills = bundle.skills.map((skill) => {
  assert.ok(typeof skill.version === "string" && /^\d+\.\d+\.\d+$/.test(skill.version), `${skill.name}: expected a numeric major.minor.patch manifest version`)
  const file = readFileSync(resolve(dirname(path), skill.path))
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(file.toString("utf8"))
  const version = frontmatter && /^version: (\d+\.\d+\.\d+)\r?$/m.exec(frontmatter[1])?.[1]
  assert.ok(version, `${skill.name}: expected a numeric major.minor.patch frontmatter version`)
  const sha256 = createHash("sha256").update(file).digest("hex")
  if (skill.sha256 === undefined) {
    const target = resolve(dirname(path), skill.path)
    assert.ok(!previousPaths.has(target), `${skill.name}: missing SHA-256 content pin for an existing skill; restore its recorded pin before updating`)
    assert.equal(version, skill.version, `${skill.name}: first pin requires matching manifest and frontmatter versions`)
    firstPins.push(skill.name)
  } else {
    assert.ok(typeof skill.sha256 === "string" && /^[0-9a-f]{64}$/.test(skill.sha256), `${skill.name}: malformed SHA-256 content pin`)
  }
  if (skill.sha256 !== undefined && (sha256 !== skill.sha256 || version !== skill.version)) {
    const previous = skill.version.split(".").map(Number)
    const next = version.split(".").map(Number)
    const difference = next.map((part, i) => part - previous[i]).find((part) => part !== 0)
    assert.ok(difference !== undefined && difference > 0, `${skill.name}: bump its frontmatter version before refreshing the content pin`)
  }
  return {...skill, version, sha256}
})

writeFileSync(path, JSON.stringify(bundle, null, 2) + "\n")
for (const name of firstPins) console.log(`${name}: first pin recorded`)
