import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const path = new URL("../../packages/events/generated/index.ts", import.meta.url);

let before = "";
try {
  before = readFileSync(path, "utf8");
} catch {
  before = "";
}

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const eventsDir = join(repoRoot, "packages/events");

const env = { ...process.env };
env.COREPACK_HOME ??= join(repoRoot, ".corepack");
env.XDG_CACHE_HOME ??= join(repoRoot, ".cache");

execSync(`pnpm -C "${eventsDir}" events:codegen`, { stdio: "inherit", env });

let after = "";
try {
  after = readFileSync(path, "utf8");
} catch {
  after = "";
}

if (before !== after) {
  console.error("Generated events types are out of date. Run: pnpm events:codegen and commit the result.");
  process.exit(1);
}

console.log("events:codegen:check OK");
