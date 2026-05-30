import { NextRequest, NextResponse } from "next/server";
import { getProperty, saveProperty } from "@/lib/db";
import { audioKey, clipKey, removeObject } from "@/lib/storage";

export const runtime = "nodejs";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; bsId: string }> }
) {
  const { id, bsId } = await ctx.params;
  const property = await getProperty(id);
  if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const sheets = property.beatSheets ?? [];
  const idx = sheets.findIndex((s) => s.id === bsId);
  if (idx === -1) {
    return NextResponse.json({ error: "Beat sheet not found" }, { status: 404 });
  }

  // Remove this variation's clip + audio files from Supabase Storage.
  const removed = sheets[idx];
  const keysToRemove: string[] = [];
  for (const scene of removed.scenes ?? []) {
    if (scene.audioFilename) keysToRemove.push(audioKey(property.id, scene.audioFilename));
    for (const shot of scene.shots) {
      if (shot.kenburnsClipFilename)
        keysToRemove.push(clipKey(property.id, shot.kenburnsClipFilename));
      if (shot.aiClipFilename)
        keysToRemove.push(clipKey(property.id, shot.aiClipFilename));
    }
  }
  await Promise.all(keysToRemove.map((k) => removeObject(k)));

  property.beatSheets = sheets.filter((s) => s.id !== bsId);
  // If we deleted the active sheet, fall back to whatever remains.
  if (property.activeBeatSheetId === bsId) {
    property.activeBeatSheetId = property.beatSheets[0]?.id;
  }
  if (property.beatSheet?.id === bsId) {
    property.beatSheet = property.beatSheets[0];
  }

  await saveProperty(property);
  return NextResponse.json({ property });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; bsId: string }> }
) {
  const { id, bsId } = await ctx.params;
  const property = await getProperty(id);
  if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const sheet = property.beatSheets?.find((s) => s.id === bsId);
  if (!sheet) return NextResponse.json({ error: "Beat sheet not found" }, { status: 404 });

  if (typeof body.name === "string" && body.name.trim()) {
    sheet.name = body.name.trim().slice(0, 60);
  }
  await saveProperty(property);
  return NextResponse.json({ property });
}
