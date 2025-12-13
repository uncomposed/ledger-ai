import type { Prisma } from "@prisma/client";
import { getPatchHandler } from "./registry.js";
import type { ActorContext, CorrelationContext } from "../commands/types.js";
import "./builtin.js";

export async function executeChangeSetPatchIfSupported(
  tx: Prisma.TransactionClient,
  input: {
    entityId: string;
    changeSetId: string;
    baseType: string;
    baseVersion: number;
    patch: unknown;
    actor: ActorContext;
    correlation: CorrelationContext;
    now: Date;
  },
): Promise<void> {
  const handler = getPatchHandler(input.baseType, input.baseVersion);
  if (!handler) return;

  handler.validate(input.patch);

  await handler.apply(tx, { entityId: input.entityId, changeSetId: input.changeSetId, actor: input.actor, correlation: input.correlation, now: input.now }, input.patch);
}
