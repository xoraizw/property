"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Property, RendererKind, shotClipFor, getActiveBeatSheet } from "@/lib/types";

type Props = { property: Property };

export function BeatSheetView({ property }: Props) {
  const sheet = getActiveBeatSheet(property);
  const router = useRouter();
  const active: RendererKind = property.activeRenderer ?? "kenburns";
  const [switching, setSwitching] = useState(false);

  if (!sheet) return null;

  async function setActiveRenderer(next: RendererKind) {
    if (next === active) return;
    setSwitching(true);
    try {
      await fetch(`/api/properties/${property.id}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeRenderer: next }),
      });
      router.refresh();
    } finally {
      setSwitching(false);
    }
  }

  const byId = new Map(property.assets.map((a) => [a.id, a]));
  const allShots = sheet.scenes.flatMap((s) => s.shots);
  const totalShots = allShots.length;
  const renderedKB = allShots.filter((s) => s.kenburnsClipFilename).length;
  const renderedAI = allShots.filter((s) => s.aiClipFilename).length;
  const plannedSecs = allShots.reduce((s, sh) => s + (sh.durationSeconds || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div>
          <span className="text-zinc-500">Hook:</span>{" "}
          <span className="font-medium">{sheet.hookLine}</span>
        </div>
        <div>
          <span className="text-zinc-500">Voice:</span> {sheet.voiceStyle}
        </div>
        <div>
          <span className="text-zinc-500">Scenes:</span> {sheet.scenes.length} ·{" "}
          <span className="text-zinc-500">Shots:</span> {totalShots} · ~{plannedSecs.toFixed(0)}s
        </div>
      </div>

      {/* Renderer tabs */}
      <div className="flex border-b border-zinc-200 dark:border-zinc-800">
        <TabButton active={active === "kenburns"} onClick={() => setActiveRenderer("kenburns")} disabled={switching}>
          <span className="font-medium">Ken Burns</span>
          <span className="ml-2 text-xs text-zinc-500">free · local</span>
          <CountBadge done={renderedKB} total={totalShots} />
        </TabButton>
        <TabButton active={active === "ai"} onClick={() => setActiveRenderer("ai")} disabled={switching}>
          <span className="font-medium">AI Video</span>
          <span className="ml-2 text-xs text-zinc-500">fal.ai · paid</span>
          <CountBadge done={renderedAI} total={totalShots} />
        </TabButton>
      </div>

      {/* Scenes → shots */}
      <ol className="space-y-4">
        {sheet.scenes.map((scene, si) => (
          <li
            key={scene.id}
            className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="text-xs font-mono text-zinc-500">#{si + 1}</span>
              <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-xs font-medium dark:bg-zinc-800">
                {scene.label}
              </span>
              <span className="text-xs text-zinc-500">{scene.shots.length} shots</span>
            </div>
            <p className="italic text-sm text-zinc-700 dark:text-zinc-300 mb-1">“{scene.voiceover}”</p>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 mb-2">
              {scene.caption}
            </p>
            <div className="flex gap-2 flex-wrap">
              {scene.shots.map((shot) => {
                const asset = byId.get(shot.assetId);
                const clip = shotClipFor(shot, active);
                return (
                  <div key={shot.id} className="w-28">
                    <div className="relative">
                      {clip ? (
                        <video
                          src={`/api/file/${property.id}/clips/${encodeURIComponent(clip)}`}
                          controls
                          muted
                          playsInline
                          className="h-20 w-28 rounded bg-black object-cover ring-2 ring-emerald-400"
                        />
                      ) : asset ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={`/api/file/${property.id}/raw/${encodeURIComponent(asset.filename)}`}
                          alt=""
                          className="h-20 w-28 rounded object-cover opacity-90"
                        />
                      ) : (
                        <div className="h-20 w-28 rounded bg-red-100 text-[10px] flex items-center justify-center text-red-700">
                          missing
                        </div>
                      )}
                    </div>
                    <div className="mt-1 text-[10px] text-zinc-500 leading-tight">
                      {shot.motion.replace(/_/g, " ")} · {shot.crop} · {shot.durationSeconds.toFixed(1)}s
                    </div>
                    {shot.clipError && shot.clipErrorRenderer === active ? (
                      <div className="text-[10px] text-red-600">err</div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ol>

      <div className="text-sm rounded bg-zinc-100 p-3 dark:bg-zinc-950">
        <span className="text-zinc-500">CTA:</span>{" "}
        <span className="font-medium">{sheet.closingCta}</span>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        "px-4 py-2.5 text-sm flex items-center border-b-2 -mb-px transition-colors " +
        (active
          ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
          : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300")
      }
    >
      {children}
    </button>
  );
}

function CountBadge({ done, total }: { done: number; total: number }) {
  const complete = done === total && total > 0;
  return (
    <span
      className={
        "ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-mono " +
        (complete
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
          : done > 0
            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400")
      }
    >
      {done}/{total}
    </span>
  );
}
