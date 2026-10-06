import { copyFile, mkdir, readdir, rm } from "node:fs/promises";

const source = new URL("../../baton/", import.meta.url);
const mirror = new URL("./.sdk-types/", import.meta.url);
const declarations = (await readdir(source)).filter((name) => name.endsWith(".d.ts"));

// Mirror the shared declaration directory into each module, with its entrypoint
// copied to index.d.ts, exactly as the hosted typesstore consumes this bundle.
await rm(mirror, { recursive: true, force: true });
for (const module of ["runtime", "helpers", "types"]) {
  const destination = new URL(`@baton/${module}/`, mirror);
  await mkdir(destination, { recursive: true });
  for (const name of declarations) {
    await copyFile(new URL(name, source), new URL(name, destination));
  }
  await copyFile(new URL(`${module}.d.ts`, source), new URL("index.d.ts", destination));
}
