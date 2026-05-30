import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/session";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const uid = await currentUserId();
  if (uid) redirect("/");
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 px-6">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-2xl font-semibold tracking-tight">Pic-to-Video</h1>
        <p className="text-sm text-zinc-500 mt-1 mb-6">
          Enter your name to start. You get <span className="font-medium">1 free video</span>.
        </p>
        <LoginForm />
      </div>
    </div>
  );
}
