# Sandbox smoke-test evidence

- Command: `npm test`
- Result: **PASS — 13 tests, 0 failures** (run 2026-10-20)
- Scope: disposable temporary SQLite database, two synthetic accounts, local HTTP server, and no calls to the configured AI provider.
- Checks covered: session/profile, transaction creation and overspend rejection, per-user transaction isolation, budget/summary arithmetic, explicit AI consent and local dashboard/report access while AI is disabled, PDF/DOCX/XLSX exports, bill input validation, anonymous request rejection, weak-password rejection, per-account/network login throttling, security-event recording, existing-database migration, and production HTTPS enforcement.
- Dependency check: `npm audit --omit=dev` — **0 vulnerabilities** (run 2026-10-20).
- Additional review checks: JavaScript syntax checks and Python AST syntax parsing passed. No Docker build or live Azure deployment was run because Docker is unavailable in the review environment.
- Limit: this smoke suite does not validate real email delivery, actual OpenRouter vision/file extraction, voice/TTS runtime, full browser behavior, Windows NTFS ACLs, Azure storage/restart behavior, Azure proxy configuration, penetration resistance, or the remaining manual cases in `docs/TEST-CASES.md`.

Re-run from the `AIPFA` directory with `npm test`; re-run `npm audit --omit=dev` before a later release because dependency advisories change. The suite creates and removes its own temporary database; it does not use `finassist.db` or `aipfa.db`. See [Azure deployment instructions](../docs/AZURE-DEPLOYMENT.md) and complete the Azure cases in `docs/TEST-CASES.md` before real-user use.
