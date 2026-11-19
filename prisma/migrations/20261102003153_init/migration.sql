-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "LearnerKind" AS ENUM ('MINOR', 'ADULT');

-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('ACTIVE', 'ON_HOLD', 'ALUMNI', 'DROPPED');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'LEFT', 'TRANSFERRED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT 'rsc',
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isOwner" BOOLEAN NOT NULL DEFAULT false,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "totpSecretEnc" TEXT,
    "totpPendingEnc" TEXT,
    "totpEnabledAt" TIMESTAMP(3),
    "totpLastStep" INTEGER,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" UUID NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT 'rsc',
    "name" TEXT NOT NULL,
    "permissions" TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "scope" JSONB NOT NULL DEFAULT '{"all":true}',

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "mfaPending" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryCode" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "RecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT 'rsc',
    "actorId" UUID,
    "actorName" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" UUID,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Counter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "DomainEvent" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "DomainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldDefinition" (
    "id" UUID NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT 'rsc',
    "entity" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL DEFAULT '*',
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "options" TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT false,
    "groupName" TEXT NOT NULL DEFAULT 'General',
    "helpText" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "validation" JSONB,
    "showIf" JSONB,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademicYear" (
    "id" UUID NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT 'rsc',
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademicYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramType" (
    "id" UUID NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT 'rsc',
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "learnerKind" "LearnerKind" NOT NULL,
    "guardianRequired" BOOLEAN NOT NULL,
    "defaultBilling" TEXT NOT NULL DEFAULT 'monthly',
    "curriculumLevels" TEXT[],
    "defaultRecipients" TEXT NOT NULL DEFAULT 'both',
    "config" JSONB NOT NULL DEFAULT '{}',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeType" (
    "id" UUID NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT 'rsc',
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "allowedParentKeys" TEXT[],
    "enrollable" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "NodeType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramNode" (
    "id" UUID NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT 'rsc',
    "yearId" UUID NOT NULL,
    "parentId" UUID,
    "nodeTypeId" UUID NOT NULL,
    "programTypeId" UUID,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "defaultDurationMin" INTEGER,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "order" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subject" (
    "id" UUID NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT 'rsc',
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "boardTags" TEXT[],
    "color" TEXT,
    "defaultDurationMin" INTEGER,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchSubject" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "defaultDurationMin" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BatchSubject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyllabusNode" (
    "id" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "parentId" UUID,
    "level" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weightage" DOUBLE PRECISION,
    "estHours" DOUBLE PRECISION,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SyllabusNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentGroup" (
    "id" UUID NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT 'rsc',
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'manual',
    "rule" JSONB,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMember" (
    "groupId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "addedBy" TEXT NOT NULL DEFAULT 'user',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("groupId","studentId")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" UUID NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT 'rsc',
    "admissionNo" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL DEFAULT '',
    "dobEnc" TEXT,
    "gender" TEXT,
    "learnerKind" "LearnerKind" NOT NULL DEFAULT 'MINOR',
    "status" "StudentStatus" NOT NULL DEFAULT 'ACTIVE',
    "custom" JSONB NOT NULL DEFAULT '{}',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" UUID NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT 'rsc',
    "name" TEXT NOT NULL,
    "phoneEnc" TEXT,
    "phoneIdx" TEXT,
    "phoneLast4" TEXT,
    "whatsappEnc" TEXT,
    "whatsappIdx" TEXT,
    "emailEnc" TEXT,
    "emailIdx" TEXT,
    "emailOptIn" BOOLEAN NOT NULL DEFAULT false,
    "waOptIn" BOOLEAN NOT NULL DEFAULT false,
    "consentAt" TIMESTAMP(3),
    "consentSource" TEXT,
    "preferredChannel" TEXT NOT NULL DEFAULT 'whatsapp',
    "preferredLanguage" TEXT NOT NULL DEFAULT 'en',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuardianLink" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "relation" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "receives" TEXT NOT NULL DEFAULT 'all',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuardianLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enrollment" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "rollNo" TEXT,
    "joinedOn" DATE NOT NULL,
    "leftOn" DATE,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Role_orgId_name_key" ON "Role"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_userId_roleId_key" ON "UserRole"("userId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "LoginAttempt_kind_keyHash_createdAt_idx" ON "LoginAttempt"("kind", "keyHash", "createdAt");

-- CreateIndex
CREATE INDEX "RecoveryCode_userId_idx" ON "RecoveryCode"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "DomainEvent_processedAt_occurredAt_idx" ON "DomainEvent"("processedAt", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "FieldDefinition_orgId_entity_scopeKey_key_key" ON "FieldDefinition"("orgId", "entity", "scopeKey", "key");

-- CreateIndex
CREATE UNIQUE INDEX "AcademicYear_orgId_name_key" ON "AcademicYear"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramType_orgId_key_key" ON "ProgramType"("orgId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "NodeType_orgId_key_key" ON "NodeType"("orgId", "key");

-- CreateIndex
CREATE INDEX "ProgramNode_yearId_parentId_idx" ON "ProgramNode"("yearId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_orgId_code_key" ON "Subject"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "BatchSubject_batchId_subjectId_key" ON "BatchSubject"("batchId", "subjectId");

-- CreateIndex
CREATE INDEX "SyllabusNode_subjectId_parentId_idx" ON "SyllabusNode"("subjectId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentGroup_orgId_name_key" ON "StudentGroup"("orgId", "name");

-- CreateIndex
CREATE INDEX "Student_firstName_lastName_idx" ON "Student"("firstName", "lastName");

-- CreateIndex
CREATE INDEX "Student_status_idx" ON "Student"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Student_orgId_admissionNo_key" ON "Student"("orgId", "admissionNo");

-- CreateIndex
CREATE INDEX "Contact_phoneIdx_idx" ON "Contact"("phoneIdx");

-- CreateIndex
CREATE INDEX "Contact_whatsappIdx_idx" ON "Contact"("whatsappIdx");

-- CreateIndex
CREATE INDEX "Contact_emailIdx_idx" ON "Contact"("emailIdx");

-- CreateIndex
CREATE UNIQUE INDEX "GuardianLink_studentId_contactId_key" ON "GuardianLink"("studentId", "contactId");

-- CreateIndex
CREATE INDEX "Enrollment_batchId_status_idx" ON "Enrollment"("batchId", "status");

-- CreateIndex
CREATE INDEX "Enrollment_studentId_idx" ON "Enrollment"("studentId");

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryCode" ADD CONSTRAINT "RecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramNode" ADD CONSTRAINT "ProgramNode_yearId_fkey" FOREIGN KEY ("yearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramNode" ADD CONSTRAINT "ProgramNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ProgramNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramNode" ADD CONSTRAINT "ProgramNode_nodeTypeId_fkey" FOREIGN KEY ("nodeTypeId") REFERENCES "NodeType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramNode" ADD CONSTRAINT "ProgramNode_programTypeId_fkey" FOREIGN KEY ("programTypeId") REFERENCES "ProgramType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchSubject" ADD CONSTRAINT "BatchSubject_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProgramNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchSubject" ADD CONSTRAINT "BatchSubject_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyllabusNode" ADD CONSTRAINT "SyllabusNode_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyllabusNode" ADD CONSTRAINT "SyllabusNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "SyllabusNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "StudentGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianLink" ADD CONSTRAINT "GuardianLink_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianLink" ADD CONSTRAINT "GuardianLink_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProgramNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
