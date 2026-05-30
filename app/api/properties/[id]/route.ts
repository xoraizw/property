import { NextRequest, NextResponse } from "next/server";
import { deleteProperty, getProperty } from "@/lib/db";
import { removePrefix } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const property = await getProperty(id);
  if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ property });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const property = await getProperty(id);
  if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Blow away everything the property owns in Supabase Storage: photos, clips,
  // audio, final videos. Then delete the DB row.
  await removePrefix(`properties/${id}`);
  await deleteProperty(id);
  return NextResponse.json({ ok: true });
}
