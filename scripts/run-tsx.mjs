import { spawn } from "node:child_process";

function parseNodeVersion() {
  const [majorRaw, minorRaw] = process.versions.node.split(".");
  const major = Number(majorRaw ?? 0);
  const minor = Number(minorRaw ?? 0);
  return { major, minor };
}

function supportsImportFlag() {
  const { major, minor } = parseNodeVersion();
  if (major > 20) return true;
  if (major === 20) return minor >= 6;
  if (major === 18) return minor >= 19;
  return false;
}

const argv = process.argv.slice(2);
const isTest = argv[0] === "--test";
const scriptIndex = isTest ? 1 : 0;
const scriptPath = argv[scriptIndex];

if (!scriptPath) {
  console.error("Usage: node scripts/run-tsx.mjs [--test] <script> [args...]");
  process.exit(2);
}

const scriptArgs = argv.slice(scriptIndex + 1);

const nodeArgs = [];
if (isTest) nodeArgs.push("--test");

if (supportsImportFlag()) nodeArgs.push("--import", "tsx");
else nodeArgs.push("--loader", "tsx");

nodeArgs.push(scriptPath, ...scriptArgs);

const child = spawn(process.execPath, nodeArgs, { stdio: "inherit" });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});

