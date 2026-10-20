# Azure deployment guide

This guide prepares the current SQLite/WAL application for a **single Azure Linux VM** using a persistent local managed disk, Docker Compose, and Caddy for HTTPS. It does not create Azure resources or deploy the app for you.

## Why use a VM for this version

The server enables SQLite Write-Ahead Logging (WAL). SQLite documents that WAL does not work over a network filesystem. Azure App Service's Linux `/home` storage is shared persistent storage, and Microsoft warns against using storage mounts for local databases such as SQLite. For this version, keep the database on the VM's local filesystem backed by a persistent Azure managed disk. Do not put the WAL database on App Service `/home` or Azure Files. A managed database and multi-instance Azure PaaS hosting would require a database-adapter change and a separate migration review.

## Student credit and service costs

The GitHub Student Developer Pack currently lists an Azure benefit with $100 of credit for eligible students aged 18 or older. Redeem the offer, then verify your Azure subscription, remaining credit, and expiration date before creating resources. Azure for Students credit is limited and time-bound; Microsoft says the subscription may be disabled when the credit runs out or the credit period ends. Set a budget alert and do not upgrade to pay-as-you-go unless you accept paid usage. VM compute, managed disks, and network addresses/egress can consume credit; the actual duration depends on your chosen sizes and uptime.

Azure credit does not pay OpenRouter. Assistant chat and bill/image analysis require a separately funded OpenRouter account. Choose a VM with enough CPU, RAM, and disk for the included Docker image. The Dockerfile installs CPU PyTorch and Transformers, and first-use TTS downloads a language model. TTS is optional but can need substantial resources; Meta MMS is licensed CC-BY-NC 4.0, so this setup is for non-commercial use unless you obtain another license. The included Compose setup builds directly on the VM, so it does not need a container registry; the first build can take time and use disk space.

## 1. Create a Linux VM and persistent disk

1. Create an Ubuntu Linux VM in the Azure Portal using the Azure for Students subscription. Choose a region and VM size available under your subscription and budget. Keep the VM to one instance; this app uses SQLite and process-local rate limits.
2. Attach a **managed data disk** to the VM. On the VM, partition/format it as ext4, mount it persistently at `/mnt/aipfa-data`, and add its UUID to `/etc/fstab`. Verify it mounts after a VM reboot. Use the managed disk, not an Azure Files share, for SQLite.
3. Restrict the VM network security group: allow SSH only from your own IP, and allow inbound TCP 80/443 for the website. Do not expose app port 3000 to the public internet.
4. Point a DNS A record for your chosen hostname to the VM's public IP. Caddy needs a public hostname and inbound ports 80 and 443 to issue and renew HTTPS certificates.

## 2. Install Docker and prepare the app

Install Docker Engine and the Docker Compose plugin on the VM using the official instructions for the VM's Ubuntu release. Copy the project source to the VM, or clone its GitHub repository after pushing the changes. `.dockerignore` excludes `.env`, SQLite files, backups, tests, and documentation from the image build. Verify that the managed data disk is mounted at `/mnt/aipfa-data` before creating or changing anything under that path; otherwise the container could write data to the VM's root disk instead.

On the VM, create data directories and grant the app's container user (UID/GID 1000) access to the app data directory:

```bash
sudo mkdir -p /mnt/aipfa-data /mnt/caddy-data /mnt/caddy-config
sudo chown 1000:1000 /mnt/aipfa-data
```

Create a protected runtime `.env` in the project directory. Start from `.env.example`, set `AIPFA_DOMAIN` and the production settings below, then enter real provider credentials only on the VM. Restrict the file:

```bash
chmod 600 .env
```

Set at least these values in `.env`:

```dotenv
AIPFA_DOMAIN=your-domain.example
BASE_URL=https://your-domain.example
NODE_ENV=production
PORT=3000
TRUST_PROXY=1
DB_PATH=/data/finassist.db
HF_HOME=/data/huggingface
DEMO_SEED=false
OPENROUTER_API_KEY=your-real-key
OPENROUTER_MODEL=openai/gpt-4o-mini
BILL_ANALYSIS_MODEL=openai/gpt-4o-mini
```

Also configure **one** email delivery option. SMTP uses `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and optional `MAIL_FROM`; Brevo uses `BREVO_API_KEY` plus `BREVO_SENDER_EMAIL`; Unosend uses `UNOSEND_API_KEY` plus an appropriate verified `UNOSEND_FROM`. Signup confirmation, password reset, and account recovery do not work without a functioning provider. Never commit `.env` or paste credentials into the frontend.

`TRUST_PROXY=1` matches the single Caddy reverse proxy in the included Compose setup. If you add another proxy/CDN in front, review the full forwarding chain and trust only the actual proxy hops.

## 3. Start with the included Azure Compose configuration

The included `docker-compose.azure.yml` binds `/mnt/aipfa-data` to the container's `/data` directory. This preserves SQLite, its `-wal`/`-shm` companion files, and TTS model cache on the VM's local managed disk. Caddy is the only container publishing public HTTP(S) ports.

From the project directory on the VM:

```bash
docker compose -f docker-compose.azure.yml up -d --build
docker compose -f docker-compose.azure.yml ps
docker compose -f docker-compose.azure.yml logs --tail=100 aipfa caddy
```

Open `https://your-domain.example`. Check the app and Caddy logs if the site does not start. Do not scale the service to multiple VMs, mount an Azure Files path over `/data`, or use the current SQLite database from more than one host. Back up the database and managed disk securely; this app does not encrypt SQLite contents.

## 4. Verify before entering real data

Use synthetic data for all initial checks:

1. Confirm the public site uses HTTPS, the app container is healthy, and port 3000 cannot be reached publicly.
2. Test signup email confirmation, login, password reset, and account deletion using a test mailbox.
3. Create a synthetic account and transactions. Restart the containers and reboot the VM; verify the data remains.
4. Enable AI consent, then try assistant chat, image/PDF/office-file analysis, and bill scanning. Review suggestions before saving. Confirm OpenRouter has credits; Azure credit is separate.
5. Download each report format and test voice separately. The first TTS request can download a model and take longer than ordinary requests.
6. Disable AI consent and confirm external AI requests are blocked while local dashboard and reports continue to work.
7. Complete the Azure cases in [TEST-CASES.md](TEST-CASES.md), configure automatic/off-host backups, and verify a restore before real-user use.

For each release, update the source on the VM and rebuild/restart the app container. This guide uses direct VM builds; it does not configure GitHub Actions or automatic deployments.

## References

- [GitHub Student Developer Pack](https://education.github.com/pack/) — current student benefits and eligibility.
- [Azure for Students FAQ](https://learn.microsoft.com/en-us/azure/education-hub/faq) — credit amount, duration, and behavior after credit exhaustion.
- [SQLite Write-Ahead Logging](https://www.sqlite.org/wal.html) — WAL limitations, including network filesystems.
- [Azure App Service persistent storage](https://learn.microsoft.com/azure/app-service/configure-custom-container) — App Service `/home` storage behavior.
- [Azure App Service storage mounts](https://learn.microsoft.com/en-us/azure/app-service/configure-connect-to-azure-storage) — Microsoft advises against using storage mounts for local databases such as SQLite.
