# 06 — Wireframes (low-fidelity)

For clickable versions of these screens, open **[wireframes/index.html](wireframes/index.html)** in a browser.

## Global layout

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ☰ RSC Classroom   [ 2026-27 ▾ ]        🔍 Search students, batches, tests…  ⌘K   🔔 3  RS │
├───────────────┬──────────────────────────────────────────────────────────────────────┤
│ ◉ Today       │                                                                      │
│ ▣ Academics   │                         PAGE CONTENT                                 │
│ 👤 Students    │                                                                      │
│ 🏫 Classrooms  │                                                                      │
│ ✓ Attendance  │                                                                      │
│ 📅 Calendar    │                                                                      │
│ 📝 Assessments │                                                                      │
│ 🧑‍🏫 Mentors     │                                                                      │
│ ✉ Messages    │                                                                      │
│ ⚡ Automations │                                                                      │
│ 📊 Reports     │                                                                      │
│ ⚙ Settings    │                                                                      │
└───────────────┴──────────────────────────────────────────────────────────────────────┘
```
Mobile: sidebar collapses to a bottom bar (Today · Attendance · Students · Messages · More).

---

## W1. Today (home dashboard)

```
┌─ Today · Mon 2 Nov ──────────────────────────────────────────────────────────────────┐
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                  │
│ │ 5 sessions   │ │ 2 registers  │ │ 38 to check  │ │ 4 msgs failed│                  │
│ │ today        │ │ unmarked     │ │ submissions  │ │ ⟳ retry      │                  │
│ └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘                  │
│                                                                                      │
│ SCHEDULE                                    │ NEEDS ATTENTION                         │
│ 07:00 JEE Alpha · Physics · Rotational ✓    │ ⚠ 6 students < 75% attendance (Oct)    │
│ 16:00 Class 10 CBSE · Maths  [Mark ▸]       │ ⚠ 12 missing DPP-14 (JEE Beta)          │
│ 17:30 Class 12 PCM · Chem    [Mark ▸]       │ ⚠ Mock Test 3 results not published    │
│ 19:00 INMO Sr · Doubt session (online)      │ 🎂 Birthdays: Aarav (10A), Diya (JEE)  │
│ 20:30 Dropper Target · Mock review          │                                         │
│                                             │ UPCOMING                                │
│ QUICK ACTIONS                               │ Wed  Chapter Test – Electrostatics      │
│ [+ Announcement] [+ Assignment] [+ Test]    │ Sat  PTM – Class 10                     │
│ [+ Student]      [Mark attendance]          │ 15 Nov  NSEP registration closes        │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

## W2. Academics: structure tree

```
┌─ Academics ─────────────────────────────────────────── [+ Program] [Clone year ▸] ──┐
│ TREE                           │ JEE 2-Year (2028) › Alpha                            │
│ ▾ School Boards                │ ─────────────────────────────────────────────────── │
│   ▸ Class 8                    │ Students 42/50   Mode: Hybrid   Room: R-2            │
│   ▸ Class 9                    │ Mentors: Rahul (Phy), Neha (Chem), Arjun (Math)      │
│   ▾ Class 10                   │                                                      │
│      • 10 CBSE Morning         │ SUBJECTS            SYLLABUS DONE   NEXT SESSION      │
│      • 10 ICSE Evening         │ Physics   ████████░░  78%          Tue 07:00         │
│ ▾ JEE                          │ Chemistry █████░░░░░  52%          Wed 07:00         │
│   ▾ JEE 2-Year (2028)          │ Maths     ██████░░░░  61%          Thu 07:00         │
│      • Alpha  ◀                │                                                      │
│      • Beta                    │ [Timetable] [Students] [Groups] [Settings]          │
│   ▸ JEE Dropper (2027)         │                                                      │
│ ▾ Olympiad                     │                                                      │
│   ▸ NSEP / INPhO               │                                                      │
│   ▸ IMO / INMO                 │                                                      │
└────────────────────────────────┴─────────────────────────────────────────────────────┘
```

## W3. Students: list

