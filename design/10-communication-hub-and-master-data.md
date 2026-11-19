# 10 — Communication Hub & Master Data (Fees)

**Status:** proposal, 2026-11-07. This doc refines [05 Communication](05-communication.md) and the Fees / Enquiries parts of [03 Data Model](03-data-model.md). It reflects what is already built and how Rahul actually wants to communicate.

**What exists today:**
- **Email:** Gmail SMTP, live.
- **WhatsApp:** Cloud API, live, with one template (`class_schedule_change`).
- **Data:**
  - per-contact email / WhatsApp opt-in
  - student ↔ contact links (`relation`, `receives`)
  - manual student groups
  - the `OutboundMessage` queue
  - the automatic timetable-change notice
- **Not built yet:** templates table, bulk send, inbound, fees, enquiries.

---

## 1. Who Rahul talks to

| Audience | Who they are in the app | How they are picked |
|---|---|---|
| **A student** | The student's own contact (`GuardianLink.relation = self`) | Student page → Message |
| **A group of students** | Students in a class / batch (any level of the program tree), a student group, a filter, or hand-picked | Composer → "Students" |
| **A parent** | A guardian contact of a student | Student page → Message → parent |
| **A group of parents** | Parents *of* a group of students (same pickers as above) | Composer → "Parents" |
| **Prospect parents** | Parents from **enquiries** (demo given, or asked about tuition), not yet enrolled | Composer → "Prospects", filtered by stage, course of interest or demo date |

The key design decision is that **every recipient is a `Contact`**, including prospects. Consent, opt-out, message history and the inbox therefore work the same way for everyone. When a prospect enrols, their existing contact is linked to the new student. No duplicate is created and the chat history is kept.

### Recipient rules (applied on every send)

1. **Consent:** the contact must have opted in on that channel. Marketing messages also need **marketing consent**.
2. **Opt-out:** anyone who replied STOP is skipped.
3. **Topic:** each parent link says which topics that parent gets (e.g. only the father gets fees). This replaces today's `receives = all | academic | fees`.
4. **Students message directly:** most students (14–15) have their own phone, so direct messages are **on by default**. A per-student switch turns them off for a student without a phone. Attendance, progress and fee messages always go to parents. Adults (bootcamp) get everything themselves.
4a. **WhatsApp first:** almost every family uses WhatsApp, so it is the default channel. Email is a fallback only for contacts with no WhatsApp, or when a WhatsApp send fails.
5. **One message per person:** a parent with two children in the same send gets **one** message naming both, as the timetable notice already does.
6. **Preview before sending:** for example, *"38 students → 31 parents (5 siblings merged). 4 skipped: no WhatsApp consent → see list."*

---

## 2. What gets sent: message purposes

Each purpose maps to one Meta template (WhatsApp) and one email layout.

| Purpose | Meta category | Goes to (default) | How it is triggered |
|---|---|---|---|
| Schedule change / extra class | Utility | Students + parents | Automatic on timetable change *(built)* |
| Homework | Utility | Students (+ parents optional) | Bulk send to a class, optional PDF / image |
| Class notice / holiday / test date | Utility | Students + parents | Bulk send |
| Attendance (absent / late) | Utility | Parents | Automatic after marking, with a 15-min delay so a mis-mark can be corrected |
| Progress report ready | Utility | Parents | When Rahul approves the report (PDF attached) |
| Fee due / overdue reminder | Utility | Parents who get fees (or the adult student) | Automatic on the fee reminder schedule |
| Fee payment received | Utility | Same | Automatic when a payment is recorded (receipt PDF) |
| Demo class reminder | Utility | Prospect | Automatic, day before the demo |
| Demo follow-up / tuition details (subjects, timings, fee) | **Marketing** | Prospect | Manual, from the enquiry |
| New course announcement | **Marketing** | Parents + prospects with marketing consent | Manual bulk send |

**Why the category matters:**
- Utility messages are cheaper and are approved easily.
- Marketing messages cost more, need marketing consent, and Meta limits how often an unengaged person receives them.
- Meta rejects vague "{{1}}" catch-all templates, so each purpose gets its own specific template.

**Free text:** Rahul can type freely, with no template, only inside the **24-hour window** after a contact last messaged us. The inbox shows that window as a countdown.

---

## 3. Communication module structure

