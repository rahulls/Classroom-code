-- CreateTable
CREATE TABLE "ClassRecord" (
    "id" UUID NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT 'rsc',
    "classKey" TEXT NOT NULL,
    "batchId" UUID NOT NULL,
    "batchSubjectId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "startMin" INTEGER NOT NULL,
    "notes" TEXT,
    "homework" TEXT,
    "homeworkDue" DATE,
    "sentAt" TIMESTAMP(3),
    "attendanceTakenAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" UUID NOT NULL,
    "classRecordId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "markedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClassRecord_classKey_key" ON "ClassRecord"("classKey");

-- CreateIndex
CREATE INDEX "ClassRecord_batchId_date_idx" ON "ClassRecord"("batchId", "date");

-- CreateIndex
CREATE INDEX "ClassRecord_date_idx" ON "ClassRecord"("date");

-- CreateIndex
CREATE INDEX "Attendance_studentId_idx" ON "Attendance"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_classRecordId_studentId_key" ON "Attendance"("classRecordId", "studentId");

-- AddForeignKey
ALTER TABLE "ClassRecord" ADD CONSTRAINT "ClassRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProgramNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_classRecordId_fkey" FOREIGN KEY ("classRecordId") REFERENCES "ClassRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