```
┌─ Students (312) ───────────────────────── [Import CSV] [+ Add student] ─────────────┐
│ 🔍 search…   Batch [All ▾]  Group [All ▾]  Status [Active ▾]  + Filter   ★ Saved ▾   │
│ ┌──┬──────────────────┬──────────────┬────────┬────────┬────────┬──────────────────┐ │
│ │☐ │ Name             │ Batches      │ Att %  │ Avg %  │ Due    │ Contact          │ │
│ ├──┼──────────────────┼──────────────┼────────┼────────┼────────┼──────────────────┤ │
│ │☐ │ Aarav Mehta      │ 10 CBSE M    │ 92 ▲   │ 81     │ 0      │ 📱✉  Father ✔WA  │ │
│ │☐ │ Diya Patel       │ JEE Alpha +2 │ 71 ⚠   │ 64 ▼   │ 3      │ 📱✉  Mother ✔WA  │ │
│ │☐ │ Kabir Singh      │ 12 PCM       │ 88     │ 58     │ 1      │ 📱   ✉ missing ⚠ │ │
│ └──┴──────────────────┴──────────────┴────────┴────────┴────────┴──────────────────┘ │
│ 2 selected → [Message] [Add to group] [Move batch] [Export]                          │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

## W4. Student 360° profile

```
┌─ ◀ Students / Diya Patel ─────────────────────────── [Message ▾] [Edit] [⋯] ────────┐
│ (photo) Diya Patel · RSC-2026-0142 · Active                                           │
│         JEE Alpha · Olympiad Physics Core · Group: INPhO shortlist                    │
│         Mentor: Neha Sharma                                                           │
│ ┌──────────┬──────────┬──────────┬──────────┐                                        │
│ │ Att 71%⚠ │ Avg 64%  │ Rank 18  │ 3 pending│                                        │
│ └──────────┴──────────┴──────────┴──────────┘                                        │
│ [Overview] [Profile] [Attendance] [Scores] [Assignments] [Messages] [Mentor notes]    │
│ ──────────────────────────────────────────────────────────────────────────────────── │
│ SCORE TREND (vs batch avg)            │ WEAK TOPICS                                   │
│   ╭─╮      ╭──                        │ • Rotational dynamics  38%                    │
│ ──╯ ╰──╮╭──╯   — Diya  ··· batch       │ • Electrochemistry     42%                    │
│        ╰╯                             │ • Definite integrals   45%                    │
│ RECENT ACTIVITY                                                                       │
│ 30 Oct  Absent – Chemistry  → WhatsApp sent to Mother ✓✓ read                        │
│ 28 Oct  Mock 3: 168/300 (Rank 18)  → Result sent ✓✓                                  │
│ 25 Oct  Mentor note: "Needs extra practice in rotation…"                              │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

## W5. Attendance register (fast marking)

```
┌─ Attendance · Class 10 CBSE · Maths · Mon 2 Nov 16:00 ─────────────────────────────┐
│ Default: ● All present     Statuses: [P] [A] [L] [E] [O]    Keyboard: ↑↓  P/A/L     │
│ ┌────┬──────────────────┬─────────────────────────────┬──────────────┐             │
│ │ #  │ Student          │ Status                      │ Remark       │             │
│ ├────┼──────────────────┼─────────────────────────────┼──────────────┤             │
│ │ 1  │ Aarav Mehta      │ (P) A  L  E  O              │              │             │
│ │ 2  │ Ishita Rao       │  P (A) L  E  O   📱 parent   │              │             │
│ │ 3  │ Rohan Das        │  P  A (L) E  O   📱 parent   │ 15 min late  │             │
│ └────┴──────────────────┴─────────────────────────────┴──────────────┘             │
│ Summary: 28 P · 2 A · 1 L      ⓘ Parents of 3 students will be notified in 15 min  │
│                                         [Save draft]  [Save & notify ▸]            │
└────────────────────────────────────────────────────────────────────────────────────┘
```

## W6. Calendar

Blocks are drawn **at their real length** (height ∝ duration) and labelled with start–end time and a duration badge.

