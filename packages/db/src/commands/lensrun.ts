import type { LensRun, PrismaClient } from "@prisma/client";
import { can } from "@ledger/policy";
import { emitOutboxEvent } from "../events/emit.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors.js";
import type { ActorContext, CorrelationContext } from "./types.js";

export async function ensureLensRun(
  prisma: PrismaClient,
  input: {
    trackId: string;
    lensKey: string;
    actor: ActorContext;
    correlation: CorrelationContext;
  },
): Promise<LensRun> {
  const track = await prisma.track.findUnique({ where: { id: input.trackId } });
  if (!track) throw new NotFoundError("Track not found");
  if (track.entityId !== input.actor.entityId) throw new ForbiddenError("Cross-entity access denied");
  if (!can(input.actor, "track:ingest", { entityId: track.entityId })) throw new ForbiddenError("Not allowed");

  try {
    return await prisma.lensRun.create({
      data: {
        entityId: track.entityId,
        trackId: track.id,
        lensKey: input.lensKey,
        status: "queued",
      },
    });
  } catch (e) {
    const msg = String(e);
    if (msg.includes("LensRun_trackId_lensKey_key")) {
      return prisma.lensRun.findUniqueOrThrow({ where: { trackId_lensKey: { trackId: track.id, lensKey: input.lensKey } } });
    }
    throw e;
  }
}

export async function startLensRun(
  prisma: PrismaClient,
  input: {
    lensRunId: string;
    actor: ActorContext;
    correlation: CorrelationContext;
  },
): Promise<LensRun> {
  return prisma.$transaction(async (tx) => {
    const run = await tx.lensRun.findUnique({ where: { id: input.lensRunId }, include: { track: true } });
    if (!run) throw new NotFoundError("LensRun not found");
    if (run.entityId !== input.actor.entityId) throw new ForbiddenError("Cross-entity access denied");
    if (!can(input.actor, "track:ingest", { entityId: run.entityId })) throw new ForbiddenError("Not allowed");

    const updated = await tx.lensRun.updateMany({
      where: { id: run.id, status: "queued" },
      data: { status: "running", startedAt: new Date(), error: null },
    });
    if (updated.count !== 1) throw new ConflictError("LensRun not queued");

    const next = await tx.lensRun.findUniqueOrThrow({ where: { id: run.id } });

    await emitOutboxEvent(tx, {
      entityId: next.entityId,
      correlationId: input.correlation.correlationId,
      eventType: "lens.run.started.v1",
      eventVersion: 1,
      occurredAt: new Date(),
      payload: {
        lens_run_id: next.id,
        entity_id: next.entityId,
        track_id: next.trackId,
        lens_key: next.lensKey,
      },
    });

    return next;
  });
}

export async function completeLensRun(
  prisma: PrismaClient,
  input: {
    lensRunId: string;
    status: "succeeded" | "failed";
    error?: string | null;
    actor: ActorContext;
    correlation: CorrelationContext;
  },
): Promise<LensRun> {
  return prisma.$transaction(async (tx) => {
    const run = await tx.lensRun.findUnique({ where: { id: input.lensRunId } });
    if (!run) throw new NotFoundError("LensRun not found");
    if (run.entityId !== input.actor.entityId) throw new ForbiddenError("Cross-entity access denied");
    if (!can(input.actor, "track:ingest", { entityId: run.entityId })) throw new ForbiddenError("Not allowed");

    const nextStatus = input.status === "succeeded" ? "succeeded" : "failed";

    const updated = await tx.lensRun.updateMany({
      where: { id: run.id, status: "running" },
      data: { status: nextStatus, finishedAt: new Date(), error: input.error ?? null },
    });
    if (updated.count !== 1) throw new ConflictError("LensRun not running");

    const next = await tx.lensRun.findUniqueOrThrow({ where: { id: run.id } });

    await emitOutboxEvent(tx, {
      entityId: next.entityId,
      correlationId: input.correlation.correlationId,
      eventType: "lens.run.completed.v1",
      eventVersion: 1,
      occurredAt: new Date(),
      payload: {
        lens_run_id: next.id,
        entity_id: next.entityId,
        track_id: next.trackId,
        lens_key: next.lensKey,
        status: input.status,
        error: input.error ?? null,
      },
    });

    return next;
  });
}

