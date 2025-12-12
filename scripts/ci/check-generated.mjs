import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const path = new URL("../../packages/events/generated/index.ts", import.meta.url);

let before = "";
try {
  before = readFileSync(path, "utf8");
} catch {
  before = "";
}

execSync("pnpm -C packages/events events:codegen", { stdio: "inherit" });

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