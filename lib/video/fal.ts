import { promises as fs } from "fs";
import { existsSync } from "fs";
import path from "path";
import { spawn } from "child_process";
import ffmpegPathRaw from "ffmpeg-static";
import { fal } from "@fal-ai/client";
import { CameraMotion } from "../types";
import { clipKey, getObject, putObject, rawKey } from "../storage";
import { cropFilter, type RenderInputs } from "./renderer";
import os from "os";
import { randomUUID } from "crypto";

let configured = false;
function ensureConfigured() {
  if (configured) return;
  const credentials = process.env.FAL_KEY;
  if (!credentials) throw new Error("FAL_KEY missing in environment");
  fal.config({ credentials });
  configured = true;
}

function resolveFfmpegPath(): string {
  const provided = (ffmpegPathRaw as unknown as string | null) ?? "";
  if (provided && existsSync(provided)) return provided;
  const ext = process.platform === "win32" ? ".exe" : "";
  const fallback = path.join(process.cwd(), "node_modules", "ffmpeg-static", `ffmpeg${ext}`);
  if (existsSync(fallback)) return fallback;
  return "ffmpeg";
}
const FFMPEG_PATH = resolveFfmpegPath();

type AiModel = "ltx2" | "veo31";
const AI_MODEL: AiModel = (process.env.FAL_VIDEO_MODEL as AiModel) || "ltx2";
const ENDPOINTS: Record<AiModel, string> = {
  ltx2: "fal-ai/ltx-2-19b/distilled/image-to-video",
  veo31: "fal-ai/veo3.1/image-to-video",
};

const FPS = 25;
const NUM_FRAMES = 121;

const CAMERA_LORA: Record<
  CameraMotion,
  "dolly_in" | "dolly_out" | "dolly_left" | "dolly_right" | "jib_up" | "jib_down" | "static"
> = {
  static: "static",
  push_in: "dolly_in",
  pull_back: "dolly_out",
  dolly_through: "dolly_in",
  slow_pan_left: "dolly_left",
  slow_pan_right: "dolly_right",
  tilt_up: "jib_up",
  tilt_down: "jib_down",
};

const motionText: Record<CameraMotion, string> = {
  static: "a static locked-off camera",
  push_in: "a confident cinematic push-in toward the subject",
  pull_back: "a smooth pull-back revealing the full scene",
  dolly_through: "a smooth dolly moving forward through the space",
  slow_pan_left: "a steady pan to the left",
  slow_pan_right: "a steady pan to the right",
  tilt_up: "a smooth upward tilt",
  tilt_down: "a smooth downward tilt",
};

function buildPrompt(motion: CameraMotion, sceneDescription: string, tone: string): string {
  return [
    `Cinematic real-estate listing shot, ${tone} mood, with ${motionText[motion]}.`,
    sceneDescription,
    "Photorealistic, natural daylight, no people in frame, sharp focus, professional architectural cinematography.",
  ]
    .filter(Boolean)
    .join(" ");
}

// Pull the source photo from Supabase to a temp file, optionally crop it.
// Returns the local path of the (possibly cropped) image.
async function prepareSourceImage(
  propertyId: string,
  filename: string,
  crop: string,
  shotId: string
): Promise<string> {
  const buf = await getObject(rawKey(propertyId, filename));
  const tmpBase = path.join(os.tmpdir(), `ptv-fal-${randomUUID()}`);
  await fs.mkdir(tmpBase, { recursive: true });
  const rawLocal = path.join(tmpBase, `src-${shotId}-${filename}`);
  await fs.writeFile(rawLocal, buf);

  const filter = cropFilter(crop as never);
  if (!filter) return rawLocal;

  const outPath = path.join(tmpBase, `crop-${shotId}.jpg`);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      FFMPEG_PATH,
      ["-y", "-i", rawLocal, "-vf", filter, "-q:v", "3", outPath],
      { windowsHide: true }
    );
    let err = "";
    proc.stderr.on("data", (c) => (err += c.toString()));
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`crop failed: ${err.slice(-300)}`))
    );
  });
  await fs.rm(rawLocal).catch(() => {});
  return outPath;
}

