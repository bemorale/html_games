const CACHE_NAME = "stashdump-v9";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./mascot/mascot-idle.png",
  "./mascot/mascot-thinking.png",
  "./mascot/mascot-licking.png",
  "./mascot/mascot-jump-down.png",
  "./mascot/mascot-jump-up.png",
  "./mascot/mascot-jump-in.png",
  "./mascot/mascot-trashcan.png",
  "./mascot/mascot-trashcan-fallen.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for same-origin navigations/assets, falling back to cache when offline.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    // { cache: "no-store" } bypasses the browser's own HTTP cache — without it,
    // "network-first" can silently resolve to a stale disk-cached response
    // instead of what's actually on the server, defeating the whole point.
    fetch(event.request, { cache: "no-store" })
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
  );
});
