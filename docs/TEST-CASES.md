# AIPFA manual test cases

Record the environment, date, tester, pass/fail result, and screenshot/log evidence for each case before submission. Use synthetic accounts and data. `npm test` runs an isolated automated smoke subset against a temporary SQLite database; the other cases below still require manual verification.

| ID | Scenario | Expected result |
|---|---|---|
| AUTH-01 | Sign up with valid email/password (12+ characters) and confirm email | Account is created, password is not stored in plain text, verified account can log in |
| AUTH-02 | Login with incorrect password or unverified account | Login is rejected without creating an authenticated session |
| AUTH-04 | Try a password under 12 characters, common weak password, or over 72 UTF-8 bytes | Signup/password change rejects it; existing accounts can still log in using their existing valid password |
| RATE-02 | Submit eight wrong passwords for one account from one network, then try again | The account/network pair is throttled; another account and local finance data remain unaffected |
| AUTH-03 | Request password reset for unknown email | Generic response does not reveal whether account exists |
| DATA-01 | Create income, expense, and savings transactions | Values appear only in the current user's dashboard and history |
| DATA-02 | Try invalid amount, category, and date | API rejects invalid input and ledger remains unchanged |
| DATA-03 | Try spending above available balance | API rejects it and shows the available-balance explanation |
| DATA-04 | Change another account's transaction ID in a delete request | Other user's record is not modified |
| BUDGET-01 | Save monthly/daily budgets and exceed a threshold | Dashboard shows the corresponding budget status/insight |
| AI-01 | Ask for a finance summary with AI permission enabled | Reply uses that account's figures and does not expose another user's data |
| AI-02 | Disable AI permission, then send chat and scan requests | Both AI endpoints reject processing; dashboard and local reports remain usable |
| AI-03 | Upgrade an existing account, sign in, and attempt AI before consent | AI is blocked until the user explicitly enables consent; after consent, the original AI features work |
| BILL-01 | Analyze a clear synthetic receipt image | Suggested amount/vendor/date/category fill the form; no transaction exists until Add is pressed |
| BILL-02 | Upload unsupported, oversized, or non-bill image | Request is rejected with a readable error and no transaction is created |
| REPORT-01 | Ask the assistant for a PDF, DOCX, XLSX, or PPTX report for this month, a named month, and an exact `MM/DD/YYYY` range | Each file opens, displays the requested period, and contains only the authenticated user's selected range |
| CACHE-01 | Update a public JS/CSS/HTML asset, then use ordinary browser refresh with the service worker enabled | The browser revalidates assets and loads the updated site; offline shell fallback remains available |
| PRIV-01 | Delete account with correct password | Account, sessions, chat, budgets, and transactions are deleted |
| PRIV-02 | Delete account with wrong password | Account and data remain unchanged |
| RATE-01 | Exceed auth/chat/bill limits | Requests are throttled without server crash |
| SEC-01 | Start production with HTTP `BASE_URL`, HTTPS `BASE_URL`, and local loopback with explicit opt-in | HTTP startup is refused by default; HTTPS works and login cookie includes `Secure`; loopback HTTP works only with `ALLOW_INSECURE_LOCAL_HTTP=true` |
| SEC-02 | Inspect SQLite file permissions on POSIX and Windows | POSIX DB/WAL files are owner-only; Windows data directory ACL allows only the app/user and authorized operators |
| SEC-03 | Run `npm audit --omit=dev` | No known production dependency vulnerabilities are reported |
| DEPLOY-01 | Restart from a persistent Docker volume | Account data remains; secrets are supplied from runtime configuration |
| AZURE-01 | Deploy with `docker-compose.azure.yml` on a single Azure Linux VM; point DNS to the VM and allow inbound 80/443 | Caddy serves the app over HTTPS; port 3000 is not public; container logs show readiness |
| AZURE-02 | Mount a persistent local managed-disk filesystem at `/data`; create a synthetic account, restart containers and reboot the VM | Account and ledger survive; database, WAL, and SHM files remain together on the local disk; no Azure Files/App Service network mount is used |
| AZURE-03 | Set `NODE_ENV=production`, public HTTPS `BASE_URL`, and `TRUST_PROXY=1` for the single Caddy proxy | Startup succeeds, HTTPS cookies are secure, and client-IP rate limits use the real client IP without trusting spoofed forwarding headers |
| AZURE-04 | Configure email, OpenRouter secrets, and a funded provider account in the VM's protected `.env`; exercise signup, reset, bill scan, and assistant file analysis | Email links work; AI calls return usable responses; secrets are absent from source, client assets, and logs |
| AZURE-05 | Keep `DEMO_SEED` unset/false and the app at one instance; inspect Azure student credit and resource usage | No fixed-credential demo user exists; no scale-out or pay-as-you-go change happens unexpectedly |
| AZURE-06 | Build and start the Docker image on an equivalent Linux host; request first-use TTS for a supported language | Image builds, app starts, and TTS model download/inference fits available memory, CPU, storage, and request limits |
