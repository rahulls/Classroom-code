# 08 — Suggested Additions (need your yes / no)

These aren't in the brief, but most coaching institutes end up needing them. Mark each **Yes / Later / No**.

## ✅ Accepted into MVP (2 Nov 2026)

| # | Feature | Now specified in |
|---|---|---|
| S1 | **Enquiry & admissions pipeline**: stages, follow-ups, demo classes, convert-to-student | [01 · M13](01-feature-list.md), W20 |
| S2 | **Monthly progress report to parents**: draft → review → bulk send with PDF | [01 · M4](01-feature-list.md), W19 |
| S5 | **Class notes / homework log** after each session, auto-sent; absentee variant | [01 · M3](01-feature-list.md), W18 |
| S6 | **Daily Google Drive backup + Excel export of everything** | [01 · M11](01-feature-list.md), W21 |

## Still open: recommended

| # | Feature | Why it matters for RSC | Effort |
|---|---|---|---|
| S3 | **Income dashboard**: fees collected vs expected by month, by course, by subject; outstanding trend | You'll know which batches are profitable (partly covered by the Fees collections dashboard) | S |
| S4 | **Student leave requests**: a parent sends "Diya on leave 10–14 Nov" on WhatsApp → marked Excused in advance; optional fee-waiver rule for long leaves | Stops false "absent" alerts going to parents | S |

## Valuable: Phase 2

| # | Feature | Why | Effort |
|---|---|---|---|
| S7 | **Online test link (no login)**: tokenized MCQ test page for JEE/Olympiad practice, auto-scored | Students still have no accounts, but you get instant results | L |
| S8 | **Results & achievements wall**: JEE ranks, Olympiad selections, board toppers, with an exportable poster for social media | Marketing material straight from your data | S |
| S9 | **Referral tracking**: who referred whom, with an optional referral discount on fees | Word of mouth is the main channel for coaching | S |
| S10 | **Expense tracker** (rent, salaries, material) → simple profit & loss | Pairs with S3 | M |
| S11 | **Mentor salary / per-class payout** computed from sessions taught | Needed once you add co-teachers | M |
| S12 | **Exam countdowns & important dates** (JEE Main sessions, NSEP, INMO, boards), with auto-reminders to the right batches | Students miss registration deadlines every year | S |
| S13 | **Multilingual templates** (English / Hindi / Gujarati) chosen per guardian's preferred language | Higher read-rates from parents | S |
| S14 | **WhatsApp chatbot menu**: student/parent texts "1" to get their timetable, "2" for attendance, "3" for fee balance | Self-service without a portal | M |

## Later

| # | Feature |
|---|---|
| S15 | Student/parent read-only portal (PWA) |
| S16 | AI helpers: draft announcement text, summarise a student's month for the parent report, suggest weak-topic practice sets |
| S17 | Inventory of books/material given to students |
| S18 | Multi-branch with per-branch reports |

## Things to watch (non-feature)

- **WhatsApp template approvals take time** (minutes to a day). We should submit the starter templates as soon as the Meta account is ready.
- **Consent for minors**: add a WhatsApp/email consent line to your admission form now.
- **Fee data is sensitive**: mentors shouldn't see fees by default (permission `fees.view` is off for mentor roles).
- **GST**: if annual coaching revenue crosses the GST threshold, receipts/invoices need GSTIN and tax lines. The receipt template should support this from day one.
