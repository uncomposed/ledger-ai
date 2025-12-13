import type { Prisma } from "@prisma/client";

export type TaskSubjectCardinality = "single" | "multi";

const CARDINALITY: Record<string, TaskSubjectCardinality> = {
  "meal.goal": "single",
  resource: "multi",
};

export function taskSubjectCardinality(subjectType: string): TaskSubjectCardinality {
  return CARDINALITY[subjectType] ?? "single";
}

export async function ensureTaskSubject(
  tx: Prisma.TransactionClient,
  input: { entityId: string; taskId: string; subjectType: string; subjectId: string },
): Promise<void> {
  const cardinality = taskSubjectCardinality(input.subjectType);

  if (cardinality === "single") {
    await tx.taskSubject.deleteMany({
      where: {
        entityId: input.entityId,
        taskId: input.taskId,
        subjectType: input.subjectType,
        subjectId: { not: input.subjectId },
      },
    });
  }

  await tx.taskSubject.upsert({
    where: {
      taskId_subjectType_subjectId: {
        taskId: input.taskId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
      },
    },
    create: {
      entityId: input.entityId,
      taskId: input.taskId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
    },
    update: {},
  });
}

