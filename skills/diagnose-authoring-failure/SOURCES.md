# Sources - diagnose-authoring-failure

Authored against the pinned sources below (decision 5: nothing written from
model memory). Source-of-truth precedence: (a) MCP-served guide, (b)
`authoring.proto`, (c) lifecycle doc, (e) baton-admin
`diagnose-connector-failure`.

| Source | Pin / SHA | What this skill quotes |
|---|---|---|
| MCP-served guide | c1 `2e5f53eb441a93087d9754085ca17a5061e125ea` | The Caps table (262144-byte compile limit, 1048576-byte bundle limit) and the Evidence and credentials contract (`credential re-entry required`; activation fails closed until a PASS evidence row binds the revision digests). |
| Authoring proto | c1 `2e5f53eb441a93087d9754085ca17a5061e125ea` | `GetTestRunEvidence` (poll `(catalog_id, revision_id, test_run_id)`; `result` PASS/FAIL + `error` on the evidence row). |
| Lifecycle doc | c1 `2e5f53eb441a93087d9754085ca17a5061e125ea` | The Debugging section: the common-failures table (all nine rows), the draft-test FAIL reading (evidence row authoritative; PASS requires `ConnectionOK`, `HostCallOK`, no read error and no write attempt, config version handle match, runtime image digest match), and where logs live (product connector activity and sync logs; the status row `c1_connector_service_get` -> `status.status`, `status.lastError`). |
| baton-admin `diagnose-connector-failure` | `6fe6886f607ed0d2e48a616c30e7ce4bffc32489` | The taxonomy approach: start from the symptom, classify the failure surface, collect the smallest evidence, keep the diagnosis focused on symptom/evidence/owner/next-fix/rerun-target, and the output contract (failure summary, classified surface, evidence used, likely owner, one concrete next fix, smallest verification command). |
| SDK contract (`baton/*.d.ts`) | connector-authoring git tag `v0.0.26` (sync commit `01a69d8d` "Sync baton runtime types for v0.0.26") | The `.d.ts` module surface this skill is authored against. `runtime_pin_matched`: not verifiable offline — no tenant MCP surface is reachable from the authoring env; repo tag v0.0.26 is the served default_tag when the tenant runtime pin matches (see `read-authoring-contract` for the runtime check). |
| baton-axiomatic DSL contract | baton-axiomatic `docs/DSL.md` + `runtime/baton/*.d.ts` @ v0.0.26 (`825e5516…`) | The DSL semantics ground truth the in-repo `.d.ts` are synced from. |
