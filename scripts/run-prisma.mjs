import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

async function loadDotEnv(filePath) {
  const { config } = await import("dotenv");
  const result = config({ path: filePath });
  if (result.error) throw result.error;
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length) {
    console.error("Usage: node scripts/run-prisma.mjs <prisma args...>");
    process.exit(2);
  }

  const cwd = process.cwd();
  const rootEnv = resolve(cwd, "..", "..", ".env");
  if (existsSync(rootEnv)) await loadDotEnv(rootEnv);

  const localEnv = resolve(cwd, ".env");
  if (existsSync(localEnv)) await loadDotEnv(localEnv);

  if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL (expected in repo root .env or env vars)");
    process.exit(2);
  }

  const child = spawn("pnpm", ["exec", "prisma", ...argv], { stdio: "inherit" });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
}

main();
