import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { logger } from "@ledger/observability";
import { prisma } from "@ledger/db";
import type { PrismaClient } from "@ledger/db";
import { can } from "@ledger/policy";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  createEntity,
  addMembership,
  changeMembershipRole,
  ingestTrack,
  ensureLensRun,
  answerQuestion,
  applyChangeSet,
  createTask,
  proposeChangeSet,
  transitionTaskState,
} from "@ledger/db";
import { buildAuthProvider, type EntityScopedActor } from "./auth/provider.js";
import { enforceRouteSchemas } from "./http/strict-routes.js";
import { ChangeSetStates, MembershipRoles, TaskStates, nonNegativeIntSchema, strictObjectSchema, uuidSchema } from "./http/schema.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }

  interface FastifyRequest {
    actorId?: string;
    actor?: EntityScopedActor;
    correlationId: string;
  }
}

export function buildApp() {
  const app = Fastify({
    logger: false,
    requestIdHeader: "x-correlation-id",
    ajv: {
      customOptions: {
        allErrors: true,
        removeAdditional: false,
      },
    },
  });

  app.decorate("prisma", prisma);

  enforceRouteSchemas(app);

  const authProvider = buildAuthProvider(app.prisma);

  app.addHook("preHandler", async (req) => {
    req.correlationId = req.id;
    const mode = (req.routeOptions.config as any)?.auth as "public" | "actor" | "entity";
    if (mode === "public") return;
    if (mode === "actor") {
      req.actorId = authProvider.actorIdFromRequest(req);
      return;
    }
    req.actor = await authProvider.entityScopedActorFromRequest(req);
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof NotFoundError) return reply.status(404).send({ error: "not_found", message: err.message });
    if (err instanceof ForbiddenError) return reply.status(403).send({ error: "forbidden", message: err.message });
    if (err instanceof ConflictError) return reply.status(409).send({ error: "conflict", message: err.message });
    // Fastify validation errors
    if ((err as any)?.validation) {
      return reply.status(400).send({ error: "bad_request", message: String(err.message ?? "validation failed") });
    }
    const message = process.env.NODE_ENV === "production" ? "internal error" : String(err?.message ?? err);
    return reply.status(500).send({ error: "internal", message });
  });

  const AuthedHeaders = {
    type: "object",
    additionalProperties: true,
    properties: {
      "x-entity-id": uuidSchema(),
      "x-actor-id": uuidSchema(),
      "x-correlation-id": { type: "string" },
    },
    required: ["x-entity-id", "x-actor-id"],
  };

  const ActorOnlyHeaders = {
    type: "object",
    additionalProperties: true,
    properties: {
      "x-actor-id": uuidSchema(),
      "x-correlation-id": { type: "string" },
    },
    required: ["x-actor-id"],
  };

  app.get(
    "/health",
    {
      config: { auth: "public" },
      schema: {
        response: {
          200: strictObjectSchema({ properties: { ok: { type: "boolean", const: true } }, required: ["ok"] }),
        },
      },
    },
    async () => ({ ok: true }),
  );

  app.post(
    "/entities",
    {
      config: { auth: "actor" },
      schema: {
        headers: ActorOnlyHeaders,
        body: strictObjectSchema({
          properties: {
            entity_id: uuidSchema(),
          },
          required: [],
        }),
        response: {
          200: strictObjectSchema({
            properties: { entity_id: uuidSchema() },
            required: ["entity_id"],
          }),
        },
      },
    },
    async (req) => {
      const body = req.body as { entity_id?: string };
      const actorId = req.actorId!;
      const correlationId = req.correlationId;

      const entityId = body.entity_id ?? randomUUID();

      await createEntity(app.prisma, {
        entityId,
        createdByActorId: actorId,
        correlation: { correlationId },
      });

      return { entity_id: entityId };
    },
  );

  app.post(
    "/entities/:entityId/memberships",
    {
      config: { auth: "entity" },
      schema: {
        headers: AuthedHeaders,
        params: strictObjectSchema({ properties: { entityId: uuidSchema() }, required: ["entityId"] }),
        body: strictObjectSchema({
          properties: {
            actor_id: uuidSchema(),
            role: { type: "string", enum: [...MembershipRoles] },
          },
          required: ["actor_id", "role"],
        }),
        response: {
          200: strictObjectSchema({
            properties: {
              membership_id: uuidSchema(),
              entity_id: uuidSchema(),
              actor_id: uuidSchema(),
              role: { type: "string", enum: [...MembershipRoles] },
              version: nonNegativeIntSchema(),
            },
            required: ["membership_id", "entity_id", "actor_id", "role", "version"],
          }),
        },
      },
    },
    async (req) => {
      const performedBy = req.actor!;
      const params = req.params as { entityId: string };
      const body = req.body as { actor_id: string; role: (typeof MembershipRoles)[number] };
      const correlationId = req.correlationId;

      const membership = await addMembership(app.prisma, {
        entityId: params.entityId,
        actorId: body.actor_id,
        role: body.role,
        performedBy,
        correlation: { correlationId },
      });

      return {
        membership_id: membership.id,
        entity_id: membership.entityId,
        actor_id: membership.actorId,
        role: membership.role,
        version: membership.version,
      };
    },
  );

  app.patch(
    "/memberships/:membershipId",
    {
      config: { auth: "entity" },
      schema: {
        headers: AuthedHeaders,
        params: strictObjectSchema({ properties: { membershipId: uuidSchema() }, required: ["membershipId"] }),
        body: strictObjectSchema({
          properties: {
            role: { type: "string", enum: [...MembershipRoles] },
            expected_version: nonNegativeIntSchema(),
          },
          required: ["role", "expected_version"],
        }),
        response: {
          200: strictObjectSchema({
            properties: {
              membership_id: uuidSchema(),
              role: { type: "string", enum: [...MembershipRoles] },
              version: nonNegativeIntSchema(),
            },
            required: ["membership_id", "role", "version"],
          }),
        },
      },
    },
    async (req) => {
      const performedBy = req.actor!;
      const params = req.params as { membershipId: string };
      const body = req.body as { role: (typeof MembershipRoles)[number]; expected_version: number };
      const correlationId = req.correlationId;

      const membership = await changeMembershipRole(app.prisma, {
        membershipId: params.membershipId,
        expectedVersion: body.expected_version,
        role: body.role,
        performedBy,
        correlation: { correlationId },
      });

      return { membership_id: membership.id, role: membership.role, version: membership.version };
    },
  );

  app.post(
    "/tasks",
    {
      config: { auth: "entity" },
      schema: {
        headers: AuthedHeaders,
        body: strictObjectSchema({
          properties: { type: { type: "string", minLength: 1 }, title: { type: "string", minLength: 1 } },
          required: ["type", "title"],
        }),
        response: {
          200: strictObjectSchema({
            properties: {
              task_id: uuidSchema(),
              entity_id: uuidSchema(),
              state: { type: "string", enum: [...TaskStates] },
              version: nonNegativeIntSchema(),
            },
            required: ["task_id", "entity_id", "state", "version"],
          }),
        },
      },
    },
    async (req) => {
      const actor = req.actor!;
      const body = req.body as { type: string; title: string };
      const correlationId = req.correlationId;

      const task = await createTask(app.prisma, {
        entityId: actor.entityId,
        type: body.type,
        title: body.title,
        createdBy: actor,
        correlation: { correlationId },
      });

      return { task_id: task.id, entity_id: task.entityId, state: task.state, version: task.version };
    },
  );

  app.post(
    "/tracks",
    {
      config: { auth: "entity" },
      schema: {
        headers: AuthedHeaders,
        body: {
          oneOf: [
            strictObjectSchema({
              properties: {
                kind: { type: "string", const: "text" },
                text: { type: "string", minLength: 1 },
              },
              required: ["kind", "text"],
            }),
            strictObjectSchema({
              properties: {
                kind: { type: "string", const: "image" },
                attachments: {
                  type: "array",
                  maxItems: 5,
                  items: strictObjectSchema({
                    properties: {
                      content_type: { type: "string", minLength: 1 },
                      size_bytes: { type: "integer", minimum: 0 },
                      sha256: { type: "string", minLength: 64, maxLength: 64 },
                      storage_key: { type: "string", minLength: 1 },
                    },
                    required: ["content_type", "size_bytes", "sha256"],
                  }),
                },
              },
              required: ["kind"],
            }),
          ],
        },
        response: {
          200: strictObjectSchema({
            properties: {
              track_id: uuidSchema(),
              lens_run_id: uuidSchema(),
            },
            required: ["track_id", "lens_run_id"],
          }),
        },
      },
    },
    async (req) => {
      const actor = req.actor!;
      const correlationId = req.correlationId;
      const body = req.body as
        | { kind: "text"; text: string }
        | {
            kind: "image";
            attachments?: Array<{ content_type: string; size_bytes: number; sha256: string; storage_key?: string }>;
          };

      const track = await ingestTrack(app.prisma, {
        entityId: actor.entityId,
        kind: body.kind,
        text: body.kind === "text" ? body.text : undefined,
        attachments:
          body.kind === "image"
            ? (body.attachments ?? []).map((a) => ({
                contentType: a.content_type,
                sizeBytes: a.size_bytes,
                sha256: a.sha256,
                storageKey: a.storage_key,
              }))
            : undefined,
        createdBy: actor,
        correlation: { correlationId },
      });

      const lensKey = track.kind === "text" ? "pantry_text_v1" : "image_stub_v1";
      const lensRun = await ensureLensRun(app.prisma, { trackId: track.id, lensKey, actor, correlation: { correlationId } });

      return { track_id: track.id, lens_run_id: lensRun.id };
    },
  );

  app.get(
    "/approval-queue",
    {
      config: { auth: "entity" },
      schema: {
        headers: AuthedHeaders,
        response: {
          200: {
            type: "array",
            items: strictObjectSchema({
              properties: {
                changeset_id: uuidSchema(),
                task_id: uuidSchema(),
                state: { type: "string", enum: [...ChangeSetStates] },
                version: nonNegativeIntSchema(),
                base_type: { type: "string" },
                base_version: nonNegativeIntSchema(),
                risk_level: { type: "string" },
              },
              required: ["changeset_id", "task_id", "state", "version", "base_type", "base_version", "risk_level"],
            }),
          },
        },
      },
    },
    async (req) => {
      const actor = req.actor!;
      if (!can(actor, "changeset:read", { entityId: actor.entityId })) throw new ForbiddenError("Not allowed");

      const rows = await app.prisma.changeSet.findMany({
        where: { entityId: actor.entityId, state: "pending_approval" },
        orderBy: { createdAt: "asc" },
        take: 100,
      });

      return rows.map((cs) => ({
        changeset_id: cs.id,
        task_id: cs.taskId,
        state: cs.state,
        version: cs.version,
        base_type: cs.baseType,
        base_version: cs.baseVersion,
        risk_level: cs.riskLevel,
      }));
    },
  );

  app.get(
    "/questions",
    {
      config: { auth: "entity" },
      schema: {
        headers: AuthedHeaders,
        querystring: strictObjectSchema({
          properties: { status: { type: "string", enum: ["open", "answered", "cancelled"] } },
          required: [],
        }),
        response: {
          200: {
            type: "array",
            items: strictObjectSchema({
              properties: {
                question_id: uuidSchema(),
                entity_id: uuidSchema(),
                track_id: { type: ["string", "null"], format: "uuid" },
                task_id: { type: ["string", "null"], format: "uuid" },
                status: { type: "string", enum: ["open", "answered", "cancelled"] },
                version: nonNegativeIntSchema(),
                prompt: { type: "string" },
              },
              required: ["question_id", "entity_id", "track_id", "task_id", "status", "version", "prompt"],
            }),
          },
        },
      },
    },
    async (req) => {
      const actor = req.actor!;
      if (!can(actor, "question:read", { entityId: actor.entityId })) throw new ForbiddenError("Not allowed");
      const q = (req.query ?? {}) as { status?: "open" | "answered" | "cancelled" };
      const where = { entityId: actor.entityId, ...(q.status ? { status: q.status } : {}) };
      const rows = await app.prisma.question.findMany({ where, orderBy: { createdAt: "asc" }, take: 100 });
      return rows.map((x) => ({
        question_id: x.id,
        entity_id: x.entityId,
        track_id: x.trackId,
        task_id: x.taskId,
        status: x.status,
        version: x.version,
        prompt: x.prompt,
      }));
    },
  );

  app.post(
    "/questions/:questionId/answer",
    {
      config: { auth: "entity" },
      schema: {
        headers: AuthedHeaders,
        params: strictObjectSchema({ properties: { questionId: uuidSchema() }, required: ["questionId"] }),
        body: strictObjectSchema({
          properties: {
            expected_version: nonNegativeIntSchema(),
            answer: { type: "object", additionalProperties: true },
          },
          required: ["expected_version", "answer"],
        }),
        response: {
          200: strictObjectSchema({
            properties: {
              question_id: uuidSchema(),
              status: { type: "string", const: "answered" },
              version: nonNegativeIntSchema(),
              answer_id: uuidSchema(),
            },
            required: ["question_id", "status", "version", "answer_id"],
          }),
        },
      },
    },
    async (req) => {
      const actor = req.actor!;
      const params = req.params as { questionId: string };
      const body = req.body as { expected_version: number; answer: unknown };
      const correlationId = req.correlationId;

      const result = await answerQuestion(app.prisma, {
        questionId: params.questionId,
        expectedVersion: body.expected_version,
        answer: body.answer,
        answeredBy: actor,
        correlation: { correlationId },
      });

      return { question_id: result.question.id, status: "answered", version: result.question.version, answer_id: result.answer.id };
    },
  );

  app.post(
    "/tasks/:taskId/state",
    {
      config: { auth: "entity" },
      schema: {
        headers: AuthedHeaders,
        params: strictObjectSchema({ properties: { taskId: uuidSchema() }, required: ["taskId"] }),
        body: strictObjectSchema({
          properties: { to_state: { type: "string", enum: [...TaskStates] }, expected_version: nonNegativeIntSchema() },
          required: ["to_state", "expected_version"],
        }),
        response: {
          200: strictObjectSchema({
            properties: { task_id: uuidSchema(), state: { type: "string", enum: [...TaskStates] }, version: nonNegativeIntSchema() },
            required: ["task_id", "state", "version"],
          }),
        },
      },
    },
    async (req) => {
      const actor = req.actor!;
      const params = req.params as { taskId: string };
      const body = req.body as { to_state: (typeof TaskStates)[number]; expected_version: number };
      const correlationId = req.correlationId;

      const task = await transitionTaskState(app.prisma, {
        taskId: params.taskId,
        toState: body.to_state,
        expectedVersion: body.expected_version,
        actor,
        correlation: { correlationId },
      });

      return { task_id: task.id, state: task.state, version: task.version };
    },
  );

  app.post(
    "/tasks/:taskId/changesets",
    {
      config: { auth: "entity" },
      schema: {
        headers: AuthedHeaders,
        params: strictObjectSchema({ properties: { taskId: uuidSchema() }, required: ["taskId"] }),
        body: strictObjectSchema({
          properties: {
            base_type: { type: "string", minLength: 1 },
            base_version: nonNegativeIntSchema(),
            risk_level: { type: "string", minLength: 1 },
            patch: { type: "object", additionalProperties: true },
          },
          required: ["base_type", "base_version", "risk_level", "patch"],
        }),
        response: {
          200: strictObjectSchema({
            properties: {
              changeset_id: uuidSchema(),
              task_id: uuidSchema(),
              state: { type: "string", enum: [...ChangeSetStates] },
              version: nonNegativeIntSchema(),
            },
            required: ["changeset_id", "task_id", "state", "version"],
          }),
        },
      },
    },
    async (req) => {
      const actor = req.actor!;
      const params = req.params as { taskId: string };
      const body = req.body as { base_type: string; base_version: number; risk_level: string; patch: unknown };
      const correlationId = req.correlationId;

      const cs = await proposeChangeSet(app.prisma, {
        taskId: params.taskId,
        baseType: body.base_type,
        baseVersion: body.base_version,
        riskLevel: body.risk_level,
        patch: body.patch,
        actor,
        correlation: { correlationId },
      });

      return { changeset_id: cs.id, task_id: cs.taskId, state: cs.state, version: cs.version };
    },
  );

  app.post(
    "/changesets/:changeSetId/apply",
    {
      config: { auth: "entity" },
      schema: {
        headers: AuthedHeaders,
        params: strictObjectSchema({ properties: { changeSetId: uuidSchema() }, required: ["changeSetId"] }),
        body: strictObjectSchema({ properties: { expected_version: nonNegativeIntSchema() }, required: ["expected_version"] }),
        response: {
          200: strictObjectSchema({
            properties: { changeset_id: uuidSchema(), state: { type: "string", enum: [...ChangeSetStates] }, version: nonNegativeIntSchema() },
            required: ["changeset_id", "state", "version"],
          }),
        },
      },
    },
    async (req) => {
      const actor = req.actor!;
      const params = req.params as { changeSetId: string };
      const body = req.body as { expected_version: number };
      const correlationId = req.correlationId;

      const cs = await applyChangeSet(app.prisma, {
        changeSetId: params.changeSetId,
        expectedVersion: body.expected_version,
        actor,
        correlation: { correlationId },
      });

      return { changeset_id: cs.id, state: cs.state, version: cs.version };
    },
  );

  app.get(
    "/tasks",
    {
      config: { auth: "entity" },
      schema: {
        headers: AuthedHeaders,
        querystring: strictObjectSchema({
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 100 },
          },
          required: [],
        }),
        response: {
          200: {
            type: "array",
            items: strictObjectSchema({
              properties: {
                task_id: uuidSchema(),
                entity_id: uuidSchema(),
                type: { type: "string" },
                title: { type: "string" },
                state: { type: "string", enum: [...TaskStates] },
                version: nonNegativeIntSchema(),
              },
              required: ["task_id", "entity_id", "type", "title", "state", "version"],
            }),
          },
        },
      },
    },
    async (req) => {
      const actor = req.actor!;
      if (!can(actor, "task:read", { entityId: actor.entityId })) throw new ForbiddenError("Not allowed");
      const q = (req.query ?? {}) as { limit?: number };
      const limit = q.limit ?? 50;
      const rows = await app.prisma.task.findMany({
        where: { entityId: actor.entityId },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      return rows.map((t) => ({
        task_id: t.id,
        entity_id: t.entityId,
        type: t.type,
        title: t.title,
        state: t.state,
        version: t.version,
      }));
    },
  );

  app.get(
    "/tasks/:taskId",
    {
      config: { auth: "entity" },
      schema: {
        headers: AuthedHeaders,
        params: strictObjectSchema({ properties: { taskId: uuidSchema() }, required: ["taskId"] }),
        response: {
          200: strictObjectSchema({
            properties: {
              task_id: uuidSchema(),
              entity_id: uuidSchema(),
              type: { type: "string" },
              title: { type: "string" },
              state: { type: "string", enum: [...TaskStates] },
              version: nonNegativeIntSchema(),
            },
            required: ["task_id", "entity_id", "type", "title", "state", "version"],
          }),
        },
      },
    },
    async (req) => {
      const actor = req.actor!;
      if (!can(actor, "task:read", { entityId: actor.entityId })) throw new ForbiddenError("Not allowed");
      const params = req.params as { taskId: string };
      const task = await app.prisma.task.findFirst({ where: { id: params.taskId, entityId: actor.entityId } });
      if (!task) throw new NotFoundError("Task not found");
      return {
        task_id: task.id,
        entity_id: task.entityId,
        type: task.type,
        title: task.title,
        state: task.state,
        version: task.version,
      };
    },
  );

  app.get(
    "/changesets/:changeSetId",
    {
      config: { auth: "entity" },
      schema: {
        headers: AuthedHeaders,
        params: strictObjectSchema({ properties: { changeSetId: uuidSchema() }, required: ["changeSetId"] }),
        response: {
          200: strictObjectSchema({
            properties: {
              changeset_id: uuidSchema(),
              entity_id: uuidSchema(),
              task_id: uuidSchema(),
              state: { type: "string", enum: [...ChangeSetStates] },
              version: nonNegativeIntSchema(),
              base_type: { type: "string" },
              base_version: nonNegativeIntSchema(),
              risk_level: { type: "string" },
              patch: { type: "object", additionalProperties: true },
            },
            required: [
              "changeset_id",
              "entity_id",
              "task_id",
              "state",
              "version",
              "base_type",
              "base_version",
              "risk_level",
              "patch",
            ],
          }),
        },
      },
    },
    async (req) => {
      const actor = req.actor!;
      if (!can(actor, "changeset:read", { entityId: actor.entityId })) throw new ForbiddenError("Not allowed");
      const params = req.params as { changeSetId: string };
      const cs = await app.prisma.changeSet.findFirst({ where: { id: params.changeSetId, entityId: actor.entityId } });
      if (!cs) throw new NotFoundError("ChangeSet not found");
      return {
        changeset_id: cs.id,
        entity_id: cs.entityId,
        task_id: cs.taskId,
        state: cs.state,
        version: cs.version,
        base_type: cs.baseType,
        base_version: cs.baseVersion,
        risk_level: cs.riskLevel,
        patch: cs.patch as Record<string, unknown>,
      };
    },
  );

  return app;
}

export async function startServer(): Promise<void> {
  const port = Number(process.env.PORT ?? "3000");
  const app = buildApp();
  await app.listen({ port, host: "0.0.0.0" });
  logger.info({ port }, "api listening");
}
