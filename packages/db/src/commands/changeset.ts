import type { ChangeSet, Prisma, PrismaClient } from "@prisma/client";
import { can } from "@ledger/policy";
import { emitOutboxEvent } from "../events/emit.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors.js";
import type { ActorContext, CorrelationContext } from "./types.js";

export async function proposeChangeSet(
  prisma: PrismaClient,
  input: {
    taskId: string;
    baseType: string;
    baseVersion: number;
    riskLevel: string;
    patch: unknown;
    actor: ActorContext;
    correlation: CorrelationContext;
  },
): Promise<ChangeSet> {
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id: input.taskId } });
    if (!task) throw new NotFoundError("Task not found");
    if (task.entityId !== input.actor.entityId) throw new ForbiddenError("Cross-entity access denied");
    if (!can(input.actor, "changeset:propose", { entityId: task.entityId })) throw new ForbiddenError("Not allowed");

    const cs = await tx.changeSet.create({
      data: {
        entityId: task.entityId,
        taskId: task.id,
        state: "pending_approval",
        baseType: input.baseType,
        baseVersion: input.baseVersion,
        riskLevel: input.riskLevel,
        patch: input.patch as Prisma.InputJsonValue,
        proposedByActorId: input.actor.actorId,
        stateChangedAt: new Date(),
      },
    });

    await emitOutboxEvent(tx, {
      entityId: cs.entityId,
      correlationId: input.correlation.correlationId,
      eventType: "changeset.proposed.v1",
      eventVersion: 1,
      occurredAt: new Date(),
      payload: {
        changeset_id: cs.id,
        task_id: task.id,
        entity_id: task.entityId,
        proposed_by_actor_id: input.actor.actorId,
        risk_level: cs.riskLevel,
        produced: { changeset_ids: [cs.id] },
      },
    });

    return cs;
  });
}

export async function applyChangeSet(
  prisma: PrismaClient,
  input: {
    changeSetId: string;
    expectedVersion: number;
    actor: ActorContext;
    correlation: CorrelationContext;
  },
): Promise<ChangeSet> {
  return prisma.$transaction(async (tx) => {
    const cs = await tx.changeSet.findUnique({ where: { id: input.changeSetId } });
    if (!cs) throw new NotFoundError("ChangeSet not found");
    if (cs.entityId !== input.actor.entityId) throw new ForbiddenError("Cross-entity access denied");
    if (!can(input.actor, "changeset:apply", { entityId: cs.entityId })) throw new ForbiddenError("Not allowed");
    if (cs.state !== "pending_approval") throw new ConflictError("ChangeSet not pending approval");

    const updated = await tx.changeSet.updateMany({
      where: { id: cs.id, version: input.expectedVersion, state: "pending_approval" },
      data: {
        state: "applied",
        version: { increment: 1 },
        approvedByActorId: input.actor.actorId,
        appliedAt: new Date(),
        stateChangedAt: new Date(),
      },
    });
    if (updated.count !== 1) throw new ConflictError("Version conflict");

    const next = await tx.changeSet.findUniqueOrThrow({ where: { id: cs.id } });

    await emitOutboxEvent(tx, {
      entityId: next.entityId,
      correlationId: input.correlation.correlationId,
      eventType: "changeset.applied.v1",
      eventVersion: 1,
      occurredAt: new Date(),
      payload: {
        changeset_id: next.id,
        task_id: next.taskId,
        entity_id: next.entityId,
        approved_by_actor_id: input.actor.actorId,
        produced: { changeset_ids: [next.id] },
      },
    });

    return next;
  });
}
