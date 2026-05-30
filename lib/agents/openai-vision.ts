import OpenAI from "openai";
import { PhotoScore } from "../types";

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY missing");
    client = new OpenAI({ apiKey });
  }
  return client;
}

const VISION_PROMPT = `You are a real-estate photo critic. Analyze this single property photo and return a structured score.

Guidelines:
- roomType: pick the best matching label from the enum.
- quality: 0 (unusable) to 10 (magazine-cover hero shot). Consider composition, lighting, clutter, exposure, sharpness.
- isHero: true ONLY if this could open or close a TikTok-style listing video (wide, cinematic, no clutter, great light).
- hasPeople: true if any identifiable person is visible.
- isBlurry: true if motion blur or out-of-focus to the point it's not usable.
- description: one short sentence describing what's in the frame.
- notes: optional flags like "tilted horizon", "harsh backlight", "duplicate angle".

Be strict. A 7+ should genuinely be portfolio-grade.`;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    roomType: {
      type: "string",
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
    quality: { type: "number" },
    isHero: { type: "boolean" },
    hasPeople: { type: "boolean" },
    isBlurry: { type: "boolean" },
    description: { type: "string" },
    notes: { type: "string" },
  },
  required: ["roomType", "quality", "isHero", "hasPeople", "isBlurry", "description", "notes"],
} as const;

export async function scorePhotoOpenAI(
  imageBytes: Buffer,
  mimeType: string
): Promise<PhotoScore> {
  const ai = getClient();
  const dataUrl = `data:${mimeType || "image/jpeg"};base64,${imageBytes.toString("base64")}`;

  const response = await ai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: VISION_PROMPT },
          { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "photo_score",
        schema: RESPONSE_SCHEMA,
        strict: true,
      },
    },
  });

  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error("OpenAI vision returned empty response");
  const parsed = JSON.parse(text) as PhotoScore;
  parsed.quality = Math.max(0, Math.min(10, Number(parsed.quality) || 0));
  return parsed;
}

export function isOpenAIEnabled(): boolean {
  return !!process.env.OPENAI_API_KEY;
}