const uploadCache = new Map<string, string>();
async function uploadFile(localPath: string, mimeType: string): Promise<string> {
  const cached = uploadCache.get(localPath);
  if (cached) return cached;
  const buf = await fs.readFile(localPath);
  const blob = new Blob([new Uint8Array(buf)], { type: mimeType || "image/jpeg" });
  const url = await withRetry("upload", () => fal.storage.upload(blob));
  uploadCache.set(localPath, url);
  return url;
}

async function downloadToFile(url: string, target: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download clip (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(target, buf);
}

// Retry transient network failures (dropped connections, timeouts, 5xx). fal.ai
// occasionally resets the socket mid-run; without this a single "fetch failed"
// kills the whole shot.
function isTransient(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  const code = (err as { code?: string; cause?: { code?: string } })?.code
    ?? (err as { cause?: { code?: string } })?.cause?.code
    ?? "";
  return (
    /fetch failed|network|timeout|timed out|socket|econnreset|econnrefused|enotfound|eai_again|503|502|504|terminated/i.test(
      msg
    ) || /ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|UND_ERR/i.test(code)
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const delays = [1000, 3000, 7000];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === delays.length || !isTransient(err)) break;
      await sleep(delays[attempt]);
    }
  }
  throw lastErr instanceof Error
    ? new Error(`${label}: ${lastErr.message}`)
    : new Error(`${label}: ${String(lastErr)}`);
}

export async function renderClip(inputs: RenderInputs): Promise<string> {
  ensureConfigured();
  const { propertyId, shotId, startFilename, startMime, crop, motion, motionStrength } = inputs;

  const outFilename = `${shotId}-ai.mp4`;
  // Stage the downloaded video in /tmp; we'll push it to Supabase before returning.
  const tmpDir = path.join(os.tmpdir(), `ptv-fal-out-${randomUUID()}`);
  await fs.mkdir(tmpDir, { recursive: true });
  const outPath = path.join(tmpDir, outFilename);

  const srcPath = await prepareSourceImage(propertyId, startFilename, crop, shotId);
  const startUrl = await uploadFile(srcPath, crop === "full" ? startMime : "image/jpeg");

  let input: Record<string, unknown>;
  if (AI_MODEL === "veo31") {
    input = {
      prompt: buildPrompt(motion, inputs.sceneDescription, inputs.tone),
      image_url: startUrl,
      aspect_ratio: "16:9",
      duration: "4s",
      resolution: "720p",
      generate_audio: false,
    };
  } else {
    // The director emits motionStrength on a 1.0–2.0 "intent" scale, but LTX-2's
    // camera_lora_scale is capped at 0–1. Map [1.1, 1.8] → [0.5, 1.0].
    const loraScale = Math.min(1, Math.max(0.3, 0.5 + ((motionStrength || 1.3) - 1.1) * 0.714));
    input = {
      prompt: buildPrompt(motion, inputs.sceneDescription, inputs.tone),
      image_url: startUrl,
      camera_lora: CAMERA_LORA[motion],
      camera_lora_scale: loraScale,
      num_frames: NUM_FRAMES,
      fps: FPS,
      video_size: "landscape_16_9",
      video_quality: "high",
      video_write_mode: "balanced",
      use_multiscale: true,
      enable_prompt_expansion: true,
      generate_audio: false,
    };
  }

  const result = (await withRetry("generate", () =>
    fal.subscribe(ENDPOINTS[AI_MODEL], {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      input: input as any,
      logs: false,
    })
  )) as { data?: { video?: { url?: string } } };

  const videoUrl = result?.data?.video?.url;
  if (!videoUrl) throw new Error("fal.ai returned no video URL");
  await withRetry("download", () => downloadToFile(videoUrl, outPath));

  // Push the rendered clip to Supabase Storage, then clean up local temp files.
  const clipBuf = await fs.readFile(outPath);
  await putObject(clipKey(propertyId, outFilename), clipBuf, "video/mp4");
  await fs.rm(srcPath).catch(() => {});
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  return outFilename;
}
