# RSC Classroom

Control room for **Rahul Shah Classes**: Class 8–12, JEE, Olympiad and professional bootcamps.
Design docs live in [design/](design/README.md).

## Run it locally

Prerequisites: **Node 24 LTS** (pinned in `.nvmrc`; `npm` refuses other versions), Docker Desktop.

Package install scripts are blocked by default (npm 11). Only those listed under `allowScripts` in `package.json` run (Prisma, esbuild). Review any new ones with `npm install-scripts ls` before approving.

```bash
npm install
npm run setup          # creates .env with strong random secrets (never overwrites)
npm run services:up    # Postgres, Redis, Mailpit in Docker (127.0.0.1 only)
npm run db:migrate     # create tables
npm run db:seed        # program types, subjects, starter fields, academic year
npm run app            # daily use: fast production build on http://localhost:4310
```

- **`npm run app`** is for using the app day to day. It builds once, then pages answer in about 0.02–0.05 s. Run it again after code changes.
- **`npm run dev`** is only for developing (Turbopack). Pages compile on first visit and after every code change, so clicks can take seconds.

`npm run app` treats `http://localhost` as a local-only production build: no HTTPS, so no forced secure cookies or 2FA. Any other address keeps the full production checks (HTTPS, secure cookies, 2FA required).

On first visit you're sent to **/setup**. Paste `SETUP_TOKEN` from `.env`, then create your Owner account.
That page disappears once an account exists. Next, turn on two-factor authentication in **Settings › Security**.

### Ports (all non-standard, localhost only)

| Service | Address |
|---|---|
| App | http://localhost:4310 |
| Prisma Studio (`npm run db:studio`) | http://localhost:4312 |
| PostgreSQL | 127.0.0.1:54329 |
| Redis | 127.0.0.1:63790 |
| Mailpit (test inbox) | SMTP 127.0.0.1:10250 · UI http://localhost:10251 |

Ports come from `.env`. Scripts stop with an error if a port is busy and never switch to another one.

### Testing (never against your real data)

End-to-end tests run against a separate database `rsc_classroom_test` and a second dev server on **port 4313**
(`WEB_PORT=4313 NEXT_DIST_DIR=.next-test DATABASE_URL=…/rsc_classroom_test`). The test cleanup SQL refuses to run on any database whose name doesn't end in `_test`.

### Edit mode

Owners listed in `FULL_EDIT_EMAILS` (in `.env`) get an **Edit mode** switch in the header. It reveals edit controls for every record: years, subjects, program types, institute defaults, custom fields, admission numbers, contact details, enrolments, and moving programs/courses/batches. The allowlist lives only in `.env`, so it can't be granted from inside the app. Every change is audit-logged, and the audit log itself stays read-only.

After adding a handler to a module, run `npm run gen:actions` to regenerate that module's `actions.ts`.

## Code layout

```
src/
  core/            shared kernel: env, db, crypto, auth (sessions, 2FA, rate limits), rbac, audit, events, action wrapper
  modules/<name>/  one folder per domain module
     service.ts    reads / business logic (server-only)
     handlers.ts   validated, permission-checked mutations (server-only)
     actions.ts    "use server": the ONLY functions the browser can call; thin wrappers over handlers
  app/             Next.js routes: (auth) = public sign-in pages, (app) = signed-in area
  components/      UI building blocks
prisma/            schema, migrations, seed
```

Modules: `auth`, `config` (custom-field engine), `academics`, `students`. More modules (classrooms, attendance, calendar, fees, enquiries, communication, reports, backup) follow the same shape.

## Security model (summary)

- **Auth**: Argon2id passwords (≥12 chars), opaque session tokens stored only as SHA-256, HttpOnly + SameSite cookies (`__Host-` + Secure in production), 12 h idle and 7-day absolute expiry, all sessions invalidated on password change.
- **2FA**: TOTP with replay protection, 10 single-use hashed recovery codes; forced on in production.
- **Brute force**: per-email and per-IP throttling, account lock after 5 failures, identical errors and timing for unknown emails.
- **Every mutation** goes through `defineAction`: authentication → permission → strict zod schema → audited. Next.js rejects cross-origin action calls.
- **PII encryption**: phones, emails, DOB and fields marked "sensitive" are AES-256-GCM encrypted with per-field AAD. HMAC blind indexes allow search by phone/email without decrypting.
- **Headers**: per-request nonce CSP with `strict-dynamic`, `frame-ancestors 'none'`, nosniff, no-referrer, COOP/CORP, HSTS (production), `no-store` caching.
- **Audit log** of sign-ins, failures and every change (never secrets or decrypted PII).
- **Infra**: Docker services bound to 127.0.0.1 with random passwords; Postgres uses SCRAM; no default credentials anywhere.

See [SECURITY.md](SECURITY.md) for the go-live checklist.
