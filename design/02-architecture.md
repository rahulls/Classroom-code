# 02 — Architecture

## 1. Recommended stack

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** end-to-end | One language, shared types between UI and API |
| App framework | **Next.js 15 (App Router)** | UI + API in one deployable, server components, easy hosting |
| UI | **Tailwind CSS + shadcn/ui**, TanStack Table, FullCalendar, Recharts | Fast dense admin UI, accessible components |
| API style | Server Actions + typed route handlers (**tRPC** or Zod-validated REST) | End-to-end type safety |
| Database | **PostgreSQL** | Relational integrity + `JSONB` for configurable/custom fields |
| ORM | **Prisma** (or Drizzle) | Migrations, typed queries |
| Jobs / queue | **BullMQ + Redis** | Scheduled messages, retries, rate-limiting, reminders |
| Email | Provider adapter: **Amazon SES** / Resend / SMTP (Gmail Workspace) | Swappable via config |
| WhatsApp | **Meta WhatsApp Cloud API** (direct) — adapters for Gupshup / Interakt / Twilio | Official, cheapest per-message; adapter keeps us vendor-neutral |
| Files | S3-compatible storage (AWS S3 / Cloudflare R2) | Submissions, resources, report-card PDFs |
| PDFs | React-PDF or Playwright HTML→PDF | Report cards, receipts, result sheets |
| Auth | Auth.js (NextAuth) — credentials + Google, TOTP 2FA | Owner + mentor logins |
| Hosting | Vercel/Render (app) + Neon/Supabase (Postgres) + Upstash (Redis) — or a single VPS with Docker Compose | Low cost now, scales later |
| Observability | Sentry + structured logs | Know when a message batch fails |

> Alternative if you prefer Python: Django + DRF + Celery + React. The module design below stays exactly the same.

## 2. Modular monolith — layout

```
rsc-classroom/
├─ apps/
│  ├─ web/                     Next.js app (UI + API routes)
│  └─ worker/                  BullMQ worker process (messages, schedulers, PDFs)
├─ packages/
│  ├─ core/                    shared kernel: ids, errors, events bus, config engine, permissions
│  ├─ db/                      Prisma schema (split per module), migrations, seed
│  ├─ ui/                      design system components
│  └─ modules/
│     ├─ academics/            years, programs, courses, batches, groups, subjects, syllabus
│     ├─ students/             profiles, guardians, custom fields, enrollment, import
│     ├─ classrooms/           classrooms, sessions, activity types, resources
│     ├─ attendance/           statuses, marking, reports, thresholds
│     ├─ calendar/             timetable, events, holidays, recurrence
│     ├─ assessments/          assignments, submissions, tests, scoring schemes, grading
│     ├─ mentors/              mentor profiles, mentee mapping, notes
│     ├─ communication/        templates, campaigns, channels (email/whatsapp adapters), inbox
│     ├─ automation/           rules engine (event → condition → action)
│     ├─ analytics/            dashboards, reports, at-risk
│     ├─ fees/                 rate card, student fee lines, monthly dues, payments, receipts
│     ├─ enquiries/            leads, pipeline stages, follow-ups, demo bookings, convert-to-student
│     ├─ reports/              monthly progress reports, PDF rendering, review queue
│     ├─ backup/               Google Drive backup jobs, Excel workbook export, restore
│     └─ platform/             auth, roles, settings, audit log, files, search
└─ design/                     ← you are here
```

> **Implementation note (Phase 0):** the code started as a single Next.js package. Modules live in `src/modules/<name>/` and the shared kernel in `src/core/`, with the same boundaries described here. It can be split into the `apps/` + `packages/` workspaces above once a separate worker or second app is needed. Each module currently has `service.ts` (reads), `handlers.ts` (validated mutations) and `actions.ts` (the `"use server"` public surface).

### Inside every module (same shape)

```
modules/attendance/
├─ schema.prisma        tables owned by this module
├─ domain/              entities, value objects, pure business rules
├─ services/            use-cases: markAttendance(), getBatchReport()
├─ api/                 route handlers / tRPC router (thin; calls services)
├─ events.ts            events this module emits  (attendance.marked, attendance.below_threshold)
├─ subscribers.ts       events this module listens to (session.created → prepare register)
├─ permissions.ts       permission keys it defines (attendance.view, attendance.mark, attendance.edit_past)
├─ config.ts            configurable entities it registers (AttendanceStatus)
├─ ui/                  pages + components for this module
└─ index.ts             public interface. Other modules may ONLY import from here
```

