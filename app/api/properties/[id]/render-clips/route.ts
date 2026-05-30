import { NextRequest, NextResponse } from "next/server";
import { getProperty, saveProperty } from "@/lib/db";
import { getRenderer } from "@/lib/video/renderer";
import { RendererKind, Shot, shotClipFor, getActiveBeatSheet } from "@/lib/types";
import { estimateAiClipCost } from "@/lib/cost";
import { currentUserId } from "@/lib/session";
import { getUser, remainingQuota } from "@/lib/users";

export const runtime = "nodejs";
export const maxDuration = 600;

function shortError(err: unknown): string {
  // fal.ai validation errors carry a structured `body.detail` array.
  const body = (err as { body?: { detail?: Array<{ loc?: string[]; msg?: string }> } })?.body;
  if (body?.detail?.length) {
    return body.detail
      .map((d) => `${(d.loc ?? []).slice(1).join(".")}: ${d.msg}`)
      .join("; ")
      .slice(0, 300);
  }
  const raw = err instanceof Error ? err.message : String(err);
  const m = raw.match(/"message"\s*:\s*"([^"]+)"/);
  if (m) return m[1];
  return raw.length > 240 ? raw.slice(0, 240) + "…" : raw;
}

function setShotClip(shot: Shot, renderer: RendererKind, filename: string) {
  if (renderer === "ai") shot.aiClipFilename = filename;
  else shot.kenburnsClipFilename = filename;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    renderer?: RendererKind;
    limit?: number;
  };
  const renderer: RendererKind = body.renderer === "ai" ? "ai" : "kenburns";
  const limit =
    typeof body.limit === "number" && body.limit > 0 ? Math.floor(body.limit) : Infinity;

  const uid = await currentUserId();
  if (!uid) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const property = await getProperty(id);
  if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (property.ownerId && property.ownerId !== uid) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Don't let a quota-exhausted user spend on (paid) AI renders.
  if (renderer === "ai" && remainingQuota(await getUser(uid)) <= 0) {
    return NextResponse.json(
      { error: "You've used your free video for this account." },
      { status: 403 }
    );
  }
  const activeSheet = getActiveBeatSheet(property);
  if (!activeSheet) {
    return NextResponse.json({ error: "No beat sheet — run Direct first." }, { status: 400 });
  }

  property.status = "rendering_clips";
  property.error = undefined;
  await saveProperty(property);

  const renderClip = await getRenderer(renderer);
  const byId = new Map(property.assets.map((a) => [a.id, a]));
  const allShots = activeSheet.scenes.flatMap((s) => s.shots);
  const failures: string[] = [];
  let renderedThisCall = 0;

  for (const shot of allShots) {
    if (shotClipFor(shot, renderer)) continue; // resumable per-renderer
    if (renderedThisCall >= limit) break;

    const asset = byId.get(shot.assetId);
    if (!asset) {
      shot.clipError = `Missing asset ${shot.assetId}`;
      shot.clipErrorRenderer = renderer;
      failures.push(`${shot.id}: ${shot.clipError}`);
      await saveProperty(property);
      continue;
    }

    try {
      const filename = await renderClip({
        propertyId: property.id,
        shotId: shot.id,
        startFilename: asset.filename,
        startMime: asset.mimeType,
        crop: shot.crop,
        motion: shot.motion,
        motionStrength: shot.motionStrength,
        sceneDescription: asset.score?.description ?? "",
        tone: property.tone,
      });
      setShotClip(shot, renderer, filename);
      if (renderer === "ai") shot.estimatedCostUsd = estimateAiClipCost();
      if (shot.clipErrorRenderer === renderer) {
        shot.clipError = undefined;
        shot.clipErrorRenderer = undefined;
      }
      renderedThisCall++;
      await saveProperty(property);
    } catch (err) {
      shot.clipError = shortError(err);
      shot.clipErrorRenderer = renderer;
      failures.push(`${shot.id}: ${shot.clipError}`);
      await saveProperty(property);
    }
  }

  const total = allShots.length;
  const rendered = allShots.filter((s) => shotClipFor(s, renderer)).length;
  if (rendered === total) property.status = "clips_rendered";
  else if (rendered > 0) property.status = "directed";
  else property.status = "failed";
  property.error = failures.length ? failures.join(" | ") : undefined;
  await saveProperty(property);

  if (failures.length > 0) {
    return NextResponse.json({ property, error: property.error, partial: true }, { status: 207 });
  }
  return NextResponse.json({ property });
}
