import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as p from "@clack/prompts";
import { c3Args, FEATURES, PRODUCTS, resolveTemplateRoot } from "./constants.js";
import { applyOverlay, writeTemplateConfig } from "./apply.js";

const VERSION = "0.1.0";

/* ------------------------------------------------------------------ */
/* arg parsing (tiny on purpose — flags exist mainly for CI)           */
/* ------------------------------------------------------------------ */
function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const [key, val] = arg.slice(2).split("=");
      flags[key] = val ?? true;
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

function bail(message) {
  p.cancel(message ?? "Cancelled.");
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */
export async function main(argv) {
  const { flags, positional } = parseArgs(argv);
  const templateRoot = resolveTemplateRoot();

  // `create-smm-app add <feature>` — adopt a feature in an existing project
  if (positional[0] === "add") {
    return addFeature(positional[1], templateRoot);
  }

  p.intro("smm app creator");

  // Warn (never block) if this clone is behind origin — stale clones
  // generate projects from stale overlays.
  warnIfCloneIsStale(templateRoot);

  /* ---- gather answers (flags win, prompts fill the gaps) ---- */
  // The target may be a bare name ("my-app") or a path ("../projects/my-app").
  // C3 accepts paths natively and uses the basename as the app name.
  let target = flags.name ?? positional[0];
  if (!target) {
    target = await p.text({
      message: "Project name or path?",
      placeholder: "../projects/museum-wall-2026",
      validate: (v) =>
        /^[a-z0-9][a-z0-9-_]*$/.test(path.basename(v ?? ""))
          ? undefined
          : "project name (last path segment): lowercase letters, numbers, dashes",
    });
    if (p.isCancel(target)) bail();
  }

  let product = flags.product;
  if (!product) {
    product = await p.select({
      message: "Start from a product?",
      options: PRODUCTS,
      initialValue: "none",
    });
    if (p.isCancel(product)) bail();
  }

  let features;
  if (product !== "none") {
    // Products are recipes: they declare their own feature set.
    const productManifest = JSON.parse(
      fs.readFileSync(path.join(templateRoot, "products", product, "product.json"), "utf8")
    );
    features = productManifest.features ?? [];
    p.log.info(`${product} includes: ${features.join(", ") || "no extra features"}`);
  } else if (flags.features) {
    features = flags.features === "all" ? FEATURES.map((f) => f.value) : flags.features.split(",");
  } else {
    features = await p.multiselect({
      message: "Which features does this project need? (space to toggle)",
      options: FEATURES,
      required: false,
    });
    if (p.isCancel(features)) bail();
  }

  const unknown = features.filter((f) => !FEATURES.some((k) => k.value === f));
  if (unknown.length) bail(`Unknown feature(s): ${unknown.join(", ")}`);

  /* ---- 1. delegate the base scaffold to Cloudflare C3 ---- */
  p.log.step("Scaffolding with create-cloudflare (Next.js + Workers via OpenNext)...");
  const c3 = spawnSync("npm", c3Args(target), { stdio: "inherit", shell: process.platform === "win32" });
  if (c3.status !== 0) bail("create-cloudflare failed — see output above.");

  const projectDir = path.resolve(process.cwd(), target);
  if (!fs.existsSync(path.join(projectDir, "package.json"))) {
    bail(`Expected package.json in ${projectDir} after scaffold — did C3 change its output?`);
  }

  /* ---- 2. apply overlays: base -> features -> product (last wins) ---- */
  const notes = [];
  p.log.step("Applying SMM base overlay...");
  notes.push(...applyOverlay(projectDir, path.join(templateRoot, "base")));

  for (const feature of features) {
    p.log.step(`Adding feature: ${feature}`);
    notes.push(...applyOverlay(projectDir, path.join(templateRoot, "features", feature)));
  }

  if (product !== "none") {
    p.log.step(`Applying product: ${product}`);
    notes.push(...applyOverlay(projectDir, path.join(templateRoot, "products", product)));
  }

  writeTemplateConfig(projectDir, { product, features, version: VERSION });

  /* ---- 3. install merged deps ---- */
  if (!flags["skip-install"]) {
    p.log.step("Installing dependencies...");
    spawnSync("npm", ["install"], { cwd: projectDir, stdio: "inherit", shell: process.platform === "win32" });
  }

  /* ---- done ---- */
  const steps = [
    `cd ${target} && yarn dev`,
    ...notes,
    "Deploy: yarn deploy",
  ];
  p.note(steps.map((s, i) => `${i + 1}. ${s}`).join("\n"), "Next steps");
  p.outro("Done. Go build something.");
}

/**
 * Devs run this from a clone rather than a published package, so an outdated
 * clone silently generates outdated projects. Fetch (bounded, quiet) and warn
 * if behind origin. Any failure — offline, no git, no origin — is ignored.
 */
function warnIfCloneIsStale(templateRoot) {
  try {
    const git = (args, timeout = 4000) =>
      spawnSync("git", ["-C", templateRoot, ...args], { encoding: "utf8", timeout });
    git(["fetch", "--quiet"]);
    const behind = git(["rev-list", "--count", "HEAD..@{upstream}"]).stdout?.trim();
    if (behind && Number(behind) > 0) {
      p.log.warn(
        `This clone is ${behind} commit(s) behind origin — new projects will use outdated templates. Consider \`git pull\` first.`
      );
    }
  } catch {
    /* best effort only */
  }
}

async function addFeature(featureId, templateRoot) {
  if (!featureId || !FEATURES.some((f) => f.value === featureId)) {
    throw new Error(`Usage: create-smm-app add <${FEATURES.map((f) => f.value).join("|")}>`);
  }
  const projectDir = process.cwd();
  if (!fs.existsSync(path.join(projectDir, "package.json"))) {
    throw new Error("Run this from the root of an existing project.");
  }
  p.intro(`Adding feature: ${featureId}`);
  const notes = applyOverlay(projectDir, path.join(templateRoot, "features", featureId));
  p.log.warn("Feature files copied and package.json updated — run `npm install`.");
  p.log.warn(`Add "${featureId}" to the features array in lib/template-config.ts so the home page shows it.`);
  for (const n of notes) p.log.info(n);
  p.outro("Done.");
}
