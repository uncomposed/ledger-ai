# AGENTS.md

Instructions for coding agents working in this repo. Humans: see `README.md`.

## 1. What Ledger is

Ledger is a pnpm monorepo for a "relational lists" backend. People capture messy daily information (a pantry photo, a text list). Lenses turn it into structured proposals.

Core invariant: **AI and agents propose ChangeSets. Humans approve. Every meaningful write goes through Tasks, versioned idempotent patches, the event log and the outbox.**

Never add a code path that writes domain data and skips this. No direct `prisma.<model>.create` from a route, a worker, a lens or a script for domain tables. Use or extend the commands in `packages/db/src/commands/`.

## 2. Repo map

- `apps/api`: Fastify HTTP API (`src/server.ts`, one big file of routes). Auth in `src/auth/`, uploads in `src/uploads/`.
- `apps/worker`: polling loop. Runs queued lens runs and publishes the outbox. `src/outbox/` and `src/projections/` are empty today.
- `apps/mobile`: Expo app shell. One file, `App.tsx`: Clerk sign-in and a "call /me" button. No real screens.
- `packages/db`: Prisma schema, migrations, commands, patch registry and handlers, lens runner, outbox, `verify.ts`.
- `packages/events`: JSON Schema catalog (`catalog/`), generated TS (`generated/index.ts`), runtime validator.
- `packages/policy`: `can(actor, action, resource)` and roles (`admin`, `contributor`, `accountable`).
- `packages/observability`: JSON logger and key redaction. `otel.ts` is a placeholder for later.
- `scripts/`: `run-tsx.mjs`, `run-prisma.mjs` (load repo-root `.env`), `ci/` checks.
- `infra/docker-compose.yml`: Postgres 16 for local dev. `config/`: small JSON defaults.
- `docs/adr/`: decisions. `docs/ops/`: how-tos. `docs/specs/`: slice specs.
- `Project Ledger.md`: long founding design doc. A vision, not a description of what exists.

## 3. Setup and verification

Pinned: Node `24.22.1` (`.nvmrc`), pnpm `9.15.0` (`packageManager`). CI uses both. Run from the repo root.

```sh
pnpm install --frozen-lockfile
pnpm db:generate
```

Checks that need no database:

```sh
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm policy:test
pnpm events:validate
pnpm events:codegen:check
pnpm ci:danger
```

Checks that need Postgres (`DATABASE_URL`, see `.env.example`):

```sh
docker compose -f infra/docker-compose.yml up -d
pnpm db:migrate:deploy
pnpm db:seed:ci
pnpm db:verify
pnpm -C packages/db test:integration
pnpm -C apps/api test:integration
```

Run services: `pnpm -C apps/api dev`, `pnpm -C apps/worker dev` (both need Postgres), `pnpm -C apps/mobile dev:localhost:clear`.

Honest notes on the checks:

- As of 2026-10-26 none of these were seen passing in the owner's checkout: the install there was incomplete (`tsx`, `tsc` not found). If a check cannot run, report that rather than "verified".

- `lint` is a no-op in every package. `biome.json` exists but Biome is not installed or wired up.
- `apps/mobile` typecheck and test are no-ops.
- `test` runs real tests only in `packages/db` (patch registry) and `packages/policy`. `apps/api`, `apps/worker`, `packages/events` and `packages/observability` have no unit tests.
- `ci:danger` compares against `HEAD~1` locally, or the PR base in CI.
- CI jobs (`.github/workflows/ci.yml`): `dangerous_change_detector`, `node_checks`, `db_migrate_and_verify`, `event_schema_validate`, `policy_tests`.

## 4. Checklists

### New Prisma model or column
1. Edit `packages/db/prisma/schema.prisma`.
2. Add a migration under `packages/db/prisma/migrations/`. CI fails if the schema changed without one (`scripts/ci/dangerous-change-detector.mjs`).
3. Domain models carry `entityId` (Actor and AuthIdentity are the exceptions). Scope all queries by it.
4. Add each new index or unique key to the `required` list in `packages/db/src/verify.ts`, using the exact Prisma index name.
5. Add rows to `packages/db/prisma/seed/ci.ts` only if CI needs them.
6. Write through a command in `packages/db/src/commands/`, in a transaction, with an outbox event.
7. Run `pnpm db:generate`, `pnpm -r typecheck`, then the Postgres checks.

### New event type
1. Add `packages/events/catalog/<name>.v<N>.schema.json`. Set `$id` to `<name>.v<N>`. Copy the shape of `task.created.v1.schema.json`: `additionalProperties: false`, required `correlation_id`, uuid formats.
2. Run `pnpm events:validate` then `pnpm events:codegen`. Commit the change to `packages/events/generated/index.ts`.
3. Emit it only through `emitOutboxEvent` (`packages/db/src/events/emit.ts`). It prepends `correlation_id` and validates the payload.
4. Never edit a shipped schema in a breaking way. Add `v2`.
5. If it implies a patch, follow ADR 0003 and register a handler.

