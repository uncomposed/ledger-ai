# ADR 0001: Repo Charter

## Decision
Adopt a pnpm monorepo with:
- `packages/db` for Prisma schema, migrations, and CI invariants.
- `packages/events` for JSON schema catalog + codegen for type drift detection.
- `packages/policy` for authorization primitives and tests.
- `packages/observability` for logging/redaction and future OpenTelemetry hooks.
- `apps/api` and `apps/worker` as reference runtimes.

## Rationale
Prefer explicit invariants (scripts + CI) over convention and tribal knowledge.

