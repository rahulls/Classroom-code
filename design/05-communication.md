# 05 — Communication (Email + WhatsApp)

Students and parents have no login, so this module is the **student-facing product**. Every piece of information reaches them through here.

## 1. Channel adapters

```ts
interface ChannelAdapter {
  kind: 'email' | 'whatsapp';
  send(msg: OutboundMessage): Promise<{ providerId: string }>;
  parseWebhook(req): DeliveryUpdate[] | InboundMessage[];
  limits(): { perSecond: number; perDay?: number };
}
```

| Adapter | Provider | Notes |
|---|---|---|
| `email.ses` | Amazon SES | Cheapest at scale; needs domain DKIM/SPF |
| `email.smtp` | Gmail Workspace / Zoho | Simple start; ~2,000/day limit |
| `email.resend` | Resend | Nice DX, webhooks |
| `whatsapp.meta` | **WhatsApp Cloud API** (recommended) | Direct, per-conversation pricing, needs a Meta Business account + verified number |
| `whatsapp.gupshup` / `interakt` / `twilio` | BSPs | If you prefer a vendor dashboard/support |

Switching providers is a Settings change, not a code change.

## 2. WhatsApp rules we must design around

1. **Business-initiated messages need pre-approved templates** (categories: *Utility* for attendance/results/reminders, *Marketing* for promos/admissions). Free-form text is allowed only within **24h of the student/parent's last message**.
2. **Opt-in is required.** We capture consent at admission (form checkbox / signed) and store `wa_opt_in`, `consent_at`, `consent_source`.
3. Templates support **variables**, **media header** (PDF/image/video) and **buttons** (quick reply such as "Yes, attending", or URL).
4. **Messaging limits** scale with number quality (1K → 10K → 100K unique users/24h), so the queue enforces them.

So the app has a **WhatsApp Template Manager**: you write a template in the app, submit it to Meta via API, track approval status, and map our variables to the template's `{{1}} {{2}}` placeholders.

## 3. Starter template library

| Template | Category | Default to | Variables | Trigger |
|---|---|---|---|---|
| `welcome_enrollment` | Utility | both | student, batch, timetable link | student enrolled |
| `absent_today` | Utility | guardian | student, subject, session time | attendance A |
| `late_today` | Utility | guardian | student, subject, time | attendance L |
| `attendance_warning` | Utility | guardian | student, %, period | below threshold |
| `class_reminder` | Utility | student | subject, time, link | T-30 min before online session |
| `class_cancelled` / `rescheduled` | Utility | both | subject, old/new time, reason | session status change |
| `assignment_new` | Utility | student | title, due date, PDF | assignment published |
| `assignment_due_soon` | Utility | student | title, due in | T-24h, not submitted |
| `assignment_missing` | Utility | guardian | title, student | deadline passed, missing |
| `submission_received` | Utility | student | title, time | inbound matched |
| `test_scheduled` | Utility | both | test, date, syllabus | test created |
| `result_published` | Utility | both | test, score, max, rank, percentile, remarks, PDF | result published |
| `report_card` | Utility | guardian | term, PDF | report card generated |
| `event_invite` | Utility | both | event, date, venue + RSVP buttons | event created |
| `event_reminder` | Utility | both | event, time | T-1d / T-2h |
| `holiday_notice` | Utility | both | date(s), reason | holiday added |
| `birthday_wish` | Marketing | student | name | 08:00 on DOB |
| `extra_class` | Utility | both | subject, date, time, mode, room/link, reason | extra class created |
| `extra_class_reminder` | Utility | student | subject, time, link | T-1d / T-1h (configurable) |
| `weekly_schedule` | Utility | student | week range, list of classes (+ PDF/image) | Sunday 19:00 digest |
| `fee_due` | Utility | guardian / self | month, per-subject breakdown, total, due date, pay link | fee due generated |
| `fee_overdue` | Utility | guardian / self | month(s), balance, late fee | overdue schedule |
| `fee_receipt` | Utility | guardian / self | receipt no., amount, months covered, PDF | payment recorded |
| `session_recording` | Utility | student (bootcamp) | session, recording link, slides | session marked held |
| `class_notes` | Utility | student | subject, date, topics, summary, homework, due date, attachments | class notes saved |
| `class_missed` | Utility | both | same as above + "you were absent" | class notes saved, student absent |
| `monthly_progress` | Utility | guardian / self | month, attendance %, avg score, rank, pending work, remark, PDF | progress report approved |
| `enquiry_ack` | Utility | lead | name, course, contact number | enquiry created |
| `demo_invite` / `demo_reminder` | Utility | lead | course, date, time, venue/link | demo booked / T-1d, T-2h |
| `course_info` | Marketing | lead | course, schedule, fee structure, brochure PDF | manual from enquiry |
| `admission_followup` | Marketing | lead | name, course, offer/deadline | follow-up due (manual send) |
| `certificate_issued` | Utility | self | cohort, certificate PDF, verify link | completion rule met |
| `general_announcement` | Utility | configurable | free body | manual |

