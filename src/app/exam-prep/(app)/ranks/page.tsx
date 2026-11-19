import Link from "next/link";
import { ranksAction, toldAction } from "@/modules/exam-prep/actions";
import { waLink } from "@/modules/exam-prep/adapters/whatsapp";
import { epdb } from "@/modules/exam-prep/db";
import { mostImprovedList } from "@/modules/exam-prep/services/commerce";
import { followUps, tellingRows } from "@/modules/exam-prep/services/ranking";
import { ActionButton, CopyButton } from "../../ui";

export const metadata = { title: "Ranks" };

/** R8: TEACHER-ONLY. Ranks are told personally and never appear in reports, messages or group posts. */
export default async function RanksPage({ searchParams }: { searchParams: Promise<{ paper?: string }> }) {
  const { paper } = await searchParams;
  const papers = await epdb.paper.findMany({ where: { status: { in: ["marked", "reported"] } }, orderBy: [{ klass: "asc" }, { number: "desc" }] });
  const current = papers.find((p) => p.id === paper) ?? papers[0];
  const rows = current ? await tellingRows(current.id) : [];
  const [follow, improved] = current ? await Promise.all([followUps(current.klass, current.subject, current.board), mostImprovedList(current.klass, current.subject)]) : [[], []];
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-[#0f3460]">Ranks (teacher-only)</h1>
        <p className="text-sm text-muted">Told personally, only to students who agreed. Never in reports, emails, group posts or offers. Cohort = same class, board, subject and paper.</p>
      </div>
      <div className="flex flex-wrap gap-1 text-xs">
        {papers.map((p) => (
          <Link key={p.id} href={`?paper=${p.id}`} className={`rounded border px-2 py-1 font-mono ${p.id === current?.id ? "border-accent bg-accent/10" : "border-line"}`}>
            {p.id}
          </Link>
        ))}
        {!papers.length && <span className="text-muted">Ranks appear once a paper is marked.</span>}
      </div>
      {current && (
        <section className="card space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-[#0f3460]">To tell: {current.id}</h2>
            <ActionButton action={ranksAction} fields={{ paperId: current.id }}>
              Recompute
            </ActionButton>
          </div>
          {rows.map((r) => (
            <div key={r.record.id} className={`flex flex-wrap items-center gap-3 rounded-lg border p-2 text-sm ${r.bottomThird ? "border-warn/50" : "border-line"}`}>
              <span className="w-48">
                <b>{r.student.name}</b> <span className="font-mono text-xs text-muted">{r.student.code}</span>
              </span>
              <span className="w-28 text-xs">
                {r.record.rank}/{r.record.cohortSize}
                {r.record.previousRank != null && ` (was ${r.record.previousRank})`}
              </span>
              <span className="flex-1">{r.sentence}</span>
              <CopyButton text={r.sentence} />
              {r.parent && (
                <a href={waLink(r.parent.whatsapp, r.sentence)} target="_blank" rel="noreferrer" className="btn px-2 py-1 text-xs">
                  wa.me ↗
                </a>
              )}
              {r.record.toldAt ? (
                <span className="text-xs text-ok">told {r.record.toldAt.toLocaleDateString("en-IN")}</span>
              ) : (
                <ActionButton action={toldAction} fields={{ rankId: r.record.id, channel: "whatsapp" }} tone="primary">
                  Mark told
                </ActionButton>
              )}
            </div>
          ))}
          {!rows.length && <p className="text-sm text-muted">Nobody to tell (cohort under the minimum, or no rank consent).</p>}
        </section>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card text-sm">
          <h2 className="mb-2 font-semibold text-[#0f3460]">Follow up</h2>
          <p className="mb-2 text-xs text-muted">Stopped submitting within two papers after a bottom-third rank.</p>
          {follow.map((s) => (
            <div key={s.id}>
              <Link href={`/exam-prep/students/${s.id}`} className="text-accent hover:underline">
                {s.name}
              </Link>
            </div>
          ))}
          {!follow.length && <p className="text-muted">No one.</p>}
        </section>
        <section className="card text-sm">
          <h2 className="mb-2 font-semibold text-[#0f3460]">Most improved (recognition, never published)</h2>
          {improved.map((x) => (
            <div key={x.student.id}>
              {x.student.name}: +{x.change} points
            </div>
          ))}
          {!improved.length && <p className="text-muted">Needs two marked papers.</p>}
        </section>
      </div>
    </div>
  );
}
