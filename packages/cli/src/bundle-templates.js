// Runs on `npm pack` / `npm publish`: copies base/, features/, products/ from
// the monorepo root into packages/cli/template so the published package is
// self-contained. resolveTemplateRoot() finds them there at runtime.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const dest = path.resolve(here, "../template");

fs.rmSync(dest, { recursive: true, force: true });
for (const dir of ["base", "features", "products"]) {
  fs.cpSync(path.join(repoRoot, dir), path.join(dest, dir), { recursive: true });
}
console.log(`Bundled templates into ${dest}`);
