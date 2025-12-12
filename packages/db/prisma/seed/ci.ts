import { prisma } from "../../src/client.js";

async function main() {
  const entityId = "00000000-0000-0000-0000-000000000001";
  const actorId = "00000000-0000-0000-0000-000000000002";

  await prisma.task.create({
    data: {
      entityId,
      type: "bootstrap",
      state: "open",
      title: "CI seed task",
    },
  });

  await prisma.changeSet.create({
    data: {
      entityId,
      state: "proposed",
      baseType: "bootstrap",
      baseVersion: 1,
      riskLevel: "low",
    },
  });

  await prisma.eventOutbox.create({
    data: {
      entityId,
      eventType: "task.created.v1",
      eventVersion: 1,
      occurredAt: new Date(),
      payload: { task_id: entityId, created_by_actor_id: actorId, produced: { changeset_ids: [] } },
    },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
