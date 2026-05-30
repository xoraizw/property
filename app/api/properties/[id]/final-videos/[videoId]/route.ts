import { NextRequest, NextResponse } from "next/server";
import { getProperty, saveProperty } from "@/lib/db";
import { finalKey, removeObject } from "@/lib/storage";

export const runtime = "nodejs";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; videoId: string }> }
) {
  const { id, videoId } = await ctx.params;
  const property = await getProperty(id);
  if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const videos = property.finalVideos ?? [];
  const target = videos.find((v) => v.id === videoId);
  if (!target) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  // Remove the file from Supabase Storage; errors are swallowed.
  await removeObject(finalKey(property.id, target.filename));

  property.finalVideos = videos.filter((v) => v.id !== videoId);
  // If the deprecated field pointed at this file, clear it (or repoint to the
  // newest remaining video).
  if (property.finalVideoFilename === target.filename) {
    property.finalVideoFilename = property.finalVideos[0]?.filename;
  }
  await saveProperty(property);
  return NextResponse.json({ property });
}
