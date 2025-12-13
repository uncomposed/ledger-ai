import Fastify from "fastify";
import cors from "@fastify/cors";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
  listActorMemberships,
  ingestTrack,
  ensureLensRun,
  answerQuestion,
  applyChangeSet,
  createTask,
  proposeChangeSet,
  transitionTaskState,
  createMealGoal,
} from "@ledger/db";
import { buildAuthProvider, type EntityScopedActor } from "./auth/provider.js";
import { enforceRouteSchemas } from "./http/strict-routes.js";
import {
  ChangeSetStates,
  MealGoalStatuses,
  MembershipRoles,
  TaskStates,
  nonNegativeIntSchema,
  strictObjectSchema,
  uuidSchema,
} from "./http/schema.js";

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

export function buildApp(opts: { env?: NodeJS.ProcessEnv } = {}) {
  const env = opts.env ?? process.env;
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

  const uploadsProvider = String(env.UPLOADS_PROVIDER ?? "local").toLowerCase();
  const uploadsRootDir = env.UPLOADS_DIR ?? ".tmp/uploads";
  if (uploadsProvider !== "local") throw new Error(`Unsupported UPLOADS_PROVIDER: ${uploadsProvider}`);

  app.decorate("prisma", prisma);

  const corsAllowedOrigins = String(env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const corsAllowAll = corsAllowedOrigins.includes("*");
  if (env.NODE_ENV === "production" && corsAllowAll) {
    throw new Error('CORS_ALLOWED_ORIGINS cannot include "*" in production');
  }
  if (corsAllowedOrigins.length) {
    app.register(cors, {
      origin(origin, cb) {
        if (!origin) return cb(null, true);
        if (corsAllowAll) return cb(null, true);
        return cb(null, corsAllowedOrigins.includes(origin));
      },
      credentials: true,
    });
  }

  const authProvider = buildAuthProvider(app.prisma, env);

  app.addContentTypeParser(
    [
      "application/octet-stream",
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
      "application/pdf",
    ],
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body),
  );

  enforceRouteSchemas(app);

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
    const message = env.NODE_ENV === "production" ? "internal error" : String(err?.message ?? err);
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
    "/uploads/presign",
    {
      config: { auth: "entity" },
      schema: {
        headers: AuthedHeaders,
        body: strictObjectSchema({
          properties: {
            content_type: { type: "string", minLength: 1 },
            size_bytes: { type: "integer", minimum: 0, maximum: 25 * 1024 * 1024 },
            sha256: { type: "string", minLength: 64, maxLength: 64 },
          },
          required: ["content_type", "size_bytes", "sha256"],
        }),
        response: {
          200: strictObjectSchema({
            properties: {
              storage_key: { type: "string", minLength: 1 },
              method: { type: "string", const: "PUT" },
              url: { type: "string", minLength: 1 },
              headers: { type: "object", additionalProperties: { type: "string" } },
              expires_at: { type: "string", minLength: 1 },
            },
            required: ["storage_key", "method", "url", "headers", "expires_at"],
          }),
        },
      },
    },
    async (req) => {
      const actor = req.actor!;
      if (!can(actor, "track:ingest", { entityId: actor.entityId })) throw new ForbiddenError("Not allowed");

      const body = req.body as { content_type: string; size_bytes: number; sha256: string };
      const storageKey = randomUUID();
      const url = new URL(`/uploads/${storageKey}`, `http://${req.headers.host ?? "localhost"}`).toString();

      return {
        storage_key: storageKey,
        method: "PUT",
        url,
        headers: {
          "content-type": body.content_type,
        },
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      };
    },
  );

  app.put(
    "/uploads/:storageKey",
    {
      config: { auth: "entity" },
      bodyLimit: 25 * 1024 * 1024,
      schema: {
        headers: AuthedHeaders,
        params: strictObjectSchema({ properties: { storageKey: { type: "string", minLength: 1 } }, required: ["storageKey"] }),
        response: {
          200: strictObjectSchema({ properties: { ok: { type: "boolean", const: true } }, required: ["ok"] }),
        },
      },
    },
    async (req) => {
      const actor = req.actor!;
      if (!can(actor, "track:ingest", { entityId: actor.entityId })) throw new ForbiddenError("Not allowed");

      const params = req.params as { storageKey: string };
      const body = req.body as unknown;
      if (!Buffer.isBuffer(body)) throw new Error("Upload body must be binary");

      const entityDir = join(uploadsRootDir, actor.entityId);
      await mkdir(entityDir, { recursive: true });

      const dest = join(entityDir, params.storageKey);
      const alreadyExists = await stat(dest)
        .then(() => true)
        .catch((e: any) => {
          if (e?.code === "ENOENT") return false;
          throw e;
        });
      if (alreadyExists) throw new ConflictError("Upload already exists");

      await writeFile(dest, body);
      return { ok: true };
    },
  );

  app.get(
    "/me",
    {
      config: { auth: "actor" },
      schema: {
        headers: ActorOnlyHeaders,
        response: {
          200: strictObjectSchema({
            properties: {
              actor_id: uuidSchema(),
              memberships: {
                type: "array",
                items: strictObjectSchema({
                  properties: {
                    entity_id: uuidSchema(),
                    role: { type: "string", enum: [...MembershipRoles] },
                  },
                  required: ["entity_id", "role"],
                }),
              },
            },
            required: ["actor_id", "memberships"],
          }),
        },
      },
    },
    async (req) => {
      const actorId = req.actorId!;
      const memberships = await listActorMemberships(app.prisma, { actorId });
      return {
        actor_id: actorId,
        memberships: memberships.map((m) => ({ entity_id: m.entityId, role: m.role })),
      };
    },
  );

  app.get(
    "/entities",
    {
      config: { auth: "actor" },
      schema: {
        headers: ActorOnlyHeaders,
        response: {
          200: {
            type: "array",
            items: strictObjectSchema({
              properties: {
                entity_id: uuidSchema(),
                role: { type: "string", enum: [...MembershipRoles] },
              },
              required: ["entity_id", "role"],
            }),
          },
        },
      },
    },
    async (req) => {
      const actorId = req.actorId!;
      const memberships = await listActorMemberships(app.prisma, { actorId });
      return memberships.map((m) => ({ entity_id: m.entityId, role: m.role }));
    },
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
                    required: ["content_type", "size_bytes", "sha256", "storage_key"],
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
            attachments?: Array<{ content_type: string; size_bytes: number; sha256: string; storage_key: string }>;
          };

      if (uploadsProvider === "local" && body.kind === "image") {
        const attachments = body.attachments ?? [];
        for (const a of attachments) {
          const path = join(uploadsRootDir, actor.entityId, a.storage_key);
          const bytes = await readFile(path).catch(() => null);
          if (!bytes) throw new NotFoundError("Upload not found");
          if (bytes.length !== a.size_bytes) throw new ConflictError("Upload size mismatch");
          const have = createHash("sha256").update(bytes).digest("hex");
          if (have !== a.sha256) throw new ConflictError("Upload sha256 mismatch");
        }
      }

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

  app.get(
    "/inventory",
    {
      config: { auth: "entity" },
      schema: {
        headers: AuthedHeaders,
        querystring: strictObjectSchema({
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 500 },
          },
          required: [],
        }),
        response: {
          200: {
            type: "array",
            items: strictObjectSchema({
              properties: {
                inventory_item_id: uuidSchema(),
                entity_id: uuidSchema(),
                resource_id: uuidSchema(),
                resource_name: { type: ["string", "null"] },
                location_id: { type: ["string", "null"], format: "uuid" },
                location_name: { type: ["string", "null"] },
                location_kind: { type: ["string", "null"] },
                quantity: { type: ["string", "null"] },
                unit: { type: ["string", "null"] },
              },
              required: [
                "inventory_item_id",
                "entity_id",
                "resource_id",
                "resource_name",
                "location_id",
                "location_name",
                "location_kind",
                "quantity",
                "unit",
              ],
            }),
          },
        },
      },
    },
    async (req) => {
      const actor = req.actor!;
      if (!can(actor, "inventory:read", { entityId: actor.entityId })) throw new ForbiddenError("Not allowed");
      const q = (req.query ?? {}) as { limit?: number };
      const limit = q.limit ?? 200;

      const rows = await app.prisma.inventoryItem.findMany({
        where: { entityId: actor.entityId },
        include: { resource: true, location: true },
        orderBy: { createdAt: "desc" },
        take: limit,
      });

      return rows.map((x) => ({
        inventory_item_id: x.id,
        entity_id: x.entityId,
        resource_id: x.resourceId,
        resource_name: x.resource.name ?? null,
        location_id: x.locationId,
        location_name: x.location?.name ?? null,
        location_kind: x.location?.kind ?? null,
        quantity: x.quantity ? x.quantity.toString() : null,
        unit: x.unit ?? null,
      }));
    },
  );

  app.get(
    "/inventory/:inventoryItemId",
    {
      config: { auth: "entity" },
      schema: {
        headers: AuthedHeaders,
        params: strictObjectSchema({ properties: { inventoryItemId: uuidSchema() }, required: ["inventoryItemId"] }),
        response: {
          200: strictObjectSchema({
            properties: {
              inventory_item_id: uuidSchema(),
              entity_id: uuidSchema(),
              resource_id: uuidSchema(),
              resource_name: { type: ["string", "null"] },
              location_id: { type: ["string", "null"], format: "uuid" },
              location_name: { type: ["string", "null"] },
              location_kind: { type: ["string", "null"] },
              quantity: { type: ["string", "null"] },
              unit: { type: ["string", "null"] },
            },
            required: [
              "inventory_item_id",
              "entity_id",
              "resource_id",
              "resource_name",
              "location_id",
              "location_name",
              "location_kind",
              "quantity",
              "unit",
            ],
          }),
        },
      },
    },
    async (req) => {
      const actor = req.actor!;
      if (!can(actor, "inventory:read", { entityId: actor.entityId })) throw new ForbiddenError("Not allowed");
      const params = req.params as { inventoryItemId: string };

      const row = await app.prisma.inventoryItem.findFirst({
        where: { id: params.inventoryItemId, entityId: actor.entityId },
        include: { resource: true, location: true },
      });
      if (!row) throw new NotFoundError("InventoryItem not found");

      return {
        inventory_item_id: row.id,
        entity_id: row.entityId,
        resource_id: row.resourceId,
        resource_name: row.resource.name ?? null,
        location_id: row.locationId,
        location_name: row.location?.name ?? null,
        location_kind: row.location?.kind ?? null,
        quantity: row.quantity ? row.quantity.toString() : null,
        unit: row.unit ?? null,
      };
    },
  );

  app.post(
    "/meal-goals",
    {
      config: { auth: "entity" },
      schema: {
        headers: AuthedHeaders,
        body: strictObjectSchema({ properties: { text: { type: "string", minLength: 1 } }, required: ["text"] }),
        response: {
          200: strictObjectSchema({
            properties: {
              meal_goal_id: uuidSchema(),
              status: { type: "string", enum: [...MealGoalStatuses] },
              version: nonNegativeIntSchema(),
            },
            required: ["meal_goal_id", "status", "version"],
          }),
        },
      },
    },
    async (req) => {
      const actor = req.actor!;
      if (!can(actor, "meal:write", { entityId: actor.entityId })) throw new ForbiddenError("Not allowed");
      const body = req.body as { text: string };
      const correlationId = req.correlationId;

      const goal = await createMealGoal(app.prisma, {
        entityId: actor.entityId,
        text: body.text,
        createdBy: actor,
        correlation: { correlationId },
      });

      return { meal_goal_id: goal.id, status: goal.status, version: goal.version };
    },
  );

  app.post(
    "/meal-goals/:mealGoalId/plan",
    {
      config: { auth: "entity" },
      schema: {
        headers: AuthedHeaders,
        params: strictObjectSchema({ properties: { mealGoalId: uuidSchema() }, required: ["mealGoalId"] }),
        body: strictObjectSchema({ properties: {}, required: [] }),
        response: {
          200: strictObjectSchema({
            properties: { track_id: uuidSchema(), lens_run_id: uuidSchema() },
            required: ["track_id", "lens_run_id"],
          }),
        },
      },
    },
    async (req) => {
      const actor = req.actor!;
      if (!can(actor, "meal:read", { entityId: actor.entityId })) throw new ForbiddenError("Not allowed");

      const params = req.params as { mealGoalId: string };
      const correlationId = req.correlationId;

      const goal = await app.prisma.mealGoal.findFirst({ where: { id: params.mealGoalId, entityId: actor.entityId } });
      if (!goal) throw new NotFoundError("MealGoal not found");

      const track = await ingestTrack(app.prisma, {
        entityId: actor.entityId,
        kind: "text",
        text: goal.text,
        context: { meal_goal_id: goal.id },
        createdBy: actor,
        correlation: { correlationId },
      });

      const lensRun = await ensureLensRun(app.prisma, {
        trackId: track.id,
        lensKey: "meal_plan_v1",
        actor,
        correlation: { correlationId },
      });

      return { track_id: track.id, lens_run_id: lensRun.id };
    },
  );

  app.get(
    "/meal-goals",
    {
      config: { auth: "entity" },
      schema: {
        headers: AuthedHeaders,
        response: {
          200: {
            type: "array",
            items: strictObjectSchema({
              properties: {
                meal_goal_id: uuidSchema(),
                status: { type: "string", enum: [...MealGoalStatuses] },
                version: nonNegativeIntSchema(),
                text: { type: "string" },
              },
              required: ["meal_goal_id", "status", "version", "text"],
            }),
          },
        },
      },
    },
    async (req) => {
      const actor = req.actor!;
      if (!can(actor, "meal:read", { entityId: actor.entityId })) throw new ForbiddenError("Not allowed");

      const rows = await app.prisma.mealGoal.findMany({
        where: { entityId: actor.entityId },
        orderBy: { createdAt: "desc" },
        take: 100,
      });

      return rows.map((g) => ({ meal_goal_id: g.id, status: g.status, version: g.version, text: g.text }));
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
