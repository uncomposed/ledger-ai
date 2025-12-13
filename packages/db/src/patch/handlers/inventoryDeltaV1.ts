import { Prisma } from "@prisma/client";
import type { Prisma as PrismaTypes } from "@prisma/client";
import { emitOutboxEvent } from "../../events/emit.js";
import { ForbiddenError } from "../../errors.js";
import type { PatchHandler } from "../types.js";

function asObject(v: unknown): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("patch must be an object");
  return v as Record<string, unknown>;
}

function asString(v: unknown, name: string): string {
  if (typeof v !== "string" || !v.length) throw new Error(`${name} must be a non-empty string`);
  return v;
}

function asNumber(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${name} must be a number`);
  return v;
}

function asOpList(v: unknown): Array<{ resource_id: string; delta: number; unit?: string | null }> {
  if (!Array.isArray(v)) throw new Error("ops must be an array");
  const out: Array<{ resource_id: string; delta: number; unit?: string | null }> = [];
  for (const item of v) {
    const o = asObject(item);
    const resourceId = asString(o.resource_id, "op.resource_id");
    const delta = asNumber(o.delta, "op.delta");
    const unit = o.unit === undefined ? undefined : o.unit === null ? null : asString(o.unit, "op.unit");
    out.push({ resource_id: resourceId, delta, unit });
  }
  if (out.length > 100) throw new Error("too many ops");
  return out;
}

function locationNameForKind(kind: string): string {
  if (kind === "kitchen.pantry") return "Pantry";
  if (kind === "kitchen.fridge") return "Fridge";
  if (kind === "kitchen.freezer") return "Freezer";
  return kind;
}

export const inventoryDeltaV1: PatchHandler = {
  baseType: "inventory.delta.v1",
  baseVersion: 1,
  deterministic: true,
  idempotent: true,
  validate(patch: unknown) {
    const o = asObject(patch);
    if (o.location_kind !== undefined) asString(o.location_kind, "location_kind");
    const ops = asOpList(o.ops);
    // prevent accidental no-op patches hiding behind schema approval
    if (!ops.length) throw new Error("ops must not be empty");
  },
  async apply(tx: PrismaTypes.TransactionClient, ctx, patch: unknown) {
    if (ctx.entityId !== ctx.actor.entityId) throw new ForbiddenError("Cross-entity access denied");

    const o = asObject(patch);
    const locationKind = typeof o.location_kind === "string" && o.location_kind.length ? o.location_kind : "kitchen.pantry";
    const ops = asOpList(o.ops);

    const location = await tx.location.upsert({
      where: { entityId_kind_name: { entityId: ctx.entityId, kind: locationKind, name: locationNameForKind(locationKind) } },
      create: { entityId: ctx.entityId, kind: locationKind, name: locationNameForKind(locationKind) },
      update: {},
    });

    for (let i = 0; i < ops.length; i++) {
      const op = ops[i]!;
      const resource = await tx.resource.findUnique({ where: { id: op.resource_id } });
      if (!resource) throw new Error("Resource not found");
      if (resource.entityId !== ctx.entityId) throw new ForbiddenError("Cross-entity access denied");

      const item = await tx.inventoryItem.upsert({
        where: { entityId_resourceId_locationId: { entityId: ctx.entityId, resourceId: resource.id, locationId: location.id } },
        create: {
          entityId: ctx.entityId,
          resourceId: resource.id,
          locationId: location.id,
          quantity: new Prisma.Decimal(0),
          unit: op.unit ?? null,
        },
        update: op.unit ? { unit: op.unit } : {},
      });

      try {
        await tx.inventoryMutation.create({
          data: {
            entityId: ctx.entityId,
            changeSetId: ctx.changeSetId,
            opIndex: i,
            resourceId: resource.id,
            locationId: location.id,
            inventoryItemId: item.id,
            delta: new Prisma.Decimal(op.delta),
            unit: op.unit ?? null,
          },
        });
      } catch (e: any) {
        // Unique constraint on (changeSetId, opIndex) means we've already applied this op.
        if (e?.code === "P2002") continue;
        throw e;
      }

      await tx.inventoryItem.update({
        where: { id: item.id },
        data: { quantity: { increment: new Prisma.Decimal(op.delta) }, version: { increment: 1 } },
      });
    }

    await emitOutboxEvent(tx, {
      entityId: ctx.entityId,
      correlationId: ctx.correlation.correlationId,
      eventType: "inventory.delta.applied.v1",
      eventVersion: 1,
      occurredAt: ctx.now,
      payload: {
        entity_id: ctx.entityId,
        changeset_id: ctx.changeSetId,
        operation_count: ops.length,
      },
    });
  },
};

