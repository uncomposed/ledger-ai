import type { MealGoal, PrismaClient } from "@prisma/client";
import { can } from "@ledger/policy";
import { emitOutboxEvent } from "../events/emit.js";
import { ForbiddenError } from "../errors.js";
import type { ActorContext, CorrelationContext } from "./types.js";

export async function createMealGoal(
  prisma: PrismaClient,
  input: {
    entityId: string;
    text: string;
    createdBy: ActorContext;
    correlation: CorrelationContext;
  },
): Promise<MealGoal> {
  if (input.entityId !== input.createdBy.entityId) throw new ForbiddenError("Cross-entity access denied");
  if (!can(input.createdBy, "meal:write", { entityId: input.entityId })) throw new ForbiddenError("Not allowed");

  return prisma.$transaction(async (tx) => {
    const goal = await tx.mealGoal.create({
      data: {
        entityId: input.entityId,
        status: "open",
        text: input.text,
        createdByActorId: input.createdBy.actorId,
      },
    });

    await emitOutboxEvent(tx, {
      entityId: goal.entityId,
      correlationId: input.correlation.correlationId,
      eventType: "meal.goal.created.v1",
      eventVersion: 1,
      occurredAt: new Date(),
      payload: {
        meal_goal_id: goal.id,
        entity_id: goal.entityId,
        created_by_actor_id: input.createdBy.actorId,
        status: goal.status,
        text: goal.text,
      },
    });

    return goal;
  });
}

