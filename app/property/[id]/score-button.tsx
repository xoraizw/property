"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface PropShape {
  status?: string;
  assets: Array<{ score?: unknown }>;
}

export function ScoreButton({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ scored: number; total: number } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll the property GET endpoint while a score job is running so the user
  // sees scored count tick up live. Stops when busy goes false.
  useEffect(() => {
    if (!busy) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }
    const tick = async () => {
      try {
        const res = await fetch(`/api/properties/${propertyId}`, { cache: "no-store" });
        if (!res.ok) return;
        const { property } = (await res.json()) as { property: PropShape };
        const scored = property.assets.filter((a) => a.score).length;
        setProgress({ scored, total: property.assets.length });
      } catch {
        /* ignore network blips during polling */
      }
    };
    tick();
    pollRef.current = setInterval(tick, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [busy, propertyId]);

  async function run() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}/score`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setError("A scoring run is already in progress — wait for it to finish.");
      } else if (res.status === 207) {
        setError(`Some photos failed — click again to retry. ${j.error ?? ""}`);
      } else if (!res.ok) {
        throw new Error(j.error || `Failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const pct =
    progress && progress.total > 0
      ? Math.round((progress.scored / progress.total) * 100)
      : 0;

  return (
    <div className="flex flex-col items-end gap-2 min-w-[220px]">
      <button
        onClick={run}
        disabled={busy}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {busy
          ? progress
            ? `Scoring ${progress.scored}/${progress.total}…`
            : "Scoring…"
          : "Score photos"}
      </button>
      {busy && progress ? (
        <div className="w-full h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
          <div
            className="h-full bg-emerald-500 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
      {error ? <p className="text-xs text-red-600 max-w-xs break-words">{error}</p> : null}
    </div>
  );
}
