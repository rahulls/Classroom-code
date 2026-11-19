# 04 — Configuration Engine

Everything listed as "configurable" in the brief is handled by **one generic mechanism**: config entities with definitions stored in the DB, edited from **Settings**, validated by Zod schemas generated at runtime, and versioned in the audit log.

```
Settings
├─ Institute ............ name, logo, address, timezone (Asia/Kolkata), academic year
├─ Program Types ........ School / Competitive / Professional Bootcamp defaults
├─ Academic Structure ... node types, programs → courses → batches, subjects, syllabus
├─ Timetable ............ weekly slots, term dates, extra-class notification defaults
├─ Fees ................. rate card, billing models, discounts, pro-rata, late fee, reminders, receipt format
├─ Student Profile ...... custom fields, field groups, statuses, ID format
├─ Classrooms ........... activity types, default durations, resource categories
├─ Groups ............... manual groups, rule-based groups
├─ Grading .............. grading schemes, scoring schemes, late policies, report card templates
├─ Attendance ........... statuses, policies/thresholds, notification behaviour
├─ Calendar ............. holidays, exam calendars, working days, reminder defaults
├─ Mentors & Access ..... mentor profile fields, roles & permissions, scopes
├─ Communication ........ channel accounts, templates, quiet hours, frequency caps, sender names
├─ Automations .......... rules (event → condition → action)
├─ Class Notes .......... auto-send on/off, recipients, absentee variant, nudge time
├─ Progress Reports ..... sections, generate day, review required, recipients, branding
├─ Enquiries ............ pipeline stages, sources, lost reasons, enquiry fields, follow-up defaults
├─ Backup & Export ...... Google Drive connection, time, retention, encryption key
└─ Modules .............. enable/disable optional modules (Fees, Question Bank, Doubts…)
```

## 1. Academic structure

Node types are configurable, so the hierarchy depth isn't fixed in code.

```jsonc
// node_type
[
  { "key": "program", "label": "Program", "allowedParents": [] },
  { "key": "course",  "label": "Course",  "allowedParents": ["program"] },
  { "key": "batch",   "label": "Batch",   "allowedParents": ["course"], "enrollable": true }
]

// example tree for 2026-27
School Boards
  ├─ Class 8   → Batch "8-A (Mon/Wed/Fri 4pm)"
  ├─ Class 10  → "10 CBSE Morning", "10 ICSE Evening"
  └─ Class 12  → "12 PCM"
JEE
  ├─ JEE 2-Year (2028) → "Alpha", "Beta"
  └─ JEE Dropper (2027) → "Target"
Olympiad
  ├─ NSEP/INPhO → "Physics Olympiad Core"
  └─ IMO/INMO   → "Math Olympiad Jr", "Math Olympiad Sr"
```

Batch **attributes** (also configurable fields): capacity, mode, room, color, start/end date, fee plan.

## 2. Student profile — field definitions

```jsonc
{
  "entity": "student",
  "groups": ["Personal", "Academic", "Competitive", "Medical"],
  "fields": [
    { "key": "school_name",   "label": "School",         "type": "text",     "group": "Academic", "required": true },
    { "key": "board",         "label": "Board",          "type": "select",   "options": ["CBSE","ICSE","State","IB"], "group": "Academic" },
    { "key": "target_exam",   "label": "Target exam",    "type": "multiselect", "options": ["JEE Main","JEE Adv","BITSAT","NSEP","INMO","Boards"] },
    { "key": "jee_app_no",    "label": "JEE App No.",    "type": "text",     "group": "Competitive", "showIf": { "target_exam": { "contains": "JEE Main" } } },
    { "key": "blood_group",   "label": "Blood group",    "type": "select",   "group": "Medical", "visibleToRoles": ["owner"] },
    { "key": "prev_marks",    "label": "Last exam %",    "type": "number",   "min": 0, "max": 100 }
  ]
}
```

- Supports **conditional visibility** (`showIf`), **role visibility**, required/validation, default values.
- The same engine powers **mentor profile** fields and **batch attributes**.
- Custom fields are filterable in student lists and usable as template variables (`{{student.custom.school_name}}`).

## 3. Activity types

| key | label | takes attendance | has submission | graded | default min |
|---|---|---|---|---|---|
| lecture | Lecture | ✔ | | | 90 |
| dpp | DPP | | ✔ | ✔ | — |
| doubt | Doubt Session | ✔ | | | 60 |
| test | Chapter Test | ✔ | ✔ | ✔ | 60 |
| mock | Full Mock (JEE) | ✔ | ✔ | ✔ | 180 |
| lab | Practical/Lab | ✔ | ✔ | ✔ | 120 |
| ptm | Parent-Teacher Meet | ✔ (guardians) | | | 30 |

