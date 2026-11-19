// Idempotent seed: configuration defaults only. No user accounts (created at /setup), no fake students.
import { PrismaClient } from "@prisma/client";
import { PERMISSION_KEYS } from "./permission-keys";

const db = new PrismaClient();

async function main() {
  // Roles
  await db.role.upsert({
    where: { orgId_name: { orgId: "rsc", name: "Owner" } },
    update: { permissions: PERMISSION_KEYS },
    create: { name: "Owner", permissions: PERMISSION_KEYS, isSystem: true },
  });

  // Program types (design/04-configuration.md §7)
  const programTypes = [
    { key: "school", label: "School Boards", learnerKind: "MINOR", guardianRequired: true, defaultBilling: "monthly", curriculumLevels: ["unit", "chapter", "topic"], defaultRecipients: "both" },
    { key: "competitive", label: "Competitive (JEE / Olympiad)", learnerKind: "MINOR", guardianRequired: true, defaultBilling: "monthly", curriculumLevels: ["unit", "chapter", "topic"], defaultRecipients: "both" },
    { key: "professional", label: "Professional Bootcamp", learnerKind: "ADULT", guardianRequired: false, defaultBilling: "instalments", curriculumLevels: ["module", "session", "topic"], defaultRecipients: "self" },
  ] as const;
  for (const p of programTypes) {
    await db.programType.upsert({ where: { orgId_key: { orgId: "rsc", key: p.key } }, update: {}, create: { ...p, curriculumLevels: [...p.curriculumLevels] } });
  }

  // Hierarchy levels
  const nodeTypes = [
    { key: "program", label: "Program", allowedParentKeys: [], enrollable: false, order: 1 },
    { key: "course", label: "Course", allowedParentKeys: ["program"], enrollable: false, order: 2 },
    { key: "batch", label: "Batch", allowedParentKeys: ["course", "program"], enrollable: true, order: 3 },
  ];
  for (const n of nodeTypes) {
    await db.nodeType.upsert({ where: { orgId_key: { orgId: "rsc", key: n.key } }, update: { allowedParentKeys: n.allowedParentKeys }, create: n });
  }

  // Current academic year (Indian session: April → March)
  await db.academicYear.upsert({
    where: { orgId_name: { orgId: "rsc", name: "2026-27" } },
    update: {},
    create: { name: "2026-27", startDate: new Date("2026-04-01"), endDate: new Date("2027-03-31"), isCurrent: true },
  });

  // Common subjects
  const subjects = [
    { code: "PHY", name: "Physics", boardTags: ["CBSE", "ICSE", "JEE", "NSEP"], color: "#3b5bdb" },
    { code: "CHEM", name: "Chemistry", boardTags: ["CBSE", "ICSE", "JEE", "NSEC"], color: "#0c8599" },
    { code: "MATH", name: "Mathematics", boardTags: ["CBSE", "ICSE", "JEE", "IMO", "INMO"], color: "#e67700" },
    { code: "SCI", name: "Science", boardTags: ["CBSE", "ICSE", "NSO"], color: "#2f9e44" },
    { code: "BIO", name: "Biology", boardTags: ["CBSE", "ICSE", "NSEB"], color: "#7048e8" },
    { code: "ENG", name: "English", boardTags: ["CBSE", "ICSE"], color: "#c2255c" },
  ];
  for (const s of subjects) await db.subject.upsert({ where: { orgId_code: { orgId: "rsc", code: s.code } }, update: {}, create: s });

  // Settings
  const settings: Record<string, unknown> = {
    "institute.name": "Rahul Shah Classes",
    "institute.timezone": "Asia/Kolkata",
    "schedule.durationPresets": [45, 60, 90, 120, 180],
    "schedule.defaultDurationMin": 60,
  };
  for (const [key, value] of Object.entries(settings)) {
    await db.setting.upsert({ where: { key }, update: {}, create: { key, value: value as never } });
  }

  // Starter student-profile fields (editable in Settings › Custom fields)
  const fields = [
    { scopeKey: "*", key: "school_name", label: "School / college", type: "text", groupName: "Academic", order: 1 },
    { scopeKey: "*", key: "board", label: "Board", type: "select", options: ["CBSE", "ICSE", "State", "IB", "Other"], groupName: "Academic", order: 2 },
    { scopeKey: "competitive", key: "target_exam", label: "Target exams", type: "multiselect", options: ["JEE Main", "JEE Advanced", "BITSAT", "NSEP", "NSEC", "INMO", "IOQM"], groupName: "Competitive", order: 1 },
    { scopeKey: "professional", key: "company", label: "Company", type: "text", groupName: "Professional", order: 1 },
    { scopeKey: "professional", key: "designation", label: "Designation", type: "text", groupName: "Professional", order: 2 },
    { scopeKey: "professional", key: "experience_years", label: "Years of experience", type: "number", groupName: "Professional", order: 3 },
    { scopeKey: "professional", key: "linkedin", label: "LinkedIn", type: "url", groupName: "Professional", order: 4 },
    { scopeKey: "*", key: "medical_notes", label: "Medical notes", type: "textarea", groupName: "Medical", order: 1, sensitive: true },
  ];
  for (const f of fields) {
    await db.fieldDefinition.upsert({
      where: { orgId_entity_scopeKey_key: { orgId: "rsc", entity: "student", scopeKey: f.scopeKey, key: f.key } },
      update: {},
      create: { entity: "student", options: [], ...f },
    });
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