```
┌─ Calendar · Week · View: Batch ▾ · Colour by: (Type)|Duration · [+ Event] [+ Extra class] ┐
│ all-day │                │ ⏰ DPP-15 due   │                │ 🏖 Holiday      │
│         │ Wed 4          │ Thu 5          │ Fri 6          │ Sun 8          │
│ 16:00 ─ │ ┌────────────┐ │ ┌────────────┐ │ ┌────────────┐ │                │
│         │ │10C Maths90m│ │ │10C Sci  90m│ │ │10C Engl 60m│ │                │
│ 16:30 ─ │ │16:00–17:30 │ │ │16:00–17:30 │ │ │16:00–17:00 │ │                │
│         │ │            │ │ │            │ │ └────────────┘ │                │
│ 17:00 ─ │ │            │ │ │            │ │                │                │
│         │ │            │ │ │            │ │                │                │
│ 17:30 ─ │ └────────────┘ │ └────────────┘ │ ┌────────────┐ │                │
│         │ ┌────────────┐ │ ┌────────────┐ │ │12 Phy   60m│ │                │
│ 18:00 ─ │ │Test     60m│ │ │12 Chem  60m│ │ │17:30–18:30 │ │                │
│         │ │17:30–18:30 │ │ │17:30–18:30 │ │ │            │ │                │
│ 18:30 ─ │ └────────────┘ │ └────────────┘ │ └────────────┘ │                │
│ Legend: ■ Lecture ■ Test ■ Doubt ■ Bootcamp ■ Event ┆ Extra (dashed)          │
│ Duration mode: ░ ≤60m  ▒ 90m  ▓ 120m+                                        │
└──────────────────────────────────────────────────────────────────────────────┘
```
Agenda view lists the same sessions as rows: `Mon 2 · 16:00–17:30 · 90 min · Class 10 CBSE · Maths · R-1`.
Clicking a session: details, mark attendance, cancel/reschedule (with "notify students" toggle).

## W7. Assessment: marks entry & publish

```
┌─ Mock Test 3 · JEE Alpha · Scoring: JEE Main (+4/−1) · Max 300 ───────────────────┐
│ [Answer key] [Responses] [Marks] [Analysis] [Publish]                              │
│ Entry mode: ○ Total only  ○ Subject-wise  ● Per-question responses (auto-score)    │
│ ┌──────────────┬─────┬─────┬─────┬───────┬──────┬───────┬──────────┐               │
│ │ Student      │ Phy │ Chem│ Math│ Total │ Rank │ %ile  │ Status   │               │
│ ├──────────────┼─────┼─────┼─────┼───────┼──────┼───────┼──────────┤               │
│ │ Arjun K      │ 84  │ 76  │ 92  │ 252   │ 1    │ 99.0  │ checked  │               │
│ │ Diya Patel   │ 52  │ 60  │ 56  │ 168   │ 18   │ 58.3  │ checked  │               │
│ │ Kabir S      │  —  │  —  │  —  │  —    │      │       │ absent   │               │
│ └──────────────┴─────┴─────┴─────┴───────┴──────┴───────┴──────────┘               │
│ Batch avg 171 · Highest 252 · Lowest 64                                            │
│ PUBLISH → Template: result_published  To: ● Both  Via: [✔]WA [✔]Email             │
│           Attach: [✔] individual score PDF       [Preview]  [Publish & send ▸]     │
└────────────────────────────────────────────────────────────────────────────────────┘
```

## W8. Assignment submission tracker

```
┌─ DPP-14 · Rotational Motion · JEE Beta · Due 1 Nov 23:59 ─────────────────────────┐
│ 34 submitted · 4 late · 12 missing · 22 checked        [Remind missing ▸]          │
│ Filter: [All] [Submitted] [Missing] [Unchecked] [Inbox (5 new from WhatsApp)]      │
│ ┌──────────────┬───────────┬───────────┬──────┬────────┬───────────────────┐       │
│ │ Student      │ Status    │ Source    │ Marks│ Grade  │                   │       │
│ ├──────────────┼───────────┼───────────┼──────┼────────┼───────────────────┤       │
│ │ Meera J      │ ✔ checked │ WhatsApp  │ 18/20│ A      │ [View] [Return]   │       │
│ │ Rohit V      │ ⏰ late    │ Manual    │      │        │ [Check ▸]         │       │
│ │ Sana Q       │ ✖ missing │ —         │      │        │ [Mark submitted]  │       │
│ └──────────────┴───────────┴───────────┴──────┴────────┴───────────────────┘       │
└────────────────────────────────────────────────────────────────────────────────────┘
```

