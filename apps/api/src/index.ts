import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import { startServer } from "./server.js";

// Load repo root `.env` when running from `apps/api`.
// This keeps local dev consistent with other packages that run under `pnpm -C ...`.
const rootEnv = resolve(process.cwd(), "..", "..", ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });
if (existsSync(resolve(process.cwd(), ".env"))) config();

await startServer();
