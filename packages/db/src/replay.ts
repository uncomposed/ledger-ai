import { prisma } from "./client.js";

function usage(): never {
  console.error("Usage: pnpm -C packages/db events:replay -- --entity <uuid> [--since <iso>] [--limit <n>]");
  process.exit(2);
}

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function parseLimit(raw: string | undefined): number {
  if (!raw) return 200;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid --limit: ${raw}`);
  return Math.min(2000, Math.floor(n));
}

async function main() {
  const entityId = arg("--entity");
  if (!entityId) usage();

  const sinceRaw = arg("--since");
  const since = sinceRaw ? new Date(sinceRaw) : undefined;
  if (sinceRaw && Number.isNaN(since!.getTime())) throw new Error(`Invalid --since: ${sinceRaw}`);

  const limit = parseLimit(arg("--limit"));

  const rows = await prisma.eventLog.findMany({
    where: {
      entityId,
      ...(since ? { occurredAt: { gte: since } } : {}),
    },
    orderBy: [{ occurredAt: "asc" }, { appendedAt: "asc" }],
    take: limit,
  });

  for (const e of rows) {
    process.stdout.write(
      JSON.stringify(
        {
          occurred_at: e.occurredAt.toISOString(),
          appended_at: e.appendedAt.toISOString(),
          event_type: e.eventType,
          event_version: e.eventVersion,
          correlation_id: e.correlationId,
          payload: e.payload,
        },
        null,
        0,
      ) + "\n",
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());

