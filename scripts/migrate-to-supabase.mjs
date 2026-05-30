#!/usr/bin/env node
// One-time migration of the local data/ + storage/ trees into Supabase.
// Run this AFTER the SQL schema is applied and the `media` bucket exists.
//
//   node scripts/migrate-to-supabase.mjs
//
// Reads env from .env.local automatically. Idempotent: re-running upserts.

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

// Load .env.local (very small parser — no dependency on dotenv).
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
async function loadEnv() {
  try {
    const raw = await fs.readFile(path.join(root, ".env.local"), "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    /* ignore — env may already be in shell */
  }
}
await loadEnv();

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY;
const BUCKET = process.env.SUPABASE_BUCKET || "media";
if (!URL || !KEY) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set");
  process.exit(1);
}
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function uploadFile(localPath, remotePath) {
  const buf = await fs.readFile(localPath);
  const ext = path.extname(localPath).toLowerCase();
  const { error } = await sb.storage
    .from(BUCKET)
    .upload(remotePath, buf, { upsert: true, contentType: MIME[ext] || "application/octet-stream" });
  if (error) throw new Error(`upload ${remotePath}: ${error.message}`);
}

async function walkUpload(localDir, remotePrefix) {
  let entries;
  try {
    entries = await fs.readdir(localDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let count = 0;
  for (const e of entries) {
    const local = path.join(localDir, e.name);
    const remote = `${remotePrefix}/${e.name}`;
    if (e.isDirectory()) count += await walkUpload(local, remote);
    else {
      await uploadFile(local, remote);
      count++;
      if (count % 10 === 0) process.stdout.write(`  uploaded ${count} files…\n`);
    }
  }
  return count;
}

// 1. Users.
const usersDir = path.join(root, "data", "users");
if (await exists(usersDir)) {
  const files = (await fs.readdir(usersDir)).filter((f) => f.endsWith(".json"));
  console.log(`Migrating ${files.length} users…`);
  for (const f of files) {
    const data = JSON.parse(await fs.readFile(path.join(usersDir, f), "utf-8"));
    const { error } = await sb
      .from("users")
      .upsert({ id: data.id, data, updated_at: new Date().toISOString() }, { onConflict: "id" });
    if (error) throw new Error(`upsert user ${data.id}: ${error.message}`);
  }
}

// 2. Properties.
const propsDir = path.join(root, "data", "properties");
if (await exists(propsDir)) {
  const files = (await fs.readdir(propsDir)).filter((f) => f.endsWith(".json"));
  console.log(`Migrating ${files.length} properties…`);
  for (const f of files) {
    const data = JSON.parse(await fs.readFile(path.join(propsDir, f), "utf-8"));
    let ownerId = data.ownerId;
    if (!ownerId) {
      ownerId = process.env.DEFAULT_OWNER;
      if (!ownerId) {
        console.warn(
          `  ⚠ ${data.id} has no ownerId — set DEFAULT_OWNER env to assign one (e.g. DEFAULT_OWNER=u_soft-launch-tester)`
        );
        continue;
      }
      data.ownerId = ownerId; // persist into the jsonb blob too
    }
    const { error } = await sb
      .from("properties")
      .upsert(
        { id: data.id, owner_id: ownerId, data, updated_at: new Date().toISOString() },
        { onConflict: "id" }
      );
    if (error) throw new Error(`upsert property ${data.id}: ${error.message}`);
  }
}

// 3. Storage tree.
const storageDir = path.join(root, "storage");
if (await exists(storageDir)) {
  console.log("Uploading storage/ tree…");
  // storage/properties/{id}/... → properties/{id}/...
  const propsRoot = path.join(storageDir, "properties");
  if (await exists(propsRoot)) {
    const propDirs = await fs.readdir(propsRoot, { withFileTypes: true });
    for (const d of propDirs) {
      if (!d.isDirectory()) continue;
      const n = await walkUpload(path.join(propsRoot, d.name), `properties/${d.name}`);
      console.log(`  ${d.name}: ${n} files`);
    }
  }
  // storage/_branding/... → _branding/...
  const brandDir = path.join(storageDir, "_branding");
  if (await exists(brandDir)) {
    const n = await walkUpload(brandDir, "_branding");
    console.log(`  _branding: ${n} files`);
  }
}

console.log("Migration complete.");
