import type { Membership, MembershipRole, PrismaClient } from "@prisma/client";
import { can } from "@ledger/policy";
import { emitOutboxEvent } from "../events/emit.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors.js";
import type { ActorContext, CorrelationContext } from "./types.js";

export async function addMembership(
  prisma: PrismaClient,
  input: {
    entityId: string;
    actorId: string;
    role: MembershipRole;
    performedBy: ActorContext;
    correlation: CorrelationContext;
  },
): Promise<Membership> {
  if (input.entityId !== input.performedBy.entityId) throw new ForbiddenError("Cross-entity access denied");
  if (!can(input.performedBy, "membership:write", { entityId: input.entityId })) throw new ForbiddenError("Not allowed");

  return prisma.$transaction(async (tx) => {
    const entity = await tx.entity.findUnique({ where: { id: input.entityId } });
    if (!entity) throw new NotFoundError("Entity not found");

    const actor = await tx.actor.findUnique({ where: { id: input.actorId } });
    if (!actor) throw new NotFoundError("Actor not found");

    try {
      const membership = await tx.membership.create({
        data: {
          entityId: input.entityId,
          actorId: input.actorId,
          role: input.role,
        },
      });

      await emitOutboxEvent(tx, {
        entityId: membership.entityId,
        correlationId: input.correlation.correlationId,
        eventType: "membership.added.v1",
        eventVersion: 1,
        occurredAt: new Date(),
        payload: {
          membership_id: membership.id,
          entity_id: membership.entityId,
          actor_id: membership.actorId,
          role: membership.role,
          added_by_actor_id: input.performedBy.actorId,
        },
      });

      return membership;
    } catch (e) {
      const msg = String(e);
      if (msg.includes("Membership_entityId_actorId_key")) throw new ConflictError("Actor already a member of entity");
      throw e;
    }
  });
}

export async function changeMembershipRole(
  prisma: PrismaClient,
  input: {
    membershipId: string;
    expectedVersion: number;
    role: MembershipRole;
    performedBy: ActorContext;
    correlation: CorrelationContext;
  },
): Promise<Membership> {
  return prisma.$transaction(async (tx) => {
    const membership = await tx.membership.findUnique({ where: { id: input.membershipId } });
    if (!membership) throw new NotFoundError("Membership not found");
    if (membership.entityId !== input.performedBy.entityId) throw new ForbiddenError("Cross-entity access denied");
    if (!can(input.performedBy, "membership:write", { entityId: membership.entityId })) {
      throw new ForbiddenError("Not allowed");
    }

    const updated = await tx.membership.updateMany({
      where: { id: membership.id, version: input.expectedVersion },
      data: { role: input.role, version: { increment: 1 } },
    });
    if (updated.count !== 1) throw new ConflictError("Version conflict");

    const next = await tx.membership.findUniqueOrThrow({ where: { id: membership.id } });

    await emitOutboxEvent(tx, {
      entityId: next.entityId,
      correlationId: input.correlation.correlationId,
      eventType: "membership.role_changed.v1",
      eventVersion: 1,
      occurredAt: new Date(),
      payload: {
        membership_id: next.id,
        entity_id: next.entityId,
        actor_id: next.actorId,
        from_role: membership.role,
        to_role: next.role,
        changed_by_actor_id: input.performedBy.actorId,
      },
    });

    return next;
  });
}
