# AIPFA test cases and recorded results

This file separates **recorded results** from the **test plan**. A scenario marked Manual is not a pass until it has actually been run on the target environment. Use synthetic accounts, addresses, documents, and transaction data. Do not put real passwords or API tokens into test evidence.

## Recorded results available in this project/conversation

| Check | Result | Evidence / limits |
|---|---|---|
| Local app startup (`npm start`) | PASS | User's terminal showed `AIPFA running at http://localhost:3000`. This confirms the server started locally; it does not prove public deployment. |
| SMTP startup check | PASS | User's terminal showed `[EMAIL] SMTP login OK. Emails will be delivered.` This confirms SMTP authentication, not successful delivery to every recipient or spam-folder handling. |
| Local TTS startup | PARTIAL | A PyTorch `torch.jit.script` deprecation `FutureWarning` appeared. The warning alone does not verify a complete voice response. |
| SQLite → Turso import (`npm run migrate:turso`) | PASS | User's terminal reported 142 copied rows: users 7, issued login IDs 16, verification tokens 4, sessions 5, trusted devices 1, security events 42, budgets 10, transactions 23, and chat 34. This verifies the import command completed; verify real records in the deployed service before removing the local backup. |
| Automated smoke suite (`npm test`) | Previously recorded PASS: 13 tests, 0 failures | The repository's prior smoke-test evidence recorded this result on 2026-10-20. It was not rerun during the README/test-document cleanup. Run it again against the current checkout before release. |
| Dependency audit (`npm audit --omit=dev`) | Previously recorded PASS: 0 vulnerabilities | This is a historical result recorded on 2026-10-20, not a current audit. Run it again before release because advisories change. |

## Automated smoke tests

Run from the project folder:

```powershell
npm test
```

`tests/smoke.test.js` starts a local test server with synthetic users and a disposable temporary SQLite database, then removes the temporary database. It does not use `.env` credentials, the normal app database, a live mail provider, or OpenRouter. The automated coverage includes:

- Static app assets respond and browser caching requires revalidation.
- Authenticated profile/session behavior and legacy-account AI consent defaults.
- Transaction creation, overspending rejection, and per-user transaction isolation.
- Budget write and summary arithmetic.
- AI opt-in/opt-out enforcement and continued access to local dashboard/report data.
- Invalid bill input and rejection of unauthenticated ledger access.
- PDF, DOCX, XLSX, and PPTX report downloads; assistant-generated date-range/current-month reports.
- Weak password rejection and account/network login throttling.
- Security-event recording without storing credential values or raw network identifiers.
- Existing legacy SQLite schema migration and account login after the schema upgrade.
- Production startup rejection when a public `BASE_URL` uses HTTP.

## Manual test plan

Record date, version/commit, environment, PASS/FAIL, and non-sensitive evidence for each run.

