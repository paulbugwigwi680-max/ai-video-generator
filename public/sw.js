// BUGWIGWI service worker.
// It only keeps public files (app code, fonts, icons) and an "offline" page.
// Pages with your projects, credits and videos are NEVER stored: they always come from the network.
const VERSION = "v1";
const STATIC = "bugwigwi-static-" + VERSION;
const PAGES = "bugwigwi-pages-" + VERSION;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGES)
      .then((cache) => cache.add(new Request("/offline", { cache: "reload" })))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase, Cloudinary, etc. go straight to the network
  if (url.pathname.startsWith("/api/")) return;

  // Page visits: network first; if there is no internet, show the offline page.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(async () => (await caches.match("/offline")) || Response.error())
    );
    return;
  }

  // Built app files never change under the same name, so keep them for speed.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/pwa-icon/")) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })
    );
  }
});
