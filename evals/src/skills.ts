/**
 * Skill bundles: the configurable skill condition for a run.
 *
 *   none       — bare prompt; the control condition.
 *   guide-only — the agent is instructed to read the tenant-served authoring
 *                guide (c1_connector_authoring_get_authoring_guide) and follow
 *                it; no repo skills. The second control condition.
 *   full@<ver> — the full skill set at a pinned version, inlined into the
 *                prompt from evals/skill-bundles/full/<ver>/. Shipped by the
 *                skills PRs; the runner pins and records the version.
 *
 * A bundle is a directory with bundle.json {name, version, description} plus
 * markdown files inlined in lexical order.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface SkillBundle {
  name: string;
  version: string;
  description: string;
  /** Markdown bodies to inline into the agent prompt, in order. */
  documents: Array<{ path: string; content: string }>;
}

export function loadSkillBundle(bundlesDir: string, spec: string): SkillBundle {
  // spec forms: "none", "guide-only", "full@<version>", or a bare name.
  const [name, version] = spec.includes("@") ? spec.split("@", 2) : [spec, null];
  const dir = version ? join(bundlesDir, name, version) : join(bundlesDir, name);
  const manifestPath = join(dir, "bundle.json");
  if (!existsSync(manifestPath)) {
    const available = listBundles(bundlesDir);
    throw new Error(
      `skill bundle "${spec}" not found at ${dir}. Available: ${available.length > 0 ? available.join(", ") : "(none)"}`,
    );
  }
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (typeof manifest !== "object" || manifest === null || !("name" in manifest) || !("version" in manifest)) {
    throw new Error(`skill bundle manifest at ${manifestPath} lacks name/version`);
  }
  const m = manifest as { name: unknown; version: unknown; description?: unknown };
  const documents = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => ({ path: f, content: readFileSync(join(dir, f), "utf8") }));
  return {
    name: String(m.name),
    version: String(m.version),
    description: typeof m.description === "string" ? m.description : "",
    documents,
  };
}

export function listBundles(bundlesDir: string): string[] {
  if (!existsSync(bundlesDir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(bundlesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(bundlesDir, entry.name);
    if (existsSync(join(dir, "bundle.json"))) {
      out.push(entry.name);
      continue;
    }
    for (const sub of readdirSync(dir, { withFileTypes: true })) {
      if (sub.isDirectory() && existsSync(join(dir, sub.name, "bundle.json"))) {
        out.push(`${entry.name}@${sub.name}`);
      }
    }
  }
  return out.sort();
}
