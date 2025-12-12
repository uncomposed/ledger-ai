import type { PrismaClient } from "@ledger/db";

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
        prisma.eventLog.create({
          data: {
            entityId: row.entityId,
            eventType: row.eventType,
            eventVersion: row.eventVersion,
            occurredAt: row.occurredAt,
            payload: row.payload,
          },
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
