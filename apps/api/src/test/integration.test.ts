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
  await prisma.inventoryMutation.deleteMany({});
  await prisma.inventoryItem.deleteMany({});
  await prisma.location.deleteMany({});
  await prisma.resource.deleteMany({});
  await prisma.recipeIngredient.deleteMany({});
  await prisma.recipeStep.deleteMany({});
  await prisma.recipe.deleteMany({});
  await prisma.mealGoal.deleteMany({});
  await prisma.taskSubject.deleteMany({});
  await prisma.trackAttachment.deleteMany({});
  await prisma.answer.deleteMany({});
  await prisma.question.deleteMany({});
  await prisma.lensRun.deleteMany({});
  await prisma.track.deleteMany({});
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
  assert.ok(queue.some((x) => x.changeset_id === lens_run_id && x.base_type === "inventory.import_text.v1"));

  const cs = await prisma.changeSet.findUniqueOrThrow({ where: { id: lens_run_id } });
  assert.equal(cs.state, "pending_approval");

  const applyRes = await app.inject({
    method: "POST",
    url: `/changesets/${lens_run_id}/apply`,
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": ADMIN_ID, "x-correlation-id": "corr-inv-apply" },
    payload: { expected_version: cs.version },
  });
  assert.equal(applyRes.statusCode, 200);

  const invRes = await app.inject({
    method: "GET",
    url: "/inventory",
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": MEMBER_ID, "x-correlation-id": "corr-inv-list" },
  });
  assert.equal(invRes.statusCode, 200);
  const items = invRes.json() as Array<{ resource_name: string | null; location_kind: string | null }>;
  assert.ok(items.length >= 2);
  assert.ok(items.some((x) => x.resource_name?.toLowerCase().includes("milk")));
  assert.ok(items.some((x) => x.location_kind === "kitchen.pantry"));

  await publishOutboxOnce(prisma, { limit: 500, workerId: "api-test-lens", leaseSeconds: 0 });
  await prisma.eventLog.findFirstOrThrow({ where: { correlationId: `lensrun:${lens_run_id}`, eventType: "lens.run.completed.v1" } });
  await prisma.eventLog.findFirstOrThrow({ where: { correlationId: `lensrun:${lens_run_id}`, eventType: "changeset.proposed.v1" } });
  await prisma.eventLog.findFirstOrThrow({ where: { correlationId: "corr-inv-apply", eventType: "inventory.import_text.applied.v1" } });

  await app.close();
});

test("meal goals can be created and listed (and emit event)", async () => {
  mustEnv("DATABASE_URL");
  await resetDb();

  const app = buildApp();
  await app.ready();

  await app.inject({
    method: "POST",
    url: "/entities",
    headers: { "x-actor-id": ADMIN_ID, "x-correlation-id": "corr-meal-entity" },
    payload: { entity_id: ENTITY_ID },
  });

  await app.inject({
    method: "POST",
    url: `/entities/${ENTITY_ID}/memberships`,
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": ADMIN_ID, "x-correlation-id": "corr-meal-add" },
    payload: { actor_id: MEMBER_ID, role: "contributor" },
  });

  const createRes = await app.inject({
    method: "POST",
    url: "/meal-goals",
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": MEMBER_ID, "x-correlation-id": "corr-meal-create" },
    payload: { text: "It would be great if we could cook pasta this week" },
  });
  assert.equal(createRes.statusCode, 200);
  const created = createRes.json() as { meal_goal_id: string };

  const listRes = await app.inject({
    method: "GET",
    url: "/meal-goals",
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": MEMBER_ID, "x-correlation-id": "corr-meal-list" },
  });
  assert.equal(listRes.statusCode, 200);
  const list = listRes.json() as Array<{ meal_goal_id: string }>;
  assert.ok(list.some((x) => x.meal_goal_id === created.meal_goal_id));

  await publishOutboxOnce(prisma, { limit: 200, workerId: "api-test-meal", leaseSeconds: 0 });
  await prisma.eventLog.findFirstOrThrow({ where: { correlationId: "corr-meal-create", eventType: "meal.goal.created.v1" } });

  await app.close();
});

