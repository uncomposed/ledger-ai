import type { LensRun, PrismaClient, Track } from "@prisma/client";
import { completeLensRun } from "../commands/lensrun.js";
import { createQuestion } from "../commands/question.js";
import { proposeChangeSet } from "../commands/changeset.js";
import { createTask } from "../commands/task.js";
import { startLensRun } from "../commands/lensrun.js";
import { ConflictError } from "../errors.js";
import { resolveActorContext } from "../auth/resolve.js";
import type { ActorContext } from "../commands/types.js";

type ClaimedLensRunRow = {
  id: string;
  entityId: string;
  trackId: string;
  lensKey: string;
};

async function claimLensRuns(
  prisma: PrismaClient,
  opts: { limit: number; workerId: string; leaseSeconds: number },
): Promise<ClaimedLensRunRow[]> {
  const rows = (await prisma.$queryRaw`
    with claim as (
      select id
      from "LensRun"
      where status = 'queued'
        and ("leaseUntil" is null or "leaseUntil" <= now())
      order by "createdAt" asc
      for update skip locked
      limit ${opts.limit}
    )
    update "LensRun" r
    set
      "claimedAt" = now(),
      "claimedBy" = ${opts.workerId},
      "leaseUntil" = now() + (${opts.leaseSeconds} * interval '1 second')
    from claim
    where r.id = claim.id
    returning r.id, r."entityId", r."trackId", r."lensKey"
  `) as ClaimedLensRunRow[];

  return rows;
}

type LensContext = {
  prisma: PrismaClient;
  lensRun: LensRun;
  track: Track;
  systemActorId: string;
  system: ActorContext;
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
      actor: ctx.system,
      correlation: { correlationId: `lensrun:${ctx.lensRun.id}` },
    });
    return;
  }

  const task = await createTask(ctx.prisma, {
    entityId: ctx.lensRun.entityId,
    taskId: ctx.lensRun.id,
    type: "track.lens.pantry_text_v1",
    title: "Review pantry import proposals",
    createdBy: ctx.system,
    correlation: { correlationId: `lensrun:${ctx.lensRun.id}` },
  });

  await proposeChangeSet(ctx.prisma, {
    taskId: task.id,
    changeSetId: ctx.lensRun.id,
    baseType: "pantry_text.v1",
    baseVersion: 1,
    riskLevel: "low",
    patch: { track_id: ctx.track.id, items: lines },
    actor: ctx.system,
    correlation: { correlationId: `lensrun:${ctx.lensRun.id}` },
  });
}

async function runImageStubV1(ctx: LensContext) {
  await createQuestion(ctx.prisma, {
    entityId: ctx.lensRun.entityId,
    trackId: ctx.track.id,
    prompt: "Image ingestion is stubbed. Please describe what’s in the photo (one item per line).",
    context: { lens_key: ctx.lensRun.lensKey },
    actor: ctx.system,
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
    actor: ctx.system,
    correlation: { correlationId: `lensrun:${ctx.lensRun.id}` },
  });
  throw new Error(`Unknown lens key: ${ctx.lensRun.lensKey}`);
}

export async function runLensRunsOnce(
  prisma: PrismaClient,
  opts: { limit: number; systemActorId: string; workerId?: string; leaseSeconds?: number },
): Promise<number> {
  const workerId = opts.workerId ?? `lens-${process.pid}`;
  const leaseSeconds = opts.leaseSeconds ?? 30;
  const runs = await claimLensRuns(prisma, { limit: opts.limit, workerId, leaseSeconds });

  let processed = 0;

  for (const run of runs) {
    const system = await resolveActorContext(prisma, { actorId: opts.systemActorId, entityId: run.entityId });
    const correlationId = `lensrun:${run.id}`;

    try {
      await startLensRun(prisma, { lensRunId: run.id, actor: system, correlation: { correlationId } });
    } catch (e) {
      if (e instanceof ConflictError) continue;
      throw e;
    }

    const lensRun = await prisma.lensRun.findUniqueOrThrow({ where: { id: run.id } });
    const track = await prisma.track.findUnique({ where: { id: run.trackId } });
    if (!track) {
      await completeLensRun(prisma, {
        lensRunId: lensRun.id,
        status: "failed",
        error: "Track missing",
        actor: system,
        correlation: { correlationId },
      });
      continue;
    }

    try {
      await runLens({ prisma, lensRun, track, systemActorId: opts.systemActorId, system });

      await prisma.track.update({
        where: { id: track.id },
        data: { status: "processed", processedAt: new Date(), error: null },
      });

      await completeLensRun(prisma, {
        lensRunId: lensRun.id,
        status: "succeeded",
        actor: system,
        correlation: { correlationId },
      });
      processed += 1;
    } catch (err) {
      const message = String((err as any)?.message ?? err);
      await prisma.track.update({
        where: { id: track.id },
        data: { status: "failed", processedAt: new Date(), error: message },
      });
      await completeLensRun(prisma, {
        lensRunId: lensRun.id,
        status: "failed",
        error: message,
        actor: system,
        correlation: { correlationId },
      });
      processed += 1;
    }
  }

  return processed;
}
