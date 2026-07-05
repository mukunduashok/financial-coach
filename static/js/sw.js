const CACHE_NAME = "fincoach-v11";
const APP_SHELL = [
  "/",
  "/css/styles.css",
  "/js/main.js",
  "/js/config.js",
  "/js/env.js",
  "/js/db.js",
  "/js/ai.js",
  "/js/api.js",
  "/js/app.js",
  "/js/gmail.js",
  "/js/utils.js",
  "/js/sql-wasm.js",
  "/js/sql-wasm.wasm",
  "/js/theme-init.js",
  "/js/theme-apply.js",
  "/js/sw-register.js",
  "/manifest.json",
];

// Install — cache app shell
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

// Activate — clear old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      ),
  );
  self.clients.claim();
});

// Fetch — cache-first for same-origin static assets, network-only for external
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== "GET") return;

  // Network-only for external resources (CDN scripts, APIs)
  if (url.origin !== self.location.origin) return;

  // Cache-first for static assets
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
