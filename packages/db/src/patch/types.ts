import type { Prisma } from "@prisma/client";
import type { ActorContext, CorrelationContext } from "../commands/types.js";

export type PatchContext = {
  entityId: string;
  changeSetId: string;
  actor: ActorContext;
  correlation: CorrelationContext;
  now: Date;
};

export type PatchHandler = {
  baseType: string;
  baseVersion: number;
  deterministic: true;
  idempotent: true;
  validate: (patch: unknown) => void;
  apply: (tx: Prisma.TransactionClient, ctx: PatchContext, patch: unknown) => Promise<void>;
};
