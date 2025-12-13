import { Ajv } from "ajv";
import * as formats from "ajv-formats";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { EventType } from "../generated/index.js";
import type { FormatsPlugin } from "ajv-formats";

const catalogDir = new URL("../catalog/", import.meta.url);

function loadSchemas(): unknown[] {
  const files = readdirSync(catalogDir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".schema.json"))
    .map((d) => d.name);

  return files.map((f) => {
    const raw = readFileSync(join(catalogDir.pathname, f), "utf8");
    return JSON.parse(raw) as unknown;
  });
}

type AjvInstance = InstanceType<typeof Ajv>;

let _ajv: AjvInstance | null = null;

function getAjv(): AjvInstance {
  if (_ajv) return _ajv;
  const ajv = new Ajv({ allErrors: true, strict: true });
  const addFormats = (formats as unknown as { default: FormatsPlugin }).default;
  addFormats(ajv);
  for (const schema of loadSchemas()) ajv.addSchema(schema as any);
  _ajv = ajv;
  return ajv;
}

export function assertEventPayload(eventType: EventType, payload: unknown): void {
  const validate = getAjv().getSchema(eventType);
  if (!validate) {
    throw new Error(`Unknown event type (missing schema $id): ${eventType}`);
  }
  const ok = validate(payload);
  if (ok) return;

  const details = getAjv().errorsText(validate.errors, { separator: "\n" });
  throw new Error(`Invalid payload for event ${eventType}:\n${details}`);
}
