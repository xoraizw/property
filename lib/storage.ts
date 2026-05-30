import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { supabase, SUPABASE_BUCKET, publicUrl } from "./supabase";

/**
 * Object-key builders. These are paths inside the Supabase Storage bucket, NOT
 * local filesystem paths. We keep the same `raw/clips/audio/final` shape we
 * used on the filesystem so URLs stay readable and migrations are easy.
 */
export function rawKey(propertyId: string, filename: string) {
  return `properties/${propertyId}/raw/${filename}`;
}
export function clipKey(propertyId: string, filename: string) {
  return `properties/${propertyId}/clips/${filename}`;
}
export function audioKey(propertyId: string, filename: string) {
  return `properties/${propertyId}/audio/${filename}`;
}
export function finalKey(propertyId: string, filename: string) {
  return `properties/${propertyId}/final/${filename}`;
}
export function brandKey(filename: string) {
  return `_branding/${filename}`;
}

/**
 * Browser-facing URL of a raw uploaded photo. Returned to UI for <img> tags.
 * Other "kinds" (clips / audio / final) get a `/api/file/...` URL via the same
 * route, which now just redirects to Supabase's public URL.
 */
export function rawAssetUrl(propertyId: string, filename: string) {
  return `/api/file/${propertyId}/raw/${encodeURIComponent(filename)}`;
}

/** Convert a `/api/file/...` URL kind to the matching object-key prefix. */
const KIND_TO_PREFIX: Record<string, (id: string, name: string) => string> = {
  raw: rawKey,
  clips: clipKey,
  audio: audioKey,
  final: finalKey,
};

export function objectKeyForFileRoute(
  propertyId: string,
  kind: string,
  filename: string
): string | null {
  const fn = KIND_TO_PREFIX[kind];
  if (!fn) return null;
  return fn(propertyId, filename);
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase Storage primitives
// ─────────────────────────────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".json": "application/json",
  ".txt": "text/plain",
};
function mimeFor(remotePath: string): string {
  return MIME[path.extname(remotePath).toLowerCase()] || "application/octet-stream";
}

/** Upload bytes to the bucket at the given key (idempotent — overwrites). */
export async function putObject(
  remotePath: string,
  body: Buffer,
  contentType?: string
): Promise<void> {
  const { error } = await supabase()
    .storage.from(SUPABASE_BUCKET)
    .upload(remotePath, body, {
      contentType: contentType || mimeFor(remotePath),
      upsert: true,
    });
  if (error) throw new Error(`Supabase upload failed (${remotePath}): ${error.message}`);
}

/** Fetch bytes from an object in the bucket. */
export async function getObject(remotePath: string): Promise<Buffer> {
  const { data, error } = await supabase().storage.from(SUPABASE_BUCKET).download(remotePath);
  if (error || !data) throw new Error(`Supabase download failed (${remotePath}): ${error?.message}`);
  return Buffer.from(await data.arrayBuffer());
}

/** Best-effort existence check via HEAD on the public URL. */
export async function objectExists(remotePath: string): Promise<boolean> {
  try {
    const res = await fetch(publicUrl(remotePath), { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

/** Delete one object. Errors are swallowed (we use this for cleanup). */
export async function removeObject(remotePath: string): Promise<void> {
  await supabase().storage.from(SUPABASE_BUCKET).remove([remotePath]).catch(() => {});
}

/** Delete every object whose key starts with a prefix (used for property deletion). */
export async function removePrefix(prefix: string): Promise<void> {
  const sb = supabase().storage.from(SUPABASE_BUCKET);
  // Recursively list and delete. Supabase list() returns at most ~1000 per call.
  async function walk(folder: string) {
    const { data: entries } = await sb.list(folder, { limit: 1000 });
    if (!entries) return;
    const filesToRemove: string[] = [];
    for (const entry of entries) {
      const fullPath = folder ? `${folder}/${entry.name}` : entry.name;
      // Supabase tags directories with id=null; files have an id.
      if ((entry as { id?: string | null }).id === null) {
        await walk(fullPath);
      } else {
        filesToRemove.push(fullPath);
      }
    }
    if (filesToRemove.length) await sb.remove(filesToRemove).catch(() => {});
  }
  await walk(prefix);
}

// ─────────────────────────────────────────────────────────────────────────────
// Workspace: pull objects to a temp dir so FFmpeg can read/write them.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-request scratch directory. Each route handler that runs FFmpeg should
 * make one, stage Supabase objects into it, run FFmpeg locally, push outputs
 * back to Supabase, and dispose() to clean up `/tmp`.
 */
export class Workspace {
  readonly dir: string;
  private closed = false;
  constructor() {
    this.dir = path.join(os.tmpdir(), `ptv-${randomUUID()}`);
  }
  async open(): Promise<this> {
    await fs.mkdir(this.dir, { recursive: true });
    return this;
  }
  /** Local path inside this workspace (relative). */
  local(name: string): string {
    return path.join(this.dir, name);
  }
  /** Download a remote object into the workspace and return its local path. */
  async pull(remotePath: string, localName?: string): Promise<string> {
    const name = localName || path.basename(remotePath);
    const localPath = this.local(name);
    const buf = await getObject(remotePath);
    await fs.writeFile(localPath, buf);
    return localPath;
  }
  /** Upload a local file in the workspace to the bucket at `remotePath`. */
  async push(localPath: string, remotePath: string): Promise<void> {
    const buf = await fs.readFile(localPath);
    await putObject(remotePath, buf);
  }
  async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await fs.rm(this.dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function withWorkspace<T>(fn: (ws: Workspace) => Promise<T>): Promise<T> {
  const ws = await new Workspace().open();
  try {
    return await fn(ws);
  } finally {
    await ws.dispose();
  }
}
