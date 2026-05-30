import { promises as fs } from "fs";
import { existsSync } from "fs";
import path from "path";
import { spawn } from "child_process";
import ffmpegPathRaw from "ffmpeg-static";
import {
  CaptionSettings,
  DEFAULT_CAPTION_SETTINGS,
  FramingMode,
  Property,
  RendererKind,
  Scene,
  shotClipFor,
  getActiveBeatSheet,
} from "../types";
import os from "os";
import { randomUUID } from "crypto";
import {
  audioKey,
  brandKey,
  clipKey,
  finalKey,
  getObject,
  objectExists,
  putObject,
} from "../storage";

function resolveFfmpegPath(): string {
  const provided = (ffmpegPathRaw as unknown as string | null) ?? "";
  if (provided && existsSync(provided)) return provided;
  const ext = process.platform === "win32" ? ".exe" : "";
  const fallback = path.join(process.cwd(), "node_modules", "ffmpeg-static", `ffmpeg${ext}`);
  if (existsSync(fallback)) return fallback;
  return "ffmpeg";
}
const FFMPEG_PATH = resolveFfmpegPath();

// Bundled fonts — one TTF per (family, weight) we expose to the user.
const FONTS_DIR = path.join(process.cwd(), "assets", "fonts");
function fontPathFor(s: CaptionSettings, italic = false): string {
  if (s.fontFamily === "bebas") {
    // Bebas Neue ships in a single weight; bold/italic toggles are no-ops.
    return path.join(FONTS_DIR, "BebasNeue-Regular.ttf");
  }
  if (s.fontFamily === "montserrat") {
    if (italic) return path.join(FONTS_DIR, "Montserrat-ExtraBoldItalic.ttf");
    return path.join(FONTS_DIR, s.bold ? "Montserrat-ExtraBold.ttf" : "Montserrat-Bold.ttf");
  }
  // poppins
  if (italic) return path.join(FONTS_DIR, "Poppins-ExtraBoldItalic.ttf");
  return path.join(FONTS_DIR, s.bold ? "Poppins-ExtraBold.ttf" : "Poppins-Regular.ttf");
}

// Approximate average glyph width as a fraction of font size — used to size the
// underline drawbox since drawtext's text_w isn't accessible to other filters.
function glyphWidthFactor(family: CaptionSettings["fontFamily"]): number {
  return family === "bebas" ? 0.42 : 0.55;
}

// Escape a single word for inline use in a drawtext text='...' value.
function escapeDrawWord(w: string): string {
  return w
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "’") // curly apostrophe dodges ffmpeg quoting
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%");
}

// Build a KINETIC caption filter: each spoken word pops in one-at-a-time, synced
// to its voiceover timestamp, sliding up + fading in. `words` timings are scene-
// local seconds. Returns a drawtext chain to append after the video filters.
function buildKineticCaptionFilter(
  words: { word: string; start: number; end: number }[],
  sceneIndex: number,
  settings: CaptionSettings
): string {
  if (words.length === 0) return "";
  // Broadcast / real-estate style: bold ITALIC, warm YELLOW fill, thick black
  // outline + drop shadow for the punchy "extruded" look. Each word slides in.
  const fontSize = Math.max(28, Math.min(96, Math.round(settings.fontSize)));
  const fontPath = escapeFilterPath(fontPathFor(settings, /* italic */ true));
  const FILL = "#F5E03C"; // warm yellow/gold
  const yAnchor =
    settings.positionMode === "dynamic"
      ? DYNAMIC_Y_ANCHORS[sceneIndex % DYNAMIC_Y_ANCHORS.length]
      : "h*0.72";
  const SLIDE = 0.16; // seconds of slide-in
  const RISE = 26; // px the word rises while sliding in
  const border = Math.max(4, Math.round(fontSize * 0.13)); // outline scales with size

  let chain = "";
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const text = escapeDrawWord(w.word);
    if (!text) continue;
    // Show this word until the next word begins (one word at a time).
    const start = Math.max(0, w.start);
    const end = i + 1 < words.length ? words[i + 1].start : w.end + 0.4;
    const prog = `clip((t-${start.toFixed(3)})/${SLIDE},0,1)`;
    const yExpr = `(${yAnchor})-text_h/2+${RISE}*(1-${prog})`;
    chain +=
      `,drawtext=fontfile='${fontPath}':text='${text}':` +
      `fontcolor=${FILL}:fontsize=${fontSize}:` +
      `borderw=${border}:bordercolor=black:` +
      `shadowx=0:shadowy=4:shadowcolor=black@0.6:` +
      `alpha='${prog}':x=(w-text_w)/2:y='${yExpr}':` +
      `enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'`;
  }
  return chain;
}

