import type { Prisma, PrismaClient } from "@prisma/client";

export async function publishOutboxOnce(
  prisma: PrismaClient,
  opts: { limit: number },
): Promise<number> {
  const rows = await prisma.eventOutbox.findMany({
    where: { publishedAt: null },
    orderBy: { createdAt: "asc" },
    take: opts.limit,
  });

  for (const row of rows) {
    try {
      await prisma.$transaction([
        prisma.eventLog.upsert({
          where: { outboxId: row.id },
          create: {
            outboxId: row.id,
            entityId: row.entityId,
            eventType: row.eventType,
            eventVersion: row.eventVersion,
            occurredAt: row.occurredAt,
            payload: row.payload as Prisma.InputJsonValue,
          },
          update: {},
        }),
        prisma.eventOutbox.update({
          where: { id: row.id },
          data: { publishedAt: new Date(), publishError: null },
        }),
      ]);
    } catch (e) {
      await prisma.eventOutbox.update({
        where: { id: row.id },
        data: { publishError: String(e) },
      });
    }
  }

  return rows.length;
}
