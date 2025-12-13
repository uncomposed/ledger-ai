import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import "../patch/builtin.js";
import { getPatchHandler } from "../patch/registry.js";

type EventSchema = { $id?: unknown; "x-ledger"?: unknown };

function loadEventSchemaIds(): string[] {
  const catalogDir = new URL("../../../events/catalog/", import.meta.url);
  const dirPath = fileURLToPath(catalogDir);
  const files = readdirSync(dirPath, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".schema.json"))
    .map((d) => d.name)
    .sort();

  const ids: string[] = [];
  for (const file of files) {
    const raw = readFileSync(join(dirPath, file), "utf8");
    const json = JSON.parse(raw) as EventSchema;
    if (typeof json.$id === "string" && json.$id.length) ids.push(json.$id);
  }

  return ids;
}

function impliesPatch(schema: EventSchema): boolean {
  const meta = schema["x-ledger"];
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) return true;
  const maybe = (meta as Record<string, unknown>).impliesPatch;
  if (maybe === undefined) return true;
  if (typeof maybe !== "boolean") throw new Error("x-ledger.impliesPatch must be a boolean when provided");
  return maybe;
}

function impliedPatchFromAppliedEventId(eventId: string): { baseType: string; baseVersion: number } | null {
  const match = eventId.match(/^(.+)\.applied\.v(\d+)$/);
  if (!match) return null;
  const name = match[1] ?? "";
  const version = Number(match[2] ?? NaN);
  if (!name.includes(".")) return null; // avoids treating "changeset.applied.v1" as a patch type
  if (!Number.isFinite(version) || version <= 0) return null;
  return { baseType: `${name}.v${version}`, baseVersion: version };
}

test("patch registry is complete for patch-applied events", () => {
  // Convention: `*.applied.vN` ↔ patch type `*.vN` at baseVersion `N`.
  // If you add a domain `*.applied.vN` event that is NOT backed by a patch, set:
  //   { "x-ledger": { "impliesPatch": false } }
  // on the event schema to opt out.
  const catalogDir = new URL("../../../events/catalog/", import.meta.url);
  const dirPath = fileURLToPath(catalogDir);
  const files = readdirSync(dirPath, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".schema.json"))
    .map((d) => d.name)
    .sort();

  const implied: Array<{ baseType: string; baseVersion: number }> = [];
  for (const file of files) {
    const raw = readFileSync(join(dirPath, file), "utf8");
    const schema = JSON.parse(raw) as EventSchema;
    if (!impliesPatch(schema)) continue;
    if (typeof schema.$id !== "string" || !schema.$id.length) continue;
    const maybe = impliedPatchFromAppliedEventId(schema.$id);
    if (maybe) implied.push(maybe);
  }

  // If we ever add a patch-applied event schema but forget the handler, this test should fail loudly.
  assert.ok(implied.length > 0, "expected at least one patch-applied event schema");

  for (const { baseType, baseVersion } of implied) {
    const handler = getPatchHandler(baseType, baseVersion);
    assert.ok(handler, `missing patch handler for ${baseType}@${baseVersion}`);
    assert.equal(handler.baseType, baseType);
    assert.equal(handler.baseVersion, baseVersion);
    assert.equal(handler.deterministic, true);
    assert.equal(handler.idempotent, true);
    assert.equal(typeof handler.validate, "function");
    assert.equal(typeof handler.apply, "function");
  }
});
