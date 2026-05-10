/* Minimal service worker — installability on Android Chrome expects a fetch handler. */
self.addEventListener("install", (event) => {
  event.waitUntil(Promise.resolve().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
