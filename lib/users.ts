import { supabase } from "./supabase";

// Each user may produce this many final videos during the soft launch.
export const VIDEO_QUOTA = 1;

export interface AppUser {
  id: string;
  name: string;
  videosGenerated: number;
  createdAt: string;
}

function slug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "guest"
  );
}

// Same name → same id, so quota persists for a returning visitor.
export function userIdFromName(name: string): string {
  return `u_${slug(name)}`;
}

export async function getUser(id: string): Promise<AppUser | null> {
  const { data, error } = await supabase()
    .from("users")
    .select("data")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getUser failed: ${error.message}`);
  if (!data) return null;
  return data.data as AppUser;
}

export async function saveUser(user: AppUser): Promise<void> {
  const { error } = await supabase()
    .from("users")
    .upsert(
      { id: user.id, data: user, updated_at: new Date().toISOString() },
      { onConflict: "id" }
    );
  if (error) throw new Error(`saveUser failed: ${error.message}`);
}

export async function getOrCreateUser(name: string): Promise<AppUser> {
  const id = userIdFromName(name);
  const existing = await getUser(id);
  if (existing) return existing;
  const user: AppUser = {
    id,
    name: name.trim().slice(0, 60) || "Guest",
    videosGenerated: 0,
    createdAt: new Date().toISOString(),
  };
  await saveUser(user);
  return user;
}

export function remainingQuota(user: AppUser | null): number {
  if (!user) return 0;
  return Math.max(0, VIDEO_QUOTA - user.videosGenerated);
}