const OUT_W = 540;
const OUT_H = 960;
const FPS = 24;

// Hardcoded brand outro shown at the end of every property video.
const OUTRO_LOGO_PATH = path.join(process.cwd(), "assets", "branding", "esperanza-logo.png");
const OUTRO_CROSSFADE = 0.8; // seconds of crossfade from last beat into the outro
const OUTRO_PHONE_NUMBER = "(000) 000-0000"; // placeholder — update when real number is known
// CTA narration spoken over the outro. Edge TTS Ava reads this; the result is
// cached to disk and reused across every property's generated video.
const OUTRO_VOICEOVER = "Call us today to schedule your private tour.";
const OUTRO_VOICE = "en-US-AvaMultilingualNeural";
const OUTRO_MIN_DURATION = 3.0; // floor — outro always shows for at least this long
const OUTRO_TAIL_PAD = 0.6; // extra silence after the voiceover ends

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_PATH, args, { windowsHide: true });
    let stderr = "";
    proc.stderr.on("data", (c) => (stderr += c.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `ffmpeg exited with code ${code}.\nargs: ${args.join(" ")}\nstderr tail:\n${stderr.slice(
              -1500
            )}`
          )
        );
    });
  });
}

// Wrap a caption into at most maxLines lines of approximately maxCharsPerLine each,
// breaking only at word boundaries. Returns the lines as an array.
function wrapCaptionLines(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w;
    if (candidate.length <= maxCharsPerLine) {
      cur = candidate;
      continue;
    }
    if (cur) lines.push(cur);
    if (lines.length >= maxLines) {
      cur = "";
      break;
    }
    cur = w;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  // If we still had words left to process, ellipsize the last line.
  const consumedChars = lines.join(" ").length;
  const fullLength = words.join(" ").length;
  if (consumedChars < fullLength) {
    const last = lines[lines.length - 1] ?? "";
    lines[lines.length - 1] =
      last.length > maxCharsPerLine - 1 ? last.slice(0, maxCharsPerLine - 1) + "…" : last + "…";
  }
  return lines;
}

// Encode an absolute file path for use as a single-quoted argument inside an
// ffmpeg filter — converts backslashes to forward slashes and escapes the colon
// in Windows drive prefixes (otherwise ffmpeg treats `:` as filter-arg separator).
function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:");
}

// y-anchor expressions for a caption when positionMode = "dynamic". We alternate
// ONLY between top and lower-third — the middle tends to cover the subject.
const DYNAMIC_Y_ANCHORS = ["h*0.18", "h*0.62"];

