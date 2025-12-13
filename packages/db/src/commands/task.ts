import type { PrismaClient, Task, TaskState } from "@prisma/client";
import { can, type PolicyAction } from "@ledger/policy";
import { emitOutboxEvent } from "../events/emit.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors.js";
import type { ActorContext, CorrelationContext } from "./types.js";
import { executeChangeSetPatchIfSupported } from "../patch/execute.js";

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
        entity_id: task.entityId,
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

    // Execution tie-in: some task types produce deterministic inventory effects.
    // We encode effects as a ChangeSet so they remain auditable and replayable.
    if (input.toState === "completed" && task.type === "meal.buy") {
      const resources = await tx.taskSubject.findMany({
        where: { taskId: task.id, subjectType: "resource", entityId: task.entityId },
        select: { subjectId: true },
      });
      const resourceIds = Array.from(new Set(resources.map((r) => r.subjectId)));

      if (resourceIds.length) {
        const canAutoApply = can(input.actor, "changeset:apply", { entityId: task.entityId });
        const now2 = new Date();

        const cs = await tx.changeSet.create({
          data: {
            entityId: task.entityId,
            taskId: task.id,
            state: "pending_approval",
            baseType: "inventory.delta.v1",
            baseVersion: 1,
            riskLevel: "low",
            patch: {
              location_kind: "kitchen.pantry",
              ops: resourceIds.map((resource_id) => ({ resource_id, delta: 1, unit: "count" })),
            },
            proposedByActorId: input.actor.actorId,
            stateChangedAt: now2,
          },
        });

        await emitOutboxEvent(tx, {
          entityId: cs.entityId,
          correlationId: input.correlation.correlationId,
          eventType: "changeset.proposed.v1",
          eventVersion: 1,
          occurredAt: now2,
          payload: {
            changeset_id: cs.id,
            task_id: task.id,
            entity_id: task.entityId,
            proposed_by_actor_id: input.actor.actorId,
            risk_level: cs.riskLevel,
            produced: { changeset_ids: [cs.id] },
          },
        });

        if (canAutoApply) {
          const updatedCs = await tx.changeSet.updateMany({
            where: { id: cs.id, version: cs.version, state: "pending_approval" },
            data: {
              state: "applied",
              version: { increment: 1 },
              approvedByActorId: input.actor.actorId,
              appliedAt: now2,
              stateChangedAt: now2,
            },
          });
          if (updatedCs.count !== 1) throw new ConflictError("Version conflict");

          await executeChangeSetPatchIfSupported(tx, {
            entityId: cs.entityId,
            changeSetId: cs.id,
            baseType: cs.baseType,
            baseVersion: cs.baseVersion,
            patch: cs.patch,
            actor: input.actor,
            correlation: input.correlation,
            now: now2,
          });

          await emitOutboxEvent(tx, {
            entityId: cs.entityId,
            correlationId: input.correlation.correlationId,
            eventType: "changeset.applied.v1",
            eventVersion: 1,
            occurredAt: now2,
            payload: {
              changeset_id: cs.id,
              task_id: task.id,
              entity_id: task.entityId,
              approved_by_actor_id: input.actor.actorId,
              produced: { changeset_ids: [cs.id] },
            },
          });
        }
      }
    }

    return next;
  });
}
