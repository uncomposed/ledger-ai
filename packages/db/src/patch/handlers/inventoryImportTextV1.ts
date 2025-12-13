import { Prisma } from "@prisma/client";
import type { Prisma as PrismaTypes } from "@prisma/client";
import { emitOutboxEvent } from "../../events/emit.js";
import { ForbiddenError } from "../../errors.js";
import type { PatchHandler } from "../types.js";

function asObject(v: unknown): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("patch must be an object");
  return v as Record<string, unknown>;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) throw new Error("items must be an array");
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") throw new Error("items must be strings");
    out.push(x);
  }
  return out;
}

function canonicalKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export const inventoryImportTextV1: PatchHandler = {
  baseType: "inventory.import_text.v1",
  baseVersion: 1,
  deterministic: true,
  idempotent: true,
  validate(patch: unknown) {
    const o = asObject(patch);
    const trackId = o.track_id;
    if (typeof trackId !== "string" || !trackId.length) throw new Error("track_id must be a string");
    const items = asStringArray(o.items);
    if (items.length > 100) throw new Error("too many items");
  },
  async apply(tx: PrismaTypes.TransactionClient, ctx, patch: unknown) {
    if (ctx.entityId !== ctx.actor.entityId) throw new ForbiddenError("Cross-entity access denied");

    const o = asObject(patch);
    const trackId = String(o.track_id);
    const items = asStringArray(o.items)
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 100);

    const track = await tx.track.findUnique({ where: { id: trackId } });
    if (!track) throw new Error("Track not found");
    if (track.entityId !== ctx.entityId) throw new ForbiddenError("Cross-entity access denied");

    const location = await tx.location.upsert({
      where: { entityId_kind_name: { entityId: ctx.entityId, kind: "pantry", name: "Pantry" } },
      create: { entityId: ctx.entityId, kind: "pantry", name: "Pantry" },
      update: {},
    });

    const unique = new Map<string, string>();
    for (const item of items) {
      const key = canonicalKey(item);
      if (!key) continue;
      if (!unique.has(key)) unique.set(key, item);
    }

    const keys = Array.from(unique.keys()).sort();

    for (const key of keys) {
      const displayName = unique.get(key)!;

      const resource = await tx.resource.upsert({
        where: { entityId_kind_externalKey: { entityId: ctx.entityId, kind: "inventory.item", externalKey: key } },
        create: { entityId: ctx.entityId, kind: "inventory.item", externalKey: key, name: displayName },
        update: { name: displayName },
      });

      await tx.inventoryItem.upsert({
        where: { entityId_resourceId_locationId: { entityId: ctx.entityId, resourceId: resource.id, locationId: location.id } },
        create: {
          entityId: ctx.entityId,
          resourceId: resource.id,
          locationId: location.id,
          quantity: new Prisma.Decimal(1),
          unit: "count",
        },
        update: {},
      });
    }

    await emitOutboxEvent(tx, {
      entityId: ctx.entityId,
      correlationId: ctx.correlation.correlationId,
      eventType: "inventory.import_text.applied.v1",
      eventVersion: 1,
      occurredAt: ctx.now,
      payload: {
        entity_id: ctx.entityId,
        changeset_id: ctx.changeSetId,
        track_id: trackId,
        item_count: keys.length,
      },
    });
  },
};
