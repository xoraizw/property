import { supabase } from "./supabase";
import { Beat, Property, beatsToScenes } from "./types";

// Promote legacy fields from older saved properties so the rest of the code
// can assume the new shape. Runs on every read.
function migrateOnRead(p: Property): Property {
  if (!p.activeRenderer) p.activeRenderer = "kenburns";

  // Legacy singular beatSheet → beatSheets[].
  if (p.beatSheet && (!p.beatSheets || p.beatSheets.length === 0)) {
    p.beatSheets = [p.beatSheet];
    p.activeBeatSheetId ||= p.beatSheet.id ?? "legacy";
  }

  // For every sheet: ensure it has scenes[].
  for (const sheet of p.beatSheets ?? []) {
    const s = sheet as typeof sheet & { beats?: Beat[]; scenes?: unknown };
    if ((!s.scenes || (s.scenes as unknown[]).length === 0) && s.beats?.length) {
      for (const b of s.beats) {
        if (b.clipFilename && !b.kenburnsClipFilename) b.kenburnsClipFilename = b.clipFilename;
      }
      sheet.scenes = beatsToScenes(s.beats);
    }
    if (!sheet.scenes) sheet.scenes = [];
    if (!sheet.id) sheet.id = "legacy";
    if (!sheet.name) sheet.name = "Variation 1";
    if (!sheet.createdAt) sheet.createdAt = p.createdAt;
  }

  if (!p.activeBeatSheetId && p.beatSheets?.[0]) {
    p.activeBeatSheetId = p.beatSheets[0].id;
  }
  return p;
}

export async function saveProperty(property: Property): Promise<void> {
  property.updatedAt = new Date().toISOString();
  if (!property.ownerId) {
    throw new Error("saveProperty: property is missing ownerId");
  }
  const { error } = await supabase()
    .from("properties")
    .upsert(
      {
        id: property.id,
        owner_id: property.ownerId,
        data: property,
        updated_at: property.updatedAt,
      },
      { onConflict: "id" }
    );
  if (error) throw new Error(`saveProperty failed: ${error.message}`);
}

export async function getProperty(id: string): Promise<Property | null> {
  const { data, error } = await supabase()
    .from("properties")
    .select("data")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getProperty failed: ${error.message}`);
  if (!data) return null;
  return migrateOnRead(data.data as Property);
}

export async function deleteProperty(id: string): Promise<boolean> {
  const { error, count } = await supabase()
    .from("properties")
    .delete({ count: "exact" })
    .eq("id", id);
  if (error) throw new Error(`deleteProperty failed: ${error.message}`);
  return (count ?? 0) > 0;
}

export async function listProperties(ownerId?: string): Promise<Property[]> {
  let q = supabase()
    .from("properties")
    .select("data")
    .order("updated_at", { ascending: false });
  if (ownerId) q = q.eq("owner_id", ownerId);
  const { data, error } = await q;
  if (error) throw new Error(`listProperties failed: ${error.message}`);
  return (data ?? []).map((row) => migrateOnRead(row.data as Property));
}
