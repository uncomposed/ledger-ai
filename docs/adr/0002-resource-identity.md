# 0002 — Resource Identity Keys

## Context

We use `Resource` as a lightweight identity layer to make patch execution deterministic and idempotent across verticals (meals, home maintenance, etc.).

We need a stable key to support safe `upsert()` patterns without relying on nullable unique constraints (a footgun in Postgres).

## Decision

- `Resource.externalKey` is **required** and is the stable identity key for a resource **within** `(entityId, kind)`.
- The uniqueness boundary is `@@unique([entityId, kind, externalKey])`.

## Conventions

- **Human-entered resources**: set `externalKey` to a normalized form of the user-facing name (lowercased, trimmed, internal whitespace collapsed).
  - Example: `"Tomato Sauce"` → `"tomato sauce"`
- **Imported resources**: set `externalKey` to the stable ID from the source system (barcode, USDA ID, retailer SKU, etc.).
- **Deterministic internal resources** (e.g., idempotent task creation during a patch): derive `externalKey` from the causality envelope (for example `${changeSetId}:task:${index}`).

These conventions make dedupe explicit and keep idempotency structural, not “best effort”.

## Related

- `Location.kind` is a string; use namespaced values (e.g. `kitchen.pantry`) to avoid enum churn across verticals.

