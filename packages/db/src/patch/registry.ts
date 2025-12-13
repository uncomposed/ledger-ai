import type { PatchHandler } from "./types.js";

const handlers = new Map<string, PatchHandler>();

function keyOf(baseType: string, baseVersion: number): string {
  return `${baseType}@${baseVersion}`;
}

export function registerPatchHandler(handler: PatchHandler): void {
  if (!handler.deterministic) throw new Error(`Patch handler ${handler.baseType}@${handler.baseVersion} must be deterministic`);
  if (!handler.idempotent) throw new Error(`Patch handler ${handler.baseType}@${handler.baseVersion} must be idempotent`);
  const key = keyOf(handler.baseType, handler.baseVersion);
  if (handlers.has(key)) throw new Error(`Patch handler already registered: ${key}`);
  handlers.set(key, handler);
}

export function getPatchHandler(baseType: string, baseVersion: number): PatchHandler | undefined {
  return handlers.get(keyOf(baseType, baseVersion));
}

