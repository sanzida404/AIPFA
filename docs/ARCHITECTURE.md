# AIPFA system architecture

## Components

- Browser UI: `public/index.html`, `public/app.js`, `public/assistantextras.js`; provides authentication, dashboard, transaction entry, chat, voice, PWA shell, and bill scan review.
- Express application: `server.js`; authenticates requests, validates input, enforces ownership, calculates budgets/insights, stores records in SQLite, and exposes APIs.
- SQLite: stores users, hashed passwords, sessions, budgets, transactions, chat history, explicit AI consent timestamps, hashed login-attempt keys, and 90-day security events. Foreign keys cascade account data deletion; security events are detached from deleted accounts.
- Assistant module: `assistantbrain.js`; sends opted-in financial context to OpenRouter, handles tool calls and report generation, and starts the local TTS service when requested.
- Bill analysis: `/api/bill/analyze` sends an explicitly selected JPEG/PNG/WebP image to the configured vision-capable OpenRouter model. The server validates the result, converts non-USD totals to the app's USD ledger currency using a live indicative rate, and returns suggestions; the browser fills the transaction form and the user explicitly saves it.
- Report generators: `reportfiles.js` creates PDF, DOCX, XLSX, and PPTX output from the authenticated user's records for a selected month or exact date range.
- Currency conversion: `currency.js` fetches exchange rates from public data providers and caches them in memory.
- Voice: browser speech recognition handles input; `tts_service.py` runs local Meta MMS speech synthesis. The MMS checkpoint is licensed CC-BY-NC 4.0; this deployment is for non-commercial use unless separately licensed.

## Data and request flow

1. A user signs up; the server hashes the password and stores the account in SQLite. Email verification is sent using configured email delivery.
2. Login creates a random session token. Only its SHA-256 hash is stored in SQLite; the raw token is an HTTP-only, SameSite=Strict cookie, and Secure over HTTPS. Failed logins are limited by network plus a hash of network/account ID, without storing raw IDs in the attempt table.
3. Authenticated transaction and budget APIs validate data and scope SQL reads/writes to the authenticated user ID.
4. Dashboard summaries and deterministic insights are calculated by the server from the user's own ledger.
5. Only after a user explicitly enables AI consent, chat context is assembled from the user's finance data and sent to OpenRouter. If consent is absent or disabled, AI chat and bill scanning are blocked. Report export remains local.
6. A bill scan returns suggested fields only. The existing transaction form remains the explicit confirmation step before a ledger write.

## Core calculation notes

- Accounting periods are anchored to the first income date; each period runs to the day before the next monthly anchor.
- Savings entries reduce available balance but are excluded from ordinary spending and budget spend.
- Available balance is cumulative income minus ordinary spending and savings set aside.
- Budget alerts compare current spending and daily pace against configured limits; recommendations are deterministic heuristics, not a guarantee of financial outcomes.
- Bill image extraction is probabilistic. User confirmation is required because OCR/AI may misread totals, dates, currencies, or categories.

## Deployment

The supported Azure target for the current database is a single Linux VM with a persistent local managed disk, Docker Compose, and Caddy for HTTPS. The included `docker-compose.azure.yml` mounts the VM disk filesystem at `/data`, where SQLite, WAL files, and speech-model downloads live. Do not put the WAL database on App Service `/home` or an Azure Files mount: those are network-backed paths and WAL requires a supported local filesystem. The app listens on `PORT` (default `3000`); Caddy is the only public HTTP entry point. Set `BASE_URL` to the public HTTPS origin, `NODE_ENV=production`, and `TRUST_PROXY=1` for the single Caddy proxy. Keep one app instance because the ledger uses SQLite and rate-limit counters are process-local.

Configure SMTP or an email API for account verification and recovery. Keep secrets in the VM's protected `.env` file, which is excluded from Git and the Docker build context. OpenRouter usage is billed separately from Azure. Use the full [Azure deployment guide](AZURE-DEPLOYMENT.md) for setup, secrets, storage, and validation. Do not include `.env`, SQLite database files, `node_modules`, or `.npm-cache` in a public source repository. The `.dockerignore` intentionally omits test/documentation material from the runtime image.
