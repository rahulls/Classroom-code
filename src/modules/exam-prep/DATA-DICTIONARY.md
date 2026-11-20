# Data dictionary

Database `rsc_exam_prep` (schema: `prisma/exam-prep/schema.prisma`). All times are stored in UTC and
shown in IST.

## Entities

| Entity | Purpose | Key fields and rules |
|---|---|---|
| TeacherAccount | The one sign-in | username, argon2 password hash, encrypted two-step secret |
| AuthSession / SignInLog | Sessions (12 h) and every sign-in attempt | Session id is a SHA-256 of the cookie token; 5 failures in 15 minutes locks sign-in |
| Student | One student | code `EP-0001` (the only id that leaves the system, e.g. to the AI); class 9-12; board; subjects valid for the class; status free/paid1/paid2/opted_out; rankConsent; label; manualPath; isDemo |
| Parent | 1-2 guardians | whatsapp in E.164 format; email; language en/hi; consentAt + consentTextVersion; numberVerifiedAt; optedOutAt; reportTiming same/after. Reachable = consented and verified and not opted out |
| ConsentText | Versioned consent wording | version, text |
| ParentReply | Replies to reports | For the reply-rate metric |
| ChapterList | Syllabus order per class, subject and board | Questions must use these chapter names |
| Paper | A paper version | id `C10-MAT-P1-CBSE` (`-v2`...); baseId; status draft → published → (closed) → marked → reported; kind paper/mock/quiz; isDiagnostic (Paper 0); published papers never change, only get a new version |
| PaperFile | The tutor's own files for a paper | kind paper/key/solutions/other; PDF or CSV; isCurrent (re-uploading keeps older versions). A Paper with `uploadOnly` + `totalMarks` is published from its file, without questions |
| MarkingFormat | Fixed answer rows per class/board/subject | rows JSON [{ label (1, 1.1, 4.a, 36.iii.A), max, section?, chapter?, choice? }]; rows sharing a choice key are OR alternatives, counted once. A new uploaded paper copies it into `Paper.answerRows` |
| RowMark | A mark for one answer row of an uploaded paper | submissionId + label (unique), maxMarks, marks, errorTag. Audited (rowmark.entered/changed/removed); one bad value in a save changes nothing |
| Section | Paper sections from the board pattern | name, type (mcq/short/long/case) |
| Question | Question bank | chapter, topic, marks, type, difficulty, options and correctOption (MCQ), markingScheme `[{step, marks}]` adding up to the marks, solution |
| PaperQuestion | A question placed on a paper | Lets questions be reused across papers |
| Slot | The calendar | One per week × class × subject × board group |
| Task | The tutor's weekly to-do list | Unique dedupeKey, so jobs never duplicate |
| JobRun | Once-per-period jobs | Unique (job, periodKey) |
| Submission | A filed answer sheet | Latest wins (isCurrent); older ones kept as history; files `[{path, name, size, pages}]`; flags; isLate; source form/dm_manual/google_form |
| McqResponse | MCQ answers | Auto-scored |
| Mark | One current mark per question per sheet | source auto/ai/teacher; aiProposed, aiConfidence, aiReasoning; needsReview; errorTag concept/calculation/missing_steps/misread/none; qualityNote |
| AiRequestLog | What was sent to the AI | No image, no personal data |
| SelfMarkEntry | Student's own marks | Fallback; only used in spot-checks |
| SpotCheck | Random sheets checked by the tutor | result match/mismatch; delta |
| CorrectionNote | A corrected mark | Mentioned once in the next report |
| ReportCard | One report per (student, paper, audience, guardian) | data (no ranks), pdfPath, status draft/ready/sent/failed, channel email/whatsapp_manual, attempts |
| RankRecord | Teacher-only | rank (null below the minimum cohort), band, cohortSize, previousRank, toldAt/channel |
| MessageTemplate / Message | Templates and drafts | dedupeKey makes each draft once; status drafted/sent/cancelled; waLink |
| Plan / Payment / ReceiptCounter | Paid tiers and money | receiptNo `RSC-2026-0001` (unique and sequential); family discount automatic for 2+ subjects |
| Offer | A suggested paid offer | Created only after 2 reports and a repeating gap; suggested → sent → accepted/declined |
| TeachingSession / SessionAttendee / Doubt | Teaching add-ons | Capacity, attendance, doubt photo and response |
| Feedback | After each paper | One per student per paper |
| WorkloadEntry / ReviewCheck / Complaint | Tutor workload, Sunday checklist, complaints | |
| Setting | Every threshold | key → JSON value (validated) |
| AuditLog | Change history | Append-only (a database trigger refuses update and delete); ids and changed fields only |
| DeletionRequest | Right to delete | studentCode, completedAt, summary counts |

## Settings (defaults)

| Area | Settings |
|---|---|
| Programme | `programme.startDate` (unset)<br>`programme.weeks` 12<br>`programme.launch` 10 and 12 first, 9 and 11 after 2 weeks<br>`programme.rotation` the 4-week table<br>`programme.times` Mon 09:00 post, Wed 18:00 reminder, Thu 20:00 deadline, Fri 18:00 key, Sat 10:00 review, Sun 17:00 reports<br>`programme.graceHours` 24 |
| Cohorts | `cohort.minSize` 5<br>`cohort.ownPaper` 8<br>`cohort.taggedPdf` 3<br>`group.splitAt` 60<br>`group.maxPostsPerWeek` 12<br>`group.memberCount` 0 |
| Analytics | `analytics.strong` 75<br>`analytics.okay` 50<br>`analytics.lowScore` 35<br>`analytics.gapBelow` 50<br>`analytics.gapPapers` 2<br>`analytics.offerAfterReports` 2 |
| Marking | `marking.aiEnabled` off<br>`marking.aiModel` claude-sonnet-5-5<br>`marking.aiKey` (encrypted)<br>`marking.aiConfidence` 0.7<br>`marking.spotCount` 5<br>`marking.spotTolerance` 0<br>`marking.calibrationSheets` 10<br>`marking.calibrationTarget` 85<br>`marking.mcqShare` 40-50<br>`marking.chaptersPerPaper` 4-6 |
| Delivery | `delivery.emailEnabled` off<br>`delivery.smtp` (local Mailpit)<br>`delivery.maxAttempts` 3<br>`delivery.parentDelayHours` 3 |
| Commercial | `commercial.tiers`<br>`commercial.prices` (0 until set)<br>`commercial.familyDiscountPct` 10<br>`commercial.trial`<br>`commercial.refundLine`<br>`commercial.receiptPrefix` RSC<br>`commercial.upiId` |
| Brand | `brand.tuitionName`<br>`brand.tutorName`<br>`brand.contact`<br>`brand.formLinks`<br>`brand.referralLine` |
| Consent | `consent.currentVersion` 1 |
| Storage | `storage.maxUploadMb` 15<br>`storage.maxImages` 10<br>`retention.months` 12 |
| Targets | `targets.*` intake 80, submission 70, repeat 60, accuracy 90, ai 85, reply 20, paid 10-15, satisfaction 4, hours 15-17, health 60% and 2 paid families |
| Papers | `papers.patterns` (CBSE, ICSE-ISC, State, IGCSE, Other)<br>`mock.windowHours` 3<br>`quiz.minutes` 10 |
