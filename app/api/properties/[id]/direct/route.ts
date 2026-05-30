import { NextRequest, NextResponse } from "next/server";
import { getProperty, saveProperty } from "@/lib/db";
import { directBeatSheet } from "@/lib/agents/director";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { targetSeconds?: number };
  const requested = body.targetSeconds;
  const targetSeconds: 30 | 45 | undefined =
    requested === 30 || requested === 45 ? requested : undefined;

  const property = await getProperty(id);
  if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const scoredAssets = property.assets.filter((a) => a.score);
  if (scoredAssets.length === 0) {
    return NextResponse.json(
      { error: "No scored photos yet — run scoring first." },
      { status: 400 }
    );
  }

  property.status = "directing";
  property.error = undefined;
  await saveProperty(property);

  try {
    const existing = property.beatSheets ?? [];
    const sheet = await directBeatSheet(property, existing, targetSeconds);
    // Append; new sheets become the active one so the user sees their result.
    property.beatSheets = [...existing, sheet];
    property.activeBeatSheetId = sheet.id;
    // Keep legacy field pointing at the active sheet for backward-compat code paths.
    property.beatSheet = sheet;
    property.status = "directed";
    await saveProperty(property);
    return NextResponse.json({ property });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const m = raw.match(/"message"\s*:\s*"([^"]+)"/);
    property.status = "failed";
    property.error = m ? m[1] : raw.length > 300 ? raw.slice(0, 300) + "…" : raw;
    await saveProperty(property);
    return NextResponse.json({ error: property.error }, { status: 500 });
  }
}
