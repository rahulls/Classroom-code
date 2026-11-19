# 01 — Feature List

Phase tags: **MVP** = first usable release · **P2** = next · **P3** = later / nice-to-have.

---

## M1. Academic Structure (configurable)

Hierarchy, fully user-defined:

```
Academic Year (2026-27)
 └─ Program            School Boards | JEE | Olympiad | Professional Bootcamp   ← configurable list
     └─ Course         Class 8…12 | JEE 2-Year | JEE Dropper | NSO/IMO | "Data Science Bootcamp"
         └─ Batch      "Class 10 – Morning", "JEE 2028 – Alpha", "DS Cohort Jan-27"  (a.k.a. Section / Cohort)
             └─ Group  cross-cutting tags: "Toppers", "Needs Help", "INMO Shortlist"
```

| Feature | Phase |
|---|---|
| Create/edit/archive Academic Years; roll over a year (clone structure, promote students) | MVP |
| Programs → Courses → Batches with unlimited nesting depth (via a `parent_id` tree) | MVP |
| **Program type** sets defaults for everything under it: `school` (minors, guardian required, monthly fees), `competitive` (JEE/Olympiad scoring), `professional` (adults, no guardian, one-time/instalment fees, certificates). See M12 | MVP |
| Batch properties: capacity, mode (offline/online/hybrid), room, default timetable, mentors, fee plan link | MVP |
| **Groups**: ad-hoc or rule-based ("avg score < 40% in last 3 tests") that span batches | MVP (manual) / P2 (rule-based) |
| A student can be in **multiple batches** (e.g. Class 11 Boards + JEE Alpha + Olympiad Physics) | MVP |
| **Subjects** catalog with board mappings (CBSE / ICSE / State / JEE / Olympiad) | MVP |
| **Syllabus tree** per subject: Unit → Chapter → Topic, with weightage & estimated hours | MVP |
| Syllabus coverage tracker per batch (planned vs done, % complete) | P2 |
| Clone a course/batch (structure, subjects, timetable) for quick expansion | MVP |

## M2. Student Management (configurable profile)

| Feature | Phase |
|---|---|
| Student profile with **core fields** (name, DOB, phone, email, photo, school, board) + **custom fields** defined in Settings | MVP |
| Custom field types: text, number, date, dropdown, multi-select, phone, email, file, checkbox, URL | MVP |
| Field groups / tabs (Personal, Academic, Guardian, Medical, Competitive Exams…) | MVP |
| Guardians: multiple per student (Father, Mother, Guardian) each with phone/email/WhatsApp, plus a **preferred channel** flag | MVP |
| Communication consent per contact (email opt-in, WhatsApp opt-in, with timestamp & source) | MVP |
| Enrollment history (batch joins, transfers, leaves, status: Active / On-hold / Alumni / Dropped) | MVP |
| Bulk import from CSV/Excel with column mapping + validation preview | MVP |
| Bulk edit, bulk move between batches, bulk add to group | MVP |
| Student 360° view: profile, attendance %, scores trend, assignments, messages sent, mentor notes | MVP |
| Tags & saved filters ("Class 12 + JEE + attendance < 75%") | MVP |
| Documents vault per student (ID, marksheets, certificates) | P2 |
| Previous-exam records (school marks, JEE Main percentile, Olympiad stage cleared) | P2 |
| Birthday & milestone tracking (auto wishes) | P2 |

## M3. Classrooms & Activities (configurable)

A **Classroom** is the space where a batch + subject meets, either physical or online.

| Feature | Phase |
|---|---|
| Classroom = Batch × Subject (+ optional mentor); holds the feed of activities, resources, assignments | MVP |
| **Activity types** configurable: Lecture, DPP (Daily Practice Problems), Doubt Session, Test, Lab, Revision, Mock Interview, Parent-Teacher Meet… each with icon, color, default duration, and flags such as `takes_attendance`, `has_submission`, `is_graded` | MVP |
| **Class notes & homework log** after every session: topics covered (picked from the syllabus tree, which updates coverage %), a short summary, homework (text, attachment, due date; optionally becomes a tracked assignment in one click), resources, recording link | MVP |
| Notes auto-sent to the batch per configuration (channels, students/guardians); absentees get a "you missed this class" version with the same notes | MVP |
| Prompt when a session ends ("Log what you taught?") plus a nightly nudge listing un-logged sessions; mentors can log for their classrooms | MVP |
| Per-batch "class diary" timeline: searchable history of everything taught and assigned | MVP |
| Resource library: PDFs, links, videos, organized by subject → chapter; share with batch via email/WhatsApp | MVP |
| Online class links (Zoom/Meet/Jitsi) stored per session; auto-sent before class | MVP |
| Question bank (by chapter, difficulty, type: MCQ / multi-correct / integer / subjective; tags: JEE Main, Adv, Olympiad, PYQ) | P2 |
| DPP / worksheet generator from the question bank → PDF | P3 |
| Doubt tracker: log doubts students raise (via WhatsApp inbound), assign to mentor, resolve | P2 |

