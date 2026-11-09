import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

// Public files (webhooks, app manifest, service worker, icons, offline page) skip the login check.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|manifest.webmanifest|sw.js|pwa-icon|apple-icon|icon.svg|opengraph-image|robots.txt|sitemap.xml|offline).*)",
  ],
};
