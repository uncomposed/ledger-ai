import test from "node:test";
import assert from "node:assert/strict";
import { prisma, publishOutboxOnce } from "../index.js";
import type { Prisma } from "@prisma/client";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

test("outbox retry does not duplicate event_log rows", async () => {
  mustEnv("DATABASE_URL");

  await prisma.eventLog.deleteMany({});
  await prisma.eventOutbox.deleteMany({});

  const outbox = await prisma.eventOutbox.create({
    data: {
      entityId: "00000000-0000-0000-0000-000000000001",
      correlationId: "t-idempotency",
      eventType: "task.created.v1",
      eventVersion: 1,
      occurredAt: new Date(),
      payload: {
        correlation_id: "t-idempotency",
        task_id: "00000000-0000-0000-0000-000000000010",
        created_by_actor_id: "00000000-0000-0000-0000-000000000020",
        produced: { changeset_ids: [] },
      },
    },
  });

  await prisma.eventLog.create({
    data: {
      outboxId: outbox.id,
      entityId: outbox.entityId,
      correlationId: outbox.correlationId,
      eventType: outbox.eventType,
      eventVersion: outbox.eventVersion,
      occurredAt: outbox.occurredAt,
      payload: outbox.payload as Prisma.InputJsonValue,
    },
  });

  assert.equal(outbox.publishedAt, null);

  const published = await publishOutboxOnce(prisma, { limit: 25 });
  assert.equal(published, 1);

  const logs = await prisma.eventLog.findMany({ where: { outboxId: outbox.id } });
  assert.equal(logs.length, 1);

  const outboxAfter = await prisma.eventOutbox.findUniqueOrThrow({ where: { id: outbox.id } });
  assert.notEqual(outboxAfter.publishedAt, null);
});

test("crash window after append is safe on retry", async () => {
  mustEnv("DATABASE_URL");

  await prisma.eventLog.deleteMany({});
  await prisma.eventOutbox.deleteMany({});

  const outbox = await prisma.eventOutbox.create({
    data: {
      entityId: "00000000-0000-0000-0000-000000000001",
      correlationId: "t-crash-window",
      eventType: "task.created.v1",
      eventVersion: 1,
      occurredAt: new Date(),
      payload: {
        correlation_id: "t-crash-window",
        task_id: "00000000-0000-0000-0000-000000000011",
        created_by_actor_id: "00000000-0000-0000-0000-000000000021",
        produced: { changeset_ids: [] },
      },
    },
  });

  await assert.rejects(
    publishOutboxOnce(prisma, {
      limit: 25,
      workerId: "t1",
      leaseSeconds: 0,
      crashAfterAppendOutboxId: outbox.id,
    }),
    /failpoint: crash after append/,
  );

  const logsAfterCrash = await prisma.eventLog.findMany({ where: { outboxId: outbox.id } });
  assert.equal(logsAfterCrash.length, 1);

  const outboxAfterCrash = await prisma.eventOutbox.findUniqueOrThrow({ where: { id: outbox.id } });
  assert.equal(outboxAfterCrash.publishedAt, null);

  await publishOutboxOnce(prisma, { limit: 25, workerId: "t2", leaseSeconds: 0 });

  const logsAfterRetry = await prisma.eventLog.findMany({ where: { outboxId: outbox.id } });
  assert.equal(logsAfterRetry.length, 1);

  const outboxAfterRetry = await prisma.eventOutbox.findUniqueOrThrow({ where: { id: outbox.id } });
  assert.notEqual(outboxAfterRetry.publishedAt, null);
});
