import { GoogleGenAI, Type } from "@google/genai";
import { v4 as uuid } from "uuid";
import { Asset, Beat, BeatSheet, Property, beatsToScenes } from "../types";

// 2.0-flash is roughly 2× faster than 2.5-flash for structured JSON output
// and is more than capable for beat-sheet planning. 2.5-flash stays as the
// fallback for when 2.0 is rate-limited or returns a transient error.
const MODELS = ["gemini-2.0-flash", "gemini-2.5-flash"];

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY missing in environment");
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    hookLine: { type: Type.STRING },
    voiceStyle: { type: Type.STRING },
    closingCta: { type: Type.STRING },
    beats: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          startAssetId: { type: Type.STRING },
          endAssetId: { type: Type.STRING },
          motion: {
            type: Type.STRING,
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
          durationSeconds: { type: Type.NUMBER },
          voiceover: { type: Type.STRING },
          caption: { type: Type.STRING },
          rationale: { type: Type.STRING },
        },
        required: [
          "id",
          "startAssetId",
          "motion",
          "durationSeconds",
          "voiceover",
          "caption",
        ],
      },
    },
  },
  required: ["hookLine", "voiceStyle", "closingCta", "beats"],
};

function summarizeAsset(a: Asset) {
  if (!a.score) return null;
  return {
    id: a.id,
    roomType: a.score.roomType,
    quality: a.score.quality,
    isHero: a.score.isHero,
    hasPeople: a.score.hasPeople,
    isBlurry: a.score.isBlurry,
    description: a.score.description,
    notes: a.score.notes ?? null,
  };
}

function buildPrompt(
  property: Property,
  existing: BeatSheet[],
  targetSeconds: 15 | 30 | 60
): string {
  const usableAssets = property.assets
    .map(summarizeAsset)
    .filter((a): a is NonNullable<ReturnType<typeof summarizeAsset>> => a !== null)
    .filter((a) => !a.hasPeople && !a.isBlurry && a.quality >= 3);

  const beatCount =
    targetSeconds === 15 ? "4–5" : targetSeconds === 30 ? "6–8" : "10–12";

  // When generating a new variation, summarise prior beat sheets so the model
  // can intentionally differentiate (different hook angle, ordering, voice).
  const variationContext =
    existing.length > 0
      ? `\n\nThis is variation #${existing.length + 1}. Earlier variations:\n${existing
          .map(
            (s, i) =>
              `${i + 1}. "${s.name}" — hook: "${s.hookLine}" · voice: ${s.voiceStyle} · cta: "${s.closingCta}"`
          )
          .join("\n")}\n\nMake this variation **meaningfully different** from the ones above: pick a different angle (e.g. lifestyle vs. investor vs. amenities-focused), a different opening hook, a different room ordering, and a different voice style. Don't just rephrase the previous one.\n`
      : "";

  return `You are a real-estate video director making a ${targetSeconds}-second TikTok-style listing video for "${property.name}".${variationContext}

Tone: ${property.tone}.
Target beat count: ${beatCount} beats. Each beat is 2–5 seconds. Total of all durationSeconds should approximately equal ${targetSeconds}.

Available scored photos (only use these IDs in startAssetId / endAssetId):
${JSON.stringify(usableAssets, null, 2)}

Write a beat sheet that:
1. Opens with a hookLine (≤ 6 words), e.g. "Welcome home" / "5 reasons to tour this".
2. Flows in a natural tour order — typically: exterior → entrance → main living → kitchen → bedrooms → bathrooms → amenities/views → closing.
3. Prefers higher-quality photos and uses isHero shots for the opening and closing beats.
4. For 1–2 beats where it makes sense, pair two related shots as start/end keyframes (set both startAssetId and endAssetId) — e.g. wide → close on the same room, or exterior daytime → exterior twilight. The two shots must be of the SAME subject so an AI video model can interpolate between them. If unsure, leave endAssetId empty.
5. Picks a "motion" that matches the shot: a static interior usually wants push_in or slow_pan_*; a kitchen island wants dolly_through; an exterior wide shot wants pull_back or tilt_up.
6. Voiceover lines are conversational, ${property.tone}-toned, ≤ 12 words each. Avoid clichés like "stunning". Together they should read like one cohesive script when concatenated.
7. captions are 6–12 words, in **sentence case** (not ALL CAPS), and **descriptive of what's literally on screen** — they should add context the viewer might miss, not restate the voiceover. Examples: "Open-concept living with floor-to-ceiling windows", "Stainless appliances and quartz countertops", "Primary suite with custom walk-in closet". Avoid hype words ("stunning", "amazing", "luxurious").
8. Skips any photo that is a logo, generated image, or otherwise not a real property photo (refer to notes/description).
9. Closes with a closingCta line (≤ 10 words), e.g. "Tour today — link in bio".
10. voiceStyle: a short hint for TTS, e.g. "warm female narrator", "confident male, brisk pace".

Output ONLY the structured JSON.`;
}

function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b(429|500|502|503|504|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand)\b/i.test(
    msg
  );
}

function suggestedRetryMs(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (!m) return null;
  return Math.ceil(parseFloat(m[1]) * 1000);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function directBeatSheet(
  property: Property,
  existingVariations: BeatSheet[] = [],
  targetSeconds?: 30 | 45
): Promise<BeatSheet> {
  // Prefer OpenAI when its key is configured — faster, and produces the richer
  // multi-shot scene structure directly.
  if (process.env.OPENAI_API_KEY) {
    const { directBeatSheetOpenAI } = await import("./openai-director");
    return directBeatSheetOpenAI(property, existingVariations, targetSeconds);
  }

  // Gemini fallback. It still emits the legacy single-photo "beats" schema; we
  // convert each beat into a one-shot scene. (Less dynamic than the OpenAI path,
  // but only used when no OpenAI key is configured.)
  const ai = getClient();
  const effectiveTarget = targetSeconds ?? (property.targetSeconds === 45 ? 45 : 30);
  const prompt = buildPrompt(property, existingVariations, effectiveTarget as 15 | 30 | 60);
  const fallbackDelaysMs = [1500, 4000, 10000, 20000];
  const MAX_DELAY_MS = 60_000;

  let lastErr: unknown;
  for (const model of MODELS) {
    for (let attempt = 0; attempt < fallbackDelaysMs.length; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
            temperature: 0.6,
          },
        });
        const text = response.text;
        if (!text) throw new Error("Director agent returned empty response");
        const raw = JSON.parse(text) as {
          hookLine: string;
          voiceStyle: string;
          closingCta: string;
          beats: Beat[];
        };
        const validIds = new Set(property.assets.map((a) => a.id));
        for (const b of raw.beats) {
          if (!validIds.has(b.startAssetId)) {
            throw new Error(`Director referenced unknown startAssetId ${b.startAssetId}`);
          }
        }
        const sheet: BeatSheet = {
          id: uuid(),
          name: `Variation ${existingVariations.length + 1}`,
          createdAt: new Date().toISOString(),
          targetSeconds: effectiveTarget as 30 | 45,
          hookLine: raw.hookLine,
          voiceStyle: raw.voiceStyle,
          closingCta: raw.closingCta,
          scenes: beatsToScenes(raw.beats),
        };
        return sheet;
      } catch (err) {
        lastErr = err;
        if (!isRetryable(err)) throw err;
        const suggested = suggestedRetryMs(err);
        const wait = Math.min(
          MAX_DELAY_MS,
          suggested != null ? suggested + 1000 : fallbackDelaysMs[attempt]
        );
        await sleep(wait);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
