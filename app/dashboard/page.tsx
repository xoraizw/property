import Link from "next/link";
import { redirect } from "next/navigation";
import { listProperties } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { formatUsd } from "@/lib/cost";
import { FinalVideo, Property } from "@/lib/types";

export const dynamic = "force-dynamic";

interface VideoRow {
  property: Property;
  video: FinalVideo;
}

export default async function DashboardPage() {
  const uid = await currentUserId();
  if (!uid) redirect("/login");
  const properties = await listProperties(uid);

  // Flatten every saved final video across every property into one timeline,
  // newest first. Skips properties that have nothing rendered yet.
  const rows: VideoRow[] = properties.flatMap((p) =>
    (p.finalVideos ?? []).map((v) => ({ property: p, video: v }))
  );
  rows.sort((a, b) => b.video.generatedAt.localeCompare(a.video.generatedAt));

  const totalCost = rows.reduce((s, r) => s + (r.video.costUsd ?? 0), 0);
  const aiVideos = rows.filter((r) => r.video.renderer === "ai");
  const kbVideos = rows.filter((r) => r.video.renderer !== "ai");
  const aiCost = aiVideos.reduce((s, r) => s + (r.video.costUsd ?? 0), 0);

  // Group spend by day for the simple sparkline.
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const day = r.video.generatedAt.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + (r.video.costUsd ?? 0));
  }
  const dailySpend = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14); // last 14 days
  const maxDaily = Math.max(0.01, ...dailySpend.map(([, v]) => v));

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <main className="mx-auto max-w-6xl px-6 py-10 space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Every final video rendered across all properties, with estimated cost.
            </p>
          </div>
          <Link
            href="/"
            className="text-sm text-zinc-500 hover:underline"
          >
            ← Properties
          </Link>
        </header>

        {/* Top-line metrics. */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Metric label="Total spent (est.)" value={formatUsd(totalCost)} accent="amber" />
          <Metric label="Total videos" value={String(rows.length)} />
          <Metric label="AI videos" value={`${aiVideos.length} · ${formatUsd(aiCost)}`} accent="violet" />
          <Metric label="Ken Burns videos" value={`${kbVideos.length} · free`} accent="emerald" />
        </section>

        {/* 14-day spend sparkline. */}
        {dailySpend.length > 0 ? (
          <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-sm font-medium text-zinc-500 mb-3">Last 14 days</h2>
            <div className="flex items-end gap-1.5 h-24">
              {dailySpend.map(([day, amt]) => {
                const h = Math.max(2, Math.round((amt / maxDaily) * 96));
                return (
                  <div key={day} className="flex flex-col items-center flex-1 gap-1">
                    <div className="text-[10px] text-zinc-500 font-mono">
                      {amt > 0 ? formatUsd(amt) : ""}
                    </div>
                    <div
                      className="w-full bg-amber-400 dark:bg-amber-500 rounded-sm"
                      style={{ height: `${h}px` }}
                      title={`${day}: ${formatUsd(amt)}`}
                    />
                    <div className="text-[10px] text-zinc-500">{day.slice(5)}</div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {/* Per-video table. */}
        <section className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 overflow-hidden">
          <header className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
            <h2 className="text-lg font-medium">All videos</h2>
          </header>
          {rows.length === 0 ? (
            <p className="px-6 py-8 text-sm text-zinc-500">
              No videos rendered yet. Go to a property and click <em>Generate video</em>.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 dark:bg-zinc-950 text-zinc-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-6 py-2 font-medium">Property</th>
                    <th className="text-left px-3 py-2 font-medium">Variation</th>
                    <th className="text-left px-3 py-2 font-medium">Renderer</th>
                    <th className="text-right px-3 py-2 font-medium">Cost</th>
                    <th className="text-left px-3 py-2 font-medium">Generated</th>
                    <th className="px-6 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ property, video }) => (
                    <tr
                      key={video.id}
                      className="border-t border-zinc-200 dark:border-zinc-800"
                    >
                      <td className="px-6 py-2.5">
                        <Link
                          href={`/property/${property.id}`}
                          className="font-medium hover:underline"
                        >
                          {property.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-zinc-600 dark:text-zinc-400">
                        {video.beatSheetName ?? "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <RendererBadge renderer={video.renderer} />
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono">
                        {formatUsd(video.costUsd ?? 0)}
                      </td>
                      <td className="px-3 py-2.5 text-zinc-500">
                        {new Date(video.generatedAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-2.5 text-right">
                        <a
                          href={`/api/file/${property.id}/final/${encodeURIComponent(video.filename)}`}
                          className="text-zinc-500 hover:underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          open
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-medium">
                    <td className="px-6 py-2.5" colSpan={3}>
                      Total
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono">
                      {formatUsd(totalCost)}
                    </td>
                    <td className="px-3 py-2.5" colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        <p className="text-xs text-zinc-500">
          Costs are estimates based on LTX-Video-13B-distilled fal.ai pricing
          (~$0.10 per single clip, ~$0.15 per start/end keyframe clip). Actual
          billing on fal.ai may differ slightly.
        </p>
      </main>
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "amber" | "violet" | "emerald";
}) {
  const accentClass =
    accent === "amber"
      ? "text-amber-700 dark:text-amber-300"
      : accent === "violet"
        ? "text-violet-700 dark:text-violet-300"
        : accent === "emerald"
          ? "text-emerald-700 dark:text-emerald-300"
          : "";
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={"text-xl font-semibold mt-1 " + accentClass}>{value}</div>
    </div>
  );
}

function RendererBadge({ renderer }: { renderer?: string }) {
  if (renderer === "ai") {
    return (
      <span className="rounded px-1.5 py-0.5 text-xs bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
        AI · fal.ai
      </span>
    );
  }
  return (
    <span className="rounded px-1.5 py-0.5 text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
      Ken Burns
    </span>
  );
}
