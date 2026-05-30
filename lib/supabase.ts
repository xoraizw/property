import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Server-only Supabase client. We use the SECRET (service-role-equivalent) key
// and bypass RLS for everything — the browser never talks to Supabase directly.
let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set in the environment");
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "media";

// Construct the public URL of an object in our bucket. Used for direct browser
// playback (image/video tags) — no signing needed since the bucket is public
// and our paths use unguessable UUIDs.
export function publicUrl(remotePath: string): string {
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${remotePath}`;
}
