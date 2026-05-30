"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Seconds = 30 | 45;

export function DirectButton({
  propertyId,
  scoredCount,
  totalCount,
  existingCount,
}: {
  propertyId: string;
  scoredCount: number;
  totalCount: number;
  existingCount: number;
}) {
  const router = useRouter();
  const [duration, setDuration] = useState<Seconds>(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const partial = scoredCount > 0 && scoredCount < totalCount;
  const disabled = scoredCount === 0 || busy;

  async function run() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}/direct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetSeconds: duration }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `Failed (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const label = existingCount === 0 ? "Direct video" : "+ New variation";

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <div
          role="radiogroup"
          aria-label="Variation length"
          className="flex rounded-md border border-zinc-300 dark:border-zinc-700 overflow-hidden text-xs"
        >
          {[30, 45].map((sec) => (
            <button
              key={sec}
              type="button"
              role="radio"
              aria-checked={duration === sec}
              onClick={() => setDuration(sec as Seconds)}
              disabled={busy}
              className={
                "px-2.5 py-1.5 font-medium transition-colors " +
                (duration === sec
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "bg-white hover:bg-zinc-100 dark:bg-zinc-950 dark:hover:bg-zinc-800")
              }
            >
              {sec}s
            </button>
          ))}
        </div>
        <button
          onClick={run}
          disabled={disabled}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
          title={
            scoredCount === 0
              ? "Score at least one photo first"
              : existingCount === 0
                ? partial
                  ? `Proceed with ${scoredCount} / ${totalCount} scored photos`
                  : `Generate a ${duration}s beat sheet`
                : `Generate another ${duration}s variation with a different angle`
          }
        >
          {busy
            ? "Directing…"
            : existingCount === 0 && partial
              ? `Direct ${duration}s (${scoredCount}/${totalCount})`
              : `${label}`}
        </button>
      </div>
      {error ? <p className="text-xs text-red-600 max-w-xs">{error}</p> : null}
    </div>
  );
}
