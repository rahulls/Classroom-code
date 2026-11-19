"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { discardCsvAction, markVideoAction } from "@/modules/chaos/actions";
import type { CsvEntry } from "@/modules/chaos/jobs";
import { CsvTable } from "./csv-table";
import { YoutubePanel } from "../videos/[id]/youtube-panel";
import type { Marks, OnMark } from "./parts";
import { VideoTable, type VideoRow } from "./video-table";


const send = (action: typeof markVideoAction, fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return action(undefined, fd);
};

/** The two dashboard views (CSV files / videos) sharing one set of ticks. */
export function Dashboard({
  rows,
  csvs,
  initialTab,
  youtube,
}: {
  rows: VideoRow[];
  csvs: CsvEntry[];
  initialTab: "csv" | "videos";
  youtube: { configured: boolean; connected: boolean; channelTitle: string | null };
}) {
  const router = useRouter();
  const [tab, setTab] = useState(initialTab);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const uploadRow = rows.find((r) => r.id === uploadId && r.publish);
  const [marks, setMarks] = useState<Marks>(() => Object.fromEntries(rows.map((r) => [r.id, { uploaded: r.uploadedMark, discarded: r.discarded }])));
  const [csvDiscarded, setCsvDiscarded] = useState<Record<string, boolean>>(() => Object.fromEntries(csvs.map((c) => [c.name, c.discarded])));
  const [error, setError] = useState("");

  // Ticks change at once; they go back if the server refuses
  const onMark: OnMark = (id, mark, value) => {
    setError("");
    setMarks((m) => ({ ...m, [id]: { ...m[id], [mark]: value } }));
    send(markVideoAction, { id, mark, value: value ? "1" : "0" }).then((res) => {
      if (res?.ok) return;
      setMarks((m) => ({ ...m, [id]: { ...m[id], [mark]: !value } }));
      setError(res && !res.ok ? res.error : "Couldn't save the tick.");
    });
  };
  const onDiscardCsv = (name: string, value: boolean) => {
    setError("");
    setCsvDiscarded((m) => ({ ...m, [name]: value }));
    send(discardCsvAction, { name, value: value ? "1" : "0" }).then((res) => {
      if (res?.ok) return;
      setCsvDiscarded((m) => ({ ...m, [name]: !value }));
      setError(res && !res.ok ? res.error : "Couldn't save the tick.");
    });
  };

  const pick = (t: "csv" | "videos") => {
    setTab(t);
    window.history.replaceState(null, "", t === "csv" ? "?" : "?tab=videos");
  };
  const tabClass = (t: string) =>
    `rounded-t-lg border-b-2 px-4 py-2 text-sm font-semibold ${tab === t ? "border-[#7a2fc0] text-[#2a1260]" : "border-transparent text-muted hover:text-[#7a2fc0]"}`;

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-line" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "csv"} className={tabClass("csv")} onClick={() => pick("csv")}>
          CSV files ({csvs.length})
        </button>
        <button type="button" role="tab" aria-selected={tab === "videos"} className={tabClass("videos")} onClick={() => pick("videos")}>
          Videos ({rows.length})
        </button>
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
      {tab === "csv" ? (
        <CsvTable csvs={csvs} rows={rows} marks={marks} onMark={onMark} csvDiscarded={csvDiscarded} onDiscardCsv={onDiscardCsv} onUpload={setUploadId} />
      ) : (
        <VideoTable rows={rows} marks={marks} onMark={onMark} onUpload={setUploadId} />
      )}
      {uploadRow?.publish && (
        <UploadDialog
          title={uploadRow.title}
          format={uploadRow.format}
          onClose={() => {
            setUploadId(null);
            router.refresh(); // shows "Uploading" / "Uploaded" in the tables
          }}
        >
          <YoutubePanel
            id={uploadRow.id}
            configured={youtube.configured}
            connected={youtube.connected}
            channelTitle={youtube.channelTitle}
            hasThumb={!!uploadRow.thumb}
            thumbUrl={uploadRow.thumb ? `/chaos/videos/${uploadRow.id}/thumbnail?v=${uploadRow.thumb}` : null}
            initial={uploadRow.publish.upload}
            defaults={uploadRow.publish.defaults}
            music={uploadRow.publish.music}
            onUploaded={() => setMarks((m) => ({ ...m, [uploadRow.id]: { ...m[uploadRow.id], uploaded: true } }))}
          />
        </UploadDialog>
      )}
    </div>
  );
}

/** A centred window over the dashboard; Esc or the backdrop closes it (an upload keeps going). */
function UploadDialog({ title, format, onClose, children }: { title: string; format: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose} role="presentation">
      <div role="dialog" aria-modal="true" aria-label={`Upload ${title}`} className="my-8 w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between rounded-t-xl bg-[#2a1260] px-4 py-2 text-white">
          <span className="text-sm font-semibold">
            {title} · {format === "shorts" ? "Shorts" : "YouTube"}
          </span>
          <button type="button" onClick={onClose} className="rounded px-2 text-lg leading-none hover:bg-white/10" aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
