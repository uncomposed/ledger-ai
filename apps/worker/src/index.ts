import { prisma } from "@ledger/db";
import { logger } from "@ledger/observability";
import { publishOutboxOnce } from "./outbox/publish.js";

async function main() {
  const intervalMs = Number(process.env.OUTBOX_POLL_MS ?? "1000");

  while (true) {
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

