# connector-authoring

TypeScript type definitions for the ConductorOne connector-authoring SDK.

This repository publishes the `.d.ts` declaration files for the three modules
a connector author can import — `@baton/runtime`, `@baton/helpers`, and
`@baton/types`. ConductorOne fetches these definitions and feeds them to the
in-app authoring editor, so authors get real diagnostics and IntelliSense for
the SDK surface instead of unresolved-module errors.

These are **declarations only**. The implementations are provided by the
connector runtime at execution time; connector bundles never include them.