import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { listProperties, saveProperty } from "@/lib/db";
import { putObject, rawKey } from "@/lib/storage";
import { Asset, Property } from "@/lib/types";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  const ownerId = await currentUserId();
  if (!ownerId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const properties = await listProperties(ownerId);
  return NextResponse.json({ properties });
}

export async function POST(req: NextRequest) {
  const ownerId = await currentUserId();
  if (!ownerId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const form = await req.formData();
  const name = (form.get("name") as string | null)?.trim() || "Untitled property";
  const tone = (form.get("tone") as string | null) || "luxury";
  const targetSecondsRaw = Number(form.get("targetSeconds") ?? 30);
  const targetSeconds = ([15, 30, 60].includes(targetSecondsRaw) ? targetSecondsRaw : 30) as
    | 15
    | 30
    | 60;

  const files = form.getAll("photos").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No photos uploaded" }, { status: 400 });
  }

  const propertyId = uuid();

  const assets: Asset[] = [];
  for (const file of files) {
    const assetId = uuid();
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const filename = `${assetId}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await putObject(rawKey(propertyId, filename), buffer, file.type || "image/jpeg");
    assets.push({
      id: assetId,
      filename,
      originalName: file.name,
      mimeType: file.type || "image/jpeg",
      sizeBytes: buffer.byteLength,
      uploadedAt: new Date().toISOString(),
    });
  }

  const now = new Date().toISOString();
  const property: Property = {
    id: propertyId,
    ownerId,
    name,
    tone: (tone === "family" || tone === "investor" ? tone : "luxury") as Property["tone"],
    targetSeconds,
    assets,
    status: "idle",
    createdAt: now,
    updatedAt: now,
  };
  await saveProperty(property);

  return NextResponse.json({ property });
}