## W9. Message composer

```
┌─ New announcement ────────────────────────────────────────────────────────────────┐
│ 1 AUDIENCE   [JEE Alpha ×] [JEE Beta ×] [+ add batch/group/student]  → 84 students │
│ 2 SEND TO    ○ Students  ○ Guardians  ● Both          → 84 + 96 contacts          │
│ 3 CHANNELS   [✔] WhatsApp (162 opted-in)  [✔] Email (171)   Fallback WA→Email ✔    │
│ 4 TEMPLATE   [ test_scheduled ▾ ]   WA status: ● Approved                          │
│    ┌───────────────────────────────────────┬────────────────────────────────────┐  │
│    │ Subject: Mock Test 4 on {{test.date}} │  PREVIEW  ◀ Diya Patel (Mother) ▶  │  │
│    │ Dear {{recipient.name}},              │  ┌──────────────────────────────┐  │  │
│    │ {{student.first_name}}'s Mock Test 4  │  │ Dear Mrs. Patel,             │  │  │
│    │ is on {{test.date}} at {{test.time}}. │  │ Diya's Mock Test 4 is on     │  │  │
│    │ Syllabus: {{test.syllabus}}           │  │ Sun 8 Nov at 9:00 AM…        │  │  │
│    │ [+ variable] [📎 attach]               │  └──────────────────────────────┘  │  │
│    └───────────────────────────────────────┴────────────────────────────────────┘  │
│ ⚠ 6 contacts no WhatsApp opt-in → email only    ⚠ 2 invalid emails                 │
│ 5 WHEN  ● Now  ○ Schedule [__/__ __:__]   ✔ respect quiet hours   Est. cost ₹ 21  │
│                                                  [Save draft]  [Send to 180 ▸]     │
└────────────────────────────────────────────────────────────────────────────────────┘
```

## W10. Campaign delivery report

```
┌─ Mock Test 4 announcement · sent 2 Nov 18:04 ─────────────────────────────────────┐
│ Queued 0 │ Sent 180 │ Delivered 174 │ Read 131 │ Failed 6  [Retry failed]           │
│ ████████████████████████████████████████████████████░░░                           │
│ Recipient            Channel   Status         Time                                 │
│ Mrs. Patel           WA        ✓✓ read         18:06                               │
│ Kabir Singh          Email     ✖ bounced       18:04   [Fix contact]               │
└────────────────────────────────────────────────────────────────────────────────────┘
```

## W11. Automations

```
┌─ Automations ────────────────────────────────────────────────── [+ New rule] ─────┐
│ ● ON  Absent → parent WhatsApp          attendance.marked   312 sent this month   │
│ ● ON  Assignment due in 24h → student   assessment.due_soon  88 sent              │
│ ● ON  Result published → both + PDF     result.published     420 sent             │
│ ○ OFF Birthday wish 8 AM                student.birthday                          │
│ ─── Edit rule ─────────────────────────────────────────────────────────────────── │
│ WHEN  [ attendance.marked ▾ ]                                                     │
│ IF    [ status ▾ ] [ is ▾ ] [ Absent ▾ ]   AND  [ activity ▾ ] [ in ▾ ] [Lecture,Test]│
│ THEN  send [ absent_today ▾ ] to [ Guardian ▾ ] via [ WhatsApp ▾ ] fallback Email │
│ DELAY [ 15 min ]   DEDUPE [ once per student per day ▾ ]        [Test] [Save]     │
└───────────────────────────────────────────────────────────────────────────────────┘
```

## W12. Mentors & access

