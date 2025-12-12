import { readdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const catalogDir = new URL("../catalog/", import.meta.url);
const outFile = new URL("../generated/index.ts", import.meta.url);

function main() {
  const files = readdirSync(catalogDir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".schema.json"))
    .map((d) => d.name)
    .sort();

  const ids: string[] = files.map((f) => {
    const raw = readFileSync(join(catalogDir.pathname, f), "utf8");
    const json = JSON.parse(raw);
    if (!json.$id) throw new Error(`Schema ${f} missing $id`);
    return String(json.$id);
  });

  const lines = [
    "export const EVENT_TYPES = " + JSON.stringify(ids, null, 2) + " as const;",
    "export type EventType = (typeof EVENT_TYPES)[number];",
    "",
  ];

  writeFileSync(outFile, lines.join("\n"), "utf8");
  console.log(`events:codegen OK -> ${outFile.pathname}`);
}

main();

