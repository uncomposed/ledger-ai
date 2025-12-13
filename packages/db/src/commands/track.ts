import type { Prisma, PrismaClient, Track, TrackKind } from "@prisma/client";
import { can } from "@ledger/policy";
import { emitOutboxEvent } from "../events/emit.js";
import { ForbiddenError } from "../errors.js";
import type { ActorContext, CorrelationContext } from "./types.js";

export async function ingestTrack(
  prisma: PrismaClient,
  input: {
    entityId: string;
    kind: TrackKind;
    text?: string;
    context?: unknown;
    attachments?: Array<{
      contentType: string;
      sizeBytes: number;
      sha256: string;
      storageKey?: string;
    }>;
    createdBy: ActorContext;
    correlation: CorrelationContext;
  },
): Promise<Track> {
  if (input.entityId !== input.createdBy.entityId) throw new ForbiddenError("Cross-entity access denied");
  if (!can(input.createdBy, "track:ingest", { entityId: input.entityId })) throw new ForbiddenError("Not allowed");

  return prisma.$transaction(async (tx) => {
    const track = await tx.track.create({
      data: {
        entityId: input.entityId,
        kind: input.kind,
        correlationId: input.correlation.correlationId,
        text: input.text,
        context: (input.context ?? null) as Prisma.InputJsonValue,
        status: "ingested",
        createdByActorId: input.createdBy.actorId,
      },
    });

    const attachments = input.attachments ?? [];
    if (attachments.length) {
      await tx.trackAttachment.createMany({
        data: attachments.map((a) => ({
          trackId: track.id,
          contentType: a.contentType,
          sizeBytes: a.sizeBytes,
          sha256: a.sha256,
          storageKey: a.storageKey ?? null,
        })),
      });
    }

    await emitOutboxEvent(tx, {
      entityId: track.entityId,
      correlationId: input.correlation.correlationId,
      eventType: "track.ingested.v1",
      eventVersion: 1,
      occurredAt: new Date(),
      payload: {
        track_id: track.id,
        entity_id: track.entityId,
        kind: track.kind,
        created_by_actor_id: input.createdBy.actorId,
      },
    });

    return track;
  });
}