```
src/modules/messages/          (renamed in the UI to "Communication")
  audience.ts      resolve an audience spec → recipient list (rules in §1)
  templates.ts     template registry: purpose → Meta template name/lang/params + email layout
  composer         bulk send: audience → purpose/template → content → preview → send / schedule
  service.ts       queue + delivery (exists): extend with campaigns, scheduling, quiet hours
  inbound.ts       WhatsApp webhook: replies, delivery/read ticks, STOP handling
  inbox            threads per contact, reply within the 24-hour window
```

### Screens

| Screen | What Rahul does there |
|---|---|
| **Compose** | Pick who (students / parents / both / prospects) and which (class, group, filter, hand-picked). Pick a purpose, fill in the text, attach a file, preview per recipient, then send now or schedule. |
| **Inbox** | See replies grouped by person, labelled e.g. "Mother of Diya (Class 10)" or "Prospect: Meena, Class 9". Reply, mark done. |
| **Sent** | Each bulk send with counts (sent · delivered · read · failed) and a retry for failed messages. This replaces the current Messages list. |
| **Templates** | List of purposes with Meta status (Active / In review / Rejected) and wording. Submitted from the app later; in v1 Rahul submits them in WhatsApp Manager and the app records the name. |
| **Student / enquiry page → Messages tab** | Full history with that family, both directions. |

### Inbound needs a public address

Meta delivers replies to a web address (a webhook). The app runs on the laptop, so:

- A **Cloudflare Tunnel** (free) exposes **only** `/api/webhooks/whatsapp`. No other page is reachable from the internet.
- Every webhook call is checked against Meta's signature (`X-Hub-Signature-256` with the app secret). Calls that fail the check are dropped.
- While the laptop is off, Meta retries delivery for a limited time, so replies arrive late rather than never. The exact retry window is to be confirmed in testing.
- Reply text is personal data and is encrypted at rest like phone numbers.

---

## 4. Master data

The same principle applies everywhere:

> **The master sets the standard value. A batch can override it. A student can override it.** Each override records *who, why and from when to when*, and the screen always shows where a value came from (e.g. "₹1,800 negotiated (standard ₹2,000)").

### 4.1 Fee structure

| Master table | What it holds | Example |
|---|---|---|
| **Fee heads** | Kinds of charge; recurring or one-time | Tuition (monthly), Registration (one-time), Study material, Test series, Late fee |
| **Fee rates** | Amount for a fee head, attached to a **program-tree node** (programme / course / batch), optionally per **subject**, with a billing cycle and an **effective-from** date | Class 10 · Maths · Tuition · monthly · ₹2,000 from 2026-04-01 |
| **Price reasons** | Short list of why a student pays a different price (no stacking discounts, see §4.2) | Negotiated, Sibling, Scholarship, Other |
| **Fee policy** | Billing rules (global, or per course) | **Billed in advance on the 1st**, due on the 7th, 5 days' grace, late fee ₹100 (optional), **pro-rata by days for mid-month joiners**, reminders 3 days before / on due date / 3 and 7 days after |
| **Payment modes & receipt series** | Cash, UPI, bank transfer, cheque; receipt numbers `RSC/26-27/0001` | |
| **Institute profile** | Name, address, phone, **UPI ID** (for pay links / QR), logo | Printed on receipts and used in fee messages |

**Rate lookup** (most specific match wins):
1. batch + subject
2. batch
3. course + subject
4. course
5. programme

You set Class 10 = ₹2,000 once, and every Class 10 batch inherits it unless a batch says otherwise.

### 4.2 Student-level fee plan (discounts and custom fees)

The student's **Fees tab** shows one line per subject or fee head they are charged for. These lines are created automatically on enrolment from the master rates.

| Per line | Options |
|---|---|
| **Price** | *Standard* (default), or a **negotiated price**: a fixed monthly amount with a reason (from the price reasons list), a start date and an optional end date |
| **Status** | Active / Paused (e.g. summer break) / Stopped |

There are **no stacking discounts.** A student either pays the standard price or one negotiated price, which simply continues month after month. The screen shows it as "₹1,800 negotiated (standard ₹2,000) since Jun 2026".

**When the master price changes:**
1. Rahul adds a **new rate from a date**. Old prices are kept, never edited.
2. Students on the standard price **move to the new price** from that date.
3. Students on a negotiated price **keep it**. The preview lists them by name so Rahul can review each one: *"23 students move to ₹2,200. 2 on negotiated prices stay: Diya ₹1,800, Aarav ₹1,500 → [keep] [edit]."*
4. Months already billed never change.

**Sibling hint:** when two active students share a parent contact, the app *suggests* a negotiated price. It never sets one automatically.

