import { NextRequest, NextResponse } from "next/server";
import { getProperty, saveProperty } from "@/lib/db";
import { getObject, rawKey } from "@/lib/storage";
import { scorePhoto } from "@/lib/agents/vision";

export const runtime = "nodejs";
export const maxDuration = 300;

// Surface a short, human-friendly summary of an SDK error instead of the full nested JSON.
function shortError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // Try to pull the inner Gemini error JSON's message + status if present.
  const m = raw.match(/"message"\s*:\s*"([^"]+)"/);
  const s = raw.match(/"status"\s*:\s*"([^"]+)"/);
  if (m) return s ? `${s[1]}: ${m[1]}` : m[1];
  return raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
}

// Per-property locks to prevent two concurrent score runs from racing on the
// same JSON file. Tab-double-clicks would otherwise stomp each other's writes
// and the scored-count could go backwards.
const activeScoreRuns = new Map<string, Promise<unknown>>();

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  // If a score job is already running for this property, refuse the second request.
  if (activeScoreRuns.has(id)) {
    const property = await getProperty(id);
    return NextResponse.json(
      {
        property,
        error: "A scoring run is already in progress for this property — wait for it to finish.",
        alreadyRunning: true,
      },
      { status: 409 }
    );
  }

  const job = (async () => {
    const maybeProperty = await getProperty(id);
    if (!maybeProperty) return { status: 404 as const, body: { error: "Not found" } };
    const property = maybeProperty; // narrowed const so nested closures see non-null type

    property.status = "scoring";
    property.error = undefined;
    await saveProperty(property);

    // Worker pool. With OpenAI's gpt-4o-mini we have effectively no per-minute
    // ceiling at paid-tier 1 (500 RPM), so we crank concurrency way up. Without
    // OpenAI (Gemini free path), keep it modest to respect the 15 RPM limit.
    const CONCURRENCY = process.env.OPENAI_API_KEY ? 10 : 5;
    const failures: string[] = [];
    const queue = property.assets.filter((a) => !a.score);
    let nextIndex = 0;

    // Serialize disk writes so concurrent workers can't tear the JSON file.
    let savePromise: Promise<void> = Promise.resolve();
    const serializedSave = () => {
      const next = savePromise.then(() => saveProperty(property));
      savePromise = next.catch(() => undefined);
      return next;
    };

    async function worker() {
      while (true) {
        const i = nextIndex++;
        if (i >= queue.length) return;
        const asset = queue[i];
        try {
          const buf = await getObject(rawKey(property.id, asset.filename));
          asset.score = await scorePhoto(buf, asset.mimeType);
        } catch (err) {
          failures.push(`${asset.originalName}: ${shortError(err)}`);
        }
        await serializedSave();
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    const scoredCount = property.assets.filter((a) => a.score).length;
    property.status = scoredCount > 0 ? "scored" : "failed";
    property.error = failures.length ? failures.join(" | ") : undefined;
    await saveProperty(property);

    if (failures.length > 0) {
      return {
        status: 207 as const,
        body: { property, error: property.error, partial: true },
      };
    }
    return { status: 200 as const, body: { property } };
  })();

  activeScoreRuns.set(id, job);
  try {
    const result = await job;
    return NextResponse.json(result.body, { status: result.status });
  } finally {
    activeScoreRuns.delete(id);
  }
}
