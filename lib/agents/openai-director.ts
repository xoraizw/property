import { v4 as uuid } from "uuid";
import OpenAI from "openai";
import { Asset, BeatSheet, Property, Shot } from "../types";

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY missing");
    client = new OpenAI({ apiKey });
  }
  return client;
}

const SHOT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    assetId: { type: "string" },
    crop: {
      type: "string",
      enum: ["full", "left", "right", "center", "top", "bottom", "detail"],
    },
    motion: {
      type: "string",
      enum: [
        "static",
        "slow_pan_left",
        "slow_pan_right",
        "push_in",
        "pull_back",
        "dolly_through",
        "tilt_up",
        "tilt_down",
      ],
    },
    motionStrength: { type: "number" },
    durationSeconds: { type: "number" },
  },
  required: ["assetId", "crop", "motion", "motionStrength", "durationSeconds"],
} as const;

const SCENE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    label: { type: "string" },
    voiceover: { type: "string" },
    caption: { type: "string" },
    shots: { type: "array", items: SHOT_SCHEMA },
  },
  required: ["label", "voiceover", "caption", "shots"],
} as const;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    hookLine: { type: "string" },
    voiceStyle: { type: "string" },
    closingCta: { type: "string" },
    scenes: { type: "array", items: SCENE_SCHEMA },
  },
  required: ["hookLine", "voiceStyle", "closingCta", "scenes"],
} as const;

function summarizeAsset(a: Asset) {
  if (!a.score) return null;
  return {
    id: a.id,
    roomType: a.score.roomType,
    quality: a.score.quality,
    isHero: a.score.isHero,
    description: a.score.description,
    notes: a.score.notes ?? null,
  };
}

function buildPrompt(
  property: Property,
  existing: BeatSheet[],
  targetSeconds: 30 | 45
): string {
  const usableAssets = property.assets
    .map(summarizeAsset)
    .filter((a): a is NonNullable<ReturnType<typeof summarizeAsset>> => a !== null)
    .filter((a) => a.quality >= 3);

  const sceneCount = targetSeconds === 30 ? "6–8" : "9–12";
  const keywords = property.amenityKeywords?.length
    ? property.amenityKeywords.join(", ")
    : null;

  const variationContext =
    existing.length > 0
      ? `\n\nThis is variation #${existing.length + 1}. Earlier variations opened with: ${existing
          .map((s) => `"${s.hookLine}"`)
          .join(
            ", "
          )}. Make this one meaningfully different — different narrative angle, hook, room order, and voice style.\n`
      : "";

  const keywordBlock = keywords
    ? `\n\nThe property advertises these amenities/keywords: ${keywords}. Where — and ONLY where — a scored photo genuinely depicts one of these, you may add a short "feature" scene highlighting it (its caption can name the amenity). If no photo plausibly shows an amenity, do NOT invent a scene for it.\n`
    : "";

  return `You are an award-winning short-form real-estate video editor. You make fast-paced, modern, social-media (TikTok/Reels) listing videos for "${property.name}". Tone: ${property.tone}.${variationContext}${keywordBlock}

STEP 1 — Write the script first.
Write ONE cohesive, flowing voiceover narration for the whole property — like a confident realtor walking a buyer through it. It should read as a single continuous script when the scene voiceover lines are concatenated in order. Loosely target ~${targetSeconds} seconds of spoken narration (NOT a hard limit). Conversational, ${property.tone}-toned, no clichés like "stunning"/"luxurious". Each scene's voiceover is ONE sentence (~3–4 seconds of speech) — enough time to quick-cut through that room's angles, but never lingering.

STEP 2 — Break the script into scenes and choreograph the camera.
Split the narration into ${sceneCount} scenes. Each scene = one voiceover phrase + the shots shown under it.

Rules for engaging motion and VARIED ANGLES:
- Hero rooms (living, kitchen, primary bedroom, exterior) get 3 SHOTS. Secondary rooms get 2. Only a truly minor space (laundry/half-bath) gets 1. More shots = a real cameraman covering the room from several angles via quick cuts — this is what makes it dynamic and engaging.
- ABSOLUTE RULE — every shot in a scene MUST depict the SAME room/subject the scene's voiceover is describing (the viewer sees them WHILE that line is spoken). Get variety from different CROPS and MOTIONS of the SAME room — NEVER cut to a different room within a scene. If only one photo of the room exists, reuse that same assetId across all its shots with DIFFERENT crops and motions (this genuinely looks like new angles once animated).
- Within a scene, EVERY shot must have a DISTINCT "crop" AND a DISTINCT "motion" — make them clearly different so each cut feels like a new camera setup. Example 3-shot coverage of one room: shot1 = full + dolly_through (wide establishing), shot2 = left + push_in (move in on one side), shot3 = right + tilt_down (sweep the other side). Vary which crops/motions you use scene to scene.
- Use the full crop vocabulary: "full", "left", "right", "top", "bottom", "center", "detail". Lean on "full" and the wide side-crops ("left"/"right"/"center") for most shots. Use "detail" SPARINGLY — only for a genuine feature close-up (e.g. a faucet, a fireplace), at most once per scene — because tight crops can feel over-zoomed.
- Pick "motion" that feels like a moving operator: prefer "dolly_through" and "push_in" (walking into a space). Use "pull_back"/"tilt_up" for exteriors, "tilt_down" to reveal from ceiling to floor, "slow_pan_left/right" to sweep across. Vary it heavily — do not use the same motion in consecutive shots anywhere.
- "motionStrength": 1.4–1.8 for energetic shots, ~1.2 for a calm establishing wide. Bias punchy.
- "durationSeconds" per shot: keep MOST shots SHORT (2.5–3.5s) so cuts feel quick and nothing lingers. The total across all scenes should loosely add up to ~${targetSeconds}s.
- Open with a HOOK: the first scene grabs attention fast (a striking exterior or the best room) with a punchy first shot.

Captions: 6–12 words, sentence case, describe what's literally on screen (add context the voiceover doesn't repeat). No ALL CAPS, no hype words.
voiceStyle: short TTS hint, e.g. "warm female narrator, brisk pace".
closingCta: ≤10 words, e.g. "Book your tour today".

Only reference assetId values that appear in this list:
${JSON.stringify(usableAssets, null, 2)}

Skip logos, generated images, and any photo that isn't a real property photo. Return ONLY the JSON.`;
}

