import { cookies } from "next/headers";

export const SESSION_COOKIE = "ptv_uid";

// Works in both server components and route handlers (Next 16: cookies() is async).
export async function currentUserId(): Promise<string | null> {
  const c = await cookies();
  return c.get(SESSION_COOKIE)?.value ?? null;
}
