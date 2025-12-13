import { prisma } from "../../src/client.js";
import { emitOutboxEvent } from "../../src/events/emit.js";

async function main() {
  const entityId = "00000000-0000-0000-0000-000000000001";
  const actorId = "00000000-0000-0000-0000-000000000002";
  const correlationId = "seed";

  await prisma.entity.upsert({
    where: { id: entityId },
    create: { id: entityId },
    update: {},
  });

  await prisma.actor.upsert({
    where: { id: actorId },
    create: { id: actorId, type: "system" },
    update: {},
  });

  await prisma.membership.upsert({
    where: { entityId_actorId: { entityId, actorId } },
    create: { entityId, actorId, role: "admin" },
    update: {},
  });

  await prisma.task.create({
    data: {
      entityId,
      type: "bootstrap",
      state: "proposed",
      title: "CI seed task",
      createdByActorId: actorId,
    },
  });

  const task = await prisma.task.findFirstOrThrow({ where: { entityId }, orderBy: { createdAt: "desc" } });

  await prisma.changeSet.create({
    data: {
      entityId,
      taskId: task.id,
      state: "pending_approval",
      baseType: "bootstrap",
      baseVersion: 1,
      riskLevel: "low",
      patch: {},
      proposedByActorId: actorId,
    },
  });

  await emitOutboxEvent(prisma, {
    entityId,
    correlationId,
    eventType: "task.created.v1",
    eventVersion: 1,
    occurredAt: new Date(),
    payload: { task_id: task.id, entity_id: entityId, created_by_actor_id: actorId, produced: { changeset_ids: [] } },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