The flags drive UI behaviour: an activity with `takes_attendance` opens a register, `has_submission` creates a submission tracker, `graded` asks for a grading scheme.

## 4. Grading & scoring

```jsonc
// grading_scheme: CBSE 9-point
{ "name": "CBSE Grades", "kind": "bands",
  "bands": [ {"min":91,"label":"A1","points":10}, {"min":81,"label":"A2","points":9},
             {"min":71,"label":"B1","points":8},  {"min":61,"label":"B2","points":7},
             {"min":51,"label":"C1","points":6},  {"min":41,"label":"C2","points":5},
             {"min":33,"label":"D","points":4},   {"min":0, "label":"E","points":0} ] }

// scoring_scheme: JEE Main 2026
{ "name": "JEE Main", "rules": {
    "mcq_single": { "correct": 4, "wrong": -1, "unattempted": 0 },
    "numerical":  { "correct": 4, "wrong": 0 } } }

// scoring_scheme: JEE Advanced (multi-correct partial)
{ "name": "JEE Adv – Multi", "rules": {
    "mcq_multi": { "all_correct": 4, "partial_per_correct": 1, "any_wrong": -2 } } }

// late policy
{ "graceHours": 12, "penaltyPercentPerDay": 10, "maxPenalty": 50, "acceptAfterDays": 3 }
```

Report-card aggregation (P2):
```jsonc
{ "components": [ {"source":"tests","weight":60}, {"source":"assignments","weight":25}, {"source":"attendance","weight":15} ],
  "scheme": "CBSE Grades" }
```

## 5. Attendance

```jsonc
"statuses": [
  { "code": "P", "label": "Present", "weight": 1,   "color": "green" },
  { "code": "A", "label": "Absent",  "weight": 0,   "color": "red",    "notifyGuardian": true },
  { "code": "L", "label": "Late",    "weight": 0.5, "color": "amber",  "notifyGuardian": true },
  { "code": "E", "label": "Excused", "weight": null,"color": "gray" },   // excluded from %
  { "code": "O", "label": "Online",  "weight": 1,   "color": "blue" }
],
"policies": [
  { "scope": "global", "minPercent": 75, "window": "month",
    "actions": [ "addToGroup:low-attendance", "notify:guardian:attendance_warning" ] }
]
```

## 6. Roles & permissions (mentor access)

Permission keys are registered by each module:

```
students.view          students.view_contact      students.edit
attendance.mark        attendance.edit_past       attendance.reports
assessments.create     assessments.grade          assessments.publish
classrooms.manage      resources.share
messages.send.individual   messages.send.batch    messages.require_approval
mentees.notes          analytics.view             settings.manage
reports.approve_send   fees.view                  enquiries.manage
```

> `reports.approve_send` is **Owner-only** for now and can't be granted to other roles.

Built-in roles (editable, clonable):

| Role | Permissions | Scope |
|---|---|---|
| **Owner** | all | all |
| **Subject Mentor** | students.view, attendance.mark, assessments.create/grade, resources.share, messages.send.batch *(needs approval)* | assigned classrooms |
| **Personal Mentor** | students.view, students.view_contact, mentees.notes, messages.send.individual, analytics.view | own mentees |
| **Assistant** | attendance.mark, assessments.grade | assigned batches |

Scope is checked in the service layer (row-level), not just the UI.

## 7. Program types

```jsonc
[
  { "key": "school",       "learner": "minor", "guardianRequired": true,  "billing": "monthly",
    "fieldSet": "student_school", "curriculum": ["unit","chapter","topic"], "defaultRecipients": "both" },
  { "key": "competitive",  "learner": "minor", "guardianRequired": true,  "billing": "monthly",
    "fieldSet": "student_competitive", "scoring": "JEE Main" },
  { "key": "professional", "learner": "adult", "guardianRequired": false, "billing": "instalments",
    "fieldSet": "professional", "curriculum": ["module","session","topic"],
    "certificate": { "minAttendance": 75, "projectsPassed": true }, "defaultRecipients": "self" }
]
```

## 8. Timetable & extra classes

### Class duration

```jsonc
"durationPresets": [45, 60, 90, 120, 180],      // shown as quick picks; custom minutes always allowed
"durationDefaults": {                             // resolved most-specific first
  "activityType": { "lecture": 60, "doubt": 60, "test": 60, "mock": 180, "lab": 120 },
  "course":       { "Class 10": 90, "Class 12": 60, "JEE 2-Year": 90, "DS Bootcamp": 180 },
  "batchSubject": { "Class 10 CBSE Morning / English": 60 }
}
// Resolution: session.duration ?? slot.duration ?? batchSubject ?? course ?? activityType
// ends_at = starts_at + duration (stored on the session, so the calendar and clash checks are exact)
```

