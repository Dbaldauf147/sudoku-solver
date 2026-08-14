// Service worker: keeps the app openable with no network.
//
// Everything the coach does — solving, hints, the walkthrough, stats, the move proofs — is client-side
// JavaScript over localStorage, so the only thing standing between it and offline play was fetching the
// page itself. That's all this caches: the shell (index.html, the manifest, the icons, the win sound).
// No game data passes through here; games live in localStorage and sync separately.
//
// The rules, in the order the fetch handler applies them:
//   · anything but GET, and every /api/ request — untouched, so sync and image import behave exactly as
//     before (they fail while offline, which the app already reports).
//   · range requests — untouched, so media seeking isn't broken by a full-body cache hit.
//   · the page itself — network first. index.html is how the app checks whether it's running the current
//     build, so online it must always come from the server; the cached copy is strictly a fallback for
//     when the network isn't there.
//   · the shell files — cache first with a background refresh, since they change rarely and are what
//     make a cold offline launch possible.
// Bump VERSION when SHELL_FILES changes, so the old cache is dropped on activate.
const VERSION = "v1";
const SHELL = `sudoku-coach-shell-${VERSION}`;
const PAGE = "./index.html";
const SHELL_FILES = [
  "./",
  PAGE,
  "./manifest.webmanifest",
  "./assets/icon.svg",
  "./assets/favicon-32.png",
  "./assets/icon-180.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/icon-512-maskable.png",
  "./assets/win.m4a",
];

self.addEventListener("install", (e) => {
  // One miss (a renamed icon, say) shouldn't fail the whole install and leave the app with no offline
  // copy at all, so each file is added on its own and failures are tolerated.
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.all(SHELL_FILES.map((f) => cache.add(new Request(f, { cache: "reload" })).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith("sudoku-coach-shell-") && key !== SHELL) await caches.delete(key);
    await self.clients.claim();
  })());
});

// Refresh a cached shell file in the background; failures are silent — this is a nicety, not the path.
function revalidate(cache, request) {
  fetch(request).then((res) => { if (res && res.ok) cache.put(request, res.clone()); }).catch(() => {});
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                       // HEAD build checks, PUT syncs: straight to the network
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;           // never cache game data or image parsing
  if (req.headers.has("range")) return;                   // let the browser negotiate media ranges itself

  const isPage = req.mode === "navigate" || url.pathname === "/" || url.pathname.endsWith("/index.html");
  if (isPage) {
    e.respondWith((async () => {
      try {
        // no-store, not a plain fetch: without it the worker can be handed the browser's own cached copy
        // of the page and quietly serve a build the server has already replaced — the exact staleness the
        // version check downstream exists to catch.
        const res = await fetch(req, { cache: "no-store" });
        if (res && res.ok) { const cache = await caches.open(SHELL); cache.put(PAGE, res.clone()); }
        return res;
      } catch {
        return (await caches.match(PAGE)) || (await caches.match("./")) || Response.error();
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) { revalidate(cache, req); return hit; }
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === "basic") cache.put(req, res.clone());
      return res;
    } catch {
      return Response.error();
    }
  })());
});
