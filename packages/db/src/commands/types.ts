import type { Role } from "@ledger/policy";

export type ActorContext = {
  actorId: string;
  entityId: string;
  role: Role;
};

export type CorrelationContext = {
  correlationId: string;
};

