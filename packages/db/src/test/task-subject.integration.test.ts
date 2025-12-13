import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../client.js";
import { ensureTaskSubject } from "../subjects/taskSubject.js";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

test("task subject cardinality: meal.goal is single, resource is multi", async () => {
  mustEnv("DATABASE_URL");

  await prisma.taskSubject.deleteMany({});
  await prisma.task.deleteMany({});
  await prisma.mealGoal.deleteMany({});
  await prisma.membership.deleteMany({});
  await prisma.entity.deleteMany({});
  await prisma.actor.deleteMany({});
  await prisma.resource.deleteMany({});

  const entityId = "00000000-0000-0000-0000-00000000a001";
  const actorId = "00000000-0000-0000-0000-00000000a010";
  const taskId = "00000000-0000-0000-0000-00000000a100";

  await prisma.entity.create({ data: { id: entityId } });
  await prisma.actor.create({ data: { id: actorId, type: "human" } });
  await prisma.membership.create({ data: { entityId, actorId, role: "admin" } });

  const goalA = await prisma.mealGoal.create({ data: { entityId, text: "Goal A", createdByActorId: actorId } });
  const goalB = await prisma.mealGoal.create({ data: { entityId, text: "Goal B", createdByActorId: actorId } });

  const r1 = await prisma.resource.create({ data: { entityId, kind: "inventory.item", externalKey: "r1", name: "R1" } });
  const r2 = await prisma.resource.create({ data: { entityId, kind: "inventory.item", externalKey: "r2", name: "R2" } });

  await prisma.task.create({
    data: {
      id: taskId,
      entityId,
      type: "meal.buy",
      state: "proposed",
      title: "Buy stuff",
      createdByActorId: actorId,
      updatedByActorId: actorId,
    },
  });

  await prisma.$transaction(async (tx) => {
    await ensureTaskSubject(tx, { entityId, taskId, subjectType: "meal.goal", subjectId: goalA.id });
    await ensureTaskSubject(tx, { entityId, taskId, subjectType: "meal.goal", subjectId: goalB.id });
    await ensureTaskSubject(tx, { entityId, taskId, subjectType: "resource", subjectId: r1.id });
    await ensureTaskSubject(tx, { entityId, taskId, subjectType: "resource", subjectId: r2.id });
    await ensureTaskSubject(tx, { entityId, taskId, subjectType: "resource", subjectId: r2.id });
  });

  const subjects = await prisma.taskSubject.findMany({ where: { taskId }, orderBy: [{ subjectType: "asc" }, { subjectId: "asc" }] });
  const mealGoals = subjects.filter((s) => s.subjectType === "meal.goal");
  const resources = subjects.filter((s) => s.subjectType === "resource");

  assert.equal(mealGoals.length, 1);
  assert.equal(mealGoals[0]?.subjectId, goalB.id);
  assert.equal(resources.length, 2);
});

