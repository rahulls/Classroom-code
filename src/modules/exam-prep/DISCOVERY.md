# Discovery: the existing project (step 0)

| Area | What the project has | What Exam Prep does |
|---|---|---|
| Language and framework | TypeScript, Next.js 15 (App Router, server actions), React 19 | Same |
| Package manager | npm, exact versions, Node 24 (`engine-strict`) | Same. Added `pdf-lib` (runtime), `vitest` and `playwright-core` (dev); updated `@types/node` 20 → 24 to match the required Node 24 |
| Build and test | `npm run build`, `npm run typecheck`; there was no test runner | `npm run test:exam-prep` (vitest) |
| Database and ORM | PostgreSQL 16 in Docker (port 54329), Prisma 6. The classroom DB has no `_prisma_migrations` history, and there was a past shadow-database incident | **Separate database** `rsc_exam_prep` with its own Prisma schema and client. SQL migrations are applied by `scripts/exam-prep-migrate.mjs`, which refuses any other database and never uses a shadow DB |
| Auth and roles | Classroom users, sessions, RBAC permission keys, two-step codes | Not reused, at the owner's request. Exam Prep has one Teacher account in its own DB, its own cookie (scoped to `/exam-prep`), its own two-step codes and its own rate limits |
| Routing and navigation | `src/app/(app)` for the classroom, `src/app/chaos` for the studio | `src/app/exam-prep` with its own header; no classroom menu entry |
| UI | Tailwind; component classes `card`, `btn`, `input`, `label`, `table` | Same classes, with Exam Prep's own small form kit (`src/app/exam-prep/ui.tsx`) |
| File storage | Local folders (`storage/`, `%LOCALAPPDATA%`) | `%LOCALAPPDATA%\RSC Classroom\exam-prep\files` (outside OneDrive), served only through signed 5-minute links that also need the teacher session |
| Jobs | `instrumentation.ts` starts the classroom delivery loop | One extra registration (only with the flag on): a 10-minute idempotent tick |
| Email | nodemailer with local Mailpit (port 10250) | nodemailer with Exam Prep's own SMTP settings. Default is Mailpit, and sending is off until switched on |
| PDF | None | HTML printed by the installed Edge in headless mode, which shapes Hindi correctly; `pdf-lib` joins photos and counts pages |
| AI | `@anthropic-ai/sdk` (Chaos studio) | Same SDK behind an adapter, with Exam Prep's own encrypted key setting |
| Overlapping entities | Classroom students, contacts, classes, subjects | **None reused**: the owner asked for no interaction with the classroom. Exam Prep has its own `Student` and `Parent` |

Decisions:
- Module folder `src/modules/exam-prep` follows the existing `src/modules/<name>` convention.
- Server actions follow the project's pattern (handlers plus a generated `"use server"` file). The handler
  file is called `ep-handlers.ts` so the classroom's generator never touches it.
- WhatsApp has no API in v1: the module drafts messages with `wa.me` links and records "sent" when the
  tutor confirms.
