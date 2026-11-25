# Static sync example

A configuration-free, compile-only resource/entitlement/grant mapping pattern
backed by hardcoded data. It serves hosted and BYO authors; use declarations
and examples from the same runtime-compatible release tag or reviewed commit.
The tenant-served authoring guide and tool descriptions govern hosted gates.
Use `c1_connector_authoring_get_sdk_types` to obtain the tenant's tagged
declarations. Fetch examples at that matching tag, or a reviewed compatible
commit if the tag predates the example.

This example has zero reviewed operations and no `openapi.json` or
`reviewed-ops.json`. It cannot reach the hosted draft-test PASS/activation gate;
a local typecheck is not a draft test. See [`../http`](../http) for the frozen
read-operation contract and the HTTP PASS path, or
[`../oauth-client-credentials`](../oauth-client-credentials) for a one-base-URL
OAuth skeleton. Neither compile-time example supplies a live vendor service.
