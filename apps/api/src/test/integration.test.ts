import test from "node:test";
import assert from "node:assert/strict";
import { prisma, publishOutboxOnce } from "@ledger/db";
import { buildApp } from "../server.js";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const ENTITY_ID = "00000000-0000-0000-0000-000000000001";
const MEMBER_ID = "00000000-0000-0000-0000-000000000010";
const ADMIN_ID = "00000000-0000-0000-0000-000000000011";

async function resetDb() {
  await prisma.eventLog.deleteMany({});
  await prisma.eventOutbox.deleteMany({});
  await prisma.changeSet.deleteMany({});
  await prisma.task.deleteMany({});
}

test("task -> changeset -> apply emits events and publishes once", async () => {
  mustEnv("DATABASE_URL");
  await resetDb();

  const app = buildApp();
  await app.ready();

  const createRes = await app.inject({
    method: "POST",
    url: "/tasks",
    headers: {
      "x-entity-id": ENTITY_ID,
      "x-actor-id": MEMBER_ID,
      "x-actor-role": "member",
      "x-correlation-id": "corr-create",
    },
    payload: { type: "demo", title: "t1" },
  });
  assert.equal(createRes.statusCode, 200);
  const created = createRes.json() as { task_id: string; version: number };
  assert.equal(created.version, 0);

  const proposeRes = await app.inject({
    method: "POST",
    url: `/tasks/${created.task_id}/changesets`,
    headers: {
      "x-entity-id": ENTITY_ID,
      "x-actor-id": MEMBER_ID,
      "x-actor-role": "member",
      "x-correlation-id": "corr-propose",
    },
    payload: { base_type: "demo", base_version: 1, risk_level: "low", patch: { op: "noop" } },
  });
  assert.equal(proposeRes.statusCode, 200);
  const proposed = proposeRes.json() as { changeset_id: string; version: number };
  assert.equal(proposed.version, 0);

  const applyForbiddenRes = await app.inject({
    method: "POST",
    url: `/changesets/${proposed.changeset_id}/apply`,
    headers: {
      "x-entity-id": ENTITY_ID,
      "x-actor-id": MEMBER_ID,
      "x-actor-role": "member",
      "x-correlation-id": "corr-apply-member",
    },
    payload: { expected_version: 0 },
  });
  assert.equal(applyForbiddenRes.statusCode, 403);

  const applyRes = await app.inject({
    method: "POST",
    url: `/changesets/${proposed.changeset_id}/apply`,
    headers: {
      "x-entity-id": ENTITY_ID,
      "x-actor-id": ADMIN_ID,
      "x-actor-role": "admin",
      "x-correlation-id": "corr-apply-admin",
    },
    payload: { expected_version: 0 },
  });
  assert.equal(applyRes.statusCode, 200);

  await publishOutboxOnce(prisma, { limit: 100, workerId: "api-test", leaseSeconds: 0 });

  const createdEvent = await prisma.eventLog.findFirstOrThrow({
    where: { correlationId: "corr-create", eventType: "task.created.v1" },
  });
  assert.equal(createdEvent.correlationId, "corr-create");

  const proposedEvent = await prisma.eventLog.findFirstOrThrow({
    where: { correlationId: "corr-propose", eventType: "changeset.proposed.v1" },
  });
  assert.equal(proposedEvent.correlationId, "corr-propose");

  const appliedEvent = await prisma.eventLog.findFirstOrThrow({
    where: { correlationId: "corr-apply-admin", eventType: "changeset.applied.v1" },
  });
  assert.equal(appliedEvent.correlationId, "corr-apply-admin");

  await app.close();
});

test("double submit with stale version returns 409", async () => {
  mustEnv("DATABASE_URL");
  await resetDb();

  const app = buildApp();
  await app.ready();

  const createRes = await app.inject({
    method: "POST",
    url: "/tasks",
    headers: {
      "x-entity-id": ENTITY_ID,
      "x-actor-id": MEMBER_ID,
      "x-actor-role": "member",
      "x-correlation-id": "corr-create-2",
    },
    payload: { type: "demo", title: "t2" },
  });
  assert.equal(createRes.statusCode, 200);
  const created = createRes.json() as { task_id: string; version: number };

  const toReadyRes = await app.inject({
    method: "POST",
    url: `/tasks/${created.task_id}/state`,
    headers: {
      "x-entity-id": ENTITY_ID,
      "x-actor-id": MEMBER_ID,
      "x-actor-role": "member",
      "x-correlation-id": "corr-ready",
    },
    payload: { to_state: "ready", expected_version: created.version },
  });
  assert.equal(toReadyRes.statusCode, 200);

  const staleRes = await app.inject({
    method: "POST",
    url: `/tasks/${created.task_id}/state`,
    headers: {
      "x-entity-id": ENTITY_ID,
      "x-actor-id": MEMBER_ID,
      "x-actor-role": "member",
      "x-correlation-id": "corr-stale",
    },
    payload: { to_state: "in_progress", expected_version: created.version },
  });
  assert.equal(staleRes.statusCode, 409);

  await app.close();
});

test("unknown fields are rejected by default", async () => {
  mustEnv("DATABASE_URL");
  await resetDb();

  const app = buildApp();
  await app.ready();

  const res = await app.inject({
    method: "POST",
    url: "/tasks",
    headers: {
      "x-entity-id": ENTITY_ID,
      "x-actor-id": MEMBER_ID,
      "x-actor-role": "member",
      "x-correlation-id": "corr-extra",
    },
    payload: { type: "demo", title: "t3", extra: "nope" },
  });
  assert.equal(res.statusCode, 400);

  await app.close();
});