| ID | Scenario | Expected result | Status |
|---|---|---|---|
| AUTH-01 | Register with valid details and a strong password; open the confirmation email | Account is created, email confirmation succeeds, and the generated login ID is usable | Manual |
| AUTH-02 | Attempt login before email verification | Login does not create an authenticated session | Manual |
| AUTH-03 | Sign in with login ID, username, and email; also try an incorrect password | Valid identifiers work; incorrect credentials are rejected without a session | Manual |
| AUTH-04 | Request a password reset for an existing and a nonexistent address | Response does not reveal account existence; reset mail is delivered only for a valid account | Manual |
| AUTH-05 | Change password with correct and incorrect current passwords | Correct current password updates it; incorrect password leaves it unchanged; other sessions are invalidated | Manual |
| AUTH-06 | Set and verify a recovery email, then promote it to the primary sign-in email | Verification is required; promotion updates sign-in email and signs out other devices | Manual |
| AUTH-07 | Log in from a new device, approve by email, and continue; repeat with a configured PIN | New-device approval expires/works as expected; enabled PIN is required and wrong PIN is rejected | Manual |
| AUTH-08 | Enable/change/disable the six-digit PIN with valid and invalid account passwords | Only a valid account password changes the setting; PIN is never returned in plaintext | Manual |
| AUTH-09 | Try too-short, weak/common, and over-limit new passwords | New password is rejected with a useful message | Automated subset / Manual boundaries |
| DATA-01 | Add income, an ordinary expense, and a Savings-category transaction | Dashboard totals update; savings are tracked separately from ordinary spending | Automated subset / Manual UI |
| DATA-02 | Submit zero/negative/invalid amounts, unsupported categories, malformed dates, and overlong notes | Invalid transactions are rejected; ledger remains unchanged | Automated subset / Manual boundaries |
| DATA-03 | Try an expense larger than the available balance | Request is rejected with the balance explanation; no transaction is saved | Automated |
| DATA-04 | Use two accounts; try to read/delete the other account's transaction | Each account sees and changes only its own records | Automated subset / Manual delete |
| DATA-05 | Review current, historical, and account-anchored accounting periods | Month views, history, daily chart, category totals, and previous-month comparison match the entered records | Manual |
| BUDGET-01 | Save monthly and daily budgets; exceed or approach thresholds | Progress, projections, category/savings advice, and notifications reflect the data | Automated budget math / Manual insights |
| AI-01 | Leave AI consent disabled and try chat plus bill scan; then explicitly consent and retry | Disabled state blocks external processing; enabled state permits it with configured provider credentials | Automated block / Manual live provider |
| AI-02 | Upload each supported attachment type under 5 MB, then unsupported/oversized files | Supported file is processed when consent/provider allow; invalid input receives an error and does not alter finance records | Manual |
| AI-03 | Ask assistant for a finance summary and advice with consent enabled | Reply uses only the authenticated user's permitted context; no other user's data appears | Manual, live provider required |
| BILL-01 | Scan a synthetic clear receipt and inspect suggested fields; scan a non-bill/unclear image | Valid scan suggests fields; unclear/non-bill inputs are rejected or marked; no transaction is saved until user presses Add | Automated invalid-input subset / Manual live provider |
| BILL-02 | Scan a synthetic non-USD receipt | Suggested currency and converted USD value are reasonable; conversion failure gives a useful error | Manual, live rate source required |
| REPORT-01 | Download PDF, Excel, Word, and PowerPoint reports for current month and a chosen date range | Each file opens, displays the chosen period, and contains only the signed-in user's records | Automated formats/date subset / Manual content review |
| PRIV-01 | Turn AI consent off after enabling it; then use dashboard and reports | Chat and bill analysis are blocked; local finance pages and report exports still work | Automated |
| PRIV-02 | Delete account with the correct password, then try logging in; repeat with a wrong password on a test account | Correct password permanently removes account data/sessions; wrong password preserves the account and data | Manual |
| SEC-01 | Inspect password/session data in the database and cookies in browser developer tools | Passwords/PINs are hashes; raw session values are not stored; session cookie is `httpOnly`, `SameSite=Strict`, and `Secure` over HTTPS | Automated design review / Manual production check |
| SEC-02 | Send repeated bad logins and high-rate chat/bill requests | Rate limits return throttling responses and the server remains available | Automated login subset / Manual chat and bill limits |
| SEC-03 | Inspect API responses and server logs while using the app | Sensitive API responses are not cached; logs do not expose secrets, passwords, tokens, recipient addresses, or email body contents | Manual |
| SEC-04 | Review browser response headers and state-changing request behavior | Helmet security headers are present; state-changing API requests use the expected JSON/session protections | Manual |
| SEC-05 | Start production with a public HTTP URL, then with HTTPS; test local loopback opt-in separately | Public HTTP startup is refused by default; HTTPS cookies are secure; insecure HTTP opt-in is limited to local testing | Automated startup check / Manual cookie check |
| SEC-06 | Check database file and backup permissions on the host | SQLite is not treated as encrypted; only authorized operators can access data/backups; Windows uses restrictive NTFS ACLs | Manual |
| PWA-01 | Install app where supported, refresh after updating an asset, and test offline shell fallback | Install prompt/offline shell behave as expected; browser revalidates updated assets | Automated asset headers / Manual install/offline |
| NOTIFY-01 | Enable/disable in-app budget alerts and browser notifications | Preference is respected; alerts reflect budget state; denied browser permission degrades gracefully | Manual |
| VOICE-01 | Use microphone input in supported and unsupported browsers | Supported browser transcribes input; unsupported browser shows/uses its fallback without breaking chat | Manual |
| VOICE-02 | Request spoken replies for listed languages on a fresh install and after model cache exists | Model download and inference work within available resources; cached run reuses local model | Manual; not verified by startup warning |
| MAIL-01 | Send a verification/reset message with the selected email provider and check inbox/spam | Provider accepts message; links point to the deployed HTTPS `BASE_URL` and expire/complete the expected action | SMTP login startup check recorded; actual message flow Manual |
| MIG-01 | Import a local SQLite database into a blank Turso database and compare row counts | Migration completes and counts match; preserve local database/backup until application data is verified | PASS: user-reported 142 rows copied |
| MIG-02 | Attempt to rerun migration against a populated Turso DB | Importer refuses to overwrite existing app data; existing remote rows remain intact | Manual |
| DEPLOY-01 | Deploy Render Blueprint with secrets set and correct HTTPS `BASE_URL`; inspect build/health logs | Docker build and health check succeed; secrets are supplied through Render, not repository files | Manual; deployment not yet recorded as complete |
| DEPLOY-02 | Add synthetic test data in deployed app, restart service, and log back in | Turso-backed records persist after the Render container restarts | Manual |
| DEPLOY-03 | Connect custom domain using DNS values displayed in Render | DNS validates, TLS becomes active, canonical URL/email links use the custom HTTPS domain | Manual |
| DEPLOY-04 | Test TTS on the selected Render plan | Voice response works within host memory/CPU/storage/time limits or the limitation is recorded | Manual; do not assume free-tier TTS works |
| AUDIT-01 | Run `npm audit --omit=dev` before release | Review current advisories and address them; historical zero-vulnerability result is not a guarantee for later dates | Previously recorded PASS; rerun |

