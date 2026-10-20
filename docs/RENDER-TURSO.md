# Render + Turso deployment

This keeps the existing synchronous SQLite query and transaction API used by `server.js`. When Turso variables are present, `turso-sync-db.js` forwards those calls to Turso from a worker thread; without them, local development continues to use `finassist.db` and `better-sqlite3`.

## 1. Create the Turso database

In the Turso dashboard, create a database and generate an auth token. Keep both values private. Set them locally in `AIPFA/.env`:

```env
TURSO_DATABASE_URL=libsql://your-database-name-your-org.turso.io
TURSO_AUTH_TOKEN=your-generated-token
SQLITE_DB_PATH=./finassist.db
```

Before migrating, make a backup of `finassist.db` (and keep the `-wal`/`-shm` files alongside it while the app is stopped). Then, from the `AIPFA` folder, run:

```powershell
npm run migrate:turso
```

The importer copies users, sessions, budgets, transactions, account/security tokens, and chat history. It stops if the destination already contains data, to avoid overwriting a database. Keep the local backup until the deployed site is confirmed to contain the expected accounts and records.

## 2. Deploy the web service

Push the `AIPFA` repository to GitHub, then create a Render Web Service from that repository. Use the included `render.yaml` blueprint. It builds the existing Dockerfile so the app's Python/TTS dependencies remain part of the deployment. Add the secret values in Render's Environment page:

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `OPENROUTER_API_KEY`
- `RESEND_API_KEY`

The blueprint sets `NODE_ENV`, `BASE_URL=https://aipfa.me`, `TRUST_PROXY=1`, and `RESEND_FROM`. Do not put secret keys in `render.yaml` or commit `.env`.

Add `aipfa.me` as a custom domain on the Render service and follow the DNS records Render displays in the dashboard. Render issues TLS for a verified custom domain and redirects HTTP to HTTPS. Keep the `onrender.com` address available as a fallback.

## Important deployment behavior

- Render's free web service may sleep while idle; its first request after sleep can take longer. Turso keeps the database outside Render's ephemeral filesystem.
- The synchronous compatibility bridge blocks the Node event loop while each remote database operation completes. This minimizes changes to current route/transaction code and retains its features, but adds latency and limits throughput. If usage grows, replace it later with an async data layer while preserving the same API behavior.
- The included local Meta MMS TTS service needs model downloads, storage, CPU, and memory. The blueprint includes it through the existing Dockerfile, but speech synthesis may exceed a free instance's available memory or compute. The code and feature remain included; if TTS cannot run within free resources, that particular feature needs a larger host.
