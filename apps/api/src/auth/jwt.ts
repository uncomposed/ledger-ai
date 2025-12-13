import type { FastifyRequest } from "fastify";
import type { PrismaClient } from "@ledger/db";
import { resolveActorContext } from "@ledger/db";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { webcrypto } from "node:crypto";
import type { EntityScopedActor } from "./types.js";

if (!(globalThis as any).crypto) {
  (globalThis as any).crypto = webcrypto;
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function bearer(req: FastifyRequest): string {
  const raw = String(req.headers.authorization ?? "");
  if (!raw.toLowerCase().startsWith("bearer ")) throw new Error("missing bearer token");
  return raw.slice("bearer ".length).trim();
}

type JwtConfig = {
  issuer?: string;
  audience?: string;
  jwksUrl?: string;
  secret?: string;
};

export class JwtAuthProvider {
  private readonly issuer?: string;
  private readonly audience?: string;
  private readonly jwks?: ReturnType<typeof createRemoteJWKSet>;
  private readonly secret?: Uint8Array;

  constructor(
    private readonly prisma: PrismaClient,
    cfg: JwtConfig,
  ) {
    this.issuer = cfg.issuer;
    this.audience = cfg.audience;

    if (cfg.jwksUrl) this.jwks = createRemoteJWKSet(new URL(cfg.jwksUrl));
    if (cfg.secret) this.secret = new TextEncoder().encode(cfg.secret);

    if (!this.jwks && !this.secret) {
      throw new Error('AUTH_PROVIDER="jwt" requires AUTH_JWT_JWKS_URL or AUTH_JWT_SECRET');
    }
  }

  async actorIdFromRequest(req: FastifyRequest): Promise<string> {
    const token = bearer(req);

    const options = { issuer: this.issuer, audience: this.audience };
    const result = this.jwks ? await jwtVerify(token, this.jwks, options) : await jwtVerify(token, this.secret!, options);

    const actorId = String(result.payload.sub ?? "");
    if (!actorId) throw new Error("jwt missing sub");
    if (!isUuid(actorId)) throw new Error("jwt sub must be a UUID actor id");
    return actorId;
  }

  async entityScopedActorFromRequest(req: FastifyRequest): Promise<EntityScopedActor> {
    const actorId = await this.actorIdFromRequest(req);
    const entityId = String(req.headers["x-entity-id"] ?? "");
    if (!entityId) throw new Error("missing x-entity-id");
    return resolveActorContext(this.prisma, { actorId, entityId });
  }
}
