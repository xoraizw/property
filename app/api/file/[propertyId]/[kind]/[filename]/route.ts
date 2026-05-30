import { NextRequest, NextResponse } from "next/server";
import { publicUrl } from "@/lib/supabase";
import { objectKeyForFileRoute } from "@/lib/storage";

export const runtime = "nodejs";

// Browser asks for /api/file/{propertyId}/{kind}/{filename}; we 302-redirect to
// the Supabase Storage public URL. Keeps the existing URL shape used by every
// <img>/<video> in the UI while moving the actual bytes off the app server.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ propertyId: string; kind: string; filename: string }> }
) {
  const { propertyId, kind, filename } = await ctx.params;
  const key = objectKeyForFileRoute(propertyId, kind, decodeURIComponent(filename));
  if (!key) return NextResponse.json({ error: "Bad kind" }, { status: 400 });
  return NextResponse.redirect(publicUrl(key), 302);
}
