import type { FastifyRequest } from "fastify";
import type { PrismaClient } from "@ledger/db";
import type { Role } from "@ledger/policy";
import { resolveActorContext } from "@ledger/db";

export type EntityScopedActor = { actorId: string; entityId: string; role: Role };

export interface AuthProvider {
  actorIdFromRequest(req: FastifyRequest): string;
  entityScopedActorFromRequest(req: FastifyRequest): Promise<EntityScopedActor>;
}

class NoneAuthProvider implements AuthProvider {
  constructor(private readonly prisma: PrismaClient) {}

  actorIdFromRequest(req: FastifyRequest): string {
    const actorId = String(req.headers["x-actor-id"] ?? "");
    if (!actorId) throw new Error("missing x-actor-id");
    return actorId;
  }

  async entityScopedActorFromRequest(req: FastifyRequest): Promise<EntityScopedActor> {
    const actorId = String(req.headers["x-actor-id"] ?? "");
    const entityId = String(req.headers["x-entity-id"] ?? "");
    if (!actorId) throw new Error("missing x-actor-id");
    if (!entityId) throw new Error("missing x-entity-id");
    return resolveActorContext(this.prisma, { actorId, entityId });
  }
}

class DevAuthProvider extends NoneAuthProvider {
  constructor(prisma: PrismaClient, env: NodeJS.ProcessEnv) {
    if (env.NODE_ENV === "production") {
      throw new Error('AUTH_PROVIDER="dev" must not be used in production');
    }
    super(prisma);
  }
}

class ClerkAuthProvider implements AuthProvider {
  actorIdFromRequest(_req: FastifyRequest): string {
    throw new Error('AUTH_PROVIDER="clerk" is not implemented yet');
  }

  async entityScopedActorFromRequest(_req: FastifyRequest): Promise<EntityScopedActor> {
    throw new Error('AUTH_PROVIDER="clerk" is not implemented yet');
  }
}

export function buildAuthProvider(prisma: PrismaClient, env: NodeJS.ProcessEnv = process.env): AuthProvider {
  const provider = String(env.AUTH_PROVIDER ?? "none").toLowerCase();
  if (provider === "none") {
    if (env.NODE_ENV === "production") {
      throw new Error('AUTH_PROVIDER="none" must not be used in production');
    }
    return new NoneAuthProvider(prisma);
  }
  if (provider === "dev") return new DevAuthProvider(prisma, env);
  if (provider === "clerk") return new ClerkAuthProvider();
  throw new Error(`Unknown AUTH_PROVIDER: ${provider}`);
}
