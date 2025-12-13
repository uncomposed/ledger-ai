import test from "node:test";
import assert from "node:assert/strict";
import { prisma, publishOutboxOnce, createQuestion } from "@ledger/db";
import { buildApp } from "../server.js";
import { runLensRunsOnce } from "@ledger/db";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const ENTITY_ID = "00000000-0000-0000-0000-000000000001";
const MEMBER_ID = "00000000-0000-0000-0000-000000000010";
const ADMIN_ID = "00000000-0000-0000-0000-000000000011";
const ENTITY_B_ID = "00000000-0000-0000-0000-000000000002";
const ADMIN_B_ID = "00000000-0000-0000-0000-000000000012";

async function resetDb() {
  await prisma.eventLog.deleteMany({});
  await prisma.eventOutbox.deleteMany({});
  await prisma.changeSet.deleteMany({});
  await prisma.task.deleteMany({});
  await prisma.membership.deleteMany({});
  await prisma.entity.deleteMany({});
  await prisma.actor.deleteMany({});
}

async function seedActorsAndEntity() {
  await prisma.entity.create({ data: { id: ENTITY_ID } });
  await prisma.actor.create({ data: { id: MEMBER_ID, type: "human" } });
  await prisma.actor.create({ data: { id: ADMIN_ID, type: "human" } });
  await prisma.membership.create({ data: { entityId: ENTITY_ID, actorId: MEMBER_ID, role: "contributor" } });
  await prisma.membership.create({ data: { entityId: ENTITY_ID, actorId: ADMIN_ID, role: "admin" } });
}

