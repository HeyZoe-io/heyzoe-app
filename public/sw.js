/* Minimal service worker — installability on Android Chrome expects a fetch handler. */
self.addEventListener("install", (event) => {
  event.waitUntil(Promise.resolve().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
