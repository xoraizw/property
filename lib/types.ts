export type RoomType =
  | "exterior"
  | "living_room"
  | "kitchen"
  | "bedroom"
  | "bathroom"
  | "dining"
  | "office"
  | "garage"
  | "yard"
  | "pool"
  | "view"
  | "detail"
  | "other";

export interface PhotoScore {
  roomType: RoomType;
  quality: number; // 0-10
  isHero: boolean;
  hasPeople: boolean;
  isBlurry: boolean;
  isDuplicateOf?: string; // assetId of the canonical version
  description: string;
  notes?: string;
}

export interface Asset {
  id: string;
  filename: string; // stored filename in storage/properties/{id}/raw/
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  score?: PhotoScore;
}

export type JobStatus =
  | "idle"
  | "scoring"
  | "scored"
  | "directing"
  | "directed"
  | "rendering_clips"
  | "clips_rendered"
  | "rendering_audio"
  | "compositing"
  | "done"
  | "failed";

export type CameraMotion =
  | "static"
  | "slow_pan_left"
  | "slow_pan_right"
  | "push_in"
  | "pull_back"
  | "dolly_through"
  | "tilt_up"
  | "tilt_down";

export type RendererKind = "kenburns" | "ai";

// How a landscape AI clip is fit into the 9:16 frame:
//   "blur" → letterbox with a blurred background (whole shot visible)
//   "fill" → cover-crop to fill the frame (no bars; sides cropped)
export type FramingMode = "blur" | "fill";

// A sub-framing of a source photo, used to fake "different angles" of one room.
export type CropRegion =
  | "full"
  | "left"
  | "right"
  | "center"
  | "top"
  | "bottom"
  | "detail";

// A single rendered clip — the atomic unit of motion. Multiple shots make up a
// scene; quick-cutting between shots of the same room simulates a moving camera.
export interface Shot {
  id: string; // e.g. "scene1-shot1"
  assetId: string; // source photo
  crop: CropRegion; // sub-framing to vary the angle
  motion: CameraMotion;
  motionStrength: number; // 1.0 (subtle) – 2.0 (punchy); drives LTX camera_lora_scale
  durationSeconds: number; // planned on-screen time, 1.5–4 (re-allocated at compose to fit the scene VO)
  // Render outputs (one filename per renderer).
  kenburnsClipFilename?: string;
  aiClipFilename?: string;
  clipError?: string;
  clipErrorRenderer?: RendererKind;
  estimatedCostUsd?: number;
}

// Per-word timing (seconds, relative to the scene's audio start) for real-time captions.
export interface CaptionWord {
  word: string;
  start: number;
  end: number;
}

// A narrative unit: one continuous voiceover phrase + the shots shown under it.
export interface Scene {
  id: string; // e.g. "scene1"
  label: string; // "Kitchen", "Primary bedroom", "Reserved parking"
  voiceover: string; // the narration phrase for this scene
  caption: string; // on-screen caption (6–12 words)
  shots: Shot[];
  // TTS output for this scene's voiceover line.
  audioFilename?: string;
  audioDurationSeconds?: number;
  captionWords?: CaptionWord[]; // word-by-word timing from TTS
}

/** @deprecated old single-photo-per-beat unit; migrated to scenes on read. */
export interface Beat {
  id: string;
  startAssetId: string;
  endAssetId?: string;
  motion: CameraMotion;
  durationSeconds: number;
  voiceover: string;
  caption: string;
  rationale?: string;
  clipFilename?: string;
  kenburnsClipFilename?: string;
  aiClipFilename?: string;
  clipError?: string;
  clipErrorRenderer?: RendererKind;
  estimatedCostUsd?: number;
  audioFilename?: string;
  audioDurationSeconds?: number;
}

// Helper: pick the clip file for a given renderer.
export function shotClipFor(shot: Shot, renderer: RendererKind): string | undefined {
  return renderer === "ai" ? shot.aiClipFilename : shot.kenburnsClipFilename;
}

// All shots across a beat sheet (flattened), in play order.
export function allShots(sheet: BeatSheet): Shot[] {
  return sheet.scenes.flatMap((s) => s.shots);
}

