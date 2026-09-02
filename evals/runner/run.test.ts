// run.test.ts — CLI contract smoke for the runner (locked E1/L18).
// The exit-code contract and the --ref injection guard are security-relevant
// and must not regress: --help exits 0, missing required args exit 1, an
// invalid --ref exits 1 with a clear error, an unknown --driver exits 1.
import {test} from "node:test"
import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {promisify} from "node:util"

const execFileAsync = promisify(execFile)
const RUN = "evals/runner/run.ts"

async function runCli(args: string[]): Promise<{code: number; stdout: string; stderr: string}> {
  try {
    const {stdout, stderr} = await execFileAsync("node", ["--experimental-strip-types", RUN, ...args], {
      cwd: process.cwd(),
      timeout: 30_000,
    })
    return {code: 0, stdout, stderr}
  } catch (err) {
    const e = err as {code?: number; stdout?: string; stderr?: string}
    return {code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? ""}
  }
}

test("--help exits 0 with usage", async () => {
  const {code, stdout, stderr} = await runCli(["--help"])
  assert.equal(code, 0)
  assert.ok((stdout + stderr).includes("usage: node evals/runner/run.ts"))
})

test("missing --scenario exits 1", async () => {
  const {code} = await runCli([])
  assert.equal(code, 1)
})

test("an invalid --ref (shell metacharacters) exits 1 with a clear error", async () => {
  const {code, stderr} = await runCli(["--scenario", "evals/scenarios/tier1-directory.json", "--ref", "bad;rm -rf /"])
  assert.equal(code, 1)
  assert.ok(stderr.includes("invalid --ref"))
})

test("an unknown --driver exits 1 with a clear error", async () => {
  const {code, stderr} = await runCli(["--scenario", "evals/scenarios/tier1-directory.json", "--driver", "nope"])
  assert.equal(code, 1)
  assert.ok(stderr.includes("unknown driver"))
})
