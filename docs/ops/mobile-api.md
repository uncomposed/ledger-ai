# Mobile-Friendly API (Milestone 5)

## Session bootstrap

- `GET /me` (auth: actor)
  - Returns `actor_id` and a list of `memberships` (`entity_id`, `role`).
- `GET /entities` (auth: actor)
  - Returns the same membership list (convenience endpoint).

## Reads (scoped)

- `GET /tasks` (auth: entity)
- `GET /approval-queue` (auth: entity)
- `GET /inventory` (auth: entity)

All entity-scoped endpoints require the caller to be a member of the entity; cross-entity access is denied structurally.

## Uploads + Tracks (metadata vs blob)

The API treats uploads as a two-step flow:

1) `POST /uploads/presign` (auth: entity)
   - Input: `{ content_type, size_bytes, sha256 }`
   - Output: `{ storage_key, method, url, headers, expires_at }`

2) Client uploads the bytes directly:
   - `method` + `url` + `headers` from the presign response

3) Client ingests a Track that references the uploaded blob:
   - `POST /tracks` with `kind: "image"` and `attachments[]` including `{ storage_key, size_bytes, sha256, content_type }`
   - Server verifies the upload metadata before accepting the Track.

Local dev uses `UPLOADS_PROVIDER=local` (the API hosts `PUT /uploads/:storageKey`). Production can use `UPLOADS_PROVIDER=s3` for real presigned object storage.

## Auth providers

Config is environment-driven via `AUTH_PROVIDER`:

- `AUTH_PROVIDER=dev` or `AUTH_PROVIDER=none` are dev/CI-only and hard-error in production.
- `AUTH_PROVIDER=jwt` validates `Authorization: Bearer <token>`:
  - `sub` must be the internal UUID actor id.
  - Configure `AUTH_JWT_SECRET` (HS256) or `AUTH_JWT_JWKS_URL` (JWKS), plus optional `AUTH_JWT_ISSUER`/`AUTH_JWT_AUDIENCE`.
- `AUTH_PROVIDER=clerk` validates `Authorization: Bearer <token>` against Clerk JWKS and maps the Clerk `sub` to an internal `Actor` id using `AuthIdentity` (no vendor lock-in in core tables):
  - Configure `CLERK_JWKS_URL`, plus optional `CLERK_JWT_ISSUER`/`CLERK_JWT_AUDIENCE`.
  - The API will auto-create an internal `Actor` on first request for a new Clerk subject.

## Clerk setup (exact steps)

### 1) Create a local `.env` (do not commit)

From repo root:

```sh
cp .env.example .env
```

Then edit `.env` to include (using your values):

```env
AUTH_PROVIDER=clerk
CLERK_JWKS_URL=https://true-lark-93.clerk.accounts.dev/.well-known/jwks.json

# Optional (recommended once you know them):
CLERK_JWT_ISSUER=
CLERK_JWT_AUDIENCE=
```

You can leave `CLERK_JWT_ISSUER` / `CLERK_JWT_AUDIENCE` empty to start; signature verification via JWKS still works.

### 2) Start Postgres + apply migrations

```sh
docker compose -f infra/docker-compose.yml up -d
pnpm -C packages/db db:migrate:deploy
```

### 3) Start the API

```sh
pnpm -C apps/api dev
```

### 4) Get a Clerk JWT from your frontend

You need a user JWT from Clerk and then call the API with it.

- In your frontend, log in with Clerk.
- Use the Clerk SDK to get a token (example name varies by stack; look for `getToken()`).

What matters for the backend:
- the token must be a JWT signed by the JWKS above
- it must have a `sub` claim (Clerk user id like `user_...`)

### 5) Verify `/me` works (curl)

Replace `$TOKEN` with the real JWT from your frontend:

```sh
curl -sS http://localhost:3000/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-correlation-id: local-me" | jq
```

On first use, this will create an internal `Actor` and an `AuthIdentity` mapping row.

### 6) Create an entity + hit an entity-scoped endpoint

```sh
ENTITY_ID=$(curl -sS http://localhost:3000/entities \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-correlation-id: local-entity" | jq -r .entity_id)

curl -sS http://localhost:3000/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-entity-id: $ENTITY_ID" \
  -H "x-correlation-id: local-task" \
  -H "content-type: application/json" \
  -d '{"type":"demo","title":"hello"}' | jq
```

### 7) (Recommended) Lock issuer/audience once you have a token

If you want strict issuer/audience checks, decode your token and copy `iss` and `aud` into `.env`.

One-liner to print claims (no signature verification; safe for local inspection):

```sh
TOKEN="$TOKEN" node - <<'NODE'
const t = process.env.TOKEN;
if (!t) throw new Error("Missing TOKEN env var");
const payload = t.split('.')[1];
const json = Buffer.from(payload.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8');
console.log(JSON.stringify(JSON.parse(json), null, 2));
NODE
```
