-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "TeacherAccount" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "totpSecret" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeacherAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "twoStepOk" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignInLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ok" BOOLEAN NOT NULL,
    "reason" TEXT,

    CONSTRAINT "SignInLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "klass" INTEGER NOT NULL,
    "board" TEXT NOT NULL,
    "stateBoard" TEXT,
    "medium" TEXT,
    "subjects" TEXT[],
    "school" TEXT,
    "lastExamRange" TEXT,
    "status" TEXT NOT NULL DEFAULT 'free',
    "rankConsent" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT NOT NULL DEFAULT 'New',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "manualPath" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'teacher',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "optedOutAt" TIMESTAMP(3),

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Parent" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "whatsapp" TEXT NOT NULL,
    "email" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "consentAt" TIMESTAMP(3),
    "consentTextVersion" INTEGER,
    "numberVerifiedAt" TIMESTAMP(3),
    "verifyDraftedAt" TIMESTAMP(3),
    "optedOutAt" TIMESTAMP(3),
    "reportTiming" TEXT NOT NULL DEFAULT 'same',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Parent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentText" (
    "version" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentText_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "ParentReply" (
    "id" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "paperId" TEXT,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParentReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChapterList" (
    "id" TEXT NOT NULL,
    "klass" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "board" TEXT NOT NULL,
    "chapters" TEXT[],

    CONSTRAINT "ChapterList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Paper" (
    "id" TEXT NOT NULL,
    "baseId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "klass" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "board" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'paper',
    "pattern" TEXT NOT NULL DEFAULT 'CBSE',
    "mockMinutes" INTEGER,
    "opensAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "graceHours" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "isDiagnostic" BOOLEAN NOT NULL DEFAULT false,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "Paper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Section" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "klass" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "board" TEXT NOT NULL,
    "chapter" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "marks" DOUBLE PRECISION NOT NULL,
    "type" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "options" TEXT[],
    "correctOption" TEXT,
    "markingScheme" JSONB,
    "solution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperQuestion" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,

    CONSTRAINT "PaperQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Slot" (
    "id" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "klass" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "board" TEXT NOT NULL,
    "opensAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "paperId" TEXT,

    CONSTRAINT "Slot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "week" INTEGER,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "paperId" TEXT,
    "messageId" TEXT,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" JSONB,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "files" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "flags" TEXT[],
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "sectionTimes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McqResponse" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "chosenOption" TEXT,
    "marksAwarded" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "McqResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mark" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "marksAwarded" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "aiProposed" DOUBLE PRECISION,
    "aiConfidence" DOUBLE PRECISION,
    "aiReasoning" TEXT,
    "aiErrorTag" TEXT,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "errorTag" TEXT NOT NULL DEFAULT 'none',
    "qualityNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRequestLog" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiRequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelfMarkEntry" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "marksClaimed" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "SelfMarkEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpotCheck" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" TEXT,
    "deltaMarks" DOUBLE PRECISION,
    "checkedAt" TIMESTAMP(3),

    CONSTRAINT "SpotCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrectionNote" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reportedIn" TEXT,

    CONSTRAINT "CorrectionNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportCard" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "parentId" TEXT,
    "audience" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "data" JSONB NOT NULL,
    "pdfPath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "channel" TEXT,
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankRecord" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "cohortKey" TEXT NOT NULL,
    "cohortSize" INTEGER NOT NULL,
    "rank" INTEGER,
    "band" TEXT NOT NULL,
    "percentage" DOUBLE PRECISION NOT NULL,
    "previousRank" INTEGER,
    "toldAt" TIMESTAMP(3),
    "toldBy" TEXT,
    "channel" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RankRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "key" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "bodyHi" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "templateKey" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "tags" TEXT[],
    "body" TEXT NOT NULL,
    "studentId" TEXT,
    "parentId" TEXT,
    "paperId" TEXT,
    "waLink" TEXT,
    "status" TEXT NOT NULL DEFAULT 'drafted',
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "subjects" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "price" DOUBLE PRECISION NOT NULL,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isTrial" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "planId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "receiptNo" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "chapter" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "messageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'suggested',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeachingSession" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "klass" INTEGER NOT NULL,
    "board" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "chapter" TEXT,
    "offerId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "notes" TEXT,

    CONSTRAINT "TeachingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionAttendee" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "attended" BOOLEAN,

    CONSTRAINT "SessionAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Doubt" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "sessionId" TEXT,
    "filePath" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "response" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Doubt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "nextChapterRequest" TEXT,
    "rating" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkloadEntry" (
    "id" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "note" TEXT,

    CONSTRAINT "WorkloadEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Complaint" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT NOT NULL,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewCheck" (
    "id" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "item" TEXT NOT NULL,
    "doneAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'global',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "old" JSONB,
    "new" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeletionRequest" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "studentCode" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "confirmationSentAt" TIMESTAMP(3),
    "summary" JSONB,

    CONSTRAINT "DeletionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptCounter" (
    "id" TEXT NOT NULL DEFAULT 'receipt',
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ReceiptCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeacherAccount_username_key" ON "TeacherAccount"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Student_code_key" ON "Student"("code");

-- CreateIndex
CREATE INDEX "Student_klass_board_idx" ON "Student"("klass", "board");

-- CreateIndex
CREATE INDEX "Parent_studentId_idx" ON "Parent"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "ChapterList_klass_subject_board_key" ON "ChapterList"("klass", "subject", "board");

-- CreateIndex
CREATE INDEX "Paper_klass_subject_board_idx" ON "Paper"("klass", "subject", "board");

-- CreateIndex
CREATE UNIQUE INDEX "PaperQuestion_paperId_number_key" ON "PaperQuestion"("paperId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Slot_week_klass_subject_board_key" ON "Slot"("week", "klass", "subject", "board");

-- CreateIndex
CREATE UNIQUE INDEX "Task_dedupeKey_key" ON "Task"("dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "JobRun_job_periodKey_key" ON "JobRun"("job", "periodKey");

-- CreateIndex
CREATE INDEX "Submission_paperId_isCurrent_idx" ON "Submission"("paperId", "isCurrent");

-- CreateIndex
CREATE INDEX "Submission_studentId_idx" ON "Submission"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "McqResponse_submissionId_questionId_key" ON "McqResponse"("submissionId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "Mark_submissionId_questionId_key" ON "Mark"("submissionId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "SelfMarkEntry_submissionId_questionId_key" ON "SelfMarkEntry"("submissionId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "SpotCheck_paperId_submissionId_key" ON "SpotCheck"("paperId", "submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportCard_studentId_paperId_audience_parentId_key" ON "ReportCard"("studentId", "paperId", "audience", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "RankRecord_studentId_paperId_key" ON "RankRecord"("studentId", "paperId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_dedupeKey_key" ON "Message"("dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_receiptNo_key" ON "Payment"("receiptNo");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_studentId_subject_chapter_key" ON "Offer"("studentId", "subject", "chapter");

-- CreateIndex
CREATE UNIQUE INDEX "SessionAttendee_sessionId_studentId_key" ON "SessionAttendee"("sessionId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Feedback_studentId_paperId_key" ON "Feedback"("studentId", "paperId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkloadEntry_weekStart_key" ON "WorkloadEntry"("weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewCheck_weekStart_item_key" ON "ReviewCheck"("weekStart", "item");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- AddForeignKey
ALTER TABLE "Parent" ADD CONSTRAINT "Parent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParentReply" ADD CONSTRAINT "ParentReply_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Parent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperQuestion" ADD CONSTRAINT "PaperQuestion_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperQuestion" ADD CONSTRAINT "PaperQuestion_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperQuestion" ADD CONSTRAINT "PaperQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McqResponse" ADD CONSTRAINT "McqResponse_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mark" ADD CONSTRAINT "Mark_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfMarkEntry" ADD CONSTRAINT "SelfMarkEntry_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpotCheck" ADD CONSTRAINT "SpotCheck_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCard" ADD CONSTRAINT "ReportCard_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankRecord" ADD CONSTRAINT "RankRecord_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionAttendee" ADD CONSTRAINT "SessionAttendee_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TeachingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionAttendee" ADD CONSTRAINT "SessionAttendee_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Doubt" ADD CONSTRAINT "Doubt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Doubt" ADD CONSTRAINT "Doubt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TeachingSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AuditLog is append-only: refuse UPDATE and DELETE at the database level.
CREATE OR REPLACE FUNCTION ep_audit_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ep_audit_no_update BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ep_audit_append_only();
