import { prisma, publishOutboxOnce } from "@ledger/db";
import { logger } from "@ledger/observability";
import { runLensRunsOnce } from "./lens/run.js";

async function main() {
  const intervalMs = Number(process.env.OUTBOX_POLL_MS ?? "1000");
  const systemActorId = String(process.env.WORKER_ACTOR_ID ?? "00000000-0000-0000-0000-000000000100");

  await prisma.actor.upsert({
    where: { id: systemActorId },
    create: { id: systemActorId, type: "system" },
    update: { type: "system" },
  });

  while (true) {
    const lensRuns = await runLensRunsOnce(prisma, { limit: 10, systemActorId });
    if (lensRuns > 0) {
      logger.info({ lensRuns }, "lens runs processed");
    }

    const published = await publishOutboxOnce(prisma, { limit: 25 });
    if (published > 0) {
      logger.info({ published }, "outbox published");
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

main()
  .catch((e) => {
    logger.error({ err: e }, "worker failed");
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
