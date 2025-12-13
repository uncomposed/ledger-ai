import type { PrismaClient } from "@prisma/client";
import type { Role } from "@ledger/policy";
import { ForbiddenError, NotFoundError } from "../errors.js";

function toRole(role: string): Role {
  if (role === "admin" || role === "contributor" || role === "accountable") return role;
  throw new Error(`Unknown role: ${role}`);
}

export async function resolveActorContext(
  prisma: PrismaClient,
  input: { actorId: string; entityId: string },
): Promise<{ actorId: string; entityId: string; role: Role }> {
  const entity = await prisma.entity.findUnique({ where: { id: input.entityId } });
  if (!entity) throw new NotFoundError("Entity not found");

  const actor = await prisma.actor.findUnique({ where: { id: input.actorId } });
  if (!actor) throw new NotFoundError("Actor not found");

  const membership = await prisma.membership.findUnique({
    where: { entityId_actorId: { entityId: input.entityId, actorId: input.actorId } },
  });
  if (!membership) throw new ForbiddenError("Not a member of entity");

  return { actorId: input.actorId, entityId: input.entityId, role: toRole(membership.role) };
}

export async function listActorMemberships(
  prisma: PrismaClient,
  input: { actorId: string },
): Promise<Array<{ entityId: string; role: Role }>> {
  const actor = await prisma.actor.findUnique({ where: { id: input.actorId } });
  if (!actor) throw new NotFoundError("Actor not found");

  const memberships = await prisma.membership.findMany({
    where: { actorId: input.actorId },
    select: { entityId: true, role: true },
    orderBy: { entityId: "asc" },
  });

  return memberships.map((m) => ({ entityId: m.entityId, role: toRole(m.role) }));
}
