# Agent skills

The four mechanical funnel skills shipped in this batch, authored against
the v0.0.26 DSL contract and the 23-tool tenant MCP surface. Each skill's
`SOURCES.md` names the pinned sources with their SHAs.

| Skill | Stage coverage | Source basis |
|---|---|---|
| `author-in-app-connector` | Orchestrator — the full S0–S11 funnel | MCP-served guide, `authoring.proto`, lifecycle doc |
| `read-authoring-contract` | Stage 0 — guide + SDK contract read | MCP-served guide, `authoring.proto` |
| `build-and-test` | Stages 2–5, 9–10 — upload, build, draft test | MCP-served guide, `authoring.proto`, lifecycle doc |
| `deploy-and-activate` | Stages 6–8, 11 — app, provision, configure, deploy, mint, handoff | MCP-served guide, `authoring.proto`, lifecycle doc |

The eval bundle (`evals/skills-bundle/bundle.json`) is a manifest pointing
into this directory; the skill bodies live here as the single source of
truth.
