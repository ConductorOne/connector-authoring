/**
 * Source hygiene: deterministic static checks on the uploaded source set,
 * mirroring the build's enforced contract plus the documented common-failure
 * modes. No LLM judgment — every check is a parse or a regex with a named
 * violation.
 */
import type { Scenario } from "./types.ts";

export interface SourceHygieneScore {
  available: boolean;
  requiredFilesPresent: boolean;
  dualSchemaParity: boolean;
  isSecretOk: boolean;
  runtimeTypesOk: boolean;
  bundleCapsOk: boolean;
  connectorContractOk: boolean;
  violations: string[];
}

const SOURCE_CAP_BYTES = 262_144; // esbuild source bundle cap
const BUNDLE_CAP_BYTES = 1_048_576; // bundle + embedded runtime specs cap
const CREDENTIAL_CLASS = /token|secret|password|api[-_]?key|credential/i;
const RUNTIME_FIELD_TYPES = new Set([
  "string", "bool", "int", "string_slice", "string_map", "file_upload", "select", "oauth2",
]);

const findFile = (files: Record<string, string>, name: string): string | undefined => {
  if (files[name] !== undefined) return files[name];
  const key = Object.keys(files).find((k) => k.endsWith(`/${name}`));
  return key !== undefined ? files[key] : undefined;
};

function parseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

interface FieldBag {
  names: string[];
  secretNames: string[];
  typedNames: string[];
  untypedNames: string[];
  invalidTypeNames: string[];
}

function configSchemaFields(doc: unknown): FieldBag | null {
  if (typeof doc !== "object" || doc === null || !("fields" in doc)) return null;
  const fields = doc.fields;
  if (!Array.isArray(fields)) return null;
  const bag: FieldBag = { names: [], secretNames: [], typedNames: [], untypedNames: [], invalidTypeNames: [] };
  for (const f of fields) {
    if (typeof f !== "object" || f === null) continue;
    const rec = f as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name : null;
    if (!name) continue;
    bag.names.push(name);
    if (rec.is_secret === true || rec.isSecret === true || rec.IsSecret === true) bag.secretNames.push(name);
  }
  return bag;
}

function runtimeSchemaFields(doc: unknown): FieldBag | null {
  if (typeof doc !== "object" || doc === null || !("runtime" in doc)) return null;
  const runtime = doc.runtime;
  if (typeof runtime !== "object" || runtime === null || !("config_schema" in runtime)) return null;
  const schema = runtime.config_schema;
  const bag = configSchemaFields(schema);
  if (!bag || typeof schema !== "object" || schema === null || !("fields" in schema)) return null;
  const fields = schema.fields as unknown[];
  for (const f of fields) {
    if (typeof f !== "object" || f === null) continue;
    const rec = f as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name : null;
    if (!name) continue;
    if (typeof rec.type !== "string") bag.untypedNames.push(name);
    else {
      bag.typedNames.push(name);
      if (!RUNTIME_FIELD_TYPES.has(rec.type)) bag.invalidTypeNames.push(name);
    }
    if (rec.is_secret === true && !bag.secretNames.includes(name)) bag.secretNames.push(name);
  }
  return bag;
}

