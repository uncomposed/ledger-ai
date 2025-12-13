import type { Role } from "@ledger/policy";

export function getActorFromHeaders(headers: Record<string, unknown>): {
  actorId: string;
  entityId: string;
} {
  const entityId = String(headers["x-entity-id"] ?? "");
  const actorId = String(headers["x-actor-id"] ?? "");

  if (!entityId) throw new Error("missing x-entity-id");
  if (!actorId) throw new Error("missing x-actor-id");

  return { actorId, entityId };
}