// Build the drawtext (+ optional underline) filter chain for a scene caption.
// Each wrapped line is its own drawtext so it can be independently centered.
function buildCaptionFilter(
  workDir: string,
  caption: string,
  sceneIndex: number,
  settings: CaptionSettings,
  keyPrefix: string
): { drawText: string; textfiles: string[]; writes: Promise<void>[] } {
  const fontSize = Math.max(16, Math.min(80, Math.round(settings.fontSize)));
  const lineHeight = Math.round(fontSize * 1.15) + 8;
  const widthFactor = glyphWidthFactor(settings.fontFamily);
  const charsPerLine =
    settings.fontFamily === "bebas" ? 26 : Math.round(28 - fontSize * 0.15);
  const captionLines = wrapCaptionLines(caption || "", Math.max(14, charsPerLine), 3);
  const yAnchor =
    settings.positionMode === "dynamic"
      ? DYNAMIC_Y_ANCHORS[sceneIndex % DYNAMIC_Y_ANCHORS.length]
      : "h*0.62";
  const fontPath = escapeFilterPath(fontPathFor(settings));
  const textfiles: string[] = [];
  const writes: Promise<void>[] = [];
  let drawText = "";
  for (let i = 0; i < captionLines.length; i++) {
    const line = captionLines[i];
    const lineFile = path.join(workDir, `${keyPrefix}.cap-${i}.txt`);
    textfiles.push(lineFile);
    writes.push(fs.writeFile(lineFile, line, "utf-8"));
    const ff = escapeFilterPath(lineFile);
    const offsetExpr = `(${i} - ${(captionLines.length - 1) / 2}) * ${lineHeight}`;
    drawText +=
      `,drawtext=fontfile='${fontPath}':textfile='${ff}':` +
      `fontcolor=white:fontsize=${fontSize}:borderw=6:bordercolor=black:` +
      `shadowx=2:shadowy=3:shadowcolor=black@0.55:` +
      `x=(w-text_w)/2:y=(${yAnchor})+${offsetExpr}`;
    if (settings.underline) {
      const approxWidth = Math.round(line.length * fontSize * widthFactor);
      const thick = Math.max(2, Math.round(fontSize * 0.08));
      const yExpr = `(${yAnchor})+${offsetExpr}+${Math.round(fontSize * 0.95)}`;
      drawText += `,drawbox=x=(w-${approxWidth})/2:y=${yExpr}:w=${approxWidth}:h=${thick}:color=white:t=fill`;
    }
  }
  return { drawText, textfiles, writes };
}

// Frame one shot's clip into the 9:16 canvas and trim to `seconds`. Video only.
//   * Ken Burns clips are already 9:16 → cover-crop.
//   * AI clips are 16:9 landscape → Reels-style blurred-bg wrap.
async function renderShotSubsegment(
  clipPath: string,
  renderer: RendererKind,
  framing: FramingMode,
  seconds: number,
  outPath: string
): Promise<void> {
  const clipLen = await probeDurationSeconds(clipPath).catch(() => 4.8);

  // Retime so the shot exactly fills `seconds` WITHOUT ever freezing the frame:
  //   * If we need less than the clip has → trim early (natural-speed quick cut).
  //   * If we need more than the clip has → slow it down via setpts (gentle
  //     slow-motion). A freeze (clone-pad) is never used.
  let timeFilter: string;
  if (seconds <= clipLen + 0.05) {
    timeFilter = `trim=duration=${seconds},setpts=PTS-STARTPTS`;
  } else {
    const factor = (seconds / clipLen).toFixed(4); // >1 → slow down
    timeFilter = `setpts=${factor}*PTS,trim=duration=${seconds},setpts=PTS-STARTPTS`;
  }
  const tail = `${timeFilter},fps=${FPS},setsar=1,format=yuv420p`;

  // Cover-crop (fill the 9:16 frame, no bars) vs. blurred-bg letterbox.
  // Ken Burns clips are already 9:16 so they always cover. AI clips are 16:9 and
  // follow the framing mode.
  const useBlur = renderer === "ai" && framing === "blur";
  let fc: string;
  if (useBlur) {
    fc =
      `[0:v]split=2[bgsrc][fgsrc];` +
      `[bgsrc]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,` +
      `crop=${OUT_W}:${OUT_H},gblur=sigma=24,eq=brightness=-0.05[bg];` +
      `[fgsrc]scale=${OUT_W}:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,${tail}[v]`;
  } else {
    fc =
      `[0:v]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,` +
      `crop=${OUT_W}:${OUT_H},${tail}[v]`;
  }
  await runFfmpeg([
    "-y", "-i", clipPath, "-filter_complex", fc, "-map", "[v]", "-an",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-r", String(FPS), "-pix_fmt", "yuv420p", outPath,
  ]);
}

