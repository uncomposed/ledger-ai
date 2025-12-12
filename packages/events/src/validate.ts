import { Ajv } from "ajv";
import * as formats from "ajv-formats";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { FormatsPlugin } from "ajv-formats";

const catalogDir = new URL("../catalog/", import.meta.url);

function loadSchemas() {
  const files = readdirSync(catalogDir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".schema.json"))
    .map((d) => d.name);

  return files.map((f) => {
    const raw = readFileSync(join(catalogDir.pathname, f), "utf8");
    return JSON.parse(raw) as unknown;
  });
}

async function main() {
  const ajv = new Ajv({ allErrors: true, strict: true });
  const addFormats = (formats as unknown as { default: FormatsPlugin }).default;
  addFormats(ajv);

  const schemas = loadSchemas();
  for (const s of schemas) ajv.addSchema(s as any);

  const bad = schemas.filter((s: any) => typeof s?.$id !== "string" || !s.$id.length);
  if (bad.length) throw new Error("One or more schemas missing $id");

  console.log(`events:validate OK (${schemas.length} schemas)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