const MODELS = ["gpt-4o-mini", "gpt-4o"];

export async function directBeatSheetOpenAI(
  property: Property,
  existingVariations: BeatSheet[] = [],
  targetSeconds?: 30 | 45
): Promise<BeatSheet> {
  const ai = getClient();
  const effectiveTarget: 30 | 45 =
    targetSeconds ?? (property.targetSeconds === 45 ? 45 : 30);
  const prompt = buildPrompt(property, existingVariations, effectiveTarget);
  const validIds = new Set(property.assets.map((a) => a.id));

  type RawShot = {
    assetId: string;
    crop: string;
    motion: string;
    motionStrength: number;
    durationSeconds: number;
  };
  type RawScene = { label: string; voiceover: string; caption: string; shots: RawShot[] };
  type Raw = { hookLine: string; voiceStyle: string; closingCta: string; scenes: RawScene[] };

  let lastErr: unknown;
  for (const model of MODELS) {
    try {
      const response = await ai.chat.completions.create({
        model,
        temperature: 0.7,
        messages: [{ role: "user", content: prompt }],
        response_format: {
          type: "json_schema",
          json_schema: { name: "storyboard", schema: RESPONSE_SCHEMA, strict: true },
        },
      });
      const text = response.choices[0]?.message?.content;
      if (!text) throw new Error("OpenAI director returned empty response");
      const raw = JSON.parse(text) as Raw;

      const scenes = raw.scenes
        .map((sc, si) => {
          const shots = sc.shots
            .filter((sh) => validIds.has(sh.assetId))
            .map((sh, shi) => ({
              id: `scene${si + 1}-shot${shi + 1}`,
              assetId: sh.assetId,
              crop: (
                ["full", "left", "right", "center", "top", "bottom", "detail"].includes(sh.crop)
                  ? sh.crop
                  : "full"
              ) as Shot["crop"],
              motion: sh.motion as Shot["motion"],
              motionStrength: Math.max(1, Math.min(2, Number(sh.motionStrength) || 1.3)),
              durationSeconds: Math.max(1.5, Math.min(6, Number(sh.durationSeconds) || 3)),
            }));
          return {
            id: `scene${si + 1}`,
            label: sc.label,
            voiceover: sc.voiceover,
            caption: sc.caption,
            shots,
          };
        })
        .filter((sc) => sc.shots.length > 0);

      if (scenes.length === 0) throw new Error("Director produced no usable scenes");

      const sheet: BeatSheet = {
        id: uuid(),
        name: `Variation ${existingVariations.length + 1}`,
        createdAt: new Date().toISOString(),
        targetSeconds: effectiveTarget,
        hookLine: raw.hookLine,
        voiceStyle: raw.voiceStyle,
        closingCta: raw.closingCta,
        scenes,
      };
      return sheet;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
