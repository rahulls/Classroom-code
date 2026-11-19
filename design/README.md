# RSC Classroom — Design Package

**RSC = Rahul Shah Classes.** Coaching for Class 8–12 (school boards), JEE (Main + Advanced), Olympiads (NSO, IMO, NSEP/NSEC/NSEA, INMO, etc.) and **professional bootcamps** for working adults.

Classes run **2–3 times a week per subject**, fees are tracked **per student, per subject, per month**, and every schedule change (including extra classes) can be announced on WhatsApp/email as configured.

This folder is the **proposal**: what we'll build, how it's structured, and what the screens look like. Nothing here is code yet. Review it, mark changes, and then implementation starts.

| # | Document | What it covers |
|---|----------|----------------|
| 01 | [Feature List](01-feature-list.md) | Every module and feature, tagged by phase (MVP / P2 / P3) |
| 02 | [Architecture](02-architecture.md) | Tech stack, modular-monolith layout, how it scales |
| 03 | [Data Model](03-data-model.md) | Entities, relationships, ER diagram |
| 04 | [Configuration Engine](04-configuration.md) | How classes, profiles, grading, attendance etc. are made configurable |
| 05 | [Communication](05-communication.md) | Email + WhatsApp design, templates, automations, delivery tracking |
| 06 | [Wireframes](06-wireframes.md) | Low-fi screen layouts (ASCII) |
| — | [wireframes/index.html](wireframes/index.html) | Clickable wireframes. Open it in a browser |
| 07 | [Roadmap & Open Questions](07-roadmap.md) | Build phases, decisions still needed |
| 08 | [Suggested Additions](08-suggested-additions.md) | Extra features worth considering (yes / later / no) |
| 09 | [Integrations Setup](09-integrations-setup.md) | Checklist of Google / WhatsApp / email details Rahul will provide |
| 10 | [Communication Hub & Master Data](10-communication-hub-and-master-data.md) | Audiences (students, parents, groups, prospects), message purposes, inbox, fee structure with student-level overrides, changes to existing modules, build order |

---

## 1. Product vision

> One control room where Rahul runs every batch, tracks every student, and reaches every student or parent on email or WhatsApp in one click or automatically.

### Who uses it

| Persona | Access today | Notes |
|---------|-------------|-------|
| **Owner (Rahul)** | Full | Primary and, for now, the only user |
| **Mentor** | Optional, scoped | Teaching assistants or co-teachers. Each one sees only their assigned batches/mentees and only the actions they're allowed |
| **Student / Parent** | **No login** | Gets everything by **email / WhatsApp**: announcements, results, reminders, report cards. (A portal can be added later; the data model already supports it.) |

### Design principles

1. **Configure, don't code.** Classes, sections, subjects, profile fields, grading, attendance statuses, activity types and message templates are all *data*, not code. A new course like "Class 11 Olympiad Foundation" takes a few minutes in Settings with no deployment.
2. **Modular monolith.** Each domain (Academics, Students, Attendance, Assessments, Communication, …) is a self-contained module with its own schema, services, API and UI. Modules talk through service interfaces and domain events, so any one of them can be split into a separate service later.
3. **Event-driven communication.** Every meaningful action (`attendance.marked`, `result.published`, `assignment.due_soon`) emits an event. Automation rules decide whether to email or WhatsApp someone, so new notifications don't need code.
4. **Built for a single operator.** Bulk actions, keyboard shortcuts, smart defaults and "do it for the whole batch" everywhere. Rahul shouldn't need more than 3 clicks for daily tasks.
5. **Parents are first-class recipients.** Most students are minors, so every student has guardian contacts and every message can target *student*, *parent* or *both*.
6. **Audit everything.** Each message sent, grade changed and attendance edit is logged with who, when and what.
