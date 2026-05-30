import { NextResponse, type NextRequest } from "next/server";

// Keep this literal in sync with SESSION_COOKIE in lib/session.ts. We don't
// import it because that module pulls in next/headers, which isn't available
// in the proxy (edge) runtime.
const SESSION_COOKIE = "ptv_uid";

// Gate the app pages behind the simple name-login. API routes do their own
// per-request ownership/quota checks, and /api/file must stay open so <video>/
// <img> tags load. We only guard the page routes here.
export function proxy(req: NextRequest) {
  const uid = req.cookies.get(SESSION_COOKIE)?.value;
  if (!uid) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/property/:path*", "/dashboard"],
};