Each template has **email** and **WhatsApp** variants. The email is rich HTML with the RSC branding; the WhatsApp version is concise.

## 4. Composer flow (manual announcements)

```
① Audience        Batch / Course / Group / Saved filter / Pick students
                   → live count: "47 students · 52 guardians"
② Recipients      ○ Students  ○ Guardians  ● Both   [ ] Primary guardian only
③ Channel         [✔] WhatsApp  [✔] Email   (fallback: if no WhatsApp → email)
④ Content         Template ▾  |  subject  |  body with {{variables}}  |  attach PDF/image
⑤ Preview         Rendered per recipient (flip through), plus warnings:
                   "3 contacts have no WhatsApp opt-in", "2 invalid emails"
⑥ Send            Now  |  Schedule (date/time)  |  Respect quiet hours ✔
⑦ Track           Live dashboard: queued · sent · delivered · read · failed → Retry failed
```

## 5. Automation rules

```jsonc
{
  "name": "Absent → parent WhatsApp",
  "when": "attendance.marked",
  "if":   { "all": [ { "field": "status.notifyGuardian", "eq": true },
                     { "field": "session.activityType", "in": ["lecture","test"] } ] },
  "then": [ { "send": "absent_today", "to": "guardian", "channels": ["whatsapp"], "fallback": "email" } ],
  "delay": "15m",          // gives Rahul time to correct a mis-mark; cancelled if status changes
  "dedupe": "per-student-per-day"
}
```

Event catalog (emitted by modules):

```
student.enrolled  student.status_changed  student.birthday
session.created   session.cancelled  session.rescheduled  session.starting_soon
attendance.marked attendance.below_threshold
assessment.published  assessment.due_soon  assessment.deadline_passed
submission.received   submission.checked   result.published
session.extra_created  session.reminder  schedule.weekly_digest
event.created  event.reminder  holiday.created
fee.due_generated  fee.due_soon  fee.overdue  fee.paid
cohort.completed  certificate.issued
session.notes_saved  session.unlogged
progress_report.generated  progress_report.approved
enquiry.created  enquiry.stage_changed  enquiry.followup_due  demo.booked  enquiry.converted
backup.completed  backup.failed
```

## 6. Inbound (P2)

- WhatsApp & email webhooks → `inbound_message`.
- Matched to a contact by phone/email, then to the student.
- **Smart routing:**
  - Has media + student has an open assignment → suggested as **submission** (one click to confirm)
  - Contains "doubt"/question → **doubt** ticket
  - Button reply on event invite → **RSVP**
  - Else → **Inbox** thread for Rahul to reply (free-form allowed, since we're inside the 24h window)

## 7. Delivery, reliability, cost

- Per-message status timeline; campaign-level funnel.
- Automatic retry with backoff (3 tries); permanent failures (invalid number, bounced email) flag the contact.
- Idempotency key per `(campaign, contact, channel)` so a message is never double-sent.
- **Cost estimator** in composer: "52 WhatsApp utility messages ≈ ₹X" using the configured rate card.
- Monthly communication report: messages by type, delivery rate, failures, cost.
