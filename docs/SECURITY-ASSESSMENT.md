# AIPFA security self-assessment

Status: implementation review for the competition submission and Azure deployment preparation. This is not a certification, penetration test, or legal compliance determination. Review date: 2026-10-20.

## Permission levels

- Core/local account level: authenticated user can view and manage only their own ledger, budgets, dashboard, and locally generated reports.
- AI-enabled level: when the account's `ai_data_sharing` permission is enabled, AI chat may send financial context to the configured OpenRouter model and bill scanning may send the selected image. The Account tab can disable this level. Disabling it blocks chat and bill analysis while preserving core/local features.
- There is no administrator, shared-account, or delegated-access role in this prototype.

The permission flag is retained during migration, but AI processing also requires a recorded explicit consent timestamp. Existing accounts therefore must enable consent once in Account settings after upgrading. Turning consent off disables external AI processing while retaining local ledger, dashboard, and report features.

## Controls present

- Passwords use bcrypt cost 12 for new hashes, a 12-character minimum, common-password checks, and a 72-byte maximum to match bcrypt's input limit; random session values are stored as hashes. Email confirmation links are consumed after successful confirmation.
- Session cookie uses `httpOnly`, `SameSite=Strict`, and is marked `Secure` when the configured base URL uses HTTPS.
- Authenticated routes scope database operations by user ID; SQL statements use parameters.
- JSON input size limits, request validation, IP and account/network login-attempt limits, chat/bill rate limits, Helmet security headers, API no-store headers, password checks for account deletion, and deletion cascades are implemented.
- Security events (login success/failure, password changes/resets, AI permission changes, and account deletion) are retained for 90 days without storing IPs or credential values. Account deletion detaches past events from the deleted user.
- On POSIX systems the process uses a restrictive umask and applies owner-only permissions to SQLite files. Windows deployments must restrict the data directory with NTFS ACLs.
- Bill scan validates file type/encoded size and returned amount/date/category. It never writes a transaction automatically.
- `.env` and database files are ignored by Git. `.env.example` contains placeholders only; deployment secrets belong in the hosting platform's secret store. Email delivery logs omit recipient addresses and provider response bodies.

## Known risks and mitigations

1. Third-party AI data transfer: finance context, chat messages, and bill images can leave the application server when AI permission is enabled. Explain provider handling, minimize sent data, and obtain explicit consent before real-user deployment.
2. AI extraction/recommendation errors: bill fields and assistant advice may be wrong. Require transaction review; show that results are suggestions; never execute payments or financial transactions automatically.
3. Secret exposure: rotate any key that was ever committed or shared. Keep real keys out of source, logs, screenshots, and demo recordings.
4. Password reset sends a temporary password by email; use a dedicated test mailbox, enable email account protection, and change the temporary password after login. Avoid storing mail contents in provider or application logs.
5. Session and rate-limit scaling: sessions and login-attempt counters are persisted in SQLite, while the general auth/chat/bill rate-limit middleware uses process memory. Use a shared rate-limit store for multi-instance deployment and set `TRUST_PROXY` to the exact trusted proxy hop count.
6. Data at rest and backups: SQLite files are not encrypted by the app. Protect host volumes, restrict and encrypt backups, define retention, and test restore/deletion procedures. POSIX file permission tightening does not replace Windows NTFS ACL configuration.
7. TTS licensing/runtime: Meta MMS uses CC-BY-NC 4.0 and requires suitable non-commercial use; first-run downloads, CPU/RAM use, and hosting constraints can affect availability.
8. Missing assurance work: this review has not run a penetration test or independent privacy/legal review. Complete the test cases and attach execution evidence before submission.
9. Azure persistence and database limits: the current database uses SQLite WAL. Do not put it on App Service `/home` or Azure Files network storage; SQLite documents that WAL does not work over network filesystems, and Azure warns against using mounted storage for SQLite. Use a local filesystem on a persistent Azure VM managed disk, keep one app instance, verify restart persistence, and keep protected backups. Migrating to a managed database is needed before choosing an Azure multi-instance/PaaS architecture.
10. Student cloud credit: Azure for Students credit has a spending limit and expiration. Monitor remaining credit and costs; Azure credits do not cover OpenRouter usage. Do not enable pay-as-you-go unless charges are intended.
11. Container and voice resources: the Docker image installs CPU PyTorch and Transformers, making image builds large. TTS downloads language models on first use and can need substantial disk, memory, CPU, and outbound HTTPS. Confirm the chosen VM has enough disk, memory, and CPU, and that this non-commercial prototype's MMS use is appropriately licensed.

## Incident and operational checklist

- Rotate an exposed OpenRouter/SMTP key immediately and review provider usage logs.
- Keep production on HTTPS, verify `BASE_URL` and `TRUST_PROXY`, and supply secrets outside the repository. Production startup refuses public HTTP and warns when `TRUST_PROXY` is not configured.
- For the included Azure VM setup, mount a persistent local managed-disk filesystem at `/data` and use `docker-compose.azure.yml`. Keep port 3000 private behind Caddy; `TRUST_PROXY=1` is for that single reverse proxy. Do not use Azure App Service `/home` or Azure Files mounts for the WAL database.
- Keep `DEMO_SEED` unset or `false` in production. The opt-in demo account uses public, fixed credentials and must never be enabled for a public service.
- Enable Docker/container logging on the VM and test startup, signup email, AI consent, bill scan, attachment analysis, report downloads, TTS, restart persistence, and account deletion using synthetic data before accepting real users.
- Back up SQLite securely; document retention and account deletion behavior.
- Record a clean demo with synthetic data only. Avoid showing real email addresses, keys, transaction notes, or personal bills.