export function evaluateSourceHygiene(
  sourceFiles: Record<string, string>,
  scenario: Scenario,
  secretValues: string[],
): SourceHygieneScore {
  const violations: string[] = [];
  const flags = {
    requiredFilesPresent: true,
    dualSchemaParity: true,
    isSecretOk: true,
    runtimeTypesOk: true,
    bundleCapsOk: true,
    connectorContractOk: true,
  };
  if (Object.keys(sourceFiles).length === 0) {
    return { available: false, ...flags, violations: ["no source files collected"] };
  }

  // 1. Required files.
  const connectorTs = findFile(sourceFiles, "connector.ts");
  const configSchemaText = findFile(sourceFiles, "config-schema.json");
  const runtimeSchemaText = findFile(sourceFiles, "runtime-schema.json");
  const capabilities = findFile(sourceFiles, "capabilities.json");
  for (const [name, content] of [
    ["connector.ts", connectorTs],
    ["config-schema.json", configSchemaText],
    ["runtime-schema.json", runtimeSchemaText],
    ["capabilities.json", capabilities],
  ] as const) {
    if (content === undefined) {
      flags.requiredFilesPresent = false;
      violations.push(`required source file missing: ${name}`);
    }
  }

  // 2. connector.ts contract.
  if (connectorTs !== undefined) {
    if (!/export\s+default\s+connector\s*\(/.test(connectorTs)) {
      flags.connectorContractOk = false;
      violations.push("connector.ts lacks a default-exported connector({...})");
    }
    if (/\bfetch\s*\(|\baxios\b|XMLHttpRequest|node:http|require\(["']https?["']\)/.test(connectorTs)) {
      flags.connectorContractOk = false;
      violations.push("connector.ts performs direct HTTP (fetch/axios/XHR) — the hosted runtime owns execution");
    }
    for (const m of connectorTs.matchAll(/import\s[^;\n]{0,500}?from\s*["']([^"']+)["']/g)) {
      const spec = m[1];
      if (!spec.startsWith("@baton/")) {
        flags.connectorContractOk = false;
        violations.push(`connector.ts imports non-@baton module "${spec}" — no external/npm imports in the declarative graph`);
      }
    }
    // Hand-written pagination loop heuristic: a loop that advances an
    // offset/page/cursor variable.
    if (/\b(for|while)\s*\([^)]{0,200}\)[\s\S]{0,200}?\b(offset|page|cursor)\s*(\+\+|=[^=])/.test(connectorTs)) {
      flags.connectorContractOk = false;
      violations.push("connector.ts appears to hand-implement a pagination loop — declare pagination on the node instead");
    }
    // Every transport receiver used by nodes must be registered under
    // connector({ transports: ... }). Name-based static check.
    const transportBlock = connectorTs.match(/transports\s*:\s*\{([^}]*)\}/s);
    // Any identifier inside the block counts as registered: shorthand
    // `{ directory }` and aliased `{ dir: directory }` forms both name the
    // transport object the nodes reference.
    const registered = new Set(
      transportBlock ? [...transportBlock[1].matchAll(/\b(\w+)\b/g)].map((m) => m[1]) : [],
    );
    // Identifier length is bounded: an unbounded \w+ greedy-matches a whole
    // minified line and backtracks quadratically on large sources.
    const used = new Set([...connectorTs.matchAll(/(\w{1,64})\.(GET|POST|PUT|DELETE|PATCH)\s*\(/g)].map((m) => m[1]));
    for (const name of used) {
      if (!registered.has(name)) {
        flags.connectorContractOk = false;
        violations.push(`transport "${name}" is used by a node but not registered under connector({ transports })`);
      }
    }
    for (const secret of secretValues) {
      if (secret && connectorTs.includes(secret)) {
        flags.connectorContractOk = false;
        violations.push("connector.ts contains a plaintext credential value");
      }
    }
  }

  // 3. Dual-schema parity + is_secret + runtime types.
  const configDoc = configSchemaText !== undefined ? parseJson(configSchemaText) : null;
  const runtimeDoc = runtimeSchemaText !== undefined ? parseJson(runtimeSchemaText) : null;
  if (configSchemaText !== undefined) {
    if (configDoc === null) {
      flags.dualSchemaParity = false;
      violations.push("config-schema.json is not valid JSON");
    } else if (typeof configDoc === "object") {
      const looksLikeJsonSchema =
        ("$schema" in configDoc && typeof configDoc.$schema === "string") ||
        ("properties" in configDoc && !("fields" in configDoc));
      if (looksLikeJsonSchema) {
        flags.dualSchemaParity = false;
        violations.push("config-schema.json looks like JSON Schema — the UI schema is a baton Configuration document ({\"fields\":[...]})");
      }
    }
  }
  const configBag = configDoc !== null ? configSchemaFields(configDoc) : null;
  const runtimeBag = runtimeDoc !== null ? runtimeSchemaFields(runtimeDoc) : null;
  if (runtimeSchemaText !== undefined && runtimeDoc === null) {
    flags.dualSchemaParity = false;
    violations.push("runtime-schema.json is not valid JSON");
  } else if (runtimeDoc !== null && runtimeBag === null) {
    flags.dualSchemaParity = false;
    violations.push("runtime-schema.json lacks runtime.config_schema.fields");
  }
  if (configBag && runtimeBag) {
    const configNames = new Set(configBag.names);
    const runtimeNames = new Set(runtimeBag.names);
    for (const n of configNames) {
      if (!runtimeNames.has(n)) {
        flags.dualSchemaParity = false;
        violations.push(`field "${n}" is in config-schema.json but missing from runtime-schema.json config_schema`);
      }
    }
    for (const n of runtimeNames) {
      if (!configNames.has(n)) {
        flags.dualSchemaParity = false;
        violations.push(`field "${n}" is in runtime-schema.json config_schema but missing from config-schema.json`);
      }
    }
    // Credential-class fields must be is_secret on BOTH surfaces.
    const configSecrets = new Set(configBag.secretNames);
    const runtimeSecrets = new Set(runtimeBag.secretNames);
    for (const n of new Set([...configNames, ...runtimeNames])) {
      if (CREDENTIAL_CLASS.test(n)) {
        if (!runtimeSecrets.has(n)) {
          flags.isSecretOk = false;
          violations.push(`credential-class field "${n}" lacks is_secret in runtime-schema.json (the "secret:" spelling is not read)`);
        }
        if (!configSecrets.has(n)) {
          flags.isSecretOk = false;
          violations.push(`credential-class field "${n}" lacks is_secret/isSecret in config-schema.json`);
        }
      }
    }
    for (const n of runtimeBag.untypedNames) {
      flags.runtimeTypesOk = false;
      violations.push(`runtime config field "${n}" is missing type`);
    }
    for (const n of runtimeBag.invalidTypeNames) {
      flags.runtimeTypesOk = false;
      violations.push(`runtime config field "${n}" has an unsupported type`);
    }
  }

  // 4. Bundle caps (source sizes as the build measures them, pre-embed).
  if (connectorTs !== undefined && Buffer.byteLength(connectorTs, "utf8") > SOURCE_CAP_BYTES) {
    flags.bundleCapsOk = false;
    violations.push(`connector.ts exceeds the ${SOURCE_CAP_BYTES} byte compile limit`);
  }
  const total = Object.values(sourceFiles).reduce((sum, c) => sum + Buffer.byteLength(c, "utf8"), 0);
  if (total > BUNDLE_CAP_BYTES) {
    flags.bundleCapsOk = false;
    violations.push(`source set totals ${total} bytes, above the ${BUNDLE_CAP_BYTES} byte bundle limit`);
  }

  // Scenario-declared credential fields must exist in both schemas.
  if (configBag && runtimeBag) {
    for (const field of scenario.provider.credentialFields) {
      if (!configBag.names.includes(field)) {
        flags.dualSchemaParity = false;
        violations.push(`scenario credential field "${field}" missing from config-schema.json`);
      }
      if (!runtimeBag.names.includes(field)) {
        flags.dualSchemaParity = false;
        violations.push(`scenario credential field "${field}" missing from runtime-schema.json`);
      }
    }
  }

  return { available: true, ...flags, violations };
}