**Rules:**
1. A module never queries another module's tables directly. It calls the other module's exported service or reacts to its events.
2. Modules register themselves at startup (`registerModule({ permissions, events, config, navItems })`). So adding the **Fees** module = drop in the folder + enable it in Settings.
3. Cross-module reads for dashboards go through `analytics`, which may use read-only SQL views.

## 3. Event bus & automation flow

```
 ┌────────────┐  emits   ┌──────────────┐  matches  ┌──────────────────┐ enqueue ┌───────────┐
 │ Attendance │────────▶ │  Event Bus   │─────────▶ │ Automation Rules │───────▶ │  Queue    │
 │  module    │ attendance│ (in-process +│           │  (when/if/then)  │         │ (BullMQ)  │
 └────────────┘ .marked   │  outbox tbl) │           └──────────────────┘         └─────┬─────┘
                          └──────────────┘                                              │
                                                     ┌──────────────┐   send   ┌────────▼──────┐
                                                     │ Delivery log │◀──────── │ Channel       │
                                                     │ (status,     │  webhook │ adapters:     │
                                                     │  read, fail) │◀──────── │ Email/WhatsApp│
                                                     └──────────────┘          └───────────────┘
```

- Events are written to an **outbox table** in the same DB transaction as the change, so they're never lost.
- The worker drains the outbox → evaluates rules → enqueues message jobs.
- Provider webhooks (WhatsApp status, email bounces) update the delivery log.

## 4. Scaling with class expansion

| Growth scenario | How the design handles it |
|---|---|
| New course (e.g. "Class 7 Foundation", "KVPY", "NEET") | Pure configuration: add Program/Course/Batch/Subjects in Settings |
| 10 → 100 batches, 100 → 5,000 students | Postgres indexes on `(batch_id, date)`, paginated tables, background jobs for bulk sends |
| Bulk WhatsApp to thousands | Queue + per-provider rate limit (Meta tier limits), batched email (SES) |
| New mentors / teachers | Roles & scopes, no code |
| Second branch | Every top-level table carries `org_id` / `branch_id` from day one |
| Student portal later | Students already exist as identities; add a `student` role + read-only routes |
| Split a module into a service | Module boundary + events already in place, so move its folder behind an HTTP/queue interface |

## 5. Local development: ports

Standard ports (5173, 3000, 5432, 6379…) are already in use on the dev machine, so **every service runs on localhost with a non-standard port**. All ports are set in `.env` (never hard-coded), and Docker Compose maps them the same way.

| Service | URL / port | Env var |
|---|---|---|
| Web app (Next.js UI + API) | `http://localhost:4310` | `WEB_PORT=4310` |
| Worker health/metrics | `http://localhost:4311` | `WORKER_PORT=4311` |
| PostgreSQL | `localhost:54329` | `DB_PORT=54329` |
| Redis (BullMQ) | `localhost:63790` | `REDIS_PORT=63790` |
| Mailpit (local email catcher) SMTP / UI | `localhost:10250` / `http://localhost:10251` | `SMTP_PORT`, `MAILPIT_UI_PORT` |
| MinIO (local S3) API / console | `localhost:9310` / `http://localhost:9311` | `S3_PORT`, `S3_CONSOLE_PORT` |
| Prisma Studio | `http://localhost:4312` | `STUDIO_PORT=4312` |
| WhatsApp webhook tunnel (ngrok/cloudflared → web) | forwards to `4310` | `PUBLIC_WEBHOOK_URL` |

Dev scripts fail fast with a clear message if a configured port is already taken, and never silently fall back to another port.

## 6. Security & compliance

- Students are mostly **minors**, so guardian consent is stored for WhatsApp/email communication (DPDP Act 2023, India).
- PII fields (phone, address, DOB) are encrypted at rest (pgcrypto / app-level), with masked display for mentors without `student.view.contact`.
- Signed, expiring URLs for all files.
- Every write is audit-logged (`actor, action, entity, before, after, at`).
- Rate-limited login, 2FA for Owner.
- Nightly encrypted backups, 30-day retention.
