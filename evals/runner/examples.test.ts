import {test} from "node:test"
import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import {join} from "node:path"

type ConfigField = {
  name: string
  isSecret?: boolean
  stringField: {suggestedValue?: string; rules: {isRequired: boolean; wellKnown?: string}}
}
type RuntimeField = {name: string; type: string; required: boolean; is_secret?: boolean}
type Operation = {operation_id: string; resource_type: string; output_slice: string; id_path: string}

function json<T>(example: string, file: string): T {
  return JSON.parse(readFileSync(join("examples", example, file), "utf8")) as T
}

test("HTTP and OAuth examples keep config names, secret flags and full-URL metadata aligned", () => {
  for (const example of ["http", "oauth-client-credentials"]) {
    const ui = json<{fields: ConfigField[]}>(example, "config-schema.json")
    const runtime = json<{runtime: {config_schema: {fields: RuntimeField[]}}}>(example, "runtime-schema.json")
    const source = readFileSync(join("examples", example, "connector.ts"), "utf8")
    const refs = [...source.matchAll(/config\("([^\"]+)"\)/g)].map(match => match[1])
    assert.deepEqual([...new Set(refs)].sort(), ui.fields.map(field => field.name).sort())
    assert.deepEqual(ui.fields.map(field => field.name).sort(), runtime.runtime.config_schema.fields.map(field => field.name).sort())
    for (const field of runtime.runtime.config_schema.fields) {
      assert.equal(field.type, "string")
      assert.equal(field.required, true)
      assert.equal(Boolean(field.is_secret), Boolean(ui.fields.find(uiField => uiField.name === field.name)?.isSecret))
    }
    const base = ui.fields.find(field => field.name === "base-url")
    assert.ok(base)
    assert.equal(base.stringField.rules.wellKnown, "WELL_KNOWN_STRING_URI")
    assert.equal(base.stringField.rules.isRequired, true)
    const url = new URL(base.stringField.suggestedValue!)
    assert.equal(url.protocol, "https:")
    assert.equal(url.origin, base.stringField.suggestedValue)
  }
})

test("every HTTP projection is typed, including the child user membership projection", () => {
  const {operations} = json<{operations: Operation[]}>("http", "reviewed-ops.json")
  assert.deepEqual(operations.map(operation => [operation.operation_id, operation.resource_type]), [
    ["users", "user"], ["groups", "group"], ["group-members", "user"],
  ])
  for (const operation of operations) {
    assert.equal(operation.output_slice, "items")
    assert.ok(operation.id_path)
  }
})

test("OAuth skeleton has one URL input, derived auth endpoints, a bare host ref and a resolvable user schema", () => {
  const example = "oauth-client-credentials"
  const {fields} = json<{fields: ConfigField[]}>(example, "config-schema.json")
  assert.deepEqual(fields.map(field => field.name), ["base-url", "directory-client-id", "directory-client-secret"])
  const source = readFileSync(join("examples", example, "connector.ts"), "utf8")
  assert.match(source, /const baseUrl = config\("base-url"\)/)
  assert.match(source, /http\.v2\(\{\s*baseUrl,/)
  assert.match(source, /tokenUrl: strings\.concat\(baseUrl, "\/oauth\/token"\)/)
  assert.match(source, /audience: strings\.concat\(baseUrl, "\/v1\/"\)/)
  assert.match(source, /type: "oauth2_client_credentials"/)
  assert.match(source, /clientAuthStyle: "body"/)
  assert.match(source, /tokenRequestContentType: "application\/json"/)
  const {operations} = json<{operations: Operation[]}>(example, "reviewed-ops.json")
  assert.deepEqual(operations.map(operation => [operation.operation_id, operation.resource_type, operation.output_slice]), [["users", "user", "items"]])
  const spec = json<{components: {schemas: Record<string, {properties: Record<string, {items?: {$ref: string}}>; required: string[]}>}}>(example, "openapi.json")
  assert.equal(spec.components.schemas.UserPage.properties.items.items?.$ref, "#/components/schemas/User")
  assert.ok(spec.components.schemas.User.required.includes(operations[0].id_path))
})

test("all JSON authoring snippets are parseable JSON", () => {
  const source = readFileSync("skills/write-connector-source/SKILL.md", "utf8")
  const snippets = [...source.matchAll(/```json\n([\s\S]*?)\n```/g)]
  assert.equal(snippets.length, 3)
  for (const [, snippet] of snippets) assert.doesNotThrow(() => JSON.parse(snippet))
})
