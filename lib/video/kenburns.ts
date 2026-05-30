import { promises as fs } from "fs";
import { existsSync } from "fs";
import path from "path";
import { spawn } from "child_process";
import ffmpegPathRaw from "ffmpeg-static";
import os from "os";
import { randomUUID } from "crypto";
import { CameraMotion } from "../types";
import { clipKey, getObject, putObject, rawKey } from "../storage";
import { cropFilter, type RenderInputs } from "./renderer";

// ffmpeg-static returns the path to the bundled binary. Next.js sometimes mangles
// this string into "\ROOT\..." when it bundles. Validate and fall back to a
// manual resolution under node_modules if the package-provided path is invalid.
function resolveFfmpegPath(): string {
  const provided = (ffmpegPathRaw as unknown as string | null) ?? "";
  if (provided && existsSync(provided)) return provided;
  const ext = process.platform === "win32" ? ".exe" : "";
  const fallback = path.join(
    process.cwd(),
    "node_modules",
    "ffmpeg-static",
    `ffmpeg${ext}`
  );
  if (existsSync(fallback)) return fallback;
  // Last resort: rely on PATH.
  return "ffmpeg";
}
const FFMPEG_PATH = resolveFfmpegPath();

// Output spec — vertical TikTok-style.
const OUT_W = 540;
const OUT_H = 960;
const FPS = 24;
const CLIP_SECONDS = 5; // we always render a fixed 5s clip; compositor trims later
const TOTAL_FRAMES = CLIP_SECONDS * FPS; // 120

// Internal "canvas" the still image is scaled into BEFORE zoompan. Larger than
// output so zoompan has room to pan/zoom without losing resolution.
const CANVAS_W = 1620;
const CANVAS_H = 2880;

// zoompan expressions. `on` is current output frame (0..d-1). z is zoom factor.
// In zoompan, x and y are top-left of the zoomed crop within the input image.
type ZoomPan = { z: string; x: string; y: string };

function motionExpr(motion: CameraMotion, frames: number): ZoomPan {
  // t goes 0..1 across the clip
  const t = `(on/${frames - 1})`;
  const centerX = `iw/2-(iw/zoom/2)`;
  const centerY = `ih/2-(ih/zoom/2)`;
  switch (motion) {
    case "static":
      return { z: "1.05", x: centerX, y: centerY };
    case "push_in":
      return { z: `1.0+0.18*${t}`, x: centerX, y: centerY };
    case "pull_back":
      return { z: `1.18-0.18*${t}`, x: centerX, y: centerY };
    case "dolly_through":
      return { z: `1.0+0.32*${t}`, x: centerX, y: centerY };
    case "slow_pan_left":
      // camera moves left → reveal left side; zoomed crop's x decreases over time
      return { z: "1.15", x: `(iw-iw/zoom)*(1-${t})`, y: centerY };
    case "slow_pan_right":
      return { z: "1.15", x: `(iw-iw/zoom)*${t}`, y: centerY };
    case "tilt_up":
      return { z: "1.15", x: centerX, y: `(ih-ih/zoom)*(1-${t})` };
    case "tilt_down":
      return { z: "1.15", x: centerX, y: `(ih-ih/zoom)*${t}` };
  }
}

// Build a complete filter that scales the input image to a fixed canvas (cover-fit
// to 9:16) then applies zoompan to produce a 540x960 24fps `frames`-frame video.
function singleImageFilter(motion: CameraMotion, frames: number): string {
  const { z, x, y } = motionExpr(motion, frames);
  // Scale source to cover the canvas (9:16), then crop to canvas, then zoompan.
  // setsar=1 keeps square pixels; format=yuv420p ensures broad codec compat.
  return [
    `scale=${CANVAS_W}:${CANVAS_H}:force_original_aspect_ratio=increase`,
    `crop=${CANVAS_W}:${CANVAS_H}`,
    `zoompan=z='${z}':x='${x}':y='${y}':d=${frames}:s=${OUT_W}x${OUT_H}:fps=${FPS}`,
    `setsar=1`,
    `format=yuv420p`,
  ].join(",");
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_PATH, args, { windowsHide: true });
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `ffmpeg exited with code ${code}.\nargs: ${args.join(" ")}\nstderr tail:\n${stderr.slice(-1500)}`
          )
        );
    });
  });
}

async function renderSingle(
  inputPath: string,
  outPath: string,
  motion: CameraMotion,
  cropPrefix: string | null
): Promise<void> {
  // Crop the source first (to fake a different angle), then the ken-burns chain.
  const filter = (cropPrefix ? cropPrefix + "," : "") + singleImageFilter(motion, TOTAL_FRAMES);
  await runFfmpeg([
    "-y",
    "-loop",
    "1",
    "-i",
    inputPath,
    "-vf",
    filter,
    "-frames:v",
    String(TOTAL_FRAMES),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(FPS),
    outPath,
  ]);
}

export async function renderClipKenBurns(inputs: RenderInputs): Promise<string> {
  const { propertyId, shotId, startFilename, crop, motion } = inputs;

  const tmpDir = path.join(os.tmpdir(), `ptv-kb-${randomUUID()}`);
  await fs.mkdir(tmpDir, { recursive: true });
  try {
    // Pull source photo from Supabase to /tmp, run FFmpeg, push the MP4 back.
    const srcBuf = await getObject(rawKey(propertyId, startFilename));
    const startInput = path.join(tmpDir, `src-${shotId}-${startFilename}`);
    await fs.writeFile(startInput, srcBuf);

    const outFilename = `${shotId}.mp4`;
    const outPath = path.join(tmpDir, outFilename);
    await renderSingle(startInput, outPath, motion, cropFilter(crop));

    const clipBuf = await fs.readFile(outPath);
    await putObject(clipKey(propertyId, outFilename), clipBuf, "video/mp4");
    return outFilename;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
