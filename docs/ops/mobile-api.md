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

