import { existsSync } from "fs";
import path from "path";
import { spawn } from "child_process";
import ffmpegPathRaw from "ffmpeg-static";
import { GoogleGenAI, Type } from "@google/genai";
import { PhotoScore } from "../types";

// gemini-2.0-flash has a higher free-tier RPM (15 vs 10 on 2.5-flash) so we use
// it as the primary now that we run with concurrency=5. 2.5-flash is the fallback
// for cases where 2.0 returns a transient error.
const MODELS = ["gemini-2.0-flash", "gemini-2.5-flash"];

function resolveFfmpegPath(): string {
  const provided = (ffmpegPathRaw as unknown as string | null) ?? "";
  if (provided && existsSync(provided)) return provided;
  const ext = process.platform === "win32" ? ".exe" : "";
  const fallback = path.join(process.cwd(), "node_modules", "ffmpeg-static", `ffmpeg${ext}`);
  if (existsSync(fallback)) return fallback;
  return "ffmpeg";
}
const FFMPEG_PATH = resolveFfmpegPath();

// Downscale + recompress an image to keep upload time small and shave a bit off
// Gemini's vision-preprocessing latency. ~768px long side is more than enough for
// scoring real-estate composition; the model itself resizes anything bigger.
async function downscaleForVision(buf: Buffer, mimeType: string): Promise<Buffer> {
  // Only worth the round-trip on inputs big enough to matter.
  if (buf.byteLength < 120 * 1024) return buf;
  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-f",
      "image2pipe",
      "-i",
      "-",
      "-vf",
      "scale='min(768,iw)':-2",
      "-q:v",
      "5", // ~70% JPEG quality
      "-f",
      "image2",
      "-",
    ];
    const proc = spawn(FFMPEG_PATH, args, { windowsHide: true });
    const chunks: Buffer[] = [];
    let errOut = "";
    proc.stdout.on("data", (c) => chunks.push(c as Buffer));
    proc.stderr.on("data", (c) => (errOut += c.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0 && chunks.length > 0) resolve(Buffer.concat(chunks));
      else {
        // If ffmpeg balked (e.g. unknown format), just send the original.
        resolve(buf);
      }
    });
    proc.stdin.on("error", () => {/* ignore */});
    proc.stdin.end(buf);
  });
}

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY missing in environment");
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b(429|500|502|503|504|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand)\b/i.test(
    msg
  );
}

// Parse Gemini's suggested retry delay (e.g. `"retryDelay":"31s"` or `"retryDelay":"31.5s"`).
function suggestedRetryMs(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (!m) return null;
  return Math.ceil(parseFloat(m[1]) * 1000);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const VISION_PROMPT = `You are a real-estate photo critic. Analyze this single property photo and return a structured score.

Guidelines:
- roomType: pick the best matching label.
- quality: 0 (unusable) to 10 (magazine-cover hero shot). Consider composition, lighting, clutter, exposure, sharpness.
- isHero: true ONLY if this could open or close a TikTok-style listing video (wide, cinematic, no clutter, great light).
- hasPeople: true if any identifiable person is visible (real-estate videos avoid people in shots).
- isBlurry: true if motion blur or out-of-focus to the point it's not usable.
- description: one short sentence describing what's in the frame, in plain language a script writer can use.
- notes: optional flags like "tilted horizon", "harsh backlight", "phone-lens distortion", "duplicate angle".

Be strict. A 7+ should genuinely be portfolio-grade.`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    roomType: {
      type: Type.STRING,
      enum: [
        "exterior",
        "living_room",
        "kitchen",
        "bedroom",
        "bathroom",
        "dining",
        "office",
        "garage",
        "yard",
        "pool",
        "view",
        "detail",
        "other",
      ],
    },
    quality: { type: Type.NUMBER },
    isHero: { type: Type.BOOLEAN },
    hasPeople: { type: Type.BOOLEAN },
    isBlurry: { type: Type.BOOLEAN },
    description: { type: Type.STRING },
    notes: { type: Type.STRING },
  },
  required: ["roomType", "quality", "isHero", "hasPeople", "isBlurry", "description"],
};

export async function scorePhoto(
  imageBytes: Buffer,
  mimeType: string
): Promise<PhotoScore> {
  // Always downscale first — saves bytes regardless of provider.
  const downscaled = await downscaleForVision(imageBytes, mimeType);
  const effectiveMime = downscaled === imageBytes ? mimeType : "image/jpeg";

  // Prefer OpenAI (gpt-4o-mini) when an OpenAI key is configured. It's faster,
  // cheaper, and not rate-limited at the free-tier levels Gemini imposes.
  if (process.env.OPENAI_API_KEY) {
    const { scorePhotoOpenAI } = await import("./openai-vision");
    return scorePhotoOpenAI(downscaled, effectiveMime);
  }

  // Gemini fallback path.
  const ai = getClient();
  const base64 = downscaled.toString("base64");

  // Backoff schedule used when the API doesn't return a retryDelay.
  const fallbackDelaysMs = [1500, 4000, 10000, 20000];
  const MAX_DELAY_MS = 60_000;

  let lastErr: unknown;
  for (const model of MODELS) {
    for (let attempt = 0; attempt < fallbackDelaysMs.length; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                { text: VISION_PROMPT },
                { inlineData: { mimeType: effectiveMime, data: base64 } },
              ],
            },
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
            temperature: 0.2,
          },
        });
        const text = response.text;
        if (!text) throw new Error("Vision agent returned empty response");
        const parsed = JSON.parse(text) as PhotoScore;
        parsed.quality = Math.max(0, Math.min(10, Number(parsed.quality) || 0));
        return parsed;
      } catch (err) {
        lastErr = err;
        if (!isRetryable(err)) throw err;
        const suggested = suggestedRetryMs(err);
        // Honor the API's suggested delay (+1s buffer) when present, else exponential.
        const wait = Math.min(
          MAX_DELAY_MS,
          suggested != null ? suggested + 1000 : fallbackDelaysMs[attempt]
        );
        await sleep(wait);
      }
    }
    // exhausted attempts on this model — fall through to fallback model
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
