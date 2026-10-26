# Expo + Clerk (Milestone 5)

## 1) Install and configure

From repo root:

```sh
pnpm install
cp apps/mobile/.env.example apps/mobile/.env
```

Edit `apps/mobile/.env`:

- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_dHJ1ZS1sYXJrLTkzLmNsZXJrLmFjY291bnRzLmRldiQ`
- `EXPO_PUBLIC_API_BASE_URL=http://10.0.0.249:3000`

If you run on a physical device, `EXPO_PUBLIC_API_BASE_URL` must be your laptop LAN IP (not `localhost`).

## 2) Start backend

```sh
docker compose -f infra/docker-compose.yml up -d
pnpm -C packages/db db:migrate:deploy
pnpm -C apps/api dev
```

In your repo-root `.env`, set:

```env
AUTH_PROVIDER=clerk
CLERK_JWKS_URL=https://true-lark-93.clerk.accounts.dev/.well-known/jwks.json
```

Restart the API after changing `.env`.

## 3) Start Expo

```sh
pnpm -C apps/mobile dev:localhost:clear
```

If you already have Expo running, stop it first (Ctrl+C).

If your iOS Simulator is trying to load from port `8082` (you’ll see a URL like `http://127.0.0.1:8082/...`), start Metro explicitly on 8082:

```sh
pnpm -C apps/mobile dev:localhost:clear:8082
```

For iOS Simulator we recommend `--host localhost` to avoid LAN IP issues.

## 4) Validate end-to-end

- Sign up or sign in in the Expo app (simple built-in screen in `apps/mobile/App.tsx`).
- Tap `Call backend /me` and check Metro logs for `API /me status 200`.
- Check the Metro logs; you should see:
  - `Clerk token length ...`
  - `API /me status 200`

If the iOS Simulator shows “Could not connect to development server” but `/status` works, restart Metro and reload the app (we set `jsEngine=jsc` in `apps/mobile/app.config.ts` to avoid Hermes bytecode bundling hangs).

If you get `401 unauthorized`:
- Confirm the API `.env` has `AUTH_PROVIDER=clerk` and the correct `CLERK_JWKS_URL`.
- Confirm the token is non-empty and you are signed in.

If `/status` is running but `/index.bundle` hangs, ensure Metro is using `apps/mobile/metro.config.js` (pnpm store watcher) and restart Metro with cache cleared.
