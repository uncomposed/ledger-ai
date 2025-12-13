import type { Actor } from "./roles.js";

export type PolicyAction =
  | "task:read"
  | "task:write"
  | "task:complete"
  | "changeset:propose"
  | "changeset:apply"
  | "admin:manage";

export function can(actor: Actor, action: PolicyAction, resource: { entityId: string }): boolean {
  if (actor.entityId !== resource.entityId) return false;
  if (actor.role === "admin") return true;

  switch (action) {
    case "task:read":
    case "task:write":
    case "task:complete":
    case "changeset:propose":
      return actor.role === "member";
    case "changeset:apply":
    case "admin:manage":
      return false;
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}