// Convert legacy beats[] → scenes[] (one shot per scene) for back-compat.
export function beatsToScenes(beats: Beat[]): Scene[] {
  return beats.map((b, i) => ({
    id: `scene${i + 1}`,
    label: b.caption?.slice(0, 40) || `Scene ${i + 1}`,
    voiceover: b.voiceover,
    caption: b.caption,
    audioFilename: b.audioFilename,
    audioDurationSeconds: b.audioDurationSeconds,
    shots: [
      {
        id: `scene${i + 1}-shot1`,
        assetId: b.startAssetId,
        crop: "full" as CropRegion,
        motion: b.motion,
        motionStrength: 1,
        durationSeconds: b.durationSeconds || 3,
        kenburnsClipFilename: b.kenburnsClipFilename ?? b.clipFilename,
        aiClipFilename: b.aiClipFilename,
        clipError: b.clipError,
        clipErrorRenderer: b.clipErrorRenderer,
        estimatedCostUsd: b.estimatedCostUsd,
      },
    ],
  }));
}

// Helper: get the currently focused beat sheet (or undefined if none yet).
export function getActiveBeatSheet(property: {
  beatSheets?: BeatSheet[];
  activeBeatSheetId?: string;
}): BeatSheet | undefined {
  const sheets = property.beatSheets ?? [];
  if (sheets.length === 0) return undefined;
  if (property.activeBeatSheetId) {
    const found = sheets.find((s) => s.id === property.activeBeatSheetId);
    if (found) return found;
  }
  return sheets[0];
}

export interface BeatSheet {
  id: string;
  name: string; // user-editable label, e.g. "Luxury take" / "Variation 2"
  createdAt: string;
  /** Loose target video length for this variation. */
  targetSeconds?: 15 | 30 | 45 | 60;
  hookLine: string; // big opening overlay (≤6 words)
  scenes: Scene[]; // script-first: each scene is a VO phrase + its shots
  closingCta: string; // call-to-action at end (≤10 words)
  voiceStyle: string; // short hint to TTS, e.g. "warm female narrator"
  /** @deprecated migrated into scenes on read. */
  beats?: Beat[];
}

export type CaptionFontFamily = "poppins" | "bebas" | "montserrat";
export type CaptionPositionMode = "static" | "dynamic";
// "kinetic" = real-time word-by-word reveal synced to the voiceover.
// "phrase"  = the whole descriptive caption shown statically per scene.
export type CaptionStyle = "kinetic" | "phrase";

export interface CaptionSettings {
  fontFamily: CaptionFontFamily;
  fontSize: number; // 24–64
  bold: boolean;
  underline: boolean;
  positionMode: CaptionPositionMode;
  style: CaptionStyle;
}

export const DEFAULT_CAPTION_SETTINGS: CaptionSettings = {
  fontFamily: "montserrat",
  fontSize: 48,
  bold: true,
  underline: false,
  positionMode: "static",
  style: "kinetic",
};

export interface FinalVideo {
  id: string;
  filename: string;
  generatedAt: string;
  // Snapshot of the settings used for this render, so the UI can show what was applied.
  captionSettings?: CaptionSettings;
  renderer?: RendererKind;
  beatSheetId?: string;
  beatSheetName?: string;
  framingMode?: FramingMode;
  /** Estimated USD cost of producing this final video (sum of clip costs). 0 for Ken Burns. */
  costUsd?: number;
}

export interface Property {
  id: string;
  /** Owning user's id (from the simple name login). */
  ownerId?: string;
  name: string;
  tone: "luxury" | "family" | "investor";
  targetSeconds: 15 | 30 | 45 | 60;
  /** Optional amenity keywords (pool, reserved parking, gym…) used by the director. */
  amenityKeywords?: string[];
  assets: Asset[];
  /** @deprecated migrated into beatSheets[0] on read. */
  beatSheet?: BeatSheet;
  beatSheets?: BeatSheet[];
  /** Currently focused beat sheet — drives the UI and the render/generate routes. */
  activeBeatSheetId?: string;
  /** @deprecated kept for backward compat; new code should use finalVideos. */
  finalVideoFilename?: string;
  finalVideos?: FinalVideo[];
  captionSettings?: CaptionSettings;
  /** Which renderer's clips drive the next Generate-Video call + which tab is active in the UI. */
  activeRenderer?: RendererKind;
  /** How AI clips are fit into 9:16. Defaults to "blur". */
  framingMode?: FramingMode;
  status: JobStatus;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
