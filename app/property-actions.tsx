"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeletePropertyButton({
  propertyId,
  propertyName,
  variant = "row",
  redirectHome = false,
}: {
  propertyId: string;
  propertyName: string;
  variant?: "row" | "header";
  redirectHome?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (
      !confirm(
        `Delete "${propertyName}"? This removes all photos, clips, audio, and rendered videos for this property.`
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error || `Failed (${res.status})`);
        return;
      }
      if (redirectHome) router.push("/");
      else router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (variant === "header") {
    return (
      <button
        onClick={remove}
        disabled={busy}
        className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/30"
      >
        {busy ? "Deleting…" : "Delete property"}
      </button>
    );
  }
  return (
    <button
      onClick={remove}
      disabled={busy}
      aria-label="Delete property"
      title="Delete property"
      className="h-7 w-7 rounded-full bg-zinc-200 text-zinc-500 hover:bg-red-600 hover:text-white disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-400"
    >
      ×
    </button>
  );
}
