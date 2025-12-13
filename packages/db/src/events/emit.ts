import type { Prisma, PrismaClient } from "@prisma/client";
import { assertEventPayload, type EventType } from "@ledger/events";

export async function emitOutboxEvent(
  prisma: PrismaClient | Prisma.TransactionClient,
  args: {
    entityId: string;
    correlationId: string;
    eventType: EventType;
    eventVersion: number;
    occurredAt: Date;
    payload: Record<string, unknown>;
  },
) {
  const payload = {
    correlation_id: args.correlationId,
    ...args.payload,
  };

  assertEventPayload(args.eventType, payload);

  return prisma.eventOutbox.create({
    data: {
      entityId: args.entityId,
      correlationId: args.correlationId,
      eventType: args.eventType,
      eventVersion: args.eventVersion,
      occurredAt: args.occurredAt,
      payload: payload as Prisma.InputJsonValue,
    },
  });
}