```
┌─ Mentors ───────────────────────────────────────────────────── [+ Invite mentor] ─┐
│ Neha Sharma · Chemistry · Role: Subject Mentor + Personal Mentor                  │
│   Classrooms: JEE Alpha–Chem, JEE Beta–Chem, 12 PCM–Chem                          │
│   Mentees (8): Diya P, Rohit V, …                     [Manage mentees]            │
│ ─── Role: Subject Mentor ─────────────────────────────────────────────────────── │
│ Permission                      Allowed   Scope                                   │
│ View students                   ✔         Assigned classrooms                     │
│ View phone/email                ✖                                                 │
│ Mark attendance                 ✔         Assigned classrooms                     │
│ Edit past attendance (> 24h)    ✖                                                 │
│ Enter / publish marks           ✔ / ✖                                             │
│ Send batch messages             ✔ needs Owner approval                            │
└───────────────────────────────────────────────────────────────────────────────────┘
```

## W13. Settings: student profile fields (form builder)

```
┌─ Settings › Student Profile ───────────────────────────────────── [+ Add field] ──┐
│ Groups: [Personal] [Academic] [Competitive] [Medical] [+]                         │
│ ⠿ School name        Text          required    Academic                    [✎] [🗑]│
│ ⠿ Board              Dropdown      —           Academic   CBSE,ICSE,State  [✎] [🗑]│
│ ⠿ Target exam        Multi-select  —           Competitive                 [✎] [🗑]│
│ ⠿ JEE App No.        Text          show if Target exam ∋ JEE Main          [✎] [🗑]│
│ ⠿ Blood group        Dropdown      owner-only  Medical                     [✎] [🗑]│
│ (drag ⠿ to reorder)                                         [Preview form ▸]      │
└───────────────────────────────────────────────────────────────────────────────────┘
```
The same builder UI is reused for **Mentor profile**, **Batch attributes**, **Attendance statuses**, **Activity types** and **Grading bands**.

## W14. Timetable builder (2–3 classes/week per subject)

```
┌─ Timetable · Class 10 CBSE Morning · Term Apr 2026 – Feb 2027 ──── [Share as PDF ▸] ┐
│ SUBJECT    WEEKLY SLOTS                                               /wk   MENTOR   │
│ Maths      [Mon 16:00 · 90m · R-1] [Wed 16:00 · 90m · R-1] [Sat 10:00 · 120m] [+]  3   Rahul │
│ Science    [Tue 16:00 · 90m · R-1] [Thu 16:00 · 90m · R-1]                   [+]  2   Neha  │
│ English    [Fri 16:00 · 60m · R-2]                                           [+]  1   Arjun │
│ ─────────────────────────────────────────────────────────────────────────────────── │
│ Default duration for this subject: [90 min ▾]  (inherited from Class 10 course)      │
│ Slot editor: Day [Sat ▾] Start [10:00] Duration (60)(90)[120](180)[custom] → ends 12:00│
│              Room [R-1 ▾] Mode [Hybrid ▾]                                             │
│              Mentor [Rahul ▾]  Effective from [01-Apr-2026]  Repeat [Every week ▾]   │
│ ⚠ Clash: Sat 10:00 R-1 also used by "12 PCM – Physics"                               │
│ ✔ Skip holidays    Generates 118 sessions this term       [Cancel]  [Save slots]    │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

## W15. Add extra class (from calendar)

```
┌─ + Extra class ─────────────────────────────────────────────────────────────────────┐
│ Batch    [Class 10 CBSE Morning ▾]   Subject [Maths ▾]                               │
│ Students ● Whole batch (31)  ○ Pick students  ○ Absentees of [Mon 2 Nov ▾] (make-up) │
│ When     [Sun 8 Nov]  [11:00] – [12:30]     Mode [Offline ▾]  Room [R-1 ▾]           │
│ Reason   [Extra practice before unit test___________]                                │
│ ⓘ No clashes for 31 students · room free                                            │
│ ── Notify (defaults from Settings › Timetable; change for this class only) ──────── │
│ ✔ Send now   To: ● Both ○ Students ○ Guardians   Via: [✔] WhatsApp [✔] Email         │
│ Template: [extra_class ▾]   Reminders: [✔] 1 day before  [✔] 1 hour before  [+]      │
│ Preview: "Extra Maths class for Aarav on Sun 8 Nov, 11:00–12:30 at R-1. Reason: …"    │
│                                         [Cancel]  [Add to calendar & notify ▸]       │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

