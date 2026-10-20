# AIPFA: AI Personal Finance Assistant

Web app with email-confirmed accounts, a finance dashboard, and an AI assistant (OpenRouter) that knows your budget and spending.

## Run it
1. Install Node.js 20+ from nodejs.org
2. In this folder:
   ```
   npm install
   cp .env.example .env     # then edit .env
   npm start
   ```
3. Open http://localhost:3000

Run the isolated HTTP smoke suite with `npm test`. It creates synthetic accounts in a disposable temporary SQLite database and does not use the app's normal database or make AI-provider calls.

## .env settings
- `OPENROUTER_API_KEY`: from https://openrouter.ai/keys
- `OPENROUTER_MODEL`: any OpenRouter model id (default `openai/gpt-4o-mini`; free models end in `:free`)
- `RESEND_API_KEY` and `RESEND_FROM`: send account emails through the Resend HTTPS API. Verify the sender domain in Resend first. SMTP (`SMTP_*`) remains an optional fallback for deployments that allow SMTP.
  Email delivery is required for signup confirmation, account recovery, and password reset. Configure Resend, SMTP, Brevo, or Unosend. Without an email provider, those messages fail; they are not printed to the terminal.
- `BASE_URL`: your public URL when deployed (used in the confirmation link)
- `BILL_ANALYSIS_MODEL`: optional OpenRouter vision model for bill scans (defaults to `OPENROUTER_MODEL`, then `openrouter/free`)

## Features
- Sign up with email + password, a confirmation email arrives with your login ID (e.g. FA123456)
- Log in with ID (or email) + password
- Forgot password: new temporary password + ID emailed; all data is kept
- Dashboard: budget, income, used, left, doughnut chart, daily chart, category table, advice
- AI chat: remembers your data and chat history; summaries, spending feedback, where-to-spend advice
- Assistant attachments: image, PDF, DOCX, XLSX, PPTX, TXT, MD, and CSV analysis (up to 5 MB per file)
- Alerts for overspending, risky daily pace, heavy categories, and wrongly categorized expenses
- Optional receipt/bill image analysis that fills the transaction form for user review; it does not save without the user pressing Add
- Account privacy setting to turn third-party AI processing on or off while keeping the local dashboard and reports available
- Downloadable finance reports in PDF, Excel, Word, or PowerPoint for a selected date range or month. Ask the assistant for “this month”, “October 2026”, or dates such as “10/01/2026 to 10/19/2026” (MM/DD/YYYY).

## Free multilingual assistant speech (non-commercial)
- Install Python 3.10–3.12, then run `py -3 -m pip install -r requirements-tts.txt` on Windows (use `python3 -m pip install -r requirements-tts.txt` on Linux/macOS).
- Start AIPFA normally with `npm start`. The first spoken reply for a selected language downloads that language's MMS checkpoint and can take a while; later replies use the local cache.
- The language menu lists languages marked as supported for TTS by Meta MMS. This uses the free, locally run model rather than a per-request voice API, but still needs server storage, compute, network access for the first model download, and hosting resources.
- MMS is licensed CC-BY-NC 4.0. This setup is for personal/competition non-commercial use; obtain a suitable license before commercial use. Some languages or hosting environments may not work, and browser voice recognition support varies by device/browser.
- For a Docker deployment, build this folder as an image and run it with a persistent volume mounted at `/data`, pass the app's environment secrets at runtime, and expose the platform-provided `PORT` (the app listens on it). The volume preserves both SQLite data and downloaded voice models. Allow outbound HTTPS to Hugging Face for first-use model downloads. Choose a host with enough RAM/CPU for PyTorch inference and long enough request limits for the first download; lightweight/serverless hosts may not support this setup reliably.

## Security notes
Passwords are bcrypt-hashed (never stored or emailed in plain form except the one-time temporary reset password), new passwords must be at least 12 characters, and login attempts are rate-limited by network plus a hashed account/network key. Sessions use random httpOnly SameSite=Strict cookies and Secure cookies when `BASE_URL` is HTTPS. A production process refuses HTTP by default; local-only Docker testing can opt into loopback HTTP with `ALLOW_INSECURE_LOCAL_HTTP=true`. Security events are recorded without IPs, passwords, tokens, or email contents and pruned after 90 days. On POSIX systems the app applies owner-only permissions to its SQLite database and WAL files; on Windows, restrict the app data directory with NTFS ACLs. The API key stays on the server.

`TRUST_PROXY` defaults to `0` for direct/local access. On a hosted deployment, set it to the exact number of trusted reverse-proxy hops in front of the app; an incorrect value can break client-IP rate limiting or trust spoofed headers. Never set it to `true` unless every connecting client is behind a trusted proxy. For a local Docker run only, use `BASE_URL=http://localhost:3000` and `ALLOW_INSECURE_LOCAL_HTTP=true`; do not enable this setting on a public deployment.

Before release, run `npm audit --omit=dev`, update vulnerable packages, and review the resulting lockfile diff. Store encrypted backups outside the public app directory and restrict access to the host volume. The app does not encrypt SQLite contents itself.

AI chat and bill scanning send finance context or the selected image to the configured OpenRouter model only after the user explicitly enables consent in the Account tab. Existing accounts must confirm this once after upgrading. Disabling consent blocks AI chat and bill scanning but local ledger, dashboard, and report exports remain available. Scan results are suggestions and require review before saving. Do not upload sensitive documents unless you accept the configured AI provider's data handling terms.

## Deploy to Azure

For the prepared Render + Turso setup, see [docs/RENDER-TURSO.md](docs/RENDER-TURSO.md). It covers the one-time SQLite import and the required Render environment variables.

For the supported Azure path with the current SQLite database, use a single Azure Linux VM with a persistent managed disk, Docker Compose, and Caddy for HTTPS. Follow [Azure deployment instructions](docs/AZURE-DEPLOYMENT.md) before creating resources. Azure App Service's shared `/home` storage and Azure Files mounts are network storage; SQLite WAL is not supported on network filesystems, so the current database should not be placed there.

The app uses SQLite and in-process rate limits, so keep one app instance. The included Azure Compose file mounts the VM's local managed-disk filesystem at `/data`; this is where SQLite WAL and downloaded voice models are stored. Back up the disk and database securely; the app does not encrypt SQLite contents itself.

The GitHub Student Developer Pack's Azure offer may provide $100 of Azure credit for 12 months to eligible students aged 18+. Check the offer and remaining credit in your own accounts before creating billable resources. Azure credit does not pay OpenRouter charges; AI features need separate provider credits. Set a budget alert and do not convert the subscription to pay-as-you-go unless you accept possible charges.

## Competition documentation
- [System architecture and core algorithms](docs/ARCHITECTURE.md)
- [Azure VM deployment guide](docs/AZURE-DEPLOYMENT.md)
- [Security self-assessment and known risks](docs/SECURITY-ASSESSMENT.md)
- [Manual test cases](docs/TEST-CASES.md)
- [Under-10-minute demo script](docs/DEMO-SCRIPT.md)
- [Competition presentation deck](submission/AIPFA-competition-deck.pptx)
- [Sandbox smoke-test evidence](submission/SMOKE-TEST-EVIDENCE.md)

These documents describe the current implementation; they do not replace running the test cases, recording execution evidence, or producing the presentation and demo video. Review the security assessment before any public deployment.