### Weekly slots

```jsonc
// Weekly slots for "Class 10 CBSE – Maths" (3 classes/week)
"slots": [
  { "day": "MON", "start": "16:00", "minutes": 90, "room": "R-1", "mode": "offline" },
  { "day": "WED", "start": "16:00", "minutes": 90, "room": "R-1", "mode": "offline" },
  { "day": "SAT", "start": "10:00", "minutes": 120, "room": "R-1", "mode": "hybrid" }
],
"term": { "from": "2026-04-01", "to": "2027-02-28", "skipHolidays": true }

// Notification defaults per schedule-change type (overridable on each extra class)
"scheduleNotifications": {
  "extra":       { "enabled": true, "channels": ["whatsapp","email"], "to": "both",
                   "template": "extra_class", "sendOn": "create", "reminders": ["-1d","-1h"] },
  "cancelled":   { "enabled": true, "channels": ["whatsapp"], "to": "both", "template": "class_cancelled" },
  "rescheduled": { "enabled": true, "channels": ["whatsapp"], "to": "both", "template": "class_rescheduled" },
  "regular":     { "enabled": false, "reminders": ["-30m"], "onlyIfOnline": true },
  "weeklyDigest":{ "enabled": true, "day": "SUN", "time": "19:00", "to": "student", "channels": ["whatsapp"] }
}
```

## 9. Fees

```jsonc
"rateCard": [
  { "course": "Class 10", "subject": "Maths",   "billing": "monthly", "amount": 2500 },
  { "course": "Class 10", "subject": "Science", "billing": "monthly", "amount": 2500 },
  { "course": "JEE 2-Year", "subject": null /* PCM bundle */, "billing": "monthly", "amount": 7000 },
  { "course": "DS Bootcamp", "billing": "instalments", "amount": 45000,
    "plan": [ {"pct": 40, "due": "on_join"}, {"pct": 30, "due": "+30d"}, {"pct": 30, "due": "+60d"} ] }
],
"policy": {
  "billDay": 1, "dueDay": 10, "graceDays": 5,
  "prorata": "per_day",             // or "full", "half_if_after_15th", "none"
  "lateFee": { "type": "flat", "amount": 100, "after": "grace" },
  "discounts": ["scholarship", "sibling", "early_payment", "custom"],
  "reminders": [ "-3d", "0d", "+3d", "+7d", "every 7d" ],
  "receiptPrefix": "RSC/26-27/",
  "sendReceiptVia": ["whatsapp", "email"], "receiptTo": "guardian"
}
```

## 10. Class notes, progress reports, enquiries, backups

```jsonc
"classNotes": {
  "autoSend": true, "sendAfter": "on_save",          // or "end_of_day 20:00"
  "to": "student", "channels": ["whatsapp"],
  "absenteeVariant": { "enabled": true, "to": "both" },
  "nudge": { "afterSessionMin": 10, "nightlyAt": "21:00" }
},
"progressReports": {
  "generateOn": 1, "period": "previous_month",
  "sections": ["attendance", "tests", "assignments", "topics", "fees", "remark"],
  "autoSend": false,                       // fixed for now: never sent without approval
  "requireReview": true, "approveAndSendBy": "owner_only", "remarkBy": "owner",
  "to": { "school": "guardian", "competitive": "guardian", "professional": "self" },
  "channels": ["whatsapp", "email"], "attachPdf": true
},
"enquiries": {
  "stages": ["New", "Contacted", "Demo scheduled", "Demo attended", "Fee shared", "Admitted*", "Lost*"],
  "sources": ["Walk-in", "Phone", "WhatsApp", "Referral", "Instagram", "Website", "Other"],
  "lostReasons": ["Fees", "Timing", "Distance", "Joined elsewhere", "No response"],
  "stagesSkippable": true,
  "demoModes": ["in_class", "phone", "video"], "allowManualDemoLog": true,
  "defaultFollowupDays": 2, "autoAck": { "enabled": true, "template": "enquiry_ack" }
},
"backup": {
  "destination": "google_drive", "folder": "RSC Classroom Backups",
  "time": "02:00", "retain": { "daily": 30, "monthly": 12 },
  "include": ["db_dump_encrypted", "excel_workbook", "uploaded_files_weekly"],
  "alertOnFailure": "email"
}
```

## 11. Communication settings

```jsonc
{
  "quietHours": { "from": "21:30", "to": "07:30", "behaviour": "defer" },  // urgent can bypass
  "frequencyCap": { "perContactPerDay": 4 },
  "defaultRecipients": { "attendance": "guardian", "result": "both", "announcement": "both" },
  "senderName": "Rahul Shah Classes",
  "replyTo": "rahul@rsc...",
  "footer": "Reply STOP to unsubscribe"
}
```
