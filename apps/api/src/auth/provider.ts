import type { FastifyRequest } from "fastify";
import type { PrismaClient } from "@ledger/db";
import { resolveActorContext } from "@ledger/db";
import type { EntityScopedActor } from "./types.js";
import { JwtAuthProvider } from "./jwt.js";
import { ClerkAuthProvider as ClerkVerifierAuthProvider } from "./clerk.js";
import { UnauthorizedError } from "./errors.js";

export interface AuthProvider {
  actorIdFromRequest(req: FastifyRequest): Promise<string>;
  entityScopedActorFromRequest(req: FastifyRequest): Promise<EntityScopedActor>;
}

class NoneAuthProvider implements AuthProvider {
  constructor(private readonly prisma: PrismaClient) {}

  async actorIdFromRequest(req: FastifyRequest): Promise<string> {
    const actorId = String(req.headers["x-actor-id"] ?? "");
    if (!actorId) throw new UnauthorizedError("missing x-actor-id");
    return actorId;
  }

  async entityScopedActorFromRequest(req: FastifyRequest): Promise<EntityScopedActor> {
    const actorId = String(req.headers["x-actor-id"] ?? "");
    const entityId = String(req.headers["x-entity-id"] ?? "");
    if (!actorId) throw new UnauthorizedError("missing x-actor-id");
    if (!entityId) throw new UnauthorizedError("missing x-entity-id");
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
  private readonly provider: ClerkVerifierAuthProvider;

  constructor(prisma: PrismaClient, env: NodeJS.ProcessEnv) {
    const jwksUrl = String(env.CLERK_JWKS_URL ?? "");
    if (!jwksUrl) throw new Error('AUTH_PROVIDER="clerk" requires CLERK_JWKS_URL');
    this.provider = new ClerkVerifierAuthProvider(prisma, {
      jwksUrl,
      issuer: env.CLERK_JWT_ISSUER || undefined,
      audience: env.CLERK_JWT_AUDIENCE || undefined,
    });
  }

  async actorIdFromRequest(req: FastifyRequest): Promise<string> {
    return this.provider.actorIdFromRequest(req);
  }

  async entityScopedActorFromRequest(req: FastifyRequest): Promise<EntityScopedActor> {
    return this.provider.entityScopedActorFromRequest(req);
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
  if (provider === "jwt") {
    return new JwtAuthProvider(prisma, {
      issuer: env.AUTH_JWT_ISSUER || undefined,
      audience: env.AUTH_JWT_AUDIENCE || undefined,
      jwksUrl: env.AUTH_JWT_JWKS_URL || undefined,
      secret: env.AUTH_JWT_SECRET || undefined,
    });
  }
  if (provider === "clerk") return new ClerkAuthProvider(prisma, env);
  throw new Error(`Unknown AUTH_PROVIDER: ${provider}`);
}
