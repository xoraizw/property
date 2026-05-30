import { promises as fs } from "fs";
import { existsSync } from "fs";
import path from "path";
import { spawn } from "child_process";
import ffmpegPathRaw from "ffmpeg-static";
import os from "os";
import { randomUUID } from "crypto";
import { MsEdgeTTS, OUTPUT_FORMAT, MetadataOptions } from "msedge-tts";
import { audioKey, putObject } from "../storage";
import { CaptionWord } from "../types";

function resolveFfmpegPath(): string {
  const provided = (ffmpegPathRaw as unknown as string | null) ?? "";
  if (provided && existsSync(provided)) return provided;
  const ext = process.platform === "win32" ? ".exe" : "";
  const fallback = path.join(process.cwd(), "node_modules", "ffmpeg-static", `ffmpeg${ext}`);
  if (existsSync(fallback)) return fallback;
  return "ffmpeg";
}
const FFMPEG_PATH = resolveFfmpegPath();

// Voice picks per directed style. Edge voices are free and surprisingly natural.
function voiceFor(style: string): string {
  const lower = style.toLowerCase();
  if (lower.includes("male") && (lower.includes("warm") || lower.includes("calm")))
    return "en-US-AndrewMultilingualNeural";
  if (lower.includes("male")) return "en-US-GuyNeural";
  if (lower.includes("british") || lower.includes("uk"))
    return "en-GB-SoniaNeural";
  if (lower.includes("brisk") || lower.includes("confident"))
    return "en-US-EmmaMultilingualNeural";
  // Default: warm female narrator
  return "en-US-AvaMultilingualNeural";
}

// Probe audio duration via ffprobe-style ffmpeg call (ffmpeg -i prints to stderr).
async function probeDurationSeconds(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_PATH, ["-i", filePath, "-hide_banner"], { windowsHide: true });
    let stderr = "";
    proc.stderr.on("data", (c) => (stderr += c.toString()));
    proc.on("error", reject);
    proc.on("close", () => {
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!m) {
        reject(new Error(`Could not probe duration: ${stderr.slice(-300)}`));
        return;
      }
      const seconds =
        parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
      resolve(seconds);
    });
  });
}

export interface TtsLine {
  beatId: string; // used for filename
  text: string;
}

export interface TtsResult {
  beatId: string;
  filename: string; // saved under audioDir(propertyId)
  durationSeconds: number;
  words: CaptionWord[]; // per-word timing for real-time captions
}

// Parse Edge TTS word-boundary metadata into per-word timing (seconds).
// Offsets/durations are in 100-nanosecond ticks.
async function parseWordTimings(metadataPath: string | null): Promise<CaptionWord[]> {
  if (!metadataPath || !existsSync(metadataPath)) return [];
  try {
    const raw = await fs.readFile(metadataPath, "utf-8");
    const json = JSON.parse(raw) as {
      Metadata?: Array<{
        Type?: string;
        Data?: { Offset?: number; Duration?: number; text?: { Text?: string } };
      }>;
    };
    const words: CaptionWord[] = [];
    for (const item of json.Metadata ?? []) {
      if (item.Type !== "WordBoundary" || !item.Data) continue;
      const text = item.Data.text?.Text?.trim();
      if (!text) continue;
      const start = (item.Data.Offset ?? 0) / 1e7;
      const dur = (item.Data.Duration ?? 0) / 1e7;
      words.push({ word: text, start, end: start + dur });
    }
    return words;
  } catch {
    return [];
  }
}

export async function synthesizeLines(
  propertyId: string,
  voiceStyle: string,
  lines: TtsLine[]
): Promise<TtsResult[]> {
  // Edge TTS writes to a local dir; we then upload each mp3 to Supabase Storage.
  const outDir = path.join(os.tmpdir(), `ptv-tts-${randomUUID()}`);
  await fs.mkdir(outDir, { recursive: true });

  const tts = new MsEdgeTTS();
  const meta = new MetadataOptions();
  meta.wordBoundaryEnabled = true; // emit per-word timestamps
  await tts.setMetadata(
    voiceFor(voiceStyle),
    OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
    meta
  );

  const results: TtsResult[] = [];

  for (const line of lines) {
    // toFile writes <dirPath>/<random>.mp3 + <dirPath>/metadata.json.
    const { audioFilePath, metadataFilePath } = await tts.toFile(outDir, line.text || "…");
    const target = path.join(outDir, `${line.beatId}.mp3`);
    if (existsSync(target)) await fs.rm(target);
    await fs.rename(audioFilePath, target);
    const words = await parseWordTimings(metadataFilePath);
    const durationSeconds = await probeDurationSeconds(target);
    // Push the mp3 to Supabase Storage.
    const mp3Buf = await fs.readFile(target);
    await putObject(audioKey(propertyId, `${line.beatId}.mp3`), mp3Buf, "audio/mpeg");
    results.push({
      beatId: line.beatId,
      filename: `${line.beatId}.mp3`,
      durationSeconds,
      words,
    });
  }

  tts.close();
  await fs.rm(outDir, { recursive: true, force: true }).catch(() => {});
  return results;
}
