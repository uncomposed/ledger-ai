export const ROLES = ["admin", "contributor", "accountable"] as const;
export type Role = (typeof ROLES)[number];

export type Actor = {
  actorId: string;
  entityId: string;
  role: Role;
};
