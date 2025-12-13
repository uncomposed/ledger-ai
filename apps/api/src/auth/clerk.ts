import type { FastifyRequest } from "fastify";
import type { PrismaClient } from "@ledger/db";
import { ensureActorForExternalIdentity, resolveActorContext } from "@ledger/db";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { webcrypto } from "node:crypto";
import type { EntityScopedActor } from "./types.js";
import { UnauthorizedError } from "./errors.js";

if (!(globalThis as any).crypto) {
  (globalThis as any).crypto = webcrypto;
}

function bearer(req: FastifyRequest): string {
  const raw = String(req.headers.authorization ?? "");
  if (!raw.toLowerCase().startsWith("bearer ")) throw new UnauthorizedError("missing bearer token");
  return raw.slice("bearer ".length).trim();
}

type ClerkConfig = {
  jwksUrl: string;
  issuer?: string;
  audience?: string;
};

export class ClerkAuthProvider {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly cfg: ClerkConfig,
  ) {
    this.jwks = createRemoteJWKSet(new URL(cfg.jwksUrl));
  }

  async actorIdFromRequest(req: FastifyRequest): Promise<string> {
    const token = bearer(req);
    const result = await jwtVerify(token, this.jwks, {
      issuer: this.cfg.issuer,
      audience: this.cfg.audience,
    });

    const externalSubject = String(result.payload.sub ?? "");
    if (!externalSubject) throw new UnauthorizedError("jwt missing sub");

    const actorId = await ensureActorForExternalIdentity(this.prisma, {
      provider: "clerk",
      externalSubject,
      actorType: "human",
    });
    return actorId;
  }

  async entityScopedActorFromRequest(req: FastifyRequest): Promise<EntityScopedActor> {
    const actorId = await this.actorIdFromRequest(req);
    const entityId = String(req.headers["x-entity-id"] ?? "");
    if (!entityId) throw new UnauthorizedError("missing x-entity-id");
    return resolveActorContext(this.prisma, { actorId, entityId });
  }
}

