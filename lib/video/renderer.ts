import { CameraMotion, CropRegion, RendererKind } from "../types";

export interface RenderInputs {
  propertyId: string;
  shotId: string; // used for output filename
  startFilename: string; // source photo filename in raw/
  startMime: string;
  crop: CropRegion;
  motion: CameraMotion;
  motionStrength: number;
  sceneDescription: string;
  tone: string;
}

export type ClipRenderer = (inputs: RenderInputs) => Promise<string>;

export async function getRenderer(kind: RendererKind): Promise<ClipRenderer> {
  if (kind === "ai") {
    const { renderClip } = await import("./fal");
    return renderClip;
  }
  const { renderClipKenBurns } = await import("./kenburns");
  return renderClipKenBurns;
}

// Shared crop helper: maps a CropRegion to an ffmpeg crop filter (or null for full).
// Regions are kept GENEROUS — the AI camera move adds its own push, so an
// aggressive crop on top makes shots feel uncomfortably zoomed-in.
export function cropFilter(crop: CropRegion): string | null {
  switch (crop) {
    case "left":
      return "crop=iw*0.78:ih:0:0";
    case "right":
      return "crop=iw*0.78:ih:iw*0.22:0";
    case "center":
      return "crop=iw*0.8:ih:iw*0.1:0";
    case "top":
      return "crop=iw:ih*0.78:0:0";
    case "bottom":
      return "crop=iw:ih*0.78:0:ih*0.22";
    case "detail":
      // A modest punch-in, not an extreme close-up.
      return "crop=iw*0.66:ih*0.66:iw*0.17:ih*0.17";
    case "full":
    default:
      return null;
  }
}
