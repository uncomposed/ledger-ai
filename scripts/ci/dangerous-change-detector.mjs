import { execSync } from "node:child_process";

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

const base = process.env.GITHUB_BASE_REF
  ? `origin/${process.env.GITHUB_BASE_REF}`
  : "HEAD~1";

const diff = sh(`git diff --name-only ${base}...HEAD`).split("\n").filter(Boolean);

const changed = (prefix) => diff.some((p) => p.startsWith(prefix));

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (changed("packages/db/prisma/schema.prisma")) {
  if (!changed("packages/db/prisma/migrations/")) {
    fail("schema.prisma changed but no migration added under packages/db/prisma/migrations/");
  }
}

if (changed("packages/events/catalog/")) {
  if (!changed("packages/events/generated/")) {
    fail("Event schema changed but generated types not updated. Run: pnpm events:codegen");
  }
}

console.log("dangerous_change_detector OK");