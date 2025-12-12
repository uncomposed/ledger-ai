import type { Prisma, PrismaClient } from "@prisma/client";
import { assertEventPayload, type EventType } from "@ledger/events";

export async function emitOutboxEvent(
  prisma: PrismaClient,
  args: {
    entityId: string;
    eventType: EventType;
    eventVersion: number;
    occurredAt: Date;
    payload: unknown;
  },
) {
  assertEventPayload(args.eventType, args.payload);

  return prisma.eventOutbox.create({
    data: {
      entityId: args.entityId,
      eventType: args.eventType,
      eventVersion: args.eventVersion,
      occurredAt: args.occurredAt,
      payload: args.payload as Prisma.InputJsonValue,
    },
  });
}

