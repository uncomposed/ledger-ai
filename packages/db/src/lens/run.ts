import type { LensRun, PrismaClient, Track } from "@prisma/client";
import { completeLensRun } from "../commands/lensrun.js";
import { createQuestion } from "../commands/question.js";
import { proposeChangeSet } from "../commands/changeset.js";
import { createTask } from "../commands/task.js";
import { startLensRun } from "../commands/lensrun.js";
import { ConflictError } from "../errors.js";

function systemActor(systemActorId: string, entityId: string) {
  return { actorId: systemActorId, entityId, role: "admin" as const };
}

type LensContext = {
  prisma: PrismaClient;
  lensRun: LensRun;
  track: Track;
  systemActorId: string;
};

async function runPantryTextV1(ctx: LensContext) {
  const text = ctx.track.text ?? "";
  const lines = text
    .split(/\r?\n/)
    .map((l: string) => l.trim())
    .filter(Boolean)
    .slice(0, 100);

  if (!lines.length) {
    await createQuestion(ctx.prisma, {
      entityId: ctx.lensRun.entityId,
      trackId: ctx.track.id,
      prompt: "I couldn't find any items in that track. Can you paste a simple list (one per line)?",
      context: { lens_key: ctx.lensRun.lensKey },
      actor: systemActor(ctx.systemActorId, ctx.lensRun.entityId),
      correlation: { correlationId: `lensrun:${ctx.lensRun.id}` },
    });
    return;
  }

  const task = await createTask(ctx.prisma, {
    entityId: ctx.lensRun.entityId,
    taskId: ctx.lensRun.id,
    type: "track.lens.pantry_text_v1",
    title: "Review pantry import proposals",
    createdBy: systemActor(ctx.systemActorId, ctx.lensRun.entityId),
    correlation: { correlationId: `lensrun:${ctx.lensRun.id}` },
  });

  await proposeChangeSet(ctx.prisma, {
    taskId: task.id,
    changeSetId: ctx.lensRun.id,
    baseType: "pantry_text.v1",
    baseVersion: 1,
    riskLevel: "low",
    patch: { track_id: ctx.track.id, items: lines },
    actor: systemActor(ctx.systemActorId, ctx.lensRun.entityId),
    correlation: { correlationId: `lensrun:${ctx.lensRun.id}` },
  });
}

async function runImageStubV1(ctx: LensContext) {
  await createQuestion(ctx.prisma, {
    entityId: ctx.lensRun.entityId,
    trackId: ctx.track.id,
    prompt: "Image ingestion is stubbed. Please describe what’s in the photo (one item per line).",
    context: { lens_key: ctx.lensRun.lensKey },
    actor: systemActor(ctx.systemActorId, ctx.lensRun.entityId),
    correlation: { correlationId: `lensrun:${ctx.lensRun.id}` },
  });
}

async function runLens(ctx: LensContext) {
  if (ctx.lensRun.lensKey === "pantry_text_v1") return runPantryTextV1(ctx);
  if (ctx.lensRun.lensKey === "image_stub_v1") return runImageStubV1(ctx);
  await createQuestion(ctx.prisma, {
    entityId: ctx.lensRun.entityId,
    trackId: ctx.track.id,
    prompt: `Unknown lens key: ${ctx.lensRun.lensKey}`,
    context: { lens_key: ctx.lensRun.lensKey },
    actor: systemActor(ctx.systemActorId, ctx.lensRun.entityId),
    correlation: { correlationId: `lensrun:${ctx.lensRun.id}` },
  });
  throw new Error(`Unknown lens key: ${ctx.lensRun.lensKey}`);
}

export async function runLensRunsOnce(
  prisma: PrismaClient,
  opts: { limit: number; systemActorId: string },
): Promise<number> {
  const runs = await prisma.lensRun.findMany({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" },
    take: opts.limit,
  });

  let processed = 0;

  for (const run of runs) {
    const actor = systemActor(opts.systemActorId, run.entityId);
    const correlationId = `lensrun:${run.id}`;

    try {
      await startLensRun(prisma, { lensRunId: run.id, actor, correlation: { correlationId } });
    } catch (e) {
      if (e instanceof ConflictError) continue;
      throw e;
    }

    const track = await prisma.track.findUnique({ where: { id: run.trackId } });
    if (!track) {
      await completeLensRun(prisma, {
        lensRunId: run.id,
        status: "failed",
        error: "Track missing",
        actor,
        correlation: { correlationId },
      });
      continue;
    }

    try {
      await runLens({ prisma, lensRun: run, track, systemActorId: opts.systemActorId });

      await prisma.track.update({
        where: { id: track.id },
        data: { status: "processed", processedAt: new Date(), error: null },
      });

      await completeLensRun(prisma, { lensRunId: run.id, status: "succeeded", actor, correlation: { correlationId } });
      processed += 1;
    } catch (err) {
      const message = String((err as any)?.message ?? err);
      await prisma.track.update({
        where: { id: track.id },
        data: { status: "failed", processedAt: new Date(), error: message },
      });
      await completeLensRun(prisma, {
        lensRunId: run.id,
        status: "failed",
        error: message,
        actor,
        correlation: { correlationId },
      });
      processed += 1;
    }
  }

  return processed;
}

