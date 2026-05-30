"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function UploadForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const form = new FormData(e.currentTarget);
      const res = await fetch("/api/properties", { method: "POST", body: form });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Upload failed (${res.status})`);
      }
      const { property } = (await res.json()) as { property: { id: string } };
      router.push(`/property/${property.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">Property name</label>
        <input
          name="name"
          required
          placeholder="e.g. 123 Pine St"
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Tone</label>
        <select
          name="tone"
          defaultValue="luxury"
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        >
          <option value="luxury">Luxury</option>
          <option value="family">Family-friendly</option>
          <option value="investor">Investor</option>
        </select>
        <p className="text-xs text-zinc-500 mt-1">
          You&apos;ll pick the video length when creating each beat-sheet variation.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Photos</label>
        <input
          name="photos"
          type="file"
          multiple
          accept="image/*"
          required
          className="w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-zinc-900 file:px-3 file:py-2 file:text-white dark:file:bg-zinc-100 dark:file:text-zinc-900"
        />
        <p className="text-xs text-zinc-500 mt-1">10–60 photos works best.</p>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {busy ? "Uploading…" : "Create property"}
      </button>
    </form>
  );
}
