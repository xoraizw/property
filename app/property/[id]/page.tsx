import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getProperty } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { getUser, remainingQuota } from "@/lib/users";
import { rawAssetUrl } from "@/lib/storage";
import { ScoreButton } from "./score-button";
import { DirectButton } from "./direct-button";
import { ProduceButton } from "./produce-button";
import { FramingToggle } from "./framing-toggle";
import { BeatSheetView } from "./beat-sheet-view";
import { FinalVideosList } from "./final-videos";
import { VariationsBar } from "./variations-bar";
import { DeletePropertyButton } from "../../property-actions";
import {
  FinalVideo,
  RendererKind,
  shotClipFor,
  getActiveBeatSheet,
} from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PropertyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const uid = await currentUserId();
  if (!uid) redirect("/login");
  const property = await getProperty(id);
  if (!property) notFound();
  if (property.ownerId && property.ownerId !== uid) notFound();
  const remaining = remainingQuota(await getUser(uid));

  const totalAssets = property.assets.length;
  const scoredCount = property.assets.filter((a) => a.score).length;
  const activeRenderer: RendererKind = property.activeRenderer ?? "kenburns";
  const sheets = property.beatSheets ?? [];
  const activeSheet = getActiveBeatSheet(property);
  const activeShots = activeSheet?.scenes.flatMap((s) => s.shots) ?? [];
  const totalBeats = activeShots.length; // total shots in the active variation
  const renderedActive = activeShots.filter((s) => shotClipFor(s, activeRenderer)).length;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <main className="mx-auto max-w-6xl px-6 py-10 space-y-8">
        <div>
          <Link href="/" className="text-sm text-zinc-500 hover:underline">
            ← All properties
          </Link>
        </div>

        {/* Header: title + status + step indicator. */}
        <header className="space-y-3">
          <div className="flex items-baseline justify-between gap-4">
            <h1 className="text-2xl font-semibold tracking-tight">{property.name}</h1>
            <div className="flex items-center gap-3">
              <p className="text-xs text-zinc-500">
                {property.tone} · status:{" "}
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  {property.status}
                </span>
              </p>
              <DeletePropertyButton
                propertyId={property.id}
                propertyName={property.name}
                variant="header"
                redirectHome
              />
            </div>
          </div>
          {property.error ? (
            <p className="text-xs text-red-600 break-all">{property.error}</p>
          ) : null}
          <Stepper
            scored={scoredCount}
            total={totalAssets}
            beats={totalBeats}
            clipsActive={renderedActive}
            activeRenderer={activeRenderer}
            finals={property.finalVideos?.length ?? (property.finalVideoFilename ? 1 : 0)}
          />
        </header>

        {/* Step 1 — Photos. Action: Score. */}
        <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <SectionHeader
            title="1 · Photos"
            subtitle={`${totalAssets} uploaded · ${scoredCount} scored`}
            action={<ScoreButton propertyId={property.id} />}
          />
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mt-4">
            {property.assets.map((asset) => {
              const url = rawAssetUrl(property.id, asset.filename);
              const s = asset.score;
              return (
                <div
                  key={asset.id}
                  className="rounded-md overflow-hidden border border-zinc-200 dark:border-zinc-800"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="w-full h-24 object-cover" />
                  <div className="px-2 py-1 text-[10px] flex items-center justify-between">
                    <span className="truncate text-zinc-500">
                      {s ? s.roomType : "unscored"}
                    </span>
                    {s ? (
                      <span
                        className={
                          "rounded px-1 font-mono " +
                          (s.quality >= 7
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                            : s.quality >= 4
                              ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                              : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300")
                        }
                      >
                        {s.quality.toFixed(0)}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Step 2 — Beat sheet variations. Each variation has its own beats + clips. */}
        <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <SectionHeader
            title="2 · Beat sheet variations"
            subtitle={
              activeSheet
                ? `${sheets.length} variation${sheets.length === 1 ? "" : "s"} · viewing "${activeSheet.name}" (${activeSheet.scenes.length} scenes, ${totalBeats} shots)`
                : "Use Direct to write your first script"
            }
            action={
              <DirectButton
                propertyId={property.id}
                scoredCount={scoredCount}
                totalCount={totalAssets}
                existingCount={sheets.length}
              />
            }
          />
          {sheets.length > 0 ? (
            <div className="mt-4">
              <VariationsBar
                propertyId={property.id}
                sheets={sheets}
                activeId={activeSheet?.id ?? ""}
              />
            </div>
          ) : null}
          <div className="mt-4">
            {activeSheet ? (
              <BeatSheetView property={property} />
            ) : (
              <p className="text-sm text-zinc-500">
                Score photos, then click Direct video to generate the first beat sheet.
                You can add more variations later — each one will use the same photos but
                with a different angle and script.
              </p>
            )}
          </div>
        </section>

        {/* Step 3 — Produce: render clips for the active renderer + composite. */}
        {activeSheet ? (
          <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <SectionHeader
              title="3 · Produce video"
              subtitle={
                (activeRenderer === "ai"
                  ? "Renders fal.ai clips (uses credits), then voices + composites"
                  : "Renders Ken Burns clips locally (free), then voices + composites") +
                ` · "${activeSheet.name}"`
              }
              action={
                <ProduceButton
                  propertyId={property.id}
                  renderer={activeRenderer}
                  totalShots={totalBeats}
                  renderedShots={renderedActive}
                  quotaRemaining={remaining}
                />
              }
            />
            <div className="mt-4">
              <FramingToggle
                propertyId={property.id}
                value={property.framingMode ?? "blur"}
              />
            </div>
          </section>
        ) : null}

        {/* Step 5 — Output. */}
        {(() => {
          const list: FinalVideo[] = property.finalVideos ?? [];
          if (list.length === 0 && property.finalVideoFilename) {
            list.push({
              id: "legacy",
              filename: property.finalVideoFilename,
              generatedAt: property.updatedAt,
            });
          }
          return <FinalVideosList propertyId={property.id} videos={list} />;
        })()}
      </main>
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-lg font-medium">{title}</h2>
        {subtitle ? <p className="text-xs text-zinc-500 mt-0.5">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

function Stepper({
  scored,
  total,
  beats,
  clipsActive,
  activeRenderer,
  finals,
}: {
  scored: number;
  total: number;
  beats: number;
  clipsActive: number;
  activeRenderer: RendererKind;
  finals: number;
}) {
  const steps = [
    { label: "Photos", value: `${total}`, done: total > 0 },
    { label: "Scored", value: `${scored}/${total}`, done: scored > 0 },
    { label: "Shots", value: `${beats}`, done: beats > 0 },
    {
      label: `Clips (${activeRenderer === "ai" ? "AI" : "KB"})`,
      value: `${clipsActive}/${beats}`,
      done: clipsActive > 0,
    },
    { label: "Videos", value: `${finals}`, done: finals > 0 },
  ];
  return (
    <ol className="flex items-center gap-2 overflow-x-auto text-xs">
      {steps.map((s, i) => (
        <li
          key={s.label}
          className={
            "flex items-center gap-2 rounded-md border px-3 py-1.5 whitespace-nowrap " +
            (s.done
              ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300"
              : "border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950")
          }
        >
          <span className="font-medium">{s.label}</span>
          <span className="font-mono">{s.value}</span>
          {i < steps.length - 1 ? <span className="text-zinc-400">→</span> : null}
        </li>
      ))}
    </ol>
  );
}
