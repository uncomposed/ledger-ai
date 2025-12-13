import type { PrismaClient, Task, TaskState } from "@prisma/client";
import { can, type PolicyAction } from "@ledger/policy";
import { emitOutboxEvent } from "../events/emit.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors.js";
import type { ActorContext, CorrelationContext } from "./types.js";

const ALLOWED: Record<TaskState, ReadonlySet<TaskState>> = {
  proposed: new Set(["ready", "cancelled"]),
  ready: new Set(["in_progress", "blocked", "cancelled"]),
  in_progress: new Set(["completed", "blocked", "cancelled"]),
  blocked: new Set(["ready", "cancelled"]),
  completed: new Set([]),
  cancelled: new Set([]),
};

export async function createTask(
  prisma: PrismaClient,
  input: {
    entityId: string;
    taskId?: string;
    type: string;
    title: string;
    createdBy: ActorContext;
    correlation: CorrelationContext;
  },
): Promise<Task> {
  if (input.entityId !== input.createdBy.entityId) throw new ForbiddenError("Cross-entity access denied");
  if (!can(input.createdBy, "task:write", { entityId: input.entityId })) throw new ForbiddenError("Not allowed");

  return prisma.$transaction(async (tx) => {
    if (input.taskId) {
      const existing = await tx.task.findUnique({ where: { id: input.taskId } });
      if (existing) return existing;
    }

    const task = await tx.task.create({
      data: {
        ...(input.taskId ? { id: input.taskId } : {}),
        entityId: input.entityId,
        type: input.type,
        state: "proposed",
        title: input.title,
        createdByActorId: input.createdBy.actorId,
        updatedByActorId: input.createdBy.actorId,
        stateChangedAt: new Date(),
      },
    });

    await emitOutboxEvent(tx, {
      entityId: task.entityId,
      correlationId: input.correlation.correlationId,
      eventType: "task.created.v1",
      eventVersion: 1,
      occurredAt: new Date(),
      payload: {
        task_id: task.id,
        created_by_actor_id: input.createdBy.actorId,
        produced: { changeset_ids: [] },
      },
    });

    return task;
  });
}

export async function transitionTaskState(
  prisma: PrismaClient,
  input: {
    taskId: string;
    toState: TaskState;
    expectedVersion: number;
    actor: ActorContext;
    correlation: CorrelationContext;
  },
): Promise<Task> {
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id: input.taskId } });
    if (!task) throw new NotFoundError("Task not found");
    if (task.entityId !== input.actor.entityId) throw new ForbiddenError("Cross-entity access denied");

    const allowed = ALLOWED[task.state];
    if (!allowed.has(input.toState)) throw new ConflictError(`Invalid transition ${task.state} -> ${input.toState}`);

    const isComplete = input.toState === "completed";
    const action: PolicyAction = isComplete ? "task:complete" : "task:write";
    if (!can(input.actor, action, { entityId: task.entityId })) {
      throw new ForbiddenError("Not allowed");
    }

    const updated = await tx.task.updateMany({
      where: { id: task.id, version: input.expectedVersion },
      data: {
        state: input.toState,
        version: { increment: 1 },
        updatedByActorId: input.actor.actorId,
        stateChangedAt: new Date(),
      },
    });
    if (updated.count !== 1) throw new ConflictError("Version conflict");

    const next = await tx.task.findUniqueOrThrow({ where: { id: task.id } });

    await emitOutboxEvent(tx, {
      entityId: next.entityId,
      correlationId: input.correlation.correlationId,
      eventType: "task.state_changed.v1",
      eventVersion: 1,
      occurredAt: new Date(),
      payload: {
        task_id: next.id,
        entity_id: next.entityId,
        from_state: task.state,
        to_state: next.state,
        changed_by_actor_id: input.actor.actorId,
        produced: { changeset_ids: [] },
      },
    });

    return next;
  });
}
