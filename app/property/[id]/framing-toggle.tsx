"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FramingMode } from "@/lib/types";

export function FramingToggle({
  propertyId,
  value,
}: {
  propertyId: string;
  value: FramingMode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function set(next: FramingMode) {
    if (next === value || busy) return;
    setBusy(true);
    try {
      await fetch(`/api/properties/${propertyId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ framingMode: next }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-zinc-500">Framing (AI clips)</div>
      <div className="flex rounded-md border border-zinc-300 dark:border-zinc-700 overflow-hidden text-xs">
        <button
          type="button"
          onClick={() => set("blur")}
          disabled={busy}
          className={
            "px-3 py-1.5 " +
            (value !== "fill"
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "bg-white dark:bg-zinc-950")
          }
        >
          Blurred bars
        </button>
        <button
          type="button"
          onClick={() => set("fill")}
          disabled={busy}
          className={
            "px-3 py-1.5 border-l border-zinc-300 dark:border-zinc-700 " +
            (value === "fill"
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "bg-white dark:bg-zinc-950")
          }
        >
          Full frame
        </button>
      </div>
      <p className="text-xs text-zinc-500 max-w-xs">
        {value === "fill"
          ? "Fills the 9:16 frame; crops the sides of each shot."
          : "Whole shot visible with a soft blurred background."}
        {" "}No re-render needed — applies on the next produce.
      </p>
    </div>
  );
}
