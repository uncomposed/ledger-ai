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

function contextObject(track: Track): Record<string, unknown> {
  const v = track.context as unknown;
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  return v as Record<string, unknown>;
}

async function runMealPlanV1(ctx: LensContext) {
  const ctxObj = contextObject(ctx.track);
  const mealGoalId = typeof ctxObj.meal_goal_id === "string" ? ctxObj.meal_goal_id : "";
  if (!mealGoalId) {
    await createQuestion(ctx.prisma, {
      entityId: ctx.lensRun.entityId,
      trackId: ctx.track.id,
      prompt: "Meal planning track is missing meal_goal_id context.",
      context: { lens_key: ctx.lensRun.lensKey },
      actor: ctx.system,
      correlation: { correlationId: `lensrun:${ctx.lensRun.id}` },
    });
    return;
  }

  const goal = await ctx.prisma.mealGoal.findUnique({ where: { id: mealGoalId } });
  if (!goal || goal.entityId !== ctx.lensRun.entityId) {
    await createQuestion(ctx.prisma, {
      entityId: ctx.lensRun.entityId,
      trackId: ctx.track.id,
      prompt: "Meal goal not found for planning request.",
      context: { lens_key: ctx.lensRun.lensKey, meal_goal_id: mealGoalId },
      actor: ctx.system,
      correlation: { correlationId: `lensrun:${ctx.lensRun.id}` },
    });
    return;
  }

  const task = await createTask(ctx.prisma, {
    entityId: ctx.lensRun.entityId,
    taskId: ctx.lensRun.id,
    type: "track.lens.meal_plan_v1",
    title: "Review meal plan proposals",
    createdBy: ctx.system,
    correlation: { correlationId: `lensrun:${ctx.lensRun.id}` },
  });

  const recipes = await ctx.prisma.recipe.findMany({
    where: { entityId: ctx.lensRun.entityId },
    include: { ingredients: { include: { resource: true } } },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  const inventory = await ctx.prisma.inventoryItem.findMany({
    where: { entityId: ctx.lensRun.entityId },
    include: { resource: true },
    take: 500,
  });
  const have = new Set(inventory.map((x) => x.resource.externalKey ?? "").filter(Boolean));

  const choose = recipes.find((r) => r.ingredients.every((i) => have.has(i.resource.externalKey ?? ""))) ?? recipes[0];

  const plannedTasks: Array<{ type: string; title: string }> = [];
  if (!choose) {
    plannedTasks.push({ type: "meal.plan", title: `Choose a recipe for: ${goal.text}` });
    plannedTasks.push({ type: "meal.cook", title: `Cook: ${goal.text}` });
  } else {
    const missing = choose.ingredients
      .map((i) => i.resource.externalKey ?? "")
      .filter((k) => k && !have.has(k));
    if (missing.length) plannedTasks.push({ type: "meal.buy", title: `Buy ingredients for ${choose.name}` });
    plannedTasks.push({ type: "meal.cook", title: `Cook ${choose.name}` });
  }

  await proposeChangeSet(ctx.prisma, {
    taskId: task.id,
    changeSetId: ctx.lensRun.id,
    baseType: "meal.plan.v1",
    baseVersion: 1,
    riskLevel: "low",
    patch: { meal_goal_id: goal.id, tasks: plannedTasks },
    actor: ctx.system,
    correlation: { correlationId: `lensrun:${ctx.lensRun.id}` },
  });
}

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
    baseType: "inventory.import_text.v1",
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
  if (ctx.lensRun.lensKey === "meal_plan_v1") return runMealPlanV1(ctx);
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
