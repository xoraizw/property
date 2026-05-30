import Link from "next/link";
import { redirect } from "next/navigation";
import { listProperties } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { getUser, remainingQuota, VIDEO_QUOTA } from "@/lib/users";
import { UploadForm } from "./upload-form";
import { DeletePropertyButton } from "./property-actions";
import { LogoutButton } from "./logout-button";

export const dynamic = "force-dynamic";

export default async function Home() {
  const uid = await currentUserId();
  if (!uid) redirect("/login");
  const user = await getUser(uid);
  const remaining = remainingQuota(user);
  const properties = await listProperties(uid);
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <main className="mx-auto max-w-3xl px-6 py-12 space-y-10">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Pic-to-Video</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Drop property photos. Get a TikTok-format listing video.
            </p>
            <p className="text-xs text-zinc-500 mt-2">
              Signed in as <span className="font-medium">{user?.name ?? "you"}</span> ·{" "}
              <span className={remaining > 0 ? "text-emerald-600" : "text-red-600"}>
                {remaining} of {VIDEO_QUOTA} video{VIDEO_QUOTA === 1 ? "" : "s"} left
              </span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Dashboard →
            </Link>
            <LogoutButton />
          </div>
        </header>

        <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-lg font-medium mb-4">New property</h2>
          <UploadForm />
        </section>

        <section>
          <h2 className="text-lg font-medium mb-3">Recent properties</h2>
          {properties.length === 0 ? (
            <p className="text-sm text-zinc-500">No properties yet.</p>
          ) : (
            <ul className="space-y-2">
              {properties.map((p) => (
                <li
                  key={p.id}
                  className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 flex items-center gap-3"
                >
                  <Link
                    href={`/property/${p.id}`}
                    className="flex-1 flex justify-between items-center"
                  >
                    <div>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-zinc-500">
                        {p.assets.length} photos · {p.tone} · {p.status}
                      </div>
                    </div>
                    <span className="text-zinc-400">→</span>
                  </Link>
                  <DeletePropertyButton propertyId={p.id} propertyName={p.name} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
