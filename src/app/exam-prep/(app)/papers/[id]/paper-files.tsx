import { paperFileAction, removePaperFileAction } from "@/modules/exam-prep/actions";
import { signedLink } from "@/modules/exam-prep/adapters/storage";
import { csvPreview, PAPER_FILE_KINDS, paperFiles } from "@/modules/exam-prep/services/papers";
import { ActionButton, EpForm, Msg, Submit } from "../../../ui";

const kb = (n: number) => (n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

/** The tutor's own files for a paper: upload, view, download, keep versions, remove. */
export async function PaperFiles({ paperId, uploadOnly }: { paperId: string; uploadOnly: boolean }) {
  const files = await paperFiles(paperId);
  const csv = files.find((f) => f.kind === "paper" && f.isCurrent && f.mime === "text/csv");
  const preview = csv ? await csvPreview(csv.path) : null;
  return (
    <section className="card space-y-3">
      <h2 className="font-semibold text-[#0f3460]">Files</h2>
      <p className="text-xs text-muted">
        {uploadOnly ? "Your own paper, as you made it. " : "Optional: your own files alongside the question-built paper. "}
        Uploading the same kind again keeps the earlier file as an older version.
      </p>
      {(Object.keys(PAPER_FILE_KINDS) as (keyof typeof PAPER_FILE_KINDS)[]).map((kind) => {
        const list = files.filter((f) => f.kind === kind);
        if (!list.length) return null;
        return (
          <div key={kind} className="space-y-1 text-sm">
            <b>{PAPER_FILE_KINDS[kind]}</b>
            {list.map((f) => (
              <div key={f.id} className={`flex flex-wrap items-center gap-2 ${f.isCurrent ? "" : "opacity-60"}`}>
                <span className="flex-1">
                  {f.name} <span className="text-xs text-muted">· {kb(f.size)} · {f.uploadedAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}</span>
                  {f.isCurrent ? <span className="ml-1 rounded bg-ok/15 px-1 text-[10px] text-ok">current</span> : <span className="ml-1 text-[10px]">older version</span>}
                </span>
                <a href={signedLink(f.path)} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
                  view
                </a>
                <a href={`${signedLink(f.path)}&download=1`} className="text-xs text-accent hover:underline">
                  download
                </a>
                <ActionButton action={removePaperFileAction} fields={{ fileId: f.id, paperId }} tone="danger" confirm={`Remove ${f.name}?`}>
                  Remove
                </ActionButton>
              </div>
            ))}
          </div>
        );
      })}
      {!files.length && <p className="text-sm text-warn">No files yet.{uploadOnly ? " Upload the question paper to publish it." : ""}</p>}
      <EpForm action={paperFileAction} className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
        <input type="hidden" name="paperId" value={paperId} />
        <select name="kind" className="input w-auto">
          {Object.entries(PAPER_FILE_KINDS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <input type="file" name="file" accept=".pdf,.csv" required className="input flex-1" />
        <Submit>Upload</Submit>
        <div className="w-full">
          <Msg />
        </div>
      </EpForm>
      {preview && preview.length > 0 && (
        <div className="overflow-x-auto">
          <p className="mb-1 text-xs text-muted">Preview of {csv!.name} (first {preview.length} rows)</p>
          <table className="table text-xs">
            <tbody>
              {preview.map((r, i) => (
                <tr key={i} className={i === 0 ? "font-semibold" : ""}>
                  {r.map((c, j) => (
                    <td key={j}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
