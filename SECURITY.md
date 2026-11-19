# Security & go-live checklist

The app refuses to start in production unless `APP_URL` is `https://`, `COOKIE_SECURE=true` and `REQUIRE_2FA=true`.

## Before going live

- [x] **Node.js 24 LTS** (v24.22.2, supported until Apr 2028). Use the same major on the server.
- [ ] Upgrade to Next.js 16 / Prisma 7 (now possible on Node 24), then remove the `overrides` in `package.json` and re-run `npm audit`.
- [ ] Fresh secrets for production: run `npm run setup` on the server (never reuse dev `.env`).
- [ ] Store `ENCRYPTION_KEY` and `BLIND_INDEX_KEY` in a secrets manager **and** an offline backup. Losing them = losing encrypted data.
- [ ] HTTPS only, behind a reverse proxy (Caddy / Nginx / Cloudflare) that sets `X-Forwarded-For`; database and Redis never exposed publicly.
- [ ] Managed Postgres with encryption at rest, TLS (`sslmode=require`), automated backups, point-in-time recovery.
- [ ] Owner account has 2FA on and recovery codes saved offline.
- [ ] `npm audit --omit=dev` clean; enable Dependabot/Renovate.
- [ ] Error monitoring (Sentry) configured to scrub PII.
- [ ] Rotate `SETUP_TOKEN` (it's only useful while no account exists, but don't leave it lying around).
- [ ] Webhook endpoints (WhatsApp / Google) verify signatures (`App Secret`) before trusting payloads (Phase 1).

## Local-machine notes

- This project folder is inside **OneDrive**, so `.env` (with secrets) syncs to the cloud. Consider moving the project out of OneDrive, or exclude `.env` from sync.
- Docker services listen on `127.0.0.1` only, so other devices on your Wi-Fi can't reach them.

## Reporting

Security issues: email the Owner directly. Don't open public issues.
