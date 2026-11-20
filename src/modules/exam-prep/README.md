# Exam Prep module

Free weekly test papers for Classes 9-12. The tutor runs intake, papers, submissions, marking, reports,
private ranking, messaging and paid plans from one screen at **/exam-prep**. Students and parents use
Google Forms and WhatsApp; only the tutor signs in.

The module is self-contained. It has its own PostgreSQL database (`rsc_exam_prep`), its own Prisma
client, its own sign-in, its own storage folder and its own scheduler. It has no links to the classroom
or the Chaos studio, and no data is shared with them.

## Setup

```bash
npm install                       # also generates the Exam Prep Prisma client
npm run exam-prep:migrate         # applies prisma/exam-prep/migrations to rsc_exam_prep
npm run exam-prep:seed            # chapter lists (NCERT), message templates, consent text v1
npm run exam-prep:seed -- --demo  # optional: 8 fake demo students (names start with "Demo")
```

`.env` (see `.env.example`):

| Variable | Meaning |
|---|---|
| `EXAM_PREP_ENABLED` | Feature flag. Anything but `true` turns off every page, route, action, job and menu item. |
| `EXAM_PREP_DATABASE_URL` | The Exam Prep database (`rsc_exam_prep`). |
| `EXAM_PREP_TEST_DATABASE_URL` | The test database (`rsc_exam_prep_test`). Tests refuse any other database. |
| `EXAM_PREP_SECRET` | 64 hex characters. Encrypts the AI key, SMTP password and two-step secret, and signs file links. |
| `EXAM_PREP_STORAGE` | Optional. File storage folder (default `%LOCALAPPDATA%\RSC Classroom\exam-prep\files`, outside OneDrive). |
| `EXAM_PREP_BROWSER` | Optional. The Edge or Chrome used to print PDFs. It is found automatically. |

The first visit to `/exam-prep` creates the teacher account. Turn on two-step verification in
Settings → Account.

## Run, test and dry run

| What | Command |
|---|---|
| App | `npm run app` (the module lives inside the main app on port 4310, at `/exam-prep`) |
| All tests (unit, Fixtures A/B/C, acceptance R1-R14, privacy, load) | `npm run test:exam-prep` |
| Dry run only (Fixture C) | `npx vitest run --config src/modules/exam-prep/vitest.config.mts fixture-c` |
| End-to-end UI test in Edge (desktop and a 390px phone) | see below |
| Migration status / roll back the newest | `node scripts/exam-prep-migrate.mjs --status` / `--down` |
| Regenerate the server-action surface | `npm run exam-prep:gen-actions` |

The tests use `rsc_exam_prep_test` and a temporary storage folder. They stub the AI and email adapters,
so they never call a real AI service or send mail. They never touch the classroom database.

**End-to-end UI test.** Build into `.next-test`, then start a server on port 4313 that uses only the test
databases: `DATABASE_URL=…/rsc_classroom_test`, `EXAM_PREP_DATABASE_URL=…/rsc_exam_prep_test`,
`EXAM_PREP_STORAGE=<scratch>`, `EXAM_PREP_AI_ADAPTER=stub`, `EXAM_PREP_EMAIL_ADAPTER=stub`,
`NEXT_DIST_DIR=.next-test npx next start -p 4313`. Then reset and seed the test database and run
`node src/modules/exam-prep/tests/e2e/ui-flow.mjs`. On an empty test database, `node src/modules/exam-prep/tests/e2e/rows-flow.mjs` checks uploaded papers marked row by row and the questions CSV import.

Test fixtures (spec section 8):
- Fixture A: `tests/fixtures/fixture-a.ts` and `tests/domain.test.ts`.
- Fixture B: `tests/domain.test.ts`.
- Fixture C: `tests/fixture-c.test.ts`.

## Extension points (the only changes outside the module)

1. **Route prefix**: `src/app/exam-prep/**`.
2. **Middleware** (`src/middleware.ts`): `/exam-prep` skips the classroom session gate, because Exam Prep
   checks its own session. Its pages may frame same-origin content, so the marking screen can show the
   answer-sheet PDF.
3. **Scheduler registration** (`src/instrumentation.ts`): starts `startExamPrepScheduler()` only when
   `EXAM_PREP_ENABLED=true`.
4. **Permission set**: the module's own single Teacher role (`auth.ts`). Classroom roles are not used.
5. **Navigation entry**: Exam Prep's own header. There is no link from the classroom menu, by design, so
   the two never interact.

Shared code that is used: Tailwind CSS classes from `globals.css`, and npm packages that were already
installed (zod, argon2, otplib, qrcode, nodemailer, libphonenumber-js, the Anthropic SDK).

## Layout

```
prisma/exam-prep/            schema + SQL migrations (with down.sql)
scripts/exam-prep-*.mjs      migration runner (refuses non-Exam-Prep databases), action generator
src/modules/exam-prep/
  domain/                    pure functions: scoring, bands, trend, ranking, rotation, calendar, rules
  services/                  people, papers, calendar, submissions, marking, analytics, reports,
                             ranking, messaging, commerce, metrics, privacy
  adapters/                  storage, pdf (Edge), email (SMTP), ai-marker (Claude), whatsapp (wa.me)
  ep-handlers.ts, actions.ts server actions (feature flag + teacher session + validation)
  settings.ts                every threshold, price and time (R14)
  audit.ts, auth.ts, jobs.ts, config.ts, db.ts
  seed/, tests/
src/app/exam-prep/           screens
```

See also: `DISCOVERY.md`, `ASSUMPTIONS.md`, `DATA-DICTIONARY.md` and `RUNBOOK.md`.
