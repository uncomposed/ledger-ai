# 0003 — Patch Versioning Contract

## Context

We execute state changes through `ChangeSet` patches, dispatched by `(baseType, baseVersion)` to registered patch handlers.

Once a patch type/version is used by any client (API, lens, worker), it becomes a public contract. Silent semantic changes are a correctness footgun: old patches can replay differently, retries can diverge, and “audit over discipline” breaks down.

## Decision

- A patch handler is uniquely identified by `(baseType, baseVersion)`.
- **Immutability rule**: once shipped, the semantics of a given `(baseType, baseVersion)` MUST NOT change.
- **Evolution rule**: breaking or behavior-changing updates require a **new** `baseVersion` (e.g. `inventory.import_text.v2`), and both versions remain executable.
- Patch handlers MUST be **deterministic** and **idempotent**:
  - Same inputs + same DB state ⇒ same outputs.
  - Re-applying the same patch does not create duplicate effects.

## Allowed Changes

- You MAY extend a patch schema in a backwards-compatible way **only** if it does not change behavior for existing payloads (e.g. add an optional field with a defaulted meaning that preserves v1).
- You MAY add new patch types at any time.
- You MAY deprecate old patch versions, but they must remain executable as long as you have persisted data referencing them.

## Operational Implications

- The patch registry is CI-enforced: for any event schema that implies a patch type/version (by convention), there must be a registered handler with `validate()` and `apply()`, and tests that prove idempotency.
- If you introduce an “applied” event that is not backed by a patch handler, you MUST mark it explicitly in the schema (future: `x-ledger.impliesPatch=false`) or rename it to avoid tripping registry completeness checks.