// Render a full scene: hard-cut its shots to fill the scene's VO duration, then
// overlay the caption and lay the scene's voiceover audio. Returns scene length.
async function renderSceneSegment(
  property: Property,
  scene: Scene,
  sceneIndex: number,
  settings: CaptionSettings,
  renderer: RendererKind,
  framing: FramingMode,
  segDir: string,
  segmentPath: string
): Promise<number> {
  const shots = scene.shots.filter((s) => shotClipFor(s, renderer));
  if (shots.length === 0) throw new Error(`Scene ${scene.id} has no ${renderer} clips`);

  // Pull scene audio + every shot's clip from Supabase to the workspace upfront.
  let audioPath: string | null = null;
  if (scene.audioFilename) {
    audioPath = path.join(segDir, `${scene.id}.mp3`);
    const audioBuf = await getObject(audioKey(property.id, scene.audioFilename));
    await fs.writeFile(audioPath, audioBuf);
  }
  const shotLocalByFilename = new Map<string, string>();
  for (const shot of shots) {
    const fname = shotClipFor(shot, renderer)!;
    if (shotLocalByFilename.has(fname)) continue;
    const local = path.join(segDir, fname);
    const buf = await getObject(clipKey(property.id, fname));
    await fs.writeFile(local, buf);
    shotLocalByFilename.set(fname, local);
  }

  // Scene length follows the voiceover (so the visuals match the narration).
  const plannedSum = shots.reduce((s, sh) => s + (sh.durationSeconds || 3), 0);
  const D = Math.max(
    2.5,
    scene.audioDurationSeconds ? scene.audioDurationSeconds + 0.3 : plannedSum
  );

  // Dynamic pacing: quick cuts through the scene's DISTINCT angles. Aim for
  // ~2.2s per cut (snappy) with a 1.3s floor, and always show every angle the
  // director planned. If the narration runs long, cycle back through the angles
  // (they're different crops/motions of the same room, so it stays varied, not
  // repetitive). Shots are all the same subject as the voiceover.
  const TARGET_CUT = 2.2;
  const MIN_CUT = 1.3;
  const maxByFloor = Math.max(1, Math.floor(D / MIN_CUT));
  const numCuts = Math.min(
    maxByFloor,
    Math.max(shots.length, Math.round(D / TARGET_CUT))
  );
  const cutDur = D / numCuts;

  const subPaths: string[] = [];
  for (let i = 0; i < numCuts; i++) {
    const shot = shots[i % shots.length]; // cycle through distinct angles if needed
    const clipLocal = shotLocalByFilename.get(shotClipFor(shot, renderer)!)!;
    const sub = path.join(segDir, `${scene.id}-sub${i}.mp4`);
    await renderShotSubsegment(clipLocal, renderer, framing, cutDur, sub);
    subPaths.push(sub);
  }
  const sceneRaw = path.join(segDir, `${scene.id}-raw.mp4`);
  await concatSegments(subPaths, sceneRaw);

  // Final pass: caption + scene voiceover over the concatenated scene video.
  // Kinetic (default): real-time word-by-word reveal synced to the VO.
  // Phrase (fallback): the static descriptive caption line.
  let drawText = "";
  let captionTextfiles: string[] = [];
  if (settings.style !== "phrase" && scene.captionWords && scene.captionWords.length > 0) {
    drawText = buildKineticCaptionFilter(scene.captionWords, sceneIndex, settings);
  } else {
    const cap = buildCaptionFilter(segDir, scene.caption, sceneIndex, settings, scene.id);
    await Promise.all(cap.writes);
    drawText = cap.drawText;
    captionTextfiles = cap.textfiles;
  }
  const vfilter = `[0:v]setpts=PTS-STARTPTS${drawText}[v]`;

  const args: string[] = ["-y", "-i", sceneRaw];
  if (audioPath) args.push("-i", audioPath);
  args.push("-filter_complex", vfilter);
  if (audioPath) {
    args.push("-af", `apad=whole_dur=${D},atrim=duration=${D},asetpts=PTS-STARTPTS`);
    args.push("-map", "[v]", "-map", "1:a:0");
  } else {
    args.push("-f", "lavfi", "-t", String(D), "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");
    args.push("-map", "[v]", "-map", "1:a:0", "-shortest");
  }
  args.push(
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-c:a", "aac", "-b:a", "128k", "-r", String(FPS), "-pix_fmt", "yuv420p",
    "-t", String(D), segmentPath
  );

  try {
    await runFfmpeg(args);
  } finally {
    await Promise.all([
      ...captionTextfiles.map((p) => fs.rm(p).catch(() => {})),
      ...subPaths.map((p) => fs.rm(p).catch(() => {})),
      fs.rm(sceneRaw).catch(() => {}),
    ]);
  }
  return D;
}

