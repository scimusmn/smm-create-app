import fs from "node:fs";
import path from "node:path";

/**
 * Merge a manifest's dependencies/devDependencies/scripts into the project's
 * package.json. Structured JSON merge only — this is what keeps us resilient
 * to upstream (C3 / create-next-app) changes. Never regex-patch their files.
 */
export function mergePackageJson(projectDir, manifest) {
  const pkgPath = path.join(projectDir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  for (const key of ["dependencies", "devDependencies", "scripts"]) {
    if (!manifest[key]) continue;
    pkg[key] = { ...(pkg[key] ?? {}), ...manifest[key] };
  }
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

/** Append env var names to .env.example (created if missing), skipping dupes. */
export function appendEnvExample(projectDir, envVars = []) {
  if (envVars.length === 0) return;
  const envPath = path.join(projectDir, ".env.example");
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const lines = envVars
    .filter((name) => !new RegExp(`^${name}=`, "m").test(existing))
    .map((name) => `${name}=`);
  if (lines.length === 0) return;
  const sep = existing && !existing.endsWith("\n") ? "\n" : "";
  fs.writeFileSync(envPath, existing + sep + lines.join("\n") + "\n");
}

/**
 * If/when a feature needs a Cloudflare binding (KV, R2, D1...), merge it into
 * wrangler.jsonc here — again as a structured merge (strip comments, parse,
 * merge, rewrite). None of the current features need bindings, so this is a
 * documented extension point rather than live code.
 */
export function mergeWranglerConfig(_projectDir, _manifest) {
  // intentionally empty for now
}
