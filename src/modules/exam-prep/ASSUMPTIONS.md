# Assumptions and choices

1. **One user.** At the owner's request, only the tutor signs in, from his laptop. There are no student,
   parent or helper accounts. Students and parents use Google Forms and WhatsApp. So:
   - R1's public intake page is replaced by importing the intake Google Form's CSV export, plus a teacher
     add form. The same validation applies to both: consent required, subjects by class, State-board
     fields only for State board. The import is all or nothing.
   - R4's student submission page is replaced by the teacher filing each sheet (from the Form's upload
     folder or a DM), plus a CSV import of the Form's MCQ answers. The file rules, renaming, flags,
     history and tracker are as specified. The "in-app confirmation" is the drafted "received" reply
     (and an email when emails are on).
   - The Helper role, student and parent screens, and the parent dashboard are not built. The "403 for
     another student's file" rule is enforced on the only file route: a signed link is required **and**
     the teacher must be signed in.
2. **Separate database and no classroom interaction**, as the owner asked. Students are not linked to
   classroom students.
3. **Pending intake.** A student can be on the roll before the parent consents. They count as missing in
   trackers, but no sheet can be filed and no reminder or report is made until consent is recorded
   (R11: no processing beyond intake without consent). This is how Fixture C's 28 students (24 with
   completed intake) are modelled.
4. **Student reports go to the parent's verified WhatsApp number**, addressed to the student. The R1
   field list has no student phone or email, so no student contact details are collected.
5. **Sending needs the tutor's confirmation.** Reports are generated automatically, but delivery starts
   only after the tutor clicks *Approve and deliver*. From then on the Sunday job emails parents
   automatically (when emails are switched on, the parent has an address, consented and is verified)
   and queues the rest for WhatsApp. Emails are off by default and the default SMTP server is the local
   Mailpit.
6. **Class band on parent reports** is the student's third of the cohort (same class and board) by
   percentage. It is computed from marks, never from RankRecord. It is hidden when the cohort is under
   the minimum.
7. **Common-concept papers.** Boards with fewer than the tagged-PDF threshold (default 3) take the CBSE
   paper. Each board is still its own cohort for ranks and group figures.
8. **AI marking.** The adapter sends the whole sheet PDF, the marking scheme, the question text and the
   student code. Questions are found by number on the sheet. AI marking is off by default: proposals are
   then kept for calibration and every one needs review.
9. **Image-quality check** is basic: photos under 700 px on the short side, or very heavily compressed,
   are flagged as `blurry_or_small`. "Pages out of order" is flagged when numbered photo names go
   backwards. True blur detection would need an image library.
10. **PDFs** are printed by the laptop's Edge (Chrome works too). Reports shrink to fit one page: first
    without the optional blocks, then at 90%, 80%, 70% or 60% size.
11. **Hindi.** Report, welcome-pack and parent-message text have Hindi versions (machine-quality: please
    proofread). Chapter names stay as entered.
12. **Calendar weeks** use IST. The start date is moved back to its Monday. Later-launch classes skip the
    first `delayWeeks` weeks of the rotation; their paper numbers still start at 1.
13. **Spot-check "entered marks"** are the student's self-entered marks when they exist, otherwise the
    current (AI or auto) marks. A match means equal within `marking.spotTolerance` (default 0).
14. **Retention** creates a review task after the programme year plus `retention.months`. Archive deletes
    the sheets and removes names, numbers and emails; delete removes everything. Both need the tutor to
    type APPROVE.
15. **Dependencies added:**
    - `pdf-lib`: joins photos into a PDF and counts pages.
    - `vitest` 5.1.0: test runner. Version 3 pulled in a vulnerable `tinypool`.
    - `playwright-core`: the end-to-end UI test, driving the installed Edge with no browser download.
    - `@types/node` 24 replaced 20 to match the Node 24 the project requires. vitest 5 needed it, and
      `tsc` still passes.
16. **Migrations** are plain SQL with a `down.sql`, applied by `scripts/exam-prep-migrate.mjs`. Prisma's
    `migrate dev` and `reset` are never used here, after the shadow-database incident on this machine.
17. **The AuditLog is append-only** through a database trigger. Audit values never hold names, numbers or
    file contents: `audit.ts` strips those fields.
18. **The classroom has no automated test suite**, so "existing tests still pass" means its type-check and
    production build pass unchanged.

## Handover: tutor tasks (not code)

- Write the actual papers and marking schemes, and collect state-board sample papers.
- Set prices, the refund line and the terms page (Settings → Commercial).
- Create the WhatsApp Business number and the shared group; pin the group rules (Messages).
- Make the Google Forms (intake, submission with file upload, MCQ answers, feedback) and put their links
  in Settings → Brand → Google Form links.
- Run the pilot with 3-5 friendly students.
- Proofread the Hindi templates.
- Confirm DPDP Act 2023 obligations with a professional.