// Synthesize the brand outro voiceover once, cache it in Supabase Storage under
// _branding/outro-voice.mp3, and stage a local copy in the given workspace dir
// for FFmpeg. Edge TTS is free, but caching keeps the audio byte-identical
// across every property's generated video.
async function getOrCreateOutroVoice(
  workDir: string
): Promise<{ path: string; durationSeconds: number }> {
  const brand = brandKey("outro-voice.mp3");
  const localPath = path.join(workDir, "outro-voice.mp3");
  if (await objectExists(brand)) {
    const buf = await getObject(brand);
    await fs.writeFile(localPath, buf);
  } else {
    const { MsEdgeTTS, OUTPUT_FORMAT } = await import("msedge-tts");
    const tts = new MsEdgeTTS();
    await tts.setMetadata(OUTRO_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioFilePath } = await tts.toFile(workDir, OUTRO_VOICEOVER);
    if (audioFilePath !== localPath) {
      if (existsSync(localPath)) await fs.rm(localPath);
      await fs.rename(audioFilePath, localPath);
    }
    tts.close();
    const synthBuf = await fs.readFile(localPath);
    await putObject(brand, synthBuf, "audio/mpeg");
  }
  const durationSeconds = await probeDurationSeconds(localPath);
  return { path: localPath, durationSeconds };
}

// Render the hardcoded brand outro segment: logo centered on white, CALL NOW + phone
// number below, CTA voiceover audio. Same dims/fps/codecs as the beat segments so
// that the xfade join is clean. Returns the actual outro duration so the caller
// can use it for crossfade math.
async function renderOutroSegment(workDir: string, outputPath: string): Promise<number> {
  if (!existsSync(OUTRO_LOGO_PATH)) {
    throw new Error(`Outro logo missing at ${OUTRO_LOGO_PATH}`);
  }

  // Get (or synthesize) the CTA voiceover and size the outro to fit it.
  const voice = await getOrCreateOutroVoice(workDir);
  const duration = Math.max(OUTRO_MIN_DURATION, voice.durationSeconds + OUTRO_TAIL_PAD);

  // Sized so the logo + text comfortably fill the upper-mid of the 540×960 frame.
  const logoTargetWidth = 460;
  const fontPath = escapeFilterPath(path.join(FONTS_DIR, "Poppins-ExtraBold.ttf"));
  const phoneEsc = OUTRO_PHONE_NUMBER.replace(/:/g, "\\:");

  // Video filtergraph: white bg → overlay logo → drawtext CALL NOW + phone.
  // Audio filtergraph: pad TTS with silence so total length = `duration`.
  const filterComplex =
    `color=c=white:s=${OUT_W}x${OUT_H}:d=${duration}:r=${FPS},format=yuv420p[bg];` +
    `[1:v]scale=${logoTargetWidth}:-2[logo];` +
    `[bg][logo]overlay=(W-w)/2:200,` +
    `drawtext=fontfile='${fontPath}':text='CALL NOW':fontcolor=#222222:fontsize=44:` +
    `x=(w-text_w)/2:y=540,` +
    `drawtext=fontfile='${fontPath}':text='${phoneEsc}':fontcolor=#1aaff0:fontsize=56:` +
    `x=(w-text_w)/2:y=620,` +
    `setsar=1[v];` +
    `[2:a]apad=whole_dur=${duration},atrim=duration=${duration},asetpts=PTS-STARTPTS[a]`;

  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-t",
    String(duration),
    "-i",
    `color=c=white:s=${OUT_W}x${OUT_H}:r=${FPS}`,
    "-loop",
    "1",
    "-t",
    String(duration),
    "-i",
    OUTRO_LOGO_PATH,
    "-i",
    voice.path,
    "-filter_complex",
    filterComplex,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-r",
    String(FPS),
    "-pix_fmt",
    "yuv420p",
    outputPath,
  ]);
  return duration;
}

