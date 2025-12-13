import type { Role } from "@ledger/policy";

export function getActorFromHeaders(headers: Record<string, unknown>): {
  actorId: string;
  entityId: string;
  role: Role;
} {
  const entityId = String(headers["x-entity-id"] ?? "");
  const actorId = String(headers["x-actor-id"] ?? "");
  const role = String(headers["x-actor-role"] ?? "") as Role;

  if (!entityId) throw new Error("missing x-entity-id");
  if (!actorId) throw new Error("missing x-actor-id");
  if (!role) throw new Error("missing x-actor-role");

  return { actorId, entityId, role };
}

