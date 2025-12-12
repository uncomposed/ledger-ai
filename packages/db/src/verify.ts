import { prisma } from "./client.js";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

async function main() {
  mustEnv("DATABASE_URL");
  await prisma.$queryRaw`select 1`;

  const indexes = (await prisma.$queryRaw`
    select indexname from pg_indexes where schemaname = 'public'
  `) as Array<{ indexname: string }>;

  const required = [
    "EventOutbox_publishedAt_idx",
    "EventLog_entityId_occurredAt_idx",
    "EventLog_outboxId_key",
    "Task_entityId_state_idx",
    "ChangeSet_entityId_state_idx",
  ];

  const have = new Set(indexes.map((x) => x.indexname));
  const missing = required.filter((r) => !have.has(r));
  if (missing.length) {
    throw new Error(`Missing required indexes: ${missing.join(", ")}`);
  }

  console.log("db:verify OK");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
