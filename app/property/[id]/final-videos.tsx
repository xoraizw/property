"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FinalVideo } from "@/lib/types";

export function FinalVideosList({
  propertyId,
  videos,
}: {
  propertyId: string;
  videos: FinalVideo[];
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (videos.length === 0) return null;

  async function remove(videoId: string) {
    if (!confirm("Delete this video?")) return;
    setPendingId(videoId);
    try {
      const res = await fetch(`/api/properties/${propertyId}/final-videos/${videoId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error || `Failed (${res.status})`);
      }
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-lg font-medium mb-3">Final videos ({videos.length})</h2>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {videos.map((v) => {
          const url = `/api/file/${propertyId}/final/${encodeURIComponent(v.filename)}`;
          const cs = v.captionSettings;
          return (
            <li
              key={v.id}
              className="relative rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <button
                onClick={() => remove(v.id)}
                disabled={pendingId === v.id}
                aria-label="Delete video"
                title="Delete video"
                className="absolute top-2 right-2 z-10 h-7 w-7 rounded-full bg-black/70 text-white text-sm hover:bg-red-600 disabled:opacity-50"
              >
                ×
              </button>
              <video
                src={url}
                controls
                playsInline
                className="rounded-md bg-black w-full aspect-[9/16]"
              />
              <div className="mt-2 text-xs text-zinc-500 space-y-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {v.beatSheetName ? (
                    <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                      {v.beatSheetName}
                    </span>
                  ) : null}
                  {v.renderer ? (
                    <span
                      className={
                        "rounded px-1.5 py-0.5 " +
                        (v.renderer === "ai"
                          ? "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                          : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300")
                      }
                    >
                      {v.renderer === "ai" ? "AI" : "Ken Burns"}
                    </span>
                  ) : null}
                </div>
                <div>{new Date(v.generatedAt).toLocaleString()}</div>
                {cs ? (
                  <div className="text-zinc-400">
                    {cs.fontFamily} · {cs.fontSize}px
                    {cs.bold ? " · bold" : ""}
                    {cs.underline ? " · underline" : ""} · {cs.positionMode}
                  </div>
                ) : null}
                <a
                  href={url}
                  download
                  className="inline-block mt-1 rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  Download
                </a>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
