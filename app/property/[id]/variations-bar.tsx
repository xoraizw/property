"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BeatSheet, shotClipFor } from "@/lib/types";

export function VariationsBar({
  propertyId,
  sheets,
  activeId,
}: {
  propertyId: string;
  sheets: BeatSheet[];
  activeId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  async function activate(id: string) {
    if (id === activeId) return;
    setPending(id);
    try {
      await fetch(`/api/properties/${propertyId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeBeatSheetId: id }),
      });
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this variation? Its clips and audio will be removed.")) return;
    setPending(id);
    try {
      const res = await fetch(`/api/properties/${propertyId}/beat-sheets/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error || `Failed (${res.status})`);
      }
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  async function saveRename(id: string) {
    const name = renameValue.trim();
    if (!name) {
      setRenaming(null);
      return;
    }
    setPending(id);
    try {
      await fetch(`/api/properties/${propertyId}/beat-sheets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      router.refresh();
    } finally {
      setPending(null);
      setRenaming(null);
    }
  }

  if (sheets.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 items-center">
      {sheets.map((s) => {
        const active = s.id === activeId;
        const shots = (s.scenes ?? []).flatMap((sc) => sc.shots);
        const kb = shots.filter((sh) => shotClipFor(sh, "kenburns")).length;
        const ai = shots.filter((sh) => shotClipFor(sh, "ai")).length;
        const total = shots.length;
        const isRenaming = renaming === s.id;
        return (
          <div
            key={s.id}
            className={
              "group flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition " +
              (active
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300")
            }
          >
            {isRenaming ? (
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => saveRename(s.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveRename(s.id);
                  if (e.key === "Escape") setRenaming(null);
                }}
                className="bg-transparent border-b border-current outline-none text-sm w-32"
              />
            ) : (
              <button
                onClick={() => activate(s.id)}
                onDoubleClick={() => {
                  setRenaming(s.id);
                  setRenameValue(s.name);
                }}
                disabled={pending === s.id}
                title="Click to switch · Double-click to rename"
                className="font-medium"
              >
                {s.name}
                {s.targetSeconds ? (
                  <span
                    className={
                      "ml-1.5 font-mono text-[10px] " +
                      (active ? "opacity-70" : "text-zinc-400")
                    }
                  >
                    {s.targetSeconds}s
                  </span>
                ) : null}
              </button>
            )}
            <span
              className={
                "rounded-full px-1.5 py-0.5 text-[10px] font-mono " +
                (active
                  ? "bg-white/15 text-white dark:bg-black/15 dark:text-zinc-900"
                  : "bg-zinc-100 dark:bg-zinc-800")
              }
              title={`Ken Burns ${kb}/${total} · AI ${ai}/${total}`}
            >
              KB {kb}/{total} · AI {ai}/{total}
            </span>
            {sheets.length > 1 ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  remove(s.id);
                }}
                disabled={pending === s.id}
                aria-label="Delete variation"
                title="Delete variation"
                className={
                  "rounded-full h-5 w-5 text-xs flex items-center justify-center " +
                  (active
                    ? "bg-white/20 hover:bg-red-600 text-white"
                    : "bg-zinc-200 hover:bg-red-600 hover:text-white dark:bg-zinc-800 text-zinc-500")
                }
              >
                ×
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
