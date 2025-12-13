import type { Actor } from "./roles.js";

export type PolicyAction =
  | "task:read"
  | "task:write"
  | "task:complete"
  | "changeset:read"
  | "changeset:propose"
  | "changeset:apply"
  | "membership:read"
  | "membership:write"
  | "admin:manage";

export function can(actor: Actor, action: PolicyAction, resource: { entityId: string }): boolean {
  if (actor.entityId !== resource.entityId) return false;
  if (actor.role === "admin") return true;

  switch (action) {
    case "task:read":
      return actor.role === "contributor" || actor.role === "accountable";
    case "changeset:read":
      return actor.role === "contributor" || actor.role === "accountable";
    case "task:write":
      return actor.role === "contributor";
    case "task:complete":
      return actor.role === "accountable";
    case "changeset:propose":
      return actor.role === "contributor";
    case "changeset:apply":
    case "membership:read":
    case "membership:write":
    case "admin:manage":
      return false;
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}