## M4. Assessments, Assignments & Grading (configurable)

| Feature | Phase |
|---|---|
| **Assignment** types: homework, DPP, project, lab record. Each has due date, max marks, rubric (optional), and late-policy | MVP |
| **Submission tracking** (students have no login, so submissions come in via): <br>① Rahul marks *submitted / not submitted / late* in a fast grid <br>② **WhatsApp/email inbound**: a student sends a photo/PDF and it's auto-matched by phone/email to the student + open assignment, landing in a **Submission Inbox** <br>③ (P2) **Tokenized upload link**: a one-time no-login link sent per student | ① MVP · ② P2 · ③ P2 |
| Checking workflow: Pending → Checked → Returned; marks + remarks + annotated file | MVP |
| **Tests/Exams**: chapter tests, unit tests, full mocks; offline marks entry or per-question response entry | MVP |
| JEE-style scoring scheme: +4 / −1, multi-correct partial marking, numerical; per-question answer key; auto-scoring | MVP |
| Section/subject-wise totals, rank, percentile, batch average, topper | MVP |
| Chapter/topic-wise analysis (which topics a student is weak in) | P2 |
| OMR sheet scan import (CSV from OMR software) | P3 |
| **Grading schemes** configurable: raw marks, percentage, letter grades (A1–E per CBSE), GPA, pass/fail, rubric levels, custom bands | MVP |
| Weighted aggregation rules for report cards ("Tests 60% + Assignments 25% + Attendance 15%") | P2 |
| **Report card** builder: template-based PDF, auto-sent to parents | P2 |
| Result publishing: one click sends personalized result to every student/parent (score, rank, remarks) | MVP |
| **Monthly progress report to parents**: generated automatically for the previous month (configurable day, default the 1st). One PDF per student covering subject-wise attendance, tests & scores vs batch average, assignment completion, topics covered, fee status (toggle) and a mentor/teacher remark | MVP |
| Report review queue: reports are always created as **drafts and never sent automatically**. Only the **Owner (Rahul)** can approve and send them, individually or in bulk, on WhatsApp/email with the PDF, and delivery is tracked. Mentors can't send reports (they may suggest remarks if that's enabled later) | MVP |
| Report sections & branding configurable; bootcamp variant goes to the learner instead of parents | MVP |

## M5. Attendance & Calendar (configurable)

| Feature | Phase |
|---|---|
| Attendance per session (not just per day). Statuses configurable: Present, Absent, Late, Excused, Online, Half-day… each with a count-as-present weight (1, 0, 0.5) | MVP |
| Fast marking: "all present" by default, tap the exceptions; keyboard navigation | MVP |
| Absent → automatic parent WhatsApp ("Aarav was absent from Physics today at 5 PM") | MVP |
| Attendance thresholds (e.g. < 75%) → alert + auto-group | MVP |
| Attendance reports: by student, batch, subject, date range; export Excel | MVP |
| QR / self check-in kiosk mode on a tablet at entry | P3 |
| **Calendar**: unified view of sessions, tests, assignment deadlines, holidays, events, PTMs | MVP |
| **Weekly timetable with multiple slots per subject.** Classes happen 2–3× a week, so each batch-subject has N weekly slots, each with its own day, time, duration, room, mode and mentor (e.g. Physics: Mon 17:00, Thu 17:00, Sat 10:00). Slots have effective-from/to dates so a mid-term timetable change keeps history | MVP |
| **Configurable class duration**: duration presets in Settings (e.g. 60 / 90 / 120 / 180 min + custom). The default cascades **activity type → course → batch-subject → weekly slot → single session**, each level able to override (e.g. Class 10 Maths = 90 min, English = 60 min, Saturday Maths slot = 120 min, one extra class = 45 min). End time is always computed from start + duration | MVP |
| Calendar shows each class **at its true length**: block height is proportional to duration, labelled with start–end time and a duration badge (60m / 90m…); optional "colour by duration" view; clash detection uses actual end times | MVP |
| Slots auto-generate sessions for the term and skip holidays; one-off exceptions (cancel / reschedule / swap teacher) send an automatic notice | MVP |
| **Extra class**: add a one-off session from the calendar (batch or picked students, subject, date/time, mode, room/link, reason). Then **notify per configuration**: channels (WhatsApp / email / both), recipients (student / guardian / both), template, and reminders (e.g. T-1 day, T-1 hour). Defaults live in Settings and can be overridden per class | MVP |
| Make-up / remedial class for absentees of a given session (auto-selects who was absent) | P2 |
| **Schedule views**: by batch, by subject, by **student** (all their batches merged), by mentor, by room; Day / Week / Month / Agenda; colour by subject or activity type; clash highlighting | MVP |
| Share schedule: weekly timetable as image/PDF to a batch on WhatsApp/email; optional **Sunday-evening "your week" digest** per student | MVP |
| Holiday lists & exam calendars (JEE Main dates, Olympiad stage dates, board exams) | MVP |
| Conflict detection (room, mentor, student in two batches at same time) | P2 |
| Google Calendar sync (2-way for Rahul; iCal feed per batch) | P2 |

