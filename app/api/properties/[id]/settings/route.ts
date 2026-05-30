import { NextRequest, NextResponse } from "next/server";
import { getProperty, saveProperty } from "@/lib/db";
import {
  CaptionSettings,
  DEFAULT_CAPTION_SETTINGS,
  CaptionFontFamily,
  CaptionPositionMode,
  CaptionStyle,
  RendererKind,
  FramingMode,
} from "@/lib/types";

export const runtime = "nodejs";

const VALID_FONTS: CaptionFontFamily[] = ["poppins", "bebas", "montserrat"];
const VALID_POSITIONS: CaptionPositionMode[] = ["static", "dynamic"];
const VALID_STYLES: CaptionStyle[] = ["kinetic", "phrase"];
const VALID_RENDERERS: RendererKind[] = ["kenburns", "ai"];
const VALID_FRAMINGS: FramingMode[] = ["blur", "fill"];

type SettingsPatch = Partial<CaptionSettings> & {
  activeRenderer?: RendererKind;
  activeBeatSheetId?: string;
  framingMode?: FramingMode;
};

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const property = await getProperty(id);
  if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as SettingsPatch;
  const current: CaptionSettings = {
    ...DEFAULT_CAPTION_SETTINGS,
    ...(property.captionSettings ?? {}),
  };
  const next: CaptionSettings = { ...current };

  if (typeof body.fontFamily === "string" && VALID_FONTS.includes(body.fontFamily as CaptionFontFamily)) {
    next.fontFamily = body.fontFamily as CaptionFontFamily;
  }
  if (typeof body.fontSize === "number" && body.fontSize >= 16 && body.fontSize <= 80) {
    next.fontSize = Math.round(body.fontSize);
  }
  if (typeof body.bold === "boolean") next.bold = body.bold;
  if (typeof body.underline === "boolean") next.underline = body.underline;
  if (typeof body.style === "string" && VALID_STYLES.includes(body.style as CaptionStyle)) {
    next.style = body.style as CaptionStyle;
  }
  if (
    typeof body.positionMode === "string" &&
    VALID_POSITIONS.includes(body.positionMode as CaptionPositionMode)
  ) {
    next.positionMode = body.positionMode as CaptionPositionMode;
  }

  property.captionSettings = next;
  if (
    typeof body.activeRenderer === "string" &&
    VALID_RENDERERS.includes(body.activeRenderer)
  ) {
    property.activeRenderer = body.activeRenderer;
  }
  if (typeof body.framingMode === "string" && VALID_FRAMINGS.includes(body.framingMode)) {
    property.framingMode = body.framingMode;
  }
  if (typeof body.activeBeatSheetId === "string") {
    // Only accept ids that actually exist on the property.
    const exists = (property.beatSheets ?? []).some(
      (s) => s.id === body.activeBeatSheetId
    );
    if (exists) {
      property.activeBeatSheetId = body.activeBeatSheetId;
      // Keep the legacy singular pointer in sync.
      property.beatSheet = property.beatSheets?.find(
        (s) => s.id === body.activeBeatSheetId
      );
    }
  }
  await saveProperty(property);
  return NextResponse.json({ property });
}
