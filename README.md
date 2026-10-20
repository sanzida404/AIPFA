# AIPFA — AI Personal Finance Assistant

AIPFA is a personal finance web app for recording income, spending, and savings; setting budgets; reviewing spending insights; and optionally asking an AI assistant questions about your finances.

**GitHub repository:** [sanzida404/AIPFA](https://github.com/sanzida404/AIPFA)

## Features

### Accounts and account security

- Email-confirmed account registration with a generated AIPFA login ID; sign in with the login ID, username, or email.
- Password reset by email, authenticated password change, and optional verified recovery email. A verified recovery email can be promoted to the sign-in email.
- Optional six-digit sign-in PIN. New-device sign-ins use an email approval link; a configured PIN is then required as an additional check.
- Optional profile picture, light/dark/system appearance, session logout, and permanent account deletion after password confirmation.
- Passwords are bcrypt-hashed. Session and device values are random, and database records store hashes rather than raw session tokens.

### Finance tracking

- Record income, expenses, and savings with date, category, and note; browse and remove your transaction history.
- Set monthly and daily budgets, with a suggested budget based on recorded income or carried-over balance.
- Dashboard with income, spending, available balance, savings, category breakdowns, daily spending, month-to-month comparison, and budget progress.
- Budget and spending insights for overspending, projected pace, category concentration, savings goals, and miscategorized expenses.
- Accounting periods are anchored to the account's first income date. Savings are tracked separately and are not counted as ordinary spending.

### Assistant, reports, and voice

- Optional OpenRouter-powered finance chat with chat history and supported image/document attachments (image, PDF, DOCX, XLSX, PPTX, TXT, Markdown, and CSV; up to 5 MB per attachment).
- Receipt/bill image analysis suggests amount, currency, vendor, category, and date. Review the suggestion and press **Add transaction** yourself; scanning does not save a transaction automatically. Non-USD bill amounts are converted to USD using the app's live currency-rate source.
- Export finance reports as PDF, Excel, Word, or PowerPoint for supported periods.
- Voice input depends on browser/device speech-recognition support. Voice replies use the app's local Meta MMS text-to-speech service for listed languages; the first use can download a model and need substantial CPU, memory, storage, and network access.
- Progressive Web App install support, offline app-shell fallback, device appearance preference, and optional budget notifications/alerts.

## Privacy and security behavior

- AI chat and bill scanning are off until the user explicitly enables AI data-sharing consent. When enabled, finance context and any selected bill image are sent to the configured OpenRouter provider. Turning consent off blocks those AI operations while local ledger, dashboard, and report features remain available.
- Passwords must meet the app's minimum length and strength checks. Authentication attempts are rate-limited; chat and bill-scanning requests also have limits.
- Session cookies are `httpOnly` and `SameSite=Strict`; HTTPS deployments use `Secure` cookies. Public production deployments require an HTTPS `BASE_URL`.
- Requests use parameterized SQL, authenticated data queries are scoped to the current user, and sensitive responses are not cached. Helmet supplies security headers.
- Security events are retained for up to 90 days and omit passwords, tokens, email contents, and raw IP addresses. Email logs do not print provider response bodies or recipient addresses.
- Secrets belong in local `.env` for development and the host's secret environment-variable store in production. `.env` and SQLite database/WAL files are ignored by Git. Never commit or share real API keys, database tokens, mail passwords, or personal database files.
- SQLite files are not encrypted by the app. Protect backups and host storage. On Windows, restrict the data directory with NTFS permissions.

## Requirements

- Node.js 22 recommended (the Docker image uses Node 22).
- Python 3 and the packages in `requirements-tts.txt` are required only for local text-to-speech. The Docker image installs the TTS runtime.
- An OpenRouter API key is needed for AI chat and bill analysis. Email verification, recovery, and password reset need a working email provider (Resend, SMTP, Brevo, or the supported Unosend integration).
- Development uses local SQLite. A hosted deployment in the supplied Render blueprint uses Turso for persistent data.

## Run locally

From the repository's `AIPFA` folder:

```powershell
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Edit `.env` with your own values. At minimum set `PORT`, local `BASE_URL`, and `TRUST_PROXY=0`. For local SQLite development, leave `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` empty. Add email and OpenRouter credentials to use those services.

```powershell
npm start
```

Open [http://localhost:3000](http://localhost:3000). The default local database is `finassist.db`; it is user data and is excluded from Git. Do not delete it unless you intentionally want to discard the local records.

## Test and review

Run the isolated automated smoke suite:

```powershell
npm test
```

The suite creates a temporary SQLite database with synthetic users and removes it afterward. It does not use your normal database or make OpenRouter calls. See [TEST-CASES.md](TEST-CASES.md) for the full automated and manual test checklist and the checks recorded so far. Do not treat a checklist item as passed until you have run it and recorded the result.

## Deploy with Render + Turso

The repository includes `render.yaml`; the blueprint builds the existing Dockerfile, which also includes the Python text-to-speech runtime. Use one Render web-service instance because the app uses an in-process request limiter. The supplied free plan may sleep when idle; check the hosting provider's current plan limits before relying on continuous availability. Turso stores application data outside the Render container's temporary filesystem.

### 1. Import the existing SQLite data into Turso (one time)

1. Create a Turso database and generate a database auth token. Treat the URL and token as secrets.
2. Stop the local AIPFA server so SQLite is not changing during the import.
3. Put the values in the project's local `.env`:

   ```env
   TURSO_DATABASE_URL=libsql://your-database-name-your-org.turso.io
   TURSO_AUTH_TOKEN=your-generated-token
   SQLITE_DB_PATH=./finassist.db
   ```

4. From the project folder, run:

   ```powershell
   npm run migrate:turso
   ```

The importer copies the current SQLite tables and records to the Turso database and refuses a destination that already contains application data. Run it only for the initial import into a blank Turso database. Keep the local database and its backup until the deployed app's accounts and records have been checked. The migration completion message reports how many rows were copied.

### 2. Push the repository to GitHub

Review the staged file list before pushing. Confirm `.env`, `finassist.db`, `aipfa.db`, and any backup files are not staged.

```powershell
git add -A
git status --short
git commit -m "Prepare AIPFA deployment"
git push origin main
```

The GitHub repository is [sanzida404/AIPFA](https://github.com/sanzida404/AIPFA). Do not run `git add -f` on `.env` or database files.

### 3. Create the Render service

1. In Render, create a **Blueprint** from the GitHub repository and select the branch you pushed. Render reads `render.yaml` and builds the Dockerfile.
2. In the new service's Environment settings, add the secret values:
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
   - `OPENROUTER_API_KEY` (needed for AI features)
   - `RESEND_API_KEY` (if using Resend for account email)
3. Confirm `RESEND_FROM` uses a sender address on the verified domain in Resend. For SMTP or another supported provider, configure the relevant server-side variables instead; never put provider keys in browser code.
4. Set `BASE_URL` to the service's actual HTTPS address before using email links. The blueprint initially uses `https://aipfa.me`; change this if that domain is not yet connected.
5. Wait for the build and health check. Check Render logs for Turso connection, email-provider, and startup errors.
6. Test sign-in with an existing migrated account, then check a few known transactions and create a small synthetic transaction. Confirm the change persists after a service restart.

### 4. Connect `aipfa.me` (optional)

Add the domain in the Render service's **Custom Domains** settings, then add the DNS records Render displays at your domain registrar. Wait for DNS and TLS verification. Set `BASE_URL=https://aipfa.me` only once the custom domain resolves to the Render service and HTTPS is active. Render's default HTTPS service URL remains useful for troubleshooting.

### Deployment notes

- Render container files are temporary. Keep production data in Turso, not in the container's SQLite file.
- The Turso compatibility adapter keeps existing synchronous database calls working through a worker thread. Remote database round trips add latency and block the app's main request loop while awaiting results; this approach minimizes application-route changes but is intended for modest usage.
- The local MMS voice model can be too large or CPU-intensive for a small/free service. The rest of the app may deploy even if speech synthesis cannot run within the host's available resources.
- Keep the local SQLite file and a protected backup until production data is verified. Never post secret values in support chats, screenshots, GitHub, or logs.

## Environment variables

See [.env.example](.env.example) for a placeholder template. Never replace placeholders with real values in the tracked example.

| Variable | Use |
|---|---|
| `PORT` | Local server port; hosting platforms supply their own port. |
| `BASE_URL` | Canonical app URL used in email links and HTTPS enforcement. |
| `TRUST_PROXY` | Exact number of trusted reverse-proxy hops; use `0` locally and the Render blueprint value in production. |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Select the persistent Turso database. Leave unset/blank for local SQLite. |
| `DB_PATH` | Optional SQLite file path used by the locally running app. |
| `SQLITE_DB_PATH` | Optional SQLite source-file path for the one-time Turso migration script. |
| `OPENROUTER_API_KEY` | Server-side key for AI chat and bill analysis. |
| `OPENROUTER_MODEL` | Main assistant model identifier. |
| `BILL_ANALYSIS_MODEL` | Optional vision-capable model for bill analysis. |
| `RESEND_API_KEY`, `RESEND_FROM` | Resend email API and verified sender. Resend takes precedence if configured. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Optional SMTP email setup. |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` | Optional Brevo email API setup. |
| `UNOSEND_API_KEY`, `UNOSEND_API_URL`, `UNOSEND_FROM` | Optional Unosend integration. |
| `ALLOW_INSECURE_LOCAL_HTTP` | Local Docker/testing opt-in only; do not enable for a public production URL. |

