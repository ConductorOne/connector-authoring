# Skill bundle

This directory is the skill-bundle mount point for the eval harness.

This PR ships the bundle-mode plumbing only — **no skills yet**. The runner
records `skill_bundle_mode` and `skill_bundle_version` in every run record;
mode `none` means the agent follows only the authoring guide returned by
`get_authoring_guide`.

Future PRs add the orchestrator / stage / diagnose skills here, pinned
by version, and the scenario file selects them via `skillBundle.mode`
(`guide-only` or `full`).
