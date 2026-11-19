import "server-only";
import type { NodeType, ProgramNode, ProgramType } from "@prisma/client";
import { db } from "@/core/db";

export type TreeNode = ProgramNode & {
  nodeType: NodeType;
  programType: ProgramType | null;
  activeStudents: number;
  children: TreeNode[];
};

export async function getYears() {
  return db.academicYear.findMany({ where: { archivedAt: null }, orderBy: { startDate: "desc" } });
}

export async function resolveYear(yearId?: string) {
  if (yearId) {
    const y = await db.academicYear.findFirst({ where: { id: yearId, archivedAt: null } });
    if (y) return y;
  }
  return (await db.academicYear.findFirst({ where: { isCurrent: true, archivedAt: null } })) ?? (await db.academicYear.findFirst({ orderBy: { startDate: "desc" } }));
}

export async function getTree(yearId: string): Promise<TreeNode[]> {
  const nodes = await db.programNode.findMany({
    where: { yearId, archivedAt: null },
    include: { nodeType: true, programType: true, _count: { select: { enrollments: { where: { status: "ACTIVE" } } } } },
    orderBy: [{ order: "asc" }, { name: "asc" }],
  });
  const byId = new Map<string, TreeNode>();
  for (const n of nodes) {
    const { _count, ...rest } = n;
    byId.set(n.id, { ...rest, activeStudents: _count.enrollments, children: [] });
  }
  const roots: TreeNode[] = [];
  for (const n of byId.values()) {
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  // Roll up student counts to ancestors
  const roll = (n: TreeNode): number => (n.activeStudents += n.children.reduce((s, c) => s + roll(c), 0));
  roots.forEach(roll);
  return roots;
}

/** Ancestors from root → node (inclusive). */
export async function getLineage(nodeId: string) {
  // Two queries total (not one per level): load the year's nodes once, walk up in memory.
  const node = await db.programNode.findUnique({ where: { id: nodeId }, select: { yearId: true } });
  if (!node) return [];
  const all = await db.programNode.findMany({ where: { yearId: node.yearId }, include: { nodeType: true } });
  const byId = new Map(all.map((n) => [n.id, n]));
  const chain: (ProgramNode & { nodeType: NodeType })[] = [];
  let current = byId.get(nodeId);
  for (let guard = 0; current && guard < 20; guard++) {
    chain.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}

/**
 * Duration cascade (design/04-configuration.md §8): the most specific setting wins:
 * batch-subject → batch → course/program ancestors → subject default → org default.
 */
export function effectiveDuration(opts: {
  batchSubjectMin?: number | null;
  lineage: { defaultDurationMin: number | null }[];
  subjectMin?: number | null;
  orgDefault: number;
}): { minutes: number; source: string } {
  if (opts.batchSubjectMin) return { minutes: opts.batchSubjectMin, source: "this subject in this batch" };
  for (let i = opts.lineage.length - 1; i >= 0; i--) {
    const m = opts.lineage[i]?.defaultDurationMin;
    if (m) return { minutes: m, source: i === opts.lineage.length - 1 ? "batch" : "course / program" };
  }
  if (opts.subjectMin) return { minutes: opts.subjectMin, source: "subject default" };
  return { minutes: opts.orgDefault, source: "institute default" };
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const s = await db.setting.findUnique({ where: { key } });
  return (s?.value as T) ?? fallback;
}
