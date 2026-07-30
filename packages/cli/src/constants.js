import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The entire OpenNext/Cloudflare scaffold is delegated to Cloudflare's C3 CLI.
 * We invoke it fresh every time, so new projects always get the latest
 * upstream template — there is no fork to maintain.
 *
 * NOTE: verify these flags against the current C3 release occasionally
 * (`npx create-cloudflare@latest --help`). If C3 adds or renames a flag,
 * this array is the only place to update. We run C3 with stdio inherited, so
 * if a new un-flagged prompt appears, the dev simply answers it
 * interactively instead of the scaffold breaking.
 *
 * Known gotcha (verified against C3 2.70): do NOT pass `--lang=ts`. The next
 * template is TypeScript-only and declares no language variants, so the
 * --lang filter removes it from the framework map and C3 errors with
 * "Unsupported framework: next".
 */
export const c3Args = (projectName) => [
  "create",
  "cloudflare@latest",
  "--",
  projectName,
  "--framework=next",
  "--platform=workers",
  "--git",
  "--no-deploy",
];

/** Feature ids must match folder names under features/. */
export const FEATURES = [
  { value: "serial", label: "Serial communication (Arduino / Web Serial API)" },
  { value: "sheets-cms", label: "Google Sheets as lightweight CMS" },
  { value: "kiosk", label: "Kiosk install & startup scripts" },
];

/** Product ids must match folder names under products/. */
export const PRODUCTS = [
  { value: "none", label: "None — blank project" },
  { value: "video-selector", label: "Video selector" },
  { value: "flipbook", label: "Flipbook" },
];

/**
 * Locate base/, features/, products/.
 * - Running from a clone of the template monorepo: they sit two levels up.
 * - Running from the published package: `prepack` copies them into ./template.
 * - SMM_TEMPLATE_ROOT env var overrides both (handy in CI).
 */
export function resolveTemplateRoot() {
  if (process.env.SMM_TEMPLATE_ROOT) return process.env.SMM_TEMPLATE_ROOT;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const bundled = path.resolve(here, "../template");
  if (fs.existsSync(path.join(bundled, "base"))) return bundled;
  const repo = path.resolve(here, "../../..");
  if (fs.existsSync(path.join(repo, "base"))) return repo;
  throw new Error(
    "Could not locate template files (base/, features/, products/). " +
      "Run from a clone of the template repo or set SMM_TEMPLATE_ROOT."
  );
}
