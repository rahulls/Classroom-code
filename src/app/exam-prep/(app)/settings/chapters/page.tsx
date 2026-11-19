import Link from "next/link";
import { chaptersAction } from "@/modules/exam-prep/actions";
import { epdb } from "@/modules/exam-prep/db";
import { EpForm, Msg, Submit } from "../../../ui";

export const metadata = { title: "Chapter lists" };

/** Per class, subject and board, in syllabus order. CBSE is seeded from NCERT; other boards start as editable copies. */
export default async function ChaptersPage({ searchParams }: { searchParams: Promise<{ k?: string }> }) {
  const { k } = await searchParams;
  const lists = await epdb.chapterList.findMany({ orderBy: [{ klass: "asc" }, { subject: "asc" }, { board: "asc" }] });
  const cur = lists.find((l) => `${l.klass}|${l.subject}|${l.board}` === k) ?? lists[0];
  return (
    <div className="space-y-4">
      <Link href="/exam-prep/settings" className="text-sm text-accent hover:underline">
        ← Settings
      </Link>
      <h1 className="text-2xl font-bold text-[#0f3460]">Chapter lists</h1>
      <div className="flex flex-wrap gap-1 text-xs">
        {lists.map((l) => (
          <Link key={l.id} href={`?k=${encodeURIComponent(`${l.klass}|${l.subject}|${l.board}`)}`} className={`rounded border px-2 py-1 ${l.id === cur?.id ? "border-accent bg-accent/10" : "border-line"}`}>
            {l.klass} {l.subject} {l.board}
          </Link>
        ))}
      </div>
      {cur && (
        <EpForm action={chaptersAction} reset={false} className="card space-y-2">
          <Msg />
          <input type="hidden" name="klass" value={cur.klass} />
          <input type="hidden" name="subject" value={cur.subject} />
          <input type="hidden" name="board" value={cur.board} />
          <p className="text-sm">
            Class {cur.klass} {cur.subject} · {cur.board}: one chapter per line, in syllabus order (ties in analytics are broken by this order).
          </p>
          <textarea name="chapters" defaultValue={cur.chapters.join("\n")} rows={Math.max(10, cur.chapters.length + 2)} className="input font-mono text-sm" />
          <Submit>Save</Submit>
        </EpForm>
      )}
      {!lists.length && <p className="card text-sm text-muted">Run the seed: npm run exam-prep:seed</p>}
    </div>
  );
}
