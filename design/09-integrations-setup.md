# 09 — Integrations Setup Checklist

Rahul will provide the Google and WhatsApp account details. Until then the app runs fully in **local test mode**:

- Emails are caught by **Mailpit** at `http://localhost:10251`, so nothing reaches real inboxes.
- WhatsApp messages go to a **sandbox outbox** screen that shows exactly what would be sent.
- Backups are written to a local folder instead of Google Drive.

Credentials are entered in **Settings › Integrations** (stored encrypted) or in `.env` for development. They're never committed to code, and each integration has a **Test connection** button.

---

## A. Google: Drive backups (and optionally Gmail for sending email)

| # | What's needed | Where you get it |
|---|---|---|
| 1 | The Google account that will own the backups | Your choice: personal Gmail or a Workspace account |
| 2 | A Google Cloud project | console.cloud.google.com → New project ("RSC Classroom") |
| 3 | APIs enabled: **Google Drive API** (+ **Gmail API** if sending email from Gmail) | APIs & Services → Library |
| 4 | OAuth consent screen (External, Testing mode; add your own email as a test user) | APIs & Services → OAuth consent screen |
| 5 | **OAuth Client ID + Client Secret** (type: Web application) | APIs & Services → Credentials |
| 6 | Authorized redirect URI: `http://localhost:4310/api/integrations/google/callback` | Same screen as #5 |

Scopes the app requests: `drive.file` (only files the app creates; it can't see the rest of your Drive) and optionally `gmail.send`.
After you share #5, you click **Connect Google** in Settings once and approve.

## B. WhatsApp Business (Meta Cloud API)

| # | What's needed | Where you get it |
|---|---|---|
| 1 | **Meta Business account** (verified business is recommended for higher limits) | business.facebook.com |
| 2 | A **phone number dedicated to WhatsApp Business API** (it can't also be used in the normal WhatsApp app) | Your SIM / landline |
| 3 | Meta developer app with the WhatsApp product added | developers.facebook.com → My Apps |
| 4 | **WhatsApp Business Account ID (WABA ID)** | WhatsApp → API Setup |
| 5 | **Phone Number ID** | WhatsApp → API Setup |
| 6 | **Permanent access token** (System User token with `whatsapp_business_messaging` + `whatsapp_business_management`) | Business Settings → System Users |
| 7 | **App Secret** (to verify webhooks) | App → Settings → Basic |
| 8 | A **public webhook URL**, needed for delivery/read receipts and replies | During local dev: a tunnel (cloudflared/ngrok) → `localhost:4310`; later the hosted URL |
| 9 | A webhook verify token | We generate it; you paste it into Meta |
| 10 | Payment method on the WhatsApp account | Business Settings → Payments |

After this, the app submits the starter **message templates** for approval (approval takes minutes to a day).

> If the Meta setup feels heavy, a BSP like Interakt / Gupshup / AiSensy gives you a dashboard and handles most of B1–B7. The app supports either. Just tell us which you choose.

## C. Email sending (pick one)

| Option | What's needed |
|---|---|
| **Gmail (same Google account)**: simplest | Gmail API enabled in A3; ~500 emails/day (personal) or 2,000/day (Workspace) |
| **Amazon SES**: best at scale | AWS account, verified domain (DNS records for DKIM/SPF), access key |
| **SMTP** (Zoho/other) | Host, port, username, app password |

## D. Nothing to provide yet (local)

PostgreSQL, Redis, Mailpit and MinIO run locally in Docker on the non-standard ports listed in [02-architecture.md §5](02-architecture.md).
