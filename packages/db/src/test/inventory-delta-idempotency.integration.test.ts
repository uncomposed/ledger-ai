import test from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { prisma } from "../client.js";
import "../patch/builtin.js";
import { executeChangeSetPatchIfSupported } from "../patch/execute.js";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

test("inventory.delta.v1 apply is idempotent across retries", async () => {
  mustEnv("DATABASE_URL");

  await prisma.inventoryMutation.deleteMany({});
  await prisma.inventoryItem.deleteMany({});
  await prisma.location.deleteMany({});
  await prisma.taskSubject.deleteMany({});
  await prisma.changeSet.deleteMany({});
  await prisma.task.deleteMany({});
  await prisma.resource.deleteMany({});
  await prisma.membership.deleteMany({});
  await prisma.mealGoal.deleteMany({});
  await prisma.entity.deleteMany({});
  await prisma.actor.deleteMany({});

  const entityId = "00000000-0000-0000-0000-00000000b001";
  const adminActorId = "00000000-0000-0000-0000-00000000b010";
  const changeSetId = "00000000-0000-0000-0000-00000000b020";

  await prisma.entity.create({ data: { id: entityId } });
  await prisma.actor.create({ data: { id: adminActorId, type: "human" } });
  await prisma.membership.create({ data: { entityId, actorId: adminActorId, role: "admin" } });

  const resource = await prisma.resource.create({
    data: { entityId, kind: "inventory.item", externalKey: "tomato sauce", name: "Tomato Sauce" },
  });

  await prisma.task.create({
    data: {
      id: "00000000-0000-0000-0000-00000000b030",
      entityId,
      type: "effects",
      state: "proposed",
      title: "effects",
      createdByActorId: adminActorId,
      updatedByActorId: adminActorId,
    },
  });

  await prisma.changeSet.create({
    data: {
      id: changeSetId,
      entityId,
      taskId: "00000000-0000-0000-0000-00000000b030",
      state: "applied",
      baseType: "inventory.delta.v1",
      baseVersion: 1,
      riskLevel: "low",
      patch: {
        location_kind: "kitchen.pantry",
        ops: [{ resource_id: resource.id, delta: 1, unit: "count" }],
      } as Prisma.InputJsonValue,
      proposedByActorId: adminActorId,
      approvedByActorId: adminActorId,
      appliedAt: new Date(),
      stateChangedAt: new Date(),
    },
  });

  const patch = { location_kind: "kitchen.pantry", ops: [{ resource_id: resource.id, delta: 1, unit: "count" }] };
  const actor = { actorId: adminActorId, entityId, role: "admin" as const };
  const correlation = { correlationId: "corr-inv-delta-retry" };
  const now = new Date();

  // First execution.
  await prisma.$transaction((tx) =>
    executeChangeSetPatchIfSupported(tx, {
      entityId,
      changeSetId,
      baseType: "inventory.delta.v1",
      baseVersion: 1,
      patch,
      actor,
      correlation,
      now,
    }),
  );

  // Retry execution with the same ChangeSetId and opIndex.
  await prisma.$transaction((tx) =>
    executeChangeSetPatchIfSupported(tx, {
      entityId,
      changeSetId,
      baseType: "inventory.delta.v1",
      baseVersion: 1,
      patch,
      actor,
      correlation,
      now,
    }),
  );

  const items = await prisma.inventoryItem.findMany({ where: { entityId }, include: { resource: true } });
  assert.equal(items.length, 1);
  assert.equal(items[0]?.resourceId, resource.id);
  assert.equal(items[0]?.quantity?.toString(), "1");

  const mutations = await prisma.inventoryMutation.findMany({ where: { entityId, changeSetId } });
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0]?.opIndex, 0);
});