test("meal goal planning produces a plan changeset and applying it creates tasks", async () => {
  mustEnv("DATABASE_URL");
  await resetDb();

  const app = buildApp();
  await app.ready();

  await app.inject({
    method: "POST",
    url: "/entities",
    headers: { "x-actor-id": ADMIN_ID, "x-correlation-id": "corr-plan-entity" },
    payload: { entity_id: ENTITY_ID },
  });

  await app.inject({
    method: "POST",
    url: `/entities/${ENTITY_ID}/memberships`,
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": ADMIN_ID, "x-correlation-id": "corr-plan-add" },
    payload: { actor_id: MEMBER_ID, role: "contributor" },
  });

  // Seed a minimal recipe (entity-scoped) with ingredients matching inventory.import_text externalKeys.
  const pasta = await prisma.resource.upsert({
    where: { entityId_kind_externalKey: { entityId: ENTITY_ID, kind: "inventory.item", externalKey: "pasta" } },
    create: { entityId: ENTITY_ID, kind: "inventory.item", externalKey: "pasta", name: "Pasta" },
    update: { name: "Pasta" },
  });

  const sauce = await prisma.resource.upsert({
    where: { entityId_kind_externalKey: { entityId: ENTITY_ID, kind: "inventory.item", externalKey: "tomato sauce" } },
    create: { entityId: ENTITY_ID, kind: "inventory.item", externalKey: "tomato sauce", name: "Tomato Sauce" },
    update: { name: "Tomato Sauce" },
  });

  const recipe = await prisma.recipe.create({ data: { entityId: ENTITY_ID, name: "Pasta Marinara" } });
  await prisma.recipeIngredient.createMany({
    data: [
      { recipeId: recipe.id, resourceId: pasta.id },
      { recipeId: recipe.id, resourceId: sauce.id },
    ],
  });
  await prisma.recipeStep.createMany({
    data: [
      { recipeId: recipe.id, stepIndex: 0, text: "Boil pasta." },
      { recipeId: recipe.id, stepIndex: 1, text: "Warm sauce and combine." },
    ],
  });

  // Ingest inventory list containing only pasta.
  const invTrackRes = await app.inject({
    method: "POST",
    url: "/tracks",
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": MEMBER_ID, "x-correlation-id": "corr-plan-inv-track" },
    payload: { kind: "text", text: "pasta" },
  });
  assert.equal(invTrackRes.statusCode, 200);
  const invLens = invTrackRes.json() as { lens_run_id: string };

  const SYSTEM_ID = "00000000-0000-0000-0000-000000000100";
  const processedInv = await runLensRunsOnce(prisma, { limit: 10, systemActorId: SYSTEM_ID, leaseSeconds: 0 });
  assert.equal(processedInv, 1);

  const invCs = await prisma.changeSet.findUniqueOrThrow({ where: { id: invLens.lens_run_id } });
  const invApplyRes = await app.inject({
    method: "POST",
    url: `/changesets/${invCs.id}/apply`,
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": ADMIN_ID, "x-correlation-id": "corr-plan-inv-apply" },
    payload: { expected_version: invCs.version },
  });
  assert.equal(invApplyRes.statusCode, 200);

  const mealRes = await app.inject({
    method: "POST",
    url: "/meal-goals",
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": MEMBER_ID, "x-correlation-id": "corr-plan-goal" },
    payload: { text: "Cook something easy" },
  });
  assert.equal(mealRes.statusCode, 200);
  const goal = mealRes.json() as { meal_goal_id: string };

  const planRes = await app.inject({
    method: "POST",
    url: `/meal-goals/${goal.meal_goal_id}/plan`,
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": MEMBER_ID, "x-correlation-id": "corr-plan-trigger" },
    payload: {},
  });
  assert.equal(planRes.statusCode, 200);
  const plan = planRes.json() as { lens_run_id: string };

  const processedPlan = await runLensRunsOnce(prisma, { limit: 10, systemActorId: SYSTEM_ID, leaseSeconds: 0 });
  assert.equal(processedPlan, 1);

  const planCs = await prisma.changeSet.findUniqueOrThrow({ where: { id: plan.lens_run_id } });
  assert.equal(planCs.baseType, "meal.plan.v1");

  const applyPlanRes = await app.inject({
    method: "POST",
    url: `/changesets/${planCs.id}/apply`,
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": ADMIN_ID, "x-correlation-id": "corr-plan-apply" },
    payload: { expected_version: planCs.version },
  });
  assert.equal(applyPlanRes.statusCode, 200);

  const tasksRes = await app.inject({
    method: "GET",
    url: "/tasks?limit=50",
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": MEMBER_ID, "x-correlation-id": "corr-plan-tasks" },
  });
  assert.equal(tasksRes.statusCode, 200);
  const tasks = tasksRes.json() as Array<{ task_id: string; title: string }>;
  assert.ok(tasks.some((t) => t.title.includes("Cook Pasta Marinara")));
  const buy = tasks.find((t) => t.title.includes("Buy ingredients for Pasta Marinara"));
  assert.ok(buy);

  await publishOutboxOnce(prisma, { limit: 500, workerId: "api-test-plan", leaseSeconds: 0 });
  await prisma.eventLog.findFirstOrThrow({ where: { correlationId: "corr-plan-apply", eventType: "meal.plan.applied.v1" } });

  // Completing the procurement task auto-applies an inventory delta when performed by an admin.
  const readyBuy = await app.inject({
    method: "POST",
    url: `/tasks/${buy!.task_id}/state`,
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": ADMIN_ID, "x-correlation-id": "corr-plan-buy-ready" },
    payload: { to_state: "ready", expected_version: 0 },
  });
  assert.equal(readyBuy.statusCode, 200);

  const progressBuy = await app.inject({
    method: "POST",
    url: `/tasks/${buy!.task_id}/state`,
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": ADMIN_ID, "x-correlation-id": "corr-plan-buy-progress" },
    payload: { to_state: "in_progress", expected_version: 1 },
  });
  assert.equal(progressBuy.statusCode, 200);

  const completeBuy = await app.inject({
    method: "POST",
    url: `/tasks/${buy!.task_id}/state`,
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": ADMIN_ID, "x-correlation-id": "corr-plan-buy-complete" },
    payload: { to_state: "completed", expected_version: 2 },
  });
  assert.equal(completeBuy.statusCode, 200);

  const afterInv = await app.inject({
    method: "GET",
    url: "/inventory?limit=200",
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": MEMBER_ID, "x-correlation-id": "corr-plan-inv-after" },
  });
  assert.equal(afterInv.statusCode, 200);
  const afterItems = afterInv.json() as Array<{ resource_name: string | null }>;
  assert.ok(afterItems.some((x) => x.resource_name?.toLowerCase().includes("tomato sauce")));

  await publishOutboxOnce(prisma, { limit: 500, workerId: "api-test-plan2", leaseSeconds: 0 });
  await prisma.eventLog.findFirstOrThrow({ where: { correlationId: "corr-plan-buy-complete", eventType: "inventory.delta.applied.v1" } });
  const deltaLogs = await prisma.eventLog.findMany({
    where: { correlationId: "corr-plan-buy-complete", eventType: "inventory.delta.applied.v1" },
  });
  assert.equal(deltaLogs.length, 1);

  await app.close();
});

