# Sources — build-and-test

Authored against the pinned sources below (decision 8: nothing written from
model memory). Source-of-truth precedence: (a) MCP-served guide, (b)
`authoring.proto`, (c) lifecycle doc, (d) in-repo `baton/*.d.ts` +
`examples/http`.

| Source | Pin / SHA | What this skill quotes |
|---|---|---|
| MCP-served guide | c1 `2502b4cd8f59bf6614616013010ec4f0bf72f9ae` | The caps table (16 MiB total / 12 MiB per file / 256 files / 65536 / 262144 / 1048576); the out-of-band uploads paragraph (`upload_targets`, `required_headers` verbatim); the evidence-and-credentials paragraph (`get_run` is build-only, `credential re-entry required`); the required-source-files table. |
| Authoring proto | c1 `2502b4cd8f59bf6614616013010ec4f0bf72f9ae` | `DraftSourceUploadTarget` (`url` + `required_headers`); `CreateDraftSourceUpload` / `FinalizeDraftSourceUpload` (declared files with `size_bytes`, caps); `GetRun` (build runs only); `RunDraftTestSync` / `GetTestRunEvidence` (durable PASS/FAIL row, `NotFound` while pending). |
| Lifecycle doc | c1 `2502b4cd8f59bf6614616013010ec4f0bf72f9ae` | Step 2 (upload dance with `wc -c`), step 4–5 (build + poll), step 9–10 (draft test + PASS evidence; fresh `test_run_id` on re-run). |
| In-repo SDK declarations | connector-authoring `b7e8a616cbbb1e336b788f807a3810b08ae00bc7` | The `.d.ts` module surface the uploaded source is authored against. |
| SDK contract (`baton/*.d.ts`) | connector-authoring git tag `v0.0.26` (sync commit `01a69d8d` "Sync baton runtime types for v0.0.26") | The `.d.ts` module surface this skill is authored against. `runtime_pin_matched`: not verifiable offline — no tenant MCP surface is reachable from the authoring env; repo tag v0.0.26 is the served default_tag when the tenant runtime pin matches (see `read-authoring-contract` for the runtime check). |
| baton-axiomatic DSL contract | baton-axiomatic `docs/DSL.md` + `runtime/baton/*.d.ts` @ v0.0.26 (`825e5516…`) | The DSL semantics ground truth the in-repo `.d.ts` are synced from. |