## W16. Fees: monthly status grid

```
┌─ Fees · 2026-27 ─────── Batch [All ▾] Subject [All ▾] Status [All ▾]  [Record payment] ┐
│ Nov: Expected ₹4,82,500 · Collected ₹3,10,000 (64%) · Overdue ₹38,500 (14 students)    │
│ ┌────────────────┬──────────┬───────┬───────┬───────┬───────┬───────┬────────────┐    │
│ │ Student        │ Monthly  │ Aug   │ Sep   │ Oct   │ Nov   │ Dec   │ Balance    │    │
│ ├────────────────┼──────────┼───────┼───────┼───────┼───────┼───────┼────────────┤    │
│ │ Aarav Mehta    │ ₹5,000   │ ✔Paid │ ✔Paid │ ✔Paid │ ● Due │ –     │ ₹5,000     │    │
│ │ Diya Patel     │ ₹6,300¹  │ ✔Paid │ ✔Paid │ ◐ ₹3k │ ● Due │ –     │ ₹9,600     │    │
│ │ Kabir Singh    │ ₹7,000   │ ✔Paid │ ✖ Over│ ✖ Over│ ● Due │ –     │ ₹21,000 ⚠  │    │
│ │ Meera Joshi    │ ₹0 (sch.)│ Waived│ Waived│ Waived│ Waived│ –     │ –          │    │
│ └────────────────┴──────────┴───────┴───────┴───────┴───────┴───────┴────────────┘    │
│ ¹ 10% sibling discount        Selected → [Send reminder] [Record payment] [Export]    │
│ Click a cell → per-subject breakdown: Phy ₹2,500 · Chem ₹2,500 · Math ₹2,000 (−10%)    │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

## W17. Student fee structure (in Student 360° → Fees tab)

```
┌─ Diya Patel › Fees ───────────────────────────────────────────────── [+ Fee line] ──┐
│ SUBJECT / ITEM        BATCH         RATE CARD  OVERRIDE  DISCOUNT     NET/MONTH FROM │
│ Physics               JEE Alpha     ₹2,500     —         —            ₹2,500   Apr  │
│ Chemistry             JEE Alpha     ₹2,500     —         —            ₹2,500   Apr  │
│ Maths                 JEE Alpha     ₹2,500     ₹2,000    —            ₹2,000   Apr  │
│ Olympiad Physics      INPhO Core    ₹1,500     —         10% sibling  ₹1,350   Jul  │
│                                                          TOTAL / MONTH ₹8,350        │
│ LEDGER   2 Nov  Payment ₹3,000 UPI ref 4421…  → Oct (partial)   Receipt RSC/26-27/0412 │
│          1 Nov  Due generated Nov ₹8,350                                              │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

## W18. Class notes & homework (after a session)

