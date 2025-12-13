import type { Prisma, PrismaClient } from "@prisma/client";

type ClaimedOutboxRow = {
  id: string;
  entityId: string;
  correlationId: string;
  eventType: string;
  eventVersion: number;
  occurredAt: Date;
  payload: Prisma.JsonValue;
};

async function claimOutboxRows(
  prisma: PrismaClient,
  opts: { limit: number; workerId: string; leaseSeconds: number },
): Promise<ClaimedOutboxRow[]> {
  const rows = (await prisma.$queryRaw`
    with claim as (
      select id
      from "EventOutbox"
      where "publishedAt" is null
        and ("leaseUntil" is null or "leaseUntil" <= now())
      order by "createdAt" asc
      for update skip locked
      limit ${opts.limit}
    )
    update "EventOutbox" o
    set
      "claimedAt" = now(),
      "claimedBy" = ${opts.workerId},
      "leaseUntil" = now() + (${opts.leaseSeconds} * interval '1 second'),
      "publishError" = null
    from claim
    where o.id = claim.id
    returning
      o.id,
      o."entityId",
      o."correlationId",
      o."eventType",
      o."eventVersion",
      o."occurredAt",
      o.payload
  `) as ClaimedOutboxRow[];

  return rows;
}

export async function publishOutboxOnce(
  prisma: PrismaClient,
  opts: {
    limit: number;
    workerId?: string;
    leaseSeconds?: number;
    crashAfterAppendOutboxId?: string;
  },
): Promise<number> {
  const workerId = opts.workerId ?? `worker-${process.pid}`;
  const leaseSeconds = opts.leaseSeconds ?? 30;

  const rows = await claimOutboxRows(prisma, {
    limit: opts.limit,
    workerId,
    leaseSeconds,
  });

  for (const row of rows) {
    try {
      await prisma.eventLog.upsert({
        where: { outboxId: row.id },
        create: {
          outboxId: row.id,
          entityId: row.entityId,
          correlationId: row.correlationId,
          eventType: row.eventType,
          eventVersion: row.eventVersion,
          occurredAt: row.occurredAt,
          payload: row.payload as Prisma.InputJsonValue,
        },
        update: {},
      });
    } catch (e) {
      await prisma.eventOutbox.update({
        where: { id: row.id },
        data: {
          publishError: String(e),
          leaseUntil: new Date(Date.now() + 10_000),
        },
      });
      continue;
    }

    if (opts.crashAfterAppendOutboxId && row.id === opts.crashAfterAppendOutboxId) {
      throw new Error("failpoint: crash after append");
    }

    try {
      await prisma.eventOutbox.update({
        where: { id: row.id },
        data: { publishedAt: new Date(), publishError: null, leaseUntil: null },
      });
    } catch (e) {
      await prisma.eventOutbox.update({
        where: { id: row.id },
        data: {
          publishError: String(e),
          leaseUntil: new Date(Date.now() + 10_000),
        },
      });
    }
  }

  return rows.length;
}