test("non-admin completion creates pending inventory delta changeset", async () => {
  mustEnv("DATABASE_URL");
  await resetDb();

  const ACCOUNTABLE_ID = "00000000-0000-0000-0000-000000000013";

  const app = buildApp();
  await app.ready();

  await app.inject({
    method: "POST",
    url: "/entities",
    headers: { "x-actor-id": ADMIN_ID, "x-correlation-id": "corr-entity-na" },
    payload: { entity_id: ENTITY_ID },
  });

  await app.inject({
    method: "POST",
    url: `/entities/${ENTITY_ID}/memberships`,
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": ADMIN_ID, "x-correlation-id": "corr-add-member" },
    payload: { actor_id: MEMBER_ID, role: "contributor" },
  });

  await app.inject({
    method: "POST",
    url: `/entities/${ENTITY_ID}/memberships`,
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": ADMIN_ID, "x-correlation-id": "corr-add-acc" },
    payload: { actor_id: ACCOUNTABLE_ID, role: "accountable" },
  });

  const sauce = await prisma.resource.upsert({
    where: { entityId_kind_externalKey: { entityId: ENTITY_ID, kind: "inventory.item", externalKey: "tomato sauce" } },
    create: { entityId: ENTITY_ID, kind: "inventory.item", externalKey: "tomato sauce", name: "Tomato Sauce" },
    update: { name: "Tomato Sauce" },
  });

  const createRes = await app.inject({
    method: "POST",
    url: "/tasks",
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": MEMBER_ID, "x-correlation-id": "corr-na-create" },
    payload: { type: "meal.buy", title: "Buy tomato sauce" },
  });
  assert.equal(createRes.statusCode, 200);
  const created = createRes.json() as { task_id: string };

  await prisma.taskSubject.create({
    data: { entityId: ENTITY_ID, taskId: created.task_id, subjectType: "resource", subjectId: sauce.id },
  });

  const toReady = await app.inject({
    method: "POST",
    url: `/tasks/${created.task_id}/state`,
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": MEMBER_ID, "x-correlation-id": "corr-na-ready" },
    payload: { to_state: "ready", expected_version: 0 },
  });
  assert.equal(toReady.statusCode, 200);

  const toProgress = await app.inject({
    method: "POST",
    url: `/tasks/${created.task_id}/state`,
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": MEMBER_ID, "x-correlation-id": "corr-na-progress" },
    payload: { to_state: "in_progress", expected_version: 1 },
  });
  assert.equal(toProgress.statusCode, 200);

  const toComplete = await app.inject({
    method: "POST",
    url: `/tasks/${created.task_id}/state`,
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": ACCOUNTABLE_ID, "x-correlation-id": "corr-na-complete" },
    payload: { to_state: "completed", expected_version: 2 },
  });
  assert.equal(toComplete.statusCode, 200);

  // Accountable cannot apply ChangeSets, so the effects should be proposed but not applied.
  const cs = await prisma.changeSet.findFirstOrThrow({
    where: { taskId: created.task_id, baseType: "inventory.delta.v1", state: "pending_approval" },
    orderBy: { createdAt: "desc" },
  });

  const invRes = await app.inject({
    method: "GET",
    url: "/inventory?limit=200",
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": MEMBER_ID, "x-correlation-id": "corr-na-inv-before" },
  });
  assert.equal(invRes.statusCode, 200);
  const beforeItems = invRes.json() as Array<{ resource_name: string | null }>;
  assert.ok(!beforeItems.some((x) => x.resource_name?.toLowerCase().includes("tomato sauce")));

  const applyRes = await app.inject({
    method: "POST",
    url: `/changesets/${cs.id}/apply`,
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": ADMIN_ID, "x-correlation-id": "corr-na-apply" },
    payload: { expected_version: cs.version },
  });
  assert.equal(applyRes.statusCode, 200);

  const invRes2 = await app.inject({
    method: "GET",
    url: "/inventory?limit=200",
    headers: { "x-entity-id": ENTITY_ID, "x-actor-id": MEMBER_ID, "x-correlation-id": "corr-na-inv-after" },
  });
  assert.equal(invRes2.statusCode, 200);
  const afterItems = invRes2.json() as Array<{ resource_name: string | null }>;
  assert.ok(afterItems.some((x) => x.resource_name?.toLowerCase().includes("tomato sauce")));

  await publishOutboxOnce(prisma, { limit: 500, workerId: "api-test-nonadmin", leaseSeconds: 0 });
  await prisma.eventLog.findFirstOrThrow({ where: { correlationId: "corr-na-complete", eventType: "changeset.proposed.v1" } });
  await prisma.eventLog.findFirstOrThrow({ where: { correlationId: "corr-na-apply", eventType: "inventory.delta.applied.v1" } });
  await publishOutboxOnce(prisma, { limit: 500, workerId: "api-test-nonadmin2", leaseSeconds: 0 });
  const appliedLogs = await prisma.eventLog.findMany({ where: { correlationId: "corr-na-apply", eventType: "inventory.delta.applied.v1" } });
  assert.equal(appliedLogs.length, 1);

  await app.close();
});
