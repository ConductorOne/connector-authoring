// Run from the repository root after bumping changed SKILL.md frontmatter versions.
import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {readFileSync, writeFileSync} from "node:fs"
import {dirname, resolve} from "node:path"

const path = "evals/skills-bundle/bundle.json"
const bundle = JSON.parse(readFileSync(path, "utf8")) as {
  version: string
  skills: {name: string; version: string; path: string; sha256: string}[]
}

// Validate every skill before writing, so a rejected update leaves the manifest intact.
bundle.skills = bundle.skills.map((skill) => {
  const file = readFileSync(resolve(dirname(path), skill.path))
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(file.toString("utf8"))
  const version = frontmatter && /^version: (\d+\.\d+\.\d+)\r?$/m.exec(frontmatter[1])?.[1]
  assert.ok(version, `${skill.name}: expected a numeric major.minor.patch frontmatter version`)
  const sha256 = createHash("sha256").update(file).digest("hex")
  if (sha256 !== skill.sha256 || version !== skill.version) {
    const previous = skill.version.split(".").map(Number)
    const next = version.split(".").map(Number)
    const difference = next.map((part, i) => part - previous[i]).find((part) => part !== 0)
    assert.ok(difference !== undefined && difference > 0, `${skill.name}: bump its frontmatter version before refreshing the content pin`)
  }
  return {...skill, version, sha256}
})

writeFileSync(path, JSON.stringify(bundle, null, 2) + "\n")
