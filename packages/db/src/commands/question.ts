import type { Answer, Prisma, PrismaClient, Question } from "@prisma/client";
import { can } from "@ledger/policy";
import { emitOutboxEvent } from "../events/emit.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors.js";
import type { ActorContext, CorrelationContext } from "./types.js";

export async function createQuestion(
  prisma: PrismaClient,
  input: {
    entityId: string;
    trackId?: string | null;
    taskId?: string | null;
    prompt: string;
    context: unknown;
    actor: ActorContext;
    correlation: CorrelationContext;
  },
): Promise<Question> {
  if (input.entityId !== input.actor.entityId) throw new ForbiddenError("Cross-entity access denied");
  if (!can(input.actor, "question:ask", { entityId: input.entityId })) throw new ForbiddenError("Not allowed");

  return prisma.$transaction(async (tx) => {
    if (input.trackId) {
      const track = await tx.track.findUnique({ where: { id: input.trackId } });
      if (!track) throw new NotFoundError("Track not found");
      if (track.entityId !== input.entityId) throw new ForbiddenError("Cross-entity access denied");
    }

    if (input.taskId) {
      const task = await tx.task.findUnique({ where: { id: input.taskId } });
      if (!task) throw new NotFoundError("Task not found");
      if (task.entityId !== input.entityId) throw new ForbiddenError("Cross-entity access denied");
    }

    const q = await tx.question.create({
      data: {
        entityId: input.entityId,
        trackId: input.trackId ?? null,
        taskId: input.taskId ?? null,
        status: "open",
        prompt: input.prompt,
        context: input.context as Prisma.InputJsonValue,
      },
    });

    await emitOutboxEvent(tx, {
      entityId: q.entityId,
      correlationId: input.correlation.correlationId,
      eventType: "question.asked.v1",
      eventVersion: 1,
      occurredAt: new Date(),
      payload: {
        question_id: q.id,
        entity_id: q.entityId,
        track_id: q.trackId,
        task_id: q.taskId,
        prompt: q.prompt,
      },
    });

    return q;
  });
}

export async function answerQuestion(
  prisma: PrismaClient,
  input: {
    questionId: string;
    expectedVersion: number;
    answer: unknown;
    answeredBy: ActorContext;
    correlation: CorrelationContext;
  },
): Promise<{ question: Question; answer: Answer }> {
  const q = await prisma.question.findUnique({ where: { id: input.questionId } });
  if (!q) throw new NotFoundError("Question not found");
  if (q.entityId !== input.answeredBy.entityId) throw new ForbiddenError("Cross-entity access denied");
  if (!can(input.answeredBy, "question:answer", { entityId: q.entityId })) throw new ForbiddenError("Not allowed");

  return prisma.$transaction(async (tx) => {
    const updated = await tx.question.updateMany({
      where: { id: q.id, status: "open", version: input.expectedVersion },
      data: { status: "answered", version: { increment: 1 } },
    });
    if (updated.count !== 1) throw new ConflictError("Version conflict");

    const next = await tx.question.findUniqueOrThrow({ where: { id: q.id } });

    let a: Answer;
    try {
      a = await tx.answer.create({
        data: {
          entityId: next.entityId,
          questionId: next.id,
          answeredByActorId: input.answeredBy.actorId,
          answer: input.answer as Prisma.InputJsonValue,
        },
      });
    } catch (e) {
      const msg = String(e);
      if (msg.includes("Answer_questionId_key")) throw new ConflictError("Question already answered");
      throw e;
    }

    await emitOutboxEvent(tx, {
      entityId: next.entityId,
      correlationId: input.correlation.correlationId,
      eventType: "question.answered.v1",
      eventVersion: 1,
      occurredAt: new Date(),
      payload: {
        question_id: next.id,
        entity_id: next.entityId,
        answer_id: a.id,
        answered_by_actor_id: input.answeredBy.actorId,
      },
    });

    return { question: next, answer: a };
  });
}

