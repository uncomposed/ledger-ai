# Ledger

Ledger is an early backend for turning messy daily information into structured lists. Think a photo of a pantry or a pasted shopping list.

The rule it is built around: AI proposes, humans approve. A lens reads a captured item and proposes a ChangeSet. A person with the right role applies it. Every write leaves an audit trail.

This is a personal project in active development. It is not a product and not ready for production use.

## Status

What exists today:

- A Fastify API with 24 routes: health, uploads, sessions, entities and memberships, tasks, tracks (captures), questions and answers, changesets, inventory, and meal goals. See `apps/api/src/server.ts`.
- A Postgres schema (Prisma) with an event log and a transactional outbox.
- Versioned, idempotent patch handlers: `inventory.import_text`, `inventory.delta`, `meal.plan`.
- A JSON Schema event catalog with generated types, checked in CI.
- Role-based policy checks with tests.
- A worker that runs queued lens runs and publishes the outbox.
- Auth: dev headers for local use, plus JWT and Clerk token validation.
- An Expo mobile shell with Clerk sign-in and one button that calls `GET /me`.

What does not exist yet:

- Real UI screens, on mobile or web.
- An MCP server.
- Any language model. The lenses (`pantry_text_v1`, `image_stub_v1`, `meal_plan_v1`) are plain code, and the image lens is a stub.
- Worker projections (the folder is empty).
- Real linting. Every `lint` script is a no-op, and Biome is configured but not installed.
- Unit tests for the API, worker and events packages.

Validation: no part of this has been confirmed by a person on a real device. Database tests run in CI only, and CI results are not a substitute for that.

## Architecture in brief

1. A client sends a capture (a Track) to the API.
2. A lens run is queued. The worker claims it, proposes a ChangeSet attached to a Task, and may ask Questions.
3. A person with the admin role applies the ChangeSet. A registered patch handler runs it in one transaction.
4. The command writes domain rows, an event-log entry and an outbox event together.
5. The worker publishes outbox rows.

Each entity (a person, a household, a business) owns its data. Access is checked by membership and role in `packages/policy`.

## Quickstart

Needs Node 20.19.0, pnpm 9.15.0, and Docker for Postgres.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
docker compose -f infra/docker-compose.yml up -d
pnpm db:generate
pnpm db:migrate:deploy
pnpm -C apps/api dev
```

In a second terminal, run the worker with `pnpm -C apps/worker dev`.

Checks that need no database:

```sh
pnpm -r typecheck
pnpm policy:test
pnpm events:validate
pnpm events:codegen:check
```

For the mobile app and Clerk, follow `docs/ops/expo-clerk.md`. For API calls, see `docs/ops/mobile-api.md`.

## Docs

- Slice spec: `docs/specs/0001-pantry-capture-slice.md`
- ADRs: `docs/adr/0001-repo-charter.md`, `docs/adr/0002-resource-identity.md`, `docs/adr/0003-patch-versioning-contract.md`
- Ops: `docs/ops/`
- Founding design notes (a vision, not current behavior): `Project Ledger.md`
- Agent instructions: `AGENTS.md`

## Security

Do not file issues containing secrets. See `SECURITY.md`.

## License

MIT License, Copyright (c) 2025 uncomposed. See `LICENSE`.
