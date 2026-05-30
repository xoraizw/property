"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RendererKind } from "@/lib/types";

export function ProduceButton({
  propertyId,
  renderer,
  totalShots,
  renderedShots,
  quotaRemaining,
}: {
  propertyId: string;
  renderer: RendererKind;
  totalShots: number;
  renderedShots: number;
  quotaRemaining: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const noQuota = quotaRemaining <= 0;
  const disabled = totalShots === 0 || busy || noQuota;
  const isAi = renderer === "ai";

  async function run() {
    setError(null);
    setBusy(true);
    try {
      // 1) Render any missing clips for the active renderer.
      setPhase(isAi ? "Rendering AI clips…" : "Rendering clips…");
      const r = await fetch(`/api/properties/${propertyId}/render-clips`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ renderer }),
      });
      const rj = await r.json().catch(() => ({}));
      // 207 = some clips failed; we still proceed to generate with what rendered.
      if (!r.ok && r.status !== 207) {
        throw new Error(rj.error || `Clip render failed (${r.status})`);
      }

      // 2) Voiceover + composite into the final video.
      setPhase("Generating video…");
      const g = await fetch(`/api/properties/${propertyId}/generate`, { method: "POST" });
      const gj = await g.json().catch(() => ({}));
      if (!g.ok) throw new Error(gj.error || `Generate failed (${g.status})`);

      if (r.status === 207) {
        setError("Some clips failed, but the video was produced from the ones that rendered.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setPhase("");
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        onClick={run}
        disabled={disabled}
        className={
          "rounded-md px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40 " +
          (isAi ? "bg-violet-600 hover:bg-violet-500" : "bg-emerald-600 hover:bg-emerald-500")
        }
        title={
          noQuota
            ? "You've used your free video for this account"
            : totalShots === 0
              ? "Generate a beat sheet first"
              : `Render ${renderer === "ai" ? "AI" : "Ken Burns"} clips and produce the final video`
        }
      >
        {busy
          ? phase || "Working…"
          : noQuota
            ? "Video used"
            : `Produce video (${isAi ? "AI" : "Ken Burns"})`}
      </button>
      <p className="text-xs text-zinc-500">
        {noQuota
          ? "You've used your free video for this account."
          : `Renders ${renderedShots}/${totalShots} clips, then voices + composites the final video.`}
      </p>
      {error ? <p className="text-xs text-red-600 max-w-xs">{error}</p> : null}
    </div>
  );
}