```
┌─ Log class · Class 10 CBSE · Maths · Mon 2 Nov 16:00–17:30 ────────────────────────┐
│ Topics covered  [Quadratic Eq › Nature of roots ×] [Discriminant ×] [+ from syllabus]│
│ Summary         [Derived discriminant; solved Ex 4.3 Q1–8_______________________]   │
│ Homework        [Ex 4.3 Q9–16 + worksheet____________]  📎 worksheet-4.pdf          │
│                 Due [Wed 4 Nov]   [✔] Track as assignment (creates "HW – Ex 4.3")    │
│ Resources       [+ link / file]      Recording [https://…  (optional)]               │
│ ── Send ─────────────────────────────────────────────────────────────────────────── │
│ ✔ Send to batch (28 present) · Students · WhatsApp                                   │
│ ✔ Absentees (3) get "class_missed" · Both · WhatsApp + Email                         │
│                                                    [Save only]  [Save & send ▸]      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

## W19. Monthly progress reports (review queue)

```
┌─ Progress reports · October 2026 ───── Generated 1 Nov 06:00 · 312 drafts ───────────┐
│ Filter: Batch [All ▾]  Status [Draft ▾]  Remark [Missing ▾]     [Approve selected]   │
│ ┌──┬──────────────┬────────┬────────┬────────┬──────────┬────────────────┬─────────┐ │
│ │☐ │ Student      │ Att %  │ Avg %  │ HW done│ Fees     │ Remark         │ Status  │ │
│ ├──┼──────────────┼────────┼────────┼────────┼──────────┼────────────────┼─────────┤ │
│ │☐ │ Aarav Mehta  │ 92     │ 81     │ 12/12  │ Paid     │ "Excellent…" ✎ │ ✔ ready │ │
│ │☐ │ Diya Patel   │ 71 ⚠   │ 64     │ 9/12   │ Partial  │ (Neha) ✎       │ draft   │ │
│ │☐ │ Kabir Singh  │ 88     │ 58     │ 10/12  │ Overdue  │ — add ✎        │ draft   │ │
│ └──┴──────────────┴────────┴────────┴────────┴──────────┴────────────────┴─────────┘ │
│ Preview PDF ▸   Send: Guardians · WhatsApp + Email · PDF attached  [Send approved ▸] │
│ 🔒 Only the Owner can approve & send. Nothing is sent automatically.                 │
└──────────────────────────────────────────────────────────────────────────────────────┘
PDF layout: header (logo, student, month) · attendance by subject · test table + trend
chart · homework completion · topics covered this month · fee status · remark · signature
```

## W20. Enquiries pipeline (Kanban)

```
┌─ Enquiries ─────── Course [All ▾] Source [All ▾]  This month: 46 · 12 admitted (26%) ─ [+ Enquiry] ┐
│ NEW (8)          CONTACTED (11)    DEMO SCHED. (6)   DEMO DONE (5)    FEE SHARED (4)  ADMITTED  LOST │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌─────────────┐              │
│ │ Riya Shah    │ │ Karan M      │ │ Ansh T       │ │ Priya N      │ │ Dev P       │              │
│ │ Class 9 · WA │ │ JEE · Walk-in│ │ Class 10     │ │ DS Bootcamp  │ │ JEE Dropper │              │
│ │ ⏰ today      │ │ ⏰ tomorrow   │ │ Demo Sat 10am│ │ ⏰ overdue ⚠  │ │ [Convert ▸] │              │
│ └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘ └─────────────┘              │
│ Drag cards between stages · Click → details, activity log, [Call] [WhatsApp] [Book demo] [Send fee info] │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```
**Convert ▸** opens a 3-step wizard: ① confirm student + guardian details → ② choose batch & subjects → ③ review fee lines → *Admit & send welcome*.

**Demo** button on a lead:
```
┌─ Demo · Priya N (DS Bootcamp) ─────────────────────────────────────────────┐
│ Mode   ○ In class (pick session)   ● Phone call   ○ Video call             │
│ When   [Tue 3 Nov] [18:30]  Duration [20 min]   Taken by [Rahul ▾]         │
│ ○ Schedule (send invite + reminder)   ● Already done (log it)              │
│ Outcome [Interested ▾]  Notes [Wants weekend batch; asked about EMI____]   │
│ Next follow-up [Thu 5 Nov]                         [Cancel]  [Save demo]   │
└────────────────────────────────────────────────────────────────────────────┘
```

## W21. Settings › Backup & Export

```
┌─ Backup & Export ─────────────────────────────────────────────────────────────────┐
│ Google Drive   ● Connected as rahul.…@gmail.com    Folder: /RSC Classroom Backups │
│ Schedule       Daily at [02:00]   Keep [30] daily + [12] monthly                  │
│ Includes       [✔] Database (encrypted)  [✔] Excel workbook  [✔] Files (weekly)   │
│ Last backup    ✔ 2 Nov 02:00 · 18.4 MB · 41 s          [Back up now]  [Restore…]  │
│ History        1 Nov ✔ · 31 Oct ✔ · 30 Oct ✖ token expired (re-connected) · …    │
│ ─ Export ──────────────────────────────────────────────────────────────────────── │
│ [Download everything (.xlsx)]   or choose: [✔] Students [✔] Attendance [✔] Marks  │
│ [✔] Fees & payments [ ] Messages [ ] Enquiries   Range [2026-27 ▾]  [Export ▸]    │
└───────────────────────────────────────────────────────────────────────────────────┘
```