## M6. Mentors & Mentees (configurable access)

| Feature | Phase |
|---|---|
| Mentor profile: name, contact, subjects, qualifications, availability, photo | MVP |
| Assign mentors to batches/classrooms **and** assign individual mentees (1:N) | MVP |
| **Role-based access**: roles are configurable sets of permissions (e.g. `attendance.mark`, `marks.enter`, `message.send.batch`, `student.view.contact`) | MVP |
| **Scoped access**: permissions apply only to *their* batches/mentees (row-level scope) | MVP |
| Mentor notes on mentees (private or shared with Owner), meeting log, goals | MVP |
| Mentee progress dashboard (attendance, scores trend, pending work) | MVP |
| Message approvals: mentors can draft announcements, and Owner approves before send (toggle per role) | P2 |
| Mentor workload & performance summary | P3 |

## M7. Communication Hub (Email + WhatsApp)

*Full detail in [05-communication.md](05-communication.md).*

| Feature | Phase |
|---|---|
| Compose announcement → choose audience (batch / group / course / individuals / saved filter) → recipients (students / parents / both) → channels (email, WhatsApp, both) → send now or schedule | MVP |
| Template library with variables (`{{student.first_name}}`, `{{test.score}}`, `{{rank}}`) and preview per recipient | MVP |
| WhatsApp **approved templates** management (sync with Meta), media headers (PDF report card, image poster) | MVP |
| Delivery tracking: queued → sent → delivered → read → failed, per recipient; retry failed | MVP |
| Automation rules: *When* `event` *if* `condition` *then* `send template via channel to recipients` (+ delay) | MVP (prebuilt) / P2 (custom builder) |
| Inbound WhatsApp/email inbox: replies threaded per student; tag as doubt / submission / query | P2 |
| Quiet hours, rate limits, per-student frequency cap, opt-out handling | MVP |
| Event invitations with RSVP buttons (WhatsApp interactive buttons) | P2 |
| Polls / feedback forms via WhatsApp | P3 |

## M8. Events & Announcements

| Feature | Phase |
|---|---|
| Event types: PTM, Seminar, Mock Test Day, Result Day, Holiday, Workshop, Celebration | MVP |
| Event page: date/time, venue/link, audience, attachments, reminders schedule (T-3d, T-1d, T-2h) | MVP |
| RSVP tracking (via WhatsApp button reply) | P2 |
| Announcement board (history of everything ever sent, searchable) | MVP |

## M9. Dashboards & Analytics

| Feature | Phase |
|---|---|
| **Today** dashboard: today's sessions, attendance to mark, assignments due, tests to grade, birthdays, failed messages | MVP |
| Batch dashboard: attendance trend, score distribution, top/bottom 5, syllabus progress | MVP |
| Student performance trend vs batch average; subject radar | MVP |
| At-risk detection: falling scores + low attendance + missed submissions → flagged list | P2 |
| Exports: Excel/PDF for any table | MVP |

## M10. Fees & Payments (core module)

Fees are charged **per student, per subject**. School, JEE and Olympiad batches are billed **monthly**; bootcamps are **one-time or instalments**.

| Feature | Phase |
|---|---|
| **Rate card**: default fee per subject per course (e.g. Class 10 Maths ₹2,500/mo, Science ₹2,500/mo; JEE PCM bundle ₹7,000/mo), with effective-from dates for rate revisions | MVP |
| **Per-student fee structure**: on enrolment, every subject the student takes gets a fee line copied from the rate card, which you can override (custom amount, discount %, scholarship, sibling discount, free) | MVP |
| Billing models configurable per course: monthly, quarterly, one-time, instalment plan, per-class (pay-as-you-go) | MVP |
| Auto-generate each student's **monthly due** on the 1st (sum of active subject lines) with due date + grace days | MVP |
| Pro-rata rules: joining/leaving mid-month, subject added/dropped mid-month (configurable: full / half / per-day) | MVP |
| **Monthly payment status grid**: students × months, each cell Paid / Partial / Due / Overdue / Waived / Not billed; click a cell for per-subject breakdown | MVP |
| Record payment (cash / UPI / bank / cheque, reference, date) and allocate it across months & subjects; partial and advance payments carry forward | MVP |
| Numbered receipt PDF auto-sent on WhatsApp/email | MVP |
| Reminder automation: before due, on due date, every N days while overdue, stop on payment (all configurable) | MVP |
| Student fee ledger: full history, balance, ad-hoc charges (study material, test series, late fee) | MVP |
| Collections dashboard: expected vs collected this month, outstanding by batch/subject, defaulters | MVP |
| UPI QR / payment link (Razorpay / Cashfree) with auto-reconciliation | P2 |
| GST invoice option (professionals, company-sponsored learners) | P2 |
| Export to Excel / Tally | P2 |

