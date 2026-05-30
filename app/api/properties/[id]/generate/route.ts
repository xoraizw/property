import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { getProperty, saveProperty } from "@/lib/db";
import { synthesizeLines } from "@/lib/video/tts";
import { composeFinalVideo } from "@/lib/video/compose";
import {
  DEFAULT_CAPTION_SETTINGS,
  FinalVideo,
  shotClipFor,
  getActiveBeatSheet,
} from "@/lib/types";
import { shotClipCostForRenderer } from "@/lib/cost";
import { currentUserId } from "@/lib/session";
import { getUser, saveUser, remainingQuota } from "@/lib/users";

export const runtime = "nodejs";
export const maxDuration = 600;

function shortError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.length > 400 ? raw.slice(0, 400) + "…" : raw;
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const uid = await currentUserId();
  if (!uid) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const property = await getProperty(id);
  if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (property.ownerId && property.ownerId !== uid) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Quota gate: each user may produce a limited number of final videos.
  const user = await getUser(uid);
  if (remainingQuota(user) <= 0) {
    return NextResponse.json(
      { error: "You've used your free video for this account." },
      { status: 403 }
    );
  }

  const activeSheet = getActiveBeatSheet(property);
  if (!activeSheet) {
    return NextResponse.json({ error: "No beat sheet — run Direct first." }, { status: 400 });
  }

  const renderer = property.activeRenderer ?? "kenburns";
  // Scenes that have at least one clip rendered for this renderer.
  const renderableScenes = activeSheet.scenes.filter((sc) =>
    sc.shots.some((sh) => shotClipFor(sh, renderer))
  );
  if (renderableScenes.length === 0) {
    return NextResponse.json(
      { error: `No clips rendered on the ${renderer} tab — render that tab first.` },
      { status: 400 }
    );
  }

  property.status = "rendering_audio";
  property.error = undefined;
  await saveProperty(property);

  try {
    // Stage A: TTS — one voiceover line per scene. Re-run when audio is missing
    // OR when we don't yet have word timings (needed for real-time captions).
    const needsVoice = renderableScenes.filter(
      (sc) => !sc.audioFilename || !sc.captionWords || sc.captionWords.length === 0
    );
    if (needsVoice.length > 0) {
      const tts = await synthesizeLines(
        property.id,
        activeSheet.voiceStyle,
        needsVoice.map((sc) => ({ beatId: sc.id, text: sc.voiceover }))
      );
      const byScene = new Map(tts.map((t) => [t.beatId, t]));
      for (const scene of activeSheet.scenes) {
        const r = byScene.get(scene.id);
        if (r) {
          scene.audioFilename = r.filename;
          scene.audioDurationSeconds = r.durationSeconds;
          scene.captionWords = r.words;
        }
      }
      await saveProperty(property);
    }

    // Stage B: composite.
    property.status = "compositing";
    await saveProperty(property);

    const finalFilename = await composeFinalVideo(property, renderer);
    const settingsSnapshot = {
      ...DEFAULT_CAPTION_SETTINGS,
      ...(property.captionSettings ?? {}),
    };
    const costUsd = renderableScenes
      .flatMap((sc) => sc.shots)
      .filter((sh) => shotClipFor(sh, renderer))
      .reduce((sum, sh) => sum + shotClipCostForRenderer(sh, renderer), 0);
    const newVideo: FinalVideo = {
      id: uuid(),
      filename: finalFilename,
      generatedAt: new Date().toISOString(),
      captionSettings: settingsSnapshot,
      renderer,
      beatSheetId: activeSheet.id,
      beatSheetName: activeSheet.name,
      framingMode: property.framingMode ?? "blur",
      costUsd,
    };
    property.finalVideos = [newVideo, ...(property.finalVideos ?? [])];
    // Keep the deprecated field in sync with the latest video so old UI paths
    // (and bookmarks) still resolve to a working file.
    property.finalVideoFilename = finalFilename;
    property.status = "done";
    await saveProperty(property);

    // Count this against the user's quota.
    if (user) {
      user.videosGenerated += 1;
      await saveUser(user);
    }

    return NextResponse.json({ property });
  } catch (err) {
    property.status = "failed";
    property.error = shortError(err);
    await saveProperty(property);
    return NextResponse.json({ error: property.error }, { status: 500 });
  }
}
