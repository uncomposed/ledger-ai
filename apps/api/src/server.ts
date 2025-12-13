import Fastify from "fastify";
import { logger } from "@ledger/observability";
import { prisma } from "@ledger/db";
import type { PrismaClient } from "@ledger/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  applyChangeSet,
  createTask,
  proposeChangeSet,
  transitionTaskState,
} from "@ledger/db";
import { getActorFromHeaders } from "./http/auth.js";
import { enforceRouteSchemas } from "./http/strict-routes.js";
import { ChangeSetStates, TaskStates, nonNegativeIntSchema, strictObjectSchema, uuidSchema } from "./http/schema.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
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
      "x-actor-role": { type: "string", enum: ["admin", "contributor", "accountable"] },
      "x-correlation-id": { type: "string" },
    },
    required: ["x-entity-id", "x-actor-id", "x-actor-role"],
  };

  app.get(
    "/health",
    {
      schema: {
        response: {
          200: strictObjectSchema({ properties: { ok: { type: "boolean", const: true } }, required: ["ok"] }),
        },
      },
    },
    async () => ({ ok: true }),
  );

  app.post(
    "/tasks",
    {
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
      const actor = getActorFromHeaders(req.headers as Record<string, unknown>);
      const body = req.body as { type: string; title: string };
      const correlationId = req.id;

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
    "/tasks/:taskId/state",
    {
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
      const actor = getActorFromHeaders(req.headers as Record<string, unknown>);
      const params = req.params as { taskId: string };
      const body = req.body as { to_state: (typeof TaskStates)[number]; expected_version: number };
      const correlationId = req.id;

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
      const actor = getActorFromHeaders(req.headers as Record<string, unknown>);
      const params = req.params as { taskId: string };
      const body = req.body as { base_type: string; base_version: number; risk_level: string; patch: unknown };
      const correlationId = req.id;

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
      const actor = getActorFromHeaders(req.headers as Record<string, unknown>);
      const params = req.params as { changeSetId: string };
      const body = req.body as { expected_version: number };
      const correlationId = req.id;

      const cs = await applyChangeSet(app.prisma, {
        changeSetId: params.changeSetId,
        expectedVersion: body.expected_version,
        actor,
        correlation: { correlationId },
      });

      return { changeset_id: cs.id, state: cs.state, version: cs.version };
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