Below the plan, the existing design in [03](03-data-model.md#fees--payments) applies unchanged:
- **Monthly dues** with per-subject items
- **Payments**: one payment can cover several months, and an advance is kept as credit
- **Receipts**
- **Status grid**: students × months

### 4.3 Other master data

| Master | Status |
|---|---|
| Academic years, programme types, program tree (classes / courses / batches), subjects, custom profile fields | **Exists** |
| Fee heads, fee rates, price reasons, fee policy, payment modes, receipt series, institute profile | **New** (§4.1) |
| Holidays & closures (skip classes, suppress reminders, "holiday notice" message) | New |
| Enquiry sources (walk-in, referral, Google, Instagram…), stages (New → Demo booked → Demo done → Follow-up → Joined / Lost), lost reasons | New, with Enquiries |
| Attendance statuses (Present / Absent / Late / Excused) and which ones alert parents | New, with Attendance |
| Message purposes & templates, quiet hours (e.g. no messages 21:00–08:00), default recipients per purpose | New, with Communication |
| Relations (father / mother / guardian / self / other) | Exists as fixed values; becomes editable |

All masters sit under **Settings → Master data**. Archive rather than delete, so history stays valid. Every edit is audited.

---

## 4A. Classes Rahul cancels must be made up

Who missed the class decides what happens:

| Case | Make-up owed? | What the app does |
|---|---|---|
| **A student skips a class** | No | Recorded as absent in attendance; parent alert if enabled. Counts against the student's attendance only. |
| **Rahul cancels a class** | **Yes** | The class stays on a **"Make-up owed"** list until a make-up class is scheduled *and* held. |
| **Class moved to another day/time** | No (already rescheduled) | Counts as held on the new date. |
| **Holiday / closure** (from the holidays master) | No by default | A per-holiday switch can mark it as owed. |

**Flow when cancelling:**
1. Rahul picks a reason: *Teacher unavailable*, *Holiday*, or *Other*. A make-up is required by default for all but Holiday.
2. The app asks: **"Reschedule now?"**
   - **Yes:** pick a date and time. This creates an extra class linked to the cancelled one, and parents get **one** message: "Thursday's Maths is cancelled; make-up on Saturday 4 pm".
   - **Later:** the class goes onto the **Today** page as "2 make-up classes owed: Class 10 Maths (Thu 12 Nov) …" until one is scheduled.
3. When the linked extra class is held, the cancellation is marked **made up**.

**Data:**
- `ClassDateChange` gains `reason` (teacher | holiday | other), `makeupRequired` (boolean) and `makeupForId`. The last one is on the extra class and points at the cancelled class it replaces.
- "Owed" = cancelled with `makeupRequired` and no linked make-up yet held.

**Shown on reports:**
- **Class delivery report** (per batch and subject, per month): scheduled · held · cancelled by teacher · made up · still owed · moved · holidays.
- **Parent progress report:** a line such as *"Classes this month: 12 scheduled, 11 held, 1 cancelled by teacher and made up on 14 Nov. Diya attended 10 of 12."*
- **Attendance %** is computed against classes actually held (including make-ups). Classes Rahul cancelled never count as a student absence.

---

## 5. Changes to existing modules

### Students
- **Contact:** split consent into
  - **service** (`waOptIn`, `emailOptIn`, already exists)
  - **marketing** (`marketingOptIn`, new)

  Add `optedOutAt` / `optOutReason` and `lastInboundAt` (for the 24-hour window).
- **Parent link:** replace `receives` (all / academic / fees) with **topics**, a list of: schedule, homework, notices, attendance, progress, fees. Existing values convert automatically: all → every topic; academic → all except fees; fees → fees only.
- **Student:** add a "may be messaged directly" switch, default **on** (students have their own phones).
- **Student page:** new **Messages** tab (both directions) and **Fees** tab (plan, dues, payments).
- **Student list:** add "Message selected", and filters useful for messaging (fees overdue, absent today, group).

### Academics
- **Program-tree node / batch-subject:** gains fee rates, through the new `FeeRate` table pointing at a node and an optional subject. No column changes on existing tables.
- **Timetable notice:** moves onto the shared template registry and audience resolver, as purpose *schedule*. Behaviour stays the same.
- **Cancel a class:** add a reason, "make-up required", and "Reschedule now?", which creates a linked extra class. Make-ups still owed appear on the Today page (§4A).
- **Holidays master:** feeds the calendar (classes skipped) and suppresses reminders.

### Messages → Communication
- **`OutboundMessage`:** add
  - `campaignId`, `studentId`, `enquiryId`
  - `purpose`, `templateName`
  - statuses `delivered` / `read` (from the webhook)
  - unique `(campaignId, contactId, channel)`, so a bulk send can never double-send
- **New tables:**
  - `MessageTemplate`: purpose, category, Meta name / language / status, parameter map, email subject / body, header media type
  - `Campaign`: purpose, template, audience spec, recipients mode, channels, scheduled time, counts, created by
  - `InboundMessage`: contact, Meta message id, encrypted text, media, received / read / handled
  - `File`: attachments such as homework PDFs and receipts
- **Delivery loop:** already exists. Add scheduled sends, quiet hours and the daily cap, which is 250 unique people / 24 h until Meta raises it.
- **Current Messages page:** becomes **Sent**. The manual "Open WhatsApp" flow stays as the fallback when cloud sending fails.

### New modules (each with its own WhatsApp purposes)
- **Fees:** §4.1–4.2
- **Enquiries & demos:**
  - `Enquiry` links to a `Contact` (the prospect parent) and an optional child name / class
  - demo records (in class / phone / video)
  - follow-up dates
  - **Convert to student** reuses the contact
- **Attendance:** register, then the parent alert.

### Settings / platform / permissions
- **New permissions:** `comms.send`, `comms.bulk`, `comms.marketing`, `inbox.reply`, `fees.view`, `fees.collect`, `fees.discount`, `master.edit`.
- **Owner only for now:** discounts, custom fees and marketing sends.
- **`.env` additions:**
  - `WHATSAPP_APP_SECRET` (webhook signature)
  - `WHATSAPP_VERIFY_TOKEN` (webhook setup)
  - tunnel details
  - UPI ID, which can also live in the institute profile instead
- **Today page:** unread replies, scheduled sends, fees overdue, enquiry follow-ups due today.

---

## 6. Build order

| Step | Delivers | Rahul's part |
|---|---|---|
| **1. Audience + bulk send** | Composer for students / parents / both by class, group or pick list. Homework & notices with attachment; preview; schedule; Sent page; consent split; topics; direct-message switch. **Plus make-up tracking for cancelled classes** (§4A), since the timetable already exists | Submit `homework_update`, `class_notice` and `class_cancelled_makeup` templates |
| **2. Inbox** | Webhook through Cloudflare Tunnel; replies; STOP opt-out; delivered / read ticks; 24-hour reply | Install the tunnel (one command); copy the app secret into `.env`; set the webhook URL in Meta |
| **3. Master data + Fees** | Fee heads, rates, discounts, policy, student fee plans, monthly dues, payments, receipts, reminders, status grid | Enter the fee structure; submit `fee_due_reminder`, `fee_payment_received` |
| **4. Enquiries & demos** | Prospects, demo reminders, follow-ups, convert-to-student, prospect / new-course sends | Submit `demo_reminder` (utility), `tuition_details` and `new_course` (marketing) |
| **5. Attendance** | Register + absent / late alerts to parents; attendance % against classes held | Submit `absence_alert` |
| **6. Reports on WhatsApp** | Class delivery report (§4A); "Report ready" message with the approved PDF, including the classes held / made-up line | Submit `progress_report_ready` |

I will draft every template's wording to fit Meta's Utility rules, so they aren't reclassified the way `timetable_update` was.

---

## 7. Decisions

**Answered by Rahul (2026-11-07):**

| # | Question | Answer |
|---|---|---|
| 1 | May students under 18 be messaged directly? | **Yes.** Students are 14–15 and have their own phones. |
| 2 | Standard fee changes: do standard-rate students move to the new price? | **Yes.** A few students have a discounted price, which stays. |
| 3 | Monthly fee billed in advance? | **Yes** |
| 4 | Mid-month joiner pro-rata? | **Yes** |
| 5 | Can discounts stack? | **No.** A discount is a negotiated price that continues (§4.2). |
| — | Preferred channel | **WhatsApp** (almost everyone has it); email as fallback |
| — | Classes Rahul cancels | Must be rescheduled; shown on reports (§4A). Student skips are just absences. |

**Still open:**

| # | Question | Default if unanswered |
|---|---|---|
| 6 | Do you take online payment, or record cash / UPI yourself? | Record yourself; a UPI link / QR in reminders |
| 7 | Hindi versions of messages? | English first; Hindi later per contact preference |
| 8 | Is replies arriving late when the laptop is off acceptable, or should the app move to a small cloud server later? | Laptop + tunnel for now |
