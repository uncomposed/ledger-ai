import type { Entity, PrismaClient } from "@prisma/client";
import { emitOutboxEvent } from "../events/emit.js";
import type { ActorContext, CorrelationContext } from "./types.js";

export async function createEntity(
  prisma: PrismaClient,
  input: {
    entityId: string;
    createdByActorId: string;
    correlation: CorrelationContext;
  },
): Promise<Entity> {
  return prisma.$transaction(async (tx) => {
    const entity = await tx.entity.create({ data: { id: input.entityId } });

    await tx.actor.upsert({
      where: { id: input.createdByActorId },
      create: { id: input.createdByActorId, type: "human" },
      update: {},
    });

    await tx.membership.create({
      data: {
        entityId: entity.id,
        actorId: input.createdByActorId,
        role: "admin",
      },
    });

    await emitOutboxEvent(tx, {
      entityId: entity.id,
      correlationId: input.correlation.correlationId,
      eventType: "entity.created.v1",
      eventVersion: 1,
      occurredAt: new Date(),
      payload: {
        entity_id: entity.id,
        created_by_actor_id: input.createdByActorId,
      },
    });

    return entity;
  });
}