test("task -> changeset -> apply emits events and publishes once", async () => {
  mustEnv("DATABASE_URL");
  await resetDb();
  await seedActorsAndEntity();

  const app = buildApp();
  await app.ready();

  const createRes = await app.inject({
    method: "POST",
    url: "/tasks",
    headers: {
      "x-entity-id": ENTITY_ID,
      "x-actor-id": MEMBER_ID,
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
  await seedActorsAndEntity();

  const app = buildApp();
  await app.ready();

  const createRes = await app.inject({
    method: "POST",
    url: "/tasks",
    headers: {
      "x-entity-id": ENTITY_ID,
      "x-actor-id": MEMBER_ID,
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
  await seedActorsAndEntity();

  const app = buildApp();
  await app.ready();

  const res = await app.inject({
    method: "POST",
    url: "/tasks",
    headers: {
      "x-entity-id": ENTITY_ID,
      "x-actor-id": MEMBER_ID,
      "x-correlation-id": "corr-extra",
    },
    payload: { type: "demo", title: "t3", extra: "nope" },
  });
  assert.equal(res.statusCode, 400);

  await app.close();
});

test("entity + membership audit events publish and cross-entity membership write is denied", async () => {
  mustEnv("DATABASE_URL");
  await resetDb();

  const app = buildApp();
  await app.ready();

  const createEntityRes = await app.inject({
    method: "POST",
    url: "/entities",
    headers: {
      "x-actor-id": ADMIN_ID,
      "x-correlation-id": "corr-entity-create",
    },
    payload: { entity_id: ENTITY_ID },
  });
  assert.equal(createEntityRes.statusCode, 200);

  const createEntityBRes = await app.inject({
    method: "POST",
    url: "/entities",
    headers: {
      "x-actor-id": ADMIN_B_ID,
      "x-correlation-id": "corr-entity-b-create",
    },
    payload: { entity_id: ENTITY_B_ID },
  });
  assert.equal(createEntityBRes.statusCode, 200);

  const addMemberRes = await app.inject({
    method: "POST",
    url: `/entities/${ENTITY_ID}/memberships`,
    headers: {
      "x-entity-id": ENTITY_ID,
      "x-actor-id": ADMIN_ID,
      "x-correlation-id": "corr-member-add",
    },
    payload: { actor_id: MEMBER_ID, role: "contributor" },
  });
  assert.equal(addMemberRes.statusCode, 200);
  const added = addMemberRes.json() as { membership_id: string; version: number };
  assert.equal(added.version, 0);

  const changeRoleRes = await app.inject({
    method: "PATCH",
    url: `/memberships/${added.membership_id}`,
    headers: {
      "x-entity-id": ENTITY_ID,
      "x-actor-id": ADMIN_ID,
      "x-correlation-id": "corr-member-role",
    },
    payload: { role: "accountable", expected_version: 0 },
  });
  assert.equal(changeRoleRes.statusCode, 200);

  const crossEntityDeniedRes = await app.inject({
    method: "POST",
    url: `/entities/${ENTITY_B_ID}/memberships`,
    headers: {
      "x-entity-id": ENTITY_ID,
      "x-actor-id": ADMIN_ID,
      "x-correlation-id": "corr-cross-entity",
    },
    payload: { actor_id: "00000000-0000-0000-0000-000000000099", role: "contributor" },
  });
  assert.equal(crossEntityDeniedRes.statusCode, 403);

  await publishOutboxOnce(prisma, { limit: 100, workerId: "api-test-m2", leaseSeconds: 0 });

  await prisma.eventLog.findFirstOrThrow({ where: { correlationId: "corr-entity-create", eventType: "entity.created.v1" } });
  await prisma.eventLog.findFirstOrThrow({ where: { correlationId: "corr-member-add", eventType: "membership.added.v1" } });
  await prisma.eventLog.findFirstOrThrow({ where: { correlationId: "corr-member-role", eventType: "membership.role_changed.v1" } });

  await app.close();
});

test("entity isolation: cannot read other entity's tasks/changesets by ID", async () => {
  mustEnv("DATABASE_URL");
  await resetDb();

  const app = buildApp();
  await app.ready();

  await app.inject({
    method: "POST",
    url: "/entities",
    headers: { "x-actor-id": ADMIN_ID, "x-correlation-id": "corr-create-a" },
    payload: { entity_id: ENTITY_ID },
  });

  await app.inject({
    method: "POST",
    url: "/entities",
    headers: { "x-actor-id": ADMIN_B_ID, "x-correlation-id": "corr-create-b" },
    payload: { entity_id: ENTITY_B_ID },
  });

  await app.inject({
    method: "POST",
    url: `/entities/${ENTITY_ID}/memberships`,
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": ADMIN_ID, "x-correlation-id": "corr-add-member-a" },
    payload: { actor_id: MEMBER_ID, role: "contributor" },
  });

  const createRes = await app.inject({
    method: "POST",
    url: "/tasks",
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": MEMBER_ID, "x-correlation-id": "corr-a-task" },
    payload: { type: "demo", title: "a-task" },
  });
  assert.equal(createRes.statusCode, 200);
  const created = createRes.json() as { task_id: string };

  const proposeRes = await app.inject({
    method: "POST",
    url: `/tasks/${created.task_id}/changesets`,
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": MEMBER_ID, "x-correlation-id": "corr-a-cs" },
    payload: { base_type: "demo", base_version: 1, risk_level: "low", patch: { op: "noop" } },
  });
  assert.equal(proposeRes.statusCode, 200);
  const proposed = proposeRes.json() as { changeset_id: string };

  const readTaskWrongEntity = await app.inject({
    method: "GET",
    url: `/tasks/${created.task_id}`,
    headers: { "x-entity-id": ENTITY_B_ID, "x-actor-id": ADMIN_B_ID, "x-correlation-id": "corr-read-wrong-task" },
  });
  assert.equal(readTaskWrongEntity.statusCode, 404);

  const readChangeSetWrongEntity = await app.inject({
    method: "GET",
    url: `/changesets/${proposed.changeset_id}`,
    headers: { "x-entity-id": ENTITY_B_ID, "x-actor-id": ADMIN_B_ID, "x-correlation-id": "corr-read-wrong-cs" },
  });
  assert.equal(readChangeSetWrongEntity.statusCode, 404);

  await app.close();
});

test("role enforcement: contributor cannot add memberships", async () => {
  mustEnv("DATABASE_URL");
  await resetDb();

  const app = buildApp();
  await app.ready();

  await app.inject({
    method: "POST",
    url: "/entities",
    headers: { "x-actor-id": ADMIN_ID, "x-correlation-id": "corr-create-roles" },
    payload: { entity_id: ENTITY_ID },
  });

  await app.inject({
    method: "POST",
    url: `/entities/${ENTITY_ID}/memberships`,
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": ADMIN_ID, "x-correlation-id": "corr-add-contrib" },
    payload: { actor_id: MEMBER_ID, role: "contributor" },
  });

  const res = await app.inject({
    method: "POST",
    url: `/entities/${ENTITY_ID}/memberships`,
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": MEMBER_ID, "x-correlation-id": "corr-contrib-add" },
    payload: { actor_id: "00000000-0000-0000-0000-000000000099", role: "contributor" },
  });
  assert.equal(res.statusCode, 403);

  await app.close();
});

test("role change affects permissions immediately (apply changeset)", async () => {
  mustEnv("DATABASE_URL");
  await resetDb();

  const app = buildApp();
  await app.ready();

  const createEntityRes = await app.inject({
    method: "POST",
    url: "/entities",
    headers: { "x-actor-id": ADMIN_ID, "x-correlation-id": "corr-rc-entity" },
    payload: { entity_id: ENTITY_ID },
  });
  assert.equal(createEntityRes.statusCode, 200);

  const addMemberRes = await app.inject({
    method: "POST",
    url: `/entities/${ENTITY_ID}/memberships`,
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": ADMIN_ID, "x-correlation-id": "corr-rc-add" },
    payload: { actor_id: MEMBER_ID, role: "contributor" },
  });
  assert.equal(addMemberRes.statusCode, 200);
  const membership = addMemberRes.json() as { membership_id: string; version: number };

  const createTaskRes = await app.inject({
    method: "POST",
    url: "/tasks",
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": MEMBER_ID, "x-correlation-id": "corr-rc-task" },
    payload: { type: "demo", title: "rc-task" },
  });
  assert.equal(createTaskRes.statusCode, 200);
  const created = createTaskRes.json() as { task_id: string; version: number };

  const proposeRes = await app.inject({
    method: "POST",
    url: `/tasks/${created.task_id}/changesets`,
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": MEMBER_ID, "x-correlation-id": "corr-rc-propose" },
    payload: { base_type: "demo", base_version: 1, risk_level: "low", patch: { op: "noop" } },
  });
  assert.equal(proposeRes.statusCode, 200);
  const proposed = proposeRes.json() as { changeset_id: string; version: number };

  const applyBeforeRoleChange = await app.inject({
    method: "POST",
    url: `/changesets/${proposed.changeset_id}/apply`,
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": MEMBER_ID, "x-correlation-id": "corr-rc-apply-before" },
    payload: { expected_version: proposed.version },
  });
  assert.equal(applyBeforeRoleChange.statusCode, 403);

  const changeRoleRes = await app.inject({
    method: "PATCH",
    url: `/memberships/${membership.membership_id}`,
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": ADMIN_ID, "x-correlation-id": "corr-rc-role" },
    payload: { role: "admin", expected_version: membership.version },
  });
  assert.equal(changeRoleRes.statusCode, 200);

  const applyAfterRoleChange = await app.inject({
    method: "POST",
    url: `/changesets/${proposed.changeset_id}/apply`,
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": MEMBER_ID, "x-correlation-id": "corr-rc-apply-after" },
    payload: { expected_version: proposed.version },
  });
  assert.equal(applyAfterRoleChange.statusCode, 200);

  await publishOutboxOnce(prisma, { limit: 200, workerId: "api-test-roles", leaseSeconds: 0 });

  await prisma.eventLog.findFirstOrThrow({ where: { correlationId: "corr-rc-add", eventType: "membership.added.v1" } });
  await prisma.eventLog.findFirstOrThrow({ where: { correlationId: "corr-rc-role", eventType: "membership.role_changed.v1" } });
  await prisma.eventLog.findFirstOrThrow({ where: { correlationId: "corr-rc-apply-after", eventType: "changeset.applied.v1" } });

  await app.close();
});

test("cross-entity isolation: cannot act within entity without membership", async () => {
  mustEnv("DATABASE_URL");
  await resetDb();

  const app = buildApp();
  await app.ready();

  await app.inject({
    method: "POST",
    url: "/entities",
    headers: { "x-actor-id": ADMIN_ID, "x-correlation-id": "corr-x-create-a" },
    payload: { entity_id: ENTITY_ID },
  });

  await app.inject({
    method: "POST",
    url: "/entities",
    headers: { "x-actor-id": ADMIN_B_ID, "x-correlation-id": "corr-x-create-b" },
    payload: { entity_id: ENTITY_B_ID },
  });

  await app.inject({
    method: "POST",
    url: `/entities/${ENTITY_ID}/memberships`,
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": ADMIN_ID, "x-correlation-id": "corr-x-add-a" },
    payload: { actor_id: MEMBER_ID, role: "contributor" },
  });

  const createDenied = await app.inject({
    method: "POST",
    url: "/tasks",
    headers: { "x-entity-id": ENTITY_B_ID, "x-actor-id": MEMBER_ID, "x-correlation-id": "corr-x-deny" },
    payload: { type: "demo", title: "nope" },
  });
  assert.equal(createDenied.statusCode, 403);

  await app.close();
});

test("role enforcement: accountable can read tasks but cannot write tasks", async () => {
  mustEnv("DATABASE_URL");
  await resetDb();

  const app = buildApp();
  await app.ready();

  await app.inject({
    method: "POST",
    url: "/entities",
    headers: { "x-actor-id": ADMIN_ID, "x-correlation-id": "corr-acct-entity" },
    payload: { entity_id: ENTITY_ID },
  });

  await app.inject({
    method: "POST",
    url: `/entities/${ENTITY_ID}/memberships`,
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": ADMIN_ID, "x-correlation-id": "corr-acct-add" },
    payload: { actor_id: MEMBER_ID, role: "accountable" },
  });

  const createDenied = await app.inject({
    method: "POST",
    url: "/tasks",
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": MEMBER_ID, "x-correlation-id": "corr-acct-create" },
    payload: { type: "demo", title: "nope" },
  });
  assert.equal(createDenied.statusCode, 403);

  const listOk = await app.inject({
    method: "GET",
    url: "/tasks",
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": MEMBER_ID, "x-correlation-id": "corr-acct-list" },
  });
  assert.equal(listOk.statusCode, 200);

  await app.close();
});

test("track ingestion enqueues lens run and emits event", async () => {
  mustEnv("DATABASE_URL");
  await resetDb();

  const app = buildApp();
  await app.ready();

  await app.inject({
    method: "POST",
    url: "/entities",
    headers: { "x-actor-id": ADMIN_ID, "x-correlation-id": "corr-track-entity" },
    payload: { entity_id: ENTITY_ID },
  });

  await app.inject({
    method: "POST",
    url: `/entities/${ENTITY_ID}/memberships`,
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": ADMIN_ID, "x-correlation-id": "corr-track-add" },
    payload: { actor_id: MEMBER_ID, role: "contributor" },
  });

  const trackRes = await app.inject({
    method: "POST",
    url: "/tracks",
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": MEMBER_ID, "x-correlation-id": "corr-track-ingest" },
    payload: { kind: "text", text: "milk\neggs" },
  });
  assert.equal(trackRes.statusCode, 200);
  const track = trackRes.json() as { track_id: string; lens_run_id: string };

  const lensRun = await prisma.lensRun.findUniqueOrThrow({ where: { id: track.lens_run_id } });
  assert.equal(lensRun.status, "queued");

  await publishOutboxOnce(prisma, { limit: 200, workerId: "api-test-track", leaseSeconds: 0 });

  await prisma.eventLog.findFirstOrThrow({ where: { correlationId: "corr-track-ingest", eventType: "track.ingested.v1" } });

  await app.close();
});

test("questions list and answer endpoint work and emit event", async () => {
  mustEnv("DATABASE_URL");
  await resetDb();

  const app = buildApp();
  await app.ready();

  await app.inject({
    method: "POST",
    url: "/entities",
    headers: { "x-actor-id": ADMIN_ID, "x-correlation-id": "corr-q-entity" },
    payload: { entity_id: ENTITY_ID },
  });

  await app.inject({
    method: "POST",
    url: `/entities/${ENTITY_ID}/memberships`,
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": ADMIN_ID, "x-correlation-id": "corr-q-add" },
    payload: { actor_id: MEMBER_ID, role: "contributor" },
  });

  const q = await createQuestion(prisma, {
    entityId: ENTITY_ID,
    prompt: "What unit is this?",
    context: { field: "quantity" },
    actor: { actorId: MEMBER_ID, entityId: ENTITY_ID, role: "contributor" },
    correlation: { correlationId: "corr-q-ask" },
  });

  const listRes = await app.inject({
    method: "GET",
    url: "/questions?status=open",
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": MEMBER_ID, "x-correlation-id": "corr-q-list" },
  });
  assert.equal(listRes.statusCode, 200);
  const list = listRes.json() as Array<{ question_id: string }>;
  assert.ok(list.some((x) => x.question_id === q.id));

  const answerRes = await app.inject({
    method: "POST",
    url: `/questions/${q.id}/answer`,
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": MEMBER_ID, "x-correlation-id": "corr-q-answer" },
    payload: { expected_version: 0, answer: { unit: "count" } },
  });
  assert.equal(answerRes.statusCode, 200);

  await publishOutboxOnce(prisma, { limit: 200, workerId: "api-test-q", leaseSeconds: 0 });

  await prisma.eventLog.findFirstOrThrow({ where: { correlationId: "corr-q-answer", eventType: "question.answered.v1" } });

  await app.close();
});

test("lens run processes track and produces approval-queue proposal (idempotent)", async () => {
  mustEnv("DATABASE_URL");
  await resetDb();

  const app = buildApp();
  await app.ready();

  await app.inject({
    method: "POST",
    url: "/entities",
    headers: { "x-actor-id": ADMIN_ID, "x-correlation-id": "corr-lens-entity" },
    payload: { entity_id: ENTITY_ID },
  });

  await app.inject({
    method: "POST",
    url: `/entities/${ENTITY_ID}/memberships`,
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": ADMIN_ID, "x-correlation-id": "corr-lens-add" },
    payload: { actor_id: MEMBER_ID, role: "contributor" },
  });

  const SYSTEM_ID = "00000000-0000-0000-0000-000000000100";
  await prisma.actor.upsert({ where: { id: SYSTEM_ID }, create: { id: SYSTEM_ID, type: "system" }, update: { type: "system" } });

  const trackRes = await app.inject({
    method: "POST",
    url: "/tracks",
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": MEMBER_ID, "x-correlation-id": "corr-lens-ingest" },
    payload: { kind: "text", text: "milk\neggs" },
  });
  assert.equal(trackRes.statusCode, 200);
  const { track_id, lens_run_id } = trackRes.json() as { track_id: string; lens_run_id: string };

  const processed1 = await runLensRunsOnce(prisma, { limit: 10, systemActorId: SYSTEM_ID });
  assert.equal(processed1, 1);
  const processed2 = await runLensRunsOnce(prisma, { limit: 10, systemActorId: SYSTEM_ID });
  assert.equal(processed2, 0);

  const lensRun = await prisma.lensRun.findUniqueOrThrow({ where: { id: lens_run_id } });
  assert.equal(lensRun.status, "succeeded");

  const track = await prisma.track.findUniqueOrThrow({ where: { id: track_id } });
  assert.equal(track.status, "processed");

  const queueRes = await app.inject({
    method: "GET",
    url: "/approval-queue",
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": MEMBER_ID, "x-correlation-id": "corr-lens-queue" },
  });
  assert.equal(queueRes.statusCode, 200);
  const queue = queueRes.json() as Array<{ changeset_id: string; base_type: string }>;
  assert.ok(queue.some((x) => x.changeset_id === lens_run_id && x.base_type === "pantry_text.v1"));

  await publishOutboxOnce(prisma, { limit: 500, workerId: "api-test-lens", leaseSeconds: 0 });
  await prisma.eventLog.findFirstOrThrow({ where: { correlationId: `lensrun:${lens_run_id}`, eventType: "lens.run.completed.v1" } });
  await prisma.eventLog.findFirstOrThrow({ where: { correlationId: `lensrun:${lens_run_id}`, eventType: "changeset.proposed.v1" } });

  await app.close();
});