## M11. Platform & Settings

| Feature | Phase |
|---|---|
| Single owner login (email + password + 2FA / Google sign-in) | MVP |
| Mentor logins with roles | MVP |
| Settings: institute profile, logo, branding used in emails/PDFs | MVP |
| All configurables under one **Settings** area (see [04](04-configuration.md)) | MVP |
| Audit log | MVP |
| Global search (⌘K): students, batches, tests, templates | MVP |
| **Daily backup to Google Drive** (connect your Drive once): encrypted database dump + a human-readable Excel workbook, at a configurable time (default 02:00), in a dated folder; retention 30 daily + 12 monthly | MVP |
| Backup health on the Today dashboard (last backup time, size, ✔/✖), email alert on failure, "Back up now" button, documented one-step restore | MVP |
| **Excel export of everything**: one workbook with a sheet per entity (students, guardians, enrolments, attendance, marks, fees, payments, messages…); plus export of any filtered table view | MVP |
| Multi-branch support (a second centre) by data model only, UI later | P3 |
| Student/Parent portal (read-only) | P3 |
| Mobile-friendly PWA for marking attendance from phone | MVP |

## M12. Professional Bootcamps

This is the same engine with a different program type. A `professional` program changes the defaults rather than needing separate code.

| Feature | Phase |
|---|---|
| Learners are adults: no guardian contact, messages go to the learner only | MVP |
| Own profile field set: company, designation, years of experience, LinkedIn/GitHub, goals, GSTIN (for invoices) | MVP |
| Cohorts (= batches) with start/end date; weekday-evening or weekend slots; online / hybrid | MVP |
| Curriculum as Modules → Sessions → Topics (instead of Unit → Chapter), plus projects/capstone | MVP |
| Projects with rubric grading; submissions as GitHub / Drive / URL links | MVP |
| Fees: one-time, instalments, or company-sponsored (invoice addressed to employer) | MVP |
| Post-session message with recording link + slides/resources | MVP |
| Completion rules (attendance ≥ X %, projects passed) → **certificate PDF** with verification ID | P2 |
| Session feedback (1–5 rating via WhatsApp quick-reply) and end-of-cohort NPS | P2 |
| Alumni list, referral tracking, testimonials | P3 |

## M13. Enquiries & Admissions

A small CRM for new admissions, covering school, JEE, Olympiad and bootcamp leads.

| Feature | Phase |
|---|---|
| Log an enquiry in seconds: name, phone, course interested, class/school or company, source (walk-in, phone, WhatsApp, referral, Instagram, website…), notes. Fields configurable per program type | MVP |
| **Pipeline with configurable stages**: New → Contacted → Demo scheduled → Demo attended → Fee shared → Admitted / Lost (with reason). Kanban board + list view | MVP |
| Follow-ups: next-action date + note on every enquiry; overdue follow-ups appear on the Today dashboard | MVP |
| Add enquiries **manually** at any time (the main way leads come in), with stages skippable: a lead can go straight from New to Admitted | MVP |
| **Demo class, in any of three modes:** <br>① **In class**: book the lead into an existing session or extra class; they get an invite + reminder; demo attendance is recorded <br>② **Phone / video call**: schedule or log a call demo (date, time, duration, who took it) <br>③ **Log after the fact**: record a demo that already happened, with outcome notes. <br>All demos appear on the lead's activity timeline; demos can be repeated | MVP |
| Send course details / fee structure / brochure PDF to a lead via a template | MVP |
| **Convert to student** wizard: one click carries the details into a student + guardian + batch enrolment + fee lines (from the rate card), then sends the welcome message | MVP |
| Unknown WhatsApp number messages in → suggested as a new enquiry | P2 |
| Public enquiry form link (share on Instagram/website) feeding straight into the pipeline | P2 |
| Reports: enquiries by source, course and month; conversion rate; lost reasons; demo-to-admission rate | MVP |
