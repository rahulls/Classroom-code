# 07 — Roadmap & Open Questions

## Phased delivery

### Phase 0: Foundation (≈1 week)
- Monorepo, module skeleton, DB, auth (owner), settings framework, audit log, event outbox, worker
- Local dev on **non-standard localhost ports** (web `http://localhost:4310`; full map in [02 §5](02-architecture.md#5-local-development-ports)), Docker Compose for Postgres/Redis/Mailpit/MinIO
- Config engine (field definitions + generic form builder)

### Phase 1: MVP (≈4–5 weeks)
1. Academics: years, program tree, batches, subjects, syllabus tree, groups (manual)
2. Students: profile + custom fields, guardians/contacts + consent, enrollment, CSV import, list + 360° view
3. Classrooms & calendar: activity types, **multi-slot weekly timetable** → sessions, **extra classes with configurable notifications**, holidays/events, schedule views (batch/student/mentor/room), weekly digest
4. **Fees**: rate card, per-student per-subject fee lines, monthly dues, payment status grid, payments & receipts, reminders
5. **Program types** incl. Professional Bootcamp (adult profile, cohorts, modules, projects, instalment fees)
6. **Class notes & homework log** after each session, auto-sent (absentee variant)
7. **Enquiries & admissions** pipeline, demo classes, follow-ups, convert-to-student
8. **Monthly progress reports** to parents (draft → review → bulk send, PDF)
9. **Daily Google Drive backup** + full Excel export
4. Attendance: configurable statuses, fast register, reports, threshold alerts
5. Assessments: assignments + manual submission grid, tests with marks/JEE scoring, rank, publish results
6. Communication: email (SES/SMTP) + WhatsApp Cloud API adapters, template manager, composer, delivery tracking, prebuilt automations (absent, due-soon, result, event reminders)
7. Mentors: profiles, roles/scopes, mentee mapping, notes
8. Today dashboard, global search, exports, PWA attendance on phone

### Phase 2 (≈4 weeks)
- WhatsApp/email **inbound**: submission inbox, doubts, RSVP, reply threads
- Tokenized no-login upload links
- Rule-based groups, custom automation builder, message approval flow
- Question bank, chapter-wise analysis, at-risk detection
- Report-card builder with weighted aggregation, PDF to parents
- UPI/payment-link reconciliation, GST invoices, bootcamp certificates & feedback
- Google Calendar sync, syllabus coverage tracker, make-up classes

### Phase 3
- OMR import, DPP generator, kiosk/QR attendance, polls
- Student/parent read-only portal, multi-branch UI, Razorpay

## Open questions for Rahul

| # | Question | Default if unanswered |
|---|---|---|
| 1 | Tech stack OK? (Next.js + Postgres) or prefer Python/Django? | Next.js + TypeScript |
| 2 | Hosting preference: cloud managed (Vercel + Neon) vs a single VPS? | Managed cloud |
| 3 | WhatsApp: do you have a Meta Business account + a dedicated number? Direct Cloud API or a BSP (Gupshup/Interakt)? | Meta Cloud API direct |
| 4 | Email: custom domain (e.g. `rahulshahclasses.in`) for sending? | SES on custom domain |
| 5 | Approx. scale today: number of batches / students / mentors? | ~15 batches, ~300 students, ≤5 mentors |
| 6 | Should mentors get logins in MVP, or just profiles for now? | Logins with scoped roles |
| 7 | Default message recipient for minors: parent only, or student + parent? | Both for academic, parent for attendance/fees |
| 8 | ~~Is the Fees module wanted?~~ **Yes: per student, per subject, monthly.** Do monthly fees run all 12 months, or skip months like May/June? Is a mid-month joiner charged full or pro-rata? | Bill every term month; pro-rata per day |
| 11 | Bootcamps: one-time fee or instalments? Do companies ever pay on behalf of learners (needs GST invoice)? | Instalments; GST invoice in P2 |
| 12 | Are bootcamp classes online, offline or both? Do you record sessions? | Hybrid; recording link sent after class |
| 13 | ~~Progress reports: review before sending?~~ **Answered: yes. Only Rahul approves & sends; no auto-send.** Still open: include fee status in the parent report? | Fee status included (toggle) |
| 14 | ~~Which Google account for backups?~~ **Answered: Rahul will provide Google + WhatsApp details.** See [09-integrations-setup.md](09-integrations-setup.md) | App runs in local test mode until then |
| 15 | ~~Enquiry stages / demo class?~~ **Answered: demos are sometimes in class, sometimes on phone; enquiries and demos must be addable manually.** Covered by demo modes + manual logging | — |
| 9 | Languages for messages: English only, or Hindi/Gujarati variants too? | English + Hindi templates |
| 10 | Any existing data to import (Excel of students, past results)? | CSV import in MVP |