// Concat a list of MP4 files (same codec/dims) into one MP4 via the concat demuxer.
async function concatSegments(segmentPaths: string[], outputPath: string): Promise<void> {
  const listPath = outputPath + ".list.txt";
  // Concat demuxer wants forward slashes / escaped paths.
  const body = segmentPaths.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n");
  await fs.writeFile(listPath, body, "utf-8");
  try {
    await runFfmpeg([
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ]);
  } finally {
    await fs.rm(listPath).catch(() => {});
  }
}

export async function composeFinalVideo(
  property: Property,
  renderer: RendererKind
): Promise<string> {
  const activeSheet = getActiveBeatSheet(property);
  if (!activeSheet) throw new Error("No beat sheet");
  const scenes = activeSheet.scenes.filter((sc) =>
    sc.shots.some((sh) => shotClipFor(sh, renderer))
  );
  if (scenes.length === 0)
    throw new Error(`No clips rendered for "${renderer}" — render that tab first.`);

  const settings: CaptionSettings = {
    ...DEFAULT_CAPTION_SETTINGS,
    ...(property.captionSettings ?? {}),
  };
  const framing: FramingMode = property.framingMode ?? "blur";

  // All FFmpeg work happens in a per-call /tmp workspace; only the final MP4
  // gets pushed back to Supabase Storage at the end.
  const segDir = path.join(os.tmpdir(), `ptv-compose-${randomUUID()}`);
  await fs.mkdir(segDir, { recursive: true });

  const segmentPaths: string[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const segPath = path.join(segDir, `${scenes[i].id}.mp4`);
    await renderSceneSegment(property, scenes[i], i, settings, renderer, framing, segDir, segPath);
    segmentPaths.push(segPath);
  }

  // Stitch the scenes together into a single "body" clip (no transitions).
  const bodyPath = path.join(segDir, "body.mp4");
  await concatSegments(segmentPaths, bodyPath);
  const bodyDuration = await probeDurationSeconds(bodyPath);

  // Render the brand outro and crossfade it onto the end of the body.
  const outroPath = path.join(segDir, "outro.mp4");
  await renderOutroSegment(segDir, outroPath);

  const outFilename = `final-${Date.now()}.mp4`;
  const outPath = path.join(segDir, outFilename);
  const xfadeOffset = Math.max(0, bodyDuration - OUTRO_CROSSFADE);
  await runFfmpeg([
    "-y",
    "-i",
    bodyPath,
    "-i",
    outroPath,
    "-filter_complex",
    `[0:v][1:v]xfade=transition=fade:duration=${OUTRO_CROSSFADE}:offset=${xfadeOffset}[v];` +
      `[0:a][1:a]acrossfade=duration=${OUTRO_CROSSFADE}[a]`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outPath,
  ]);

  // Push the final MP4 to Supabase Storage, then nuke the local workspace.
  const finalBuf = await fs.readFile(outPath);
  await putObject(finalKey(property.id, outFilename), finalBuf, "video/mp4");
  await fs.rm(segDir, { recursive: true, force: true }).catch(() => {});

  return outFilename;
}

// Probe a file's duration in seconds via ffmpeg (stderr parsing).
function probeDurationSeconds(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_PATH, ["-i", filePath, "-hide_banner"], { windowsHide: true });
    let stderr = "";
    proc.stderr.on("data", (c) => (stderr += c.toString()));
    proc.on("error", reject);
    proc.on("close", () => {
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!m) return reject(new Error(`Could not probe duration: ${stderr.slice(-300)}`));
      resolve(
        parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3])
      );
    });
  });
}
