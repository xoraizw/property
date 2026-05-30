import { RendererKind, Shot } from "./types";

// Rough USD-per-clip estimate for the AI renderer, keyed off the active fal.ai
// video model (FAL_VIDEO_MODEL, default "ltx2"). Verify exact rates on fal.ai —
// these are ballpark per ~4-5s clip.
//   ltx2  → LTX-2-19B distilled (~$0.05/s)
//   veo31 → Veo 3.1 standard (~$0.40/s × 4s)
const CLIP_COST_USD: Record<string, number> = {
  ltx2: 0.25,
  veo31: 1.6,
};

function activeModel(): string {
  return process.env.FAL_VIDEO_MODEL || "ltx2";
}

export function estimateAiClipCost(): number {
  return CLIP_COST_USD[activeModel()] ?? 0.25;
}

export function shotClipCostForRenderer(shot: Shot, renderer: RendererKind): number {
  if (renderer === "kenburns") return 0;
  return shot.estimatedCostUsd ?? estimateAiClipCost();
}

export function formatUsd(amount: number): string {
  if (amount === 0) return "$0.00";
  return `$${amount.toFixed(2)}`;
}