### New API route
1. Add it in `apps/api/src/server.ts`. `enforceRouteSchemas` throws at startup if the route has no `schema` or no `config.auth`.
2. Set `config: { auth: "public" | "actor" | "entity" }`. Use `"entity"` for anything touching entity data. It requires `x-entity-id` and membership.
3. Build schemas with `strictObjectSchema`, `uuidSchema` and friends from `apps/api/src/http/schema.ts`. Define `headers`, `params`, `body` or `querystring`, and a `response`.
4. Take `req.correlationId` (from `x-correlation-id`) and pass `correlation: { correlationId }` to the command.
5. Policy: commands call `can()` from `@ledger/policy` and throw `ForbiddenError`. Do the same. Add the action to `PolicyAction` and a case in `can.ts` if new.
6. Do the work in a `packages/db` command, not in the route.
7. Add a case to `apps/api/src/test/integration.test.ts` (needs Postgres). Update `docs/ops/mobile-api.md` if mobile uses it.

### New patch handler
1. Read `docs/adr/0003-patch-versioning-contract.md`. A handler is `(baseType, baseVersion)`. Shipped semantics never change. Behavior changes need a new version.
2. Add `packages/db/src/patch/handlers/<name>V<N>.ts` implementing `PatchHandler` (`validate`, `apply`, `deterministic: true`, `idempotent: true`).
3. Register it in `packages/db/src/patch/builtin.ts`. Duplicates throw.
4. Make `apply` idempotent. Derive resource keys from the changeset id and index (ADR 0002). See `InventoryMutation_changeSetId_opIndex_key` for the pattern.
5. Add an applied-event schema to the catalog (see above).
6. Add tests in `packages/db/src/test/`, including a second apply that changes nothing.

### New worker projection
`apps/worker/src/projections/` is empty, so there is no pattern yet. Keep it simple.
1. Consume from the outbox or event log, never from a route.
2. Be replayable and idempotent. `packages/db/src/replay.ts` (`pnpm events:replay`) is the nearest example.
3. Projections are read models. They must not become a second place that writes domain truth.
4. Write a short ADR first, since this sets the pattern.

## 5. Conventions seen in code

- **Strict by default.** Routes use `additionalProperties: false` schemas (`apps/api/src/http/schema.ts`). Event schemas do too.
- **Errors.** Throw `ConflictError`, `ForbiddenError`, `NotFoundError` (`packages/db/src/errors.ts`) and `UnauthorizedError` (`apps/api/src/auth/errors.ts`). The handler in `server.ts` maps them to 409, 403, 404, 401. Production hides internal messages.
- **Correlation.** Every request gets a correlation id and every outbox event carries it.
- **Optimistic locking.** Changesets carry a `version`. Apply takes `expected_version`.
- **Task states** are a fixed transition table in `packages/db/src/commands/task.ts`.
- **Logging.** Use `logger` from `@ledger/observability`. It redacts keys like `authorization`, `token`, `password` (`redact.ts`). Do not log request bodies or tokens by hand.
- **PII.** `packages/events/src/pii.ts` has `redactPii` for keys like email, phone, name. Keep PII out of event payloads and logs.
- **Auth.** `AUTH_PROVIDER=dev` (headers `x-actor-id`, `x-entity-id`) and `none` are for local and CI only and throw in production. `jwt` and `clerk` are real. See `docs/ops/mobile-api.md`.
- **Style.** ESM, `NodeNext`, strict TypeScript (`tsconfig.base.json`). Intended format: 2 spaces, double quotes, semicolons (`biome.json`, not enforced yet).

## 6. Status vocabulary

Use these words exactly. Do not skip steps.

1. `implemented`: code exists.
2. `verified`: you ran the checks and saw them pass. Name the commands and the result.
3. `human_validated`: Cole tried the real journey. Only Cole grants this. Never claim it.

Tests passing is not the same as working. If you could not run a check (no database, no install), say so.

## 7. Guardrails

- Never commit `.env`, `apps/mobile/.env`, keys, tokens or `.pem` files. Do not paste secrets into docs or code.
- Do not rewrite history. No force push, no `reset --hard`, no amending commits you did not make.
- Do not revert or overwrite edits you did not make. Other agents may be working at the same time.
- Do not commit unless asked. When you do, one idea per commit and a real message that says what and why.
- Do not edit a shipped migration. Add a new one.
- Disk is often tight. Avoid large downloads and build artifacts.
- Be honest in public text. Say what does not work. Do not invent metrics.

## 8. Specs and decisions

- `docs/adr/`: `0001` repo charter, `0002` resource identity keys, `0003` patch versioning contract.
- `docs/specs/`: slice specs. Start with `docs/specs/0001-pantry-capture-slice.md`.
- `docs/ops/`: `mobile-api.md`, `expo-clerk.md`, `github-settings.md`.
- A new decision gets a new numbered ADR. Do not rewrite old ones.
