import type { Prisma } from "@prisma/client";
import { emitOutboxEvent } from "../../events/emit.js";
import { ForbiddenError } from "../../errors.js";
import type { PatchHandler } from "../types.js";

function asObject(v: unknown): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("patch must be an object");
  return v as Record<string, unknown>;
}

function asString(v: unknown, name: string): string {
  if (typeof v !== "string" || !v.length) throw new Error(`${name} must be a non-empty string`);
  return v;
}

function asTaskList(v: unknown): Array<{ type: string; title: string; resource_ids: string[] }> {
  if (!Array.isArray(v)) throw new Error("tasks must be an array");
  const out: Array<{ type: string; title: string; resource_ids: string[] }> = [];
  for (const item of v) {
    const o = asObject(item);
    const resourceIdsRaw = o.resource_ids;
    const resourceIds: string[] = [];
    if (resourceIdsRaw !== undefined) {
      if (!Array.isArray(resourceIdsRaw)) throw new Error("task.resource_ids must be an array");
      for (const x of resourceIdsRaw) {
        resourceIds.push(asString(x, "task.resource_ids[]"));
      }
    }
    out.push({ type: asString(o.type, "task.type"), title: asString(o.title, "task.title"), resource_ids: resourceIds });
  }
  if (out.length > 25) throw new Error("too many tasks");
  return out;
}

export const mealPlanV1: PatchHandler = {
  baseType: "meal.plan.v1",
  baseVersion: 1,
  deterministic: true,
  idempotent: true,
  validate(patch: unknown) {
    const o = asObject(patch);
    asString(o.meal_goal_id, "meal_goal_id");
    asTaskList(o.tasks);
  },
  async apply(tx: Prisma.TransactionClient, ctx, patch: unknown) {
    if (ctx.entityId !== ctx.actor.entityId) throw new ForbiddenError("Cross-entity access denied");

    const o = asObject(patch);
    const mealGoalId = asString(o.meal_goal_id, "meal_goal_id");
    const tasks = asTaskList(o.tasks);

    const goal = await tx.mealGoal.findUnique({ where: { id: mealGoalId } });
    if (!goal) throw new Error("MealGoal not found");
    if (goal.entityId !== ctx.entityId) throw new ForbiddenError("Cross-entity access denied");

    const createdTaskIds: string[] = [];

    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i]!;
      const externalKey = `${ctx.changeSetId}:task:${i}`;

      const resource = await tx.resource.upsert({
        where: { entityId_kind_externalKey: { entityId: ctx.entityId, kind: "task", externalKey } },
        create: { entityId: ctx.entityId, kind: "task", externalKey, name: t.title },
        update: { name: t.title },
      });

      const existing = await tx.task.findUnique({ where: { id: resource.id } });
      if (existing) {
        createdTaskIds.push(existing.id);
        continue;
      }

      const task = await tx.task.create({
        data: {
          id: resource.id,
          entityId: ctx.entityId,
          type: t.type,
          state: "proposed",
          title: t.title,
          createdByActorId: ctx.actor.actorId,
          updatedByActorId: ctx.actor.actorId,
          stateChangedAt: ctx.now,
        },
      });

      createdTaskIds.push(task.id);
    }

    for (let i = 0; i < createdTaskIds.length; i++) {
      const taskId = createdTaskIds[i]!;
      const t = tasks[i]!;

      await tx.taskSubject.upsert({
        where: { taskId_subjectType_subjectId: { taskId, subjectType: "meal.goal", subjectId: goal.id } },
        create: { entityId: ctx.entityId, taskId, subjectType: "meal.goal", subjectId: goal.id },
        update: {},
      });

      for (const resourceId of t.resource_ids) {
        await tx.taskSubject.upsert({
          where: { taskId_subjectType_subjectId: { taskId, subjectType: "resource", subjectId: resourceId } },
          create: { entityId: ctx.entityId, taskId, subjectType: "resource", subjectId: resourceId },
          update: {},
        });
      }
    }

    await emitOutboxEvent(tx, {
      entityId: ctx.entityId,
      correlationId: ctx.correlation.correlationId,
      eventType: "meal.plan.applied.v1",
      eventVersion: 1,
      occurredAt: ctx.now,
      payload: {
        entity_id: ctx.entityId,
        changeset_id: ctx.changeSetId,
        meal_goal_id: goal.id,
        task_ids: createdTaskIds,
      },
    });
  },
};
