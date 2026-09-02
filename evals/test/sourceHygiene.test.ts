import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateSourceHygiene } from "../src/scorer/sourceHygiene.ts";
import { TEST_SCENARIO, TEST_SECRETS } from "./helpers.ts";

const GOOD_CONNECTOR = `import { config, connector, http, node, slot, walk, resourceType } from "@baton/runtime"
import { newUserResource } from "@baton/types"
const directory = http.v1({ baseUrl: config("base-url"), auth: { type: "basic", username: config("account-email"), password: config("api-token") } })
const userRow = slot()
const listUsers = node({ outputs: { userRow }, run: () => directory.GET({ path: "/v1/users" }), result: ({ response }) => [] })
const users = walk({ nodes: [listUsers], from: { userRow }, to: ({ userRow }) => newUserResource("n", "user", "id") })
const userType = resourceType({ id: "user", displayName: "User", traits: ["TRAIT_USER"], resources: users })
export default connector({ metadata: { displayName: "x" }, transports: { directory }, resourceTypes: [userType] })
`;

const goodFiles = (): Record<string, string> => ({
  "connector.ts": GOOD_CONNECTOR,
  "config-schema.json": JSON.stringify({
    fields: [
      { name: "base-url", stringField: {} },
      { name: "account-email", stringField: {} },
      { name: "api-token", isSecret: true, stringField: {} },
    ],
  }),
  "runtime-schema.json": JSON.stringify({
    version: 1,
    runtime: {
      connector: "connector.js",
      config_schema: {
        fields: [
          { name: "base-url", type: "string" },
          { name: "account-email", type: "string" },
          { name: "api-token", type: "string", is_secret: true },
        ],
      },
    },
  }),
  "capabilities.json": JSON.stringify({ sync: true }),
});

const hygiene = (files: Record<string, string>) => evaluateSourceHygiene(files, TEST_SCENARIO, TEST_SECRETS);

describe("evaluateSourceHygiene", () => {
  it("accepts a clean source set", () => {
    const score = hygiene(goodFiles());
    assert.equal(score.available, true);
    assert.deepEqual(score.violations, []);
    assert.equal(score.requiredFilesPresent, true);
    assert.equal(score.dualSchemaParity, true);
    assert.equal(score.isSecretOk, true);
    assert.equal(score.runtimeTypesOk, true);
    assert.equal(score.bundleCapsOk, true);
    assert.equal(score.connectorContractOk, true);
  });

  it("flags a missing required file", () => {
    const files = goodFiles();
    delete files["capabilities.json"];
    const score = hygiene(files);
    assert.equal(score.requiredFilesPresent, false);
    assert.ok(score.violations.some((v) => v.includes("capabilities.json")));
  });

  it("flags JSON Schema pasted into config-schema.json", () => {
    const files = goodFiles();
    files["config-schema.json"] = JSON.stringify({ $schema: "http://json-schema.org/draft-07/schema#", properties: {} });
    const score = hygiene(files);
    assert.equal(score.dualSchemaParity, false);
    assert.ok(score.violations.some((v) => v.includes("JSON Schema")));
  });

  it("flags a runtime field missing type", () => {
    const files = goodFiles();
    const runtime = JSON.parse(files["runtime-schema.json"]);
    delete runtime.runtime.config_schema.fields[0].type;
    files["runtime-schema.json"] = JSON.stringify(runtime);
    const score = hygiene(files);
    assert.equal(score.runtimeTypesOk, false);
    assert.ok(score.violations.some((v) => v.includes('"base-url" is missing type')));
  });

  it("flags a credential-class field without is_secret", () => {
    const files = goodFiles();
    const runtime = JSON.parse(files["runtime-schema.json"]);
    delete runtime.runtime.config_schema.fields[2].is_secret;
    files["runtime-schema.json"] = JSON.stringify(runtime);
    const score = hygiene(files);
    assert.equal(score.isSecretOk, false);
    assert.ok(score.violations.some((v) => v.includes('"api-token" lacks is_secret')));
  });

  it("flags dual-schema field drift in both directions", () => {
    const files = goodFiles();
    const config = JSON.parse(files["config-schema.json"]);
    config.fields.push({ name: "extra-field", stringField: {} });
    files["config-schema.json"] = JSON.stringify(config);
    const score = hygiene(files);
    assert.equal(score.dualSchemaParity, false);
    assert.ok(score.violations.some((v) => v.includes('"extra-field" is in config-schema.json but missing')));
  });

  it("flags direct fetch in connector.ts", () => {
    const files = goodFiles();
    files["connector.ts"] = GOOD_CONNECTOR + `\nconst x = fetch("https://api.example")\n`;
    const score = hygiene(files);
    assert.equal(score.connectorContractOk, false);
    assert.ok(score.violations.some((v) => v.includes("direct HTTP")));
  });

  it("flags non-@baton imports", () => {
    const files = goodFiles();
    files["connector.ts"] = `import lodash from "lodash"\n` + GOOD_CONNECTOR;
    const score = hygiene(files);
    assert.equal(score.connectorContractOk, false);
    assert.ok(score.violations.some((v) => v.includes("lodash")));
  });

  it("flags an unregistered transport", () => {
    const files = goodFiles();
    files["connector.ts"] = GOOD_CONNECTOR.replace("transports: { directory }", "transports: { }");
    const score = hygiene(files);
    assert.equal(score.connectorContractOk, false);
    assert.ok(score.violations.some((v) => v.includes('transport "directory"')));
  });

  it("flags a missing default connector export", () => {
    const files = goodFiles();
    files["connector.ts"] = GOOD_CONNECTOR.replace("export default connector({", "export const spec = connector({");
    const score = hygiene(files);
    assert.equal(score.connectorContractOk, false);
    assert.ok(score.violations.some((v) => v.includes("default-exported connector")));
  });

  it("flags the source cap", () => {
    const files = goodFiles();
    files["connector.ts"] = GOOD_CONNECTOR + "/*" + "x".repeat(263_000) + "*/";
    const score = hygiene(files);
    assert.equal(score.bundleCapsOk, false);
    assert.ok(score.violations.some((v) => v.includes("262144")));
  });

  it("flags a plaintext credential in connector.ts", () => {
    const files = goodFiles();
    files["connector.ts"] = GOOD_CONNECTOR + `\n// ${TEST_SECRETS[0]}\n`;
    const score = hygiene(files);
    assert.equal(score.connectorContractOk, false);
    assert.ok(score.violations.some((v) => v.includes("plaintext credential")));
  });

  it("reports unavailable for an empty source set", () => {
    const score = hygiene({});
    assert.equal(score.available, false);
  });
});
