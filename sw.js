/**
 * Service worker — offline-first app shell.
 *
 * - Precaches the shell into a versioned cache (bypassing the HTTP cache).
 * - Cache-first for everything same-origin; navigations fall back to index.html.
 * - Old caches are removed on activate. A new version waits until the page
 *   asks it to take over (the "Update" toast), so a running timer is never
 *   interrupted by a surprise reload.
 *
 * BUILD is stamped by the deploy workflow so every release gets a fresh cache.
 */

const BUILD = "dev";
const CACHE = `pomodoro-timer-${BUILD}`;

const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/tokens.css",
  "./css/base.css",
  "./css/components.css",
  "./css/animations.css",
  "./js/main.js",
  "./js/state.js",
  "./js/storage.js",
  "./js/timer.js",
  "./js/audio.js",
  "./js/notify.js",
  "./js/ui.js",
  "./js/fx.js",
  "./js/stats.js",
  "./js/settings.js",
  "./js/tab.js",
  "./assets/fonts/inter-var.woff2",
  "./assets/icons/favicon.svg",
  "./assets/icons/favicon-32.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/apple-touch-icon.png",
  "./assets/icons/badge-72.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: "reload" })))),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("pomodoro-timer-") && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match("./index.html");
        if (cached) return cached;
        try {
          return await fetch(request);
        } catch {
          return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok && response.type === "basic") cache.put(request, response.clone());
        return response;
      } catch {
        return new Response("", { status: 504 });
      }
    })(),
  );
});

// Tapping a notification brings the app forward.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = all.find((c) => c.url.startsWith(self.registration.scope));
      if (existing) return existing.focus();
      return self.clients.openWindow("./");
    })(),
  );
});
