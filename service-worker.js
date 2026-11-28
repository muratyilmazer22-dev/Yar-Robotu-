const CACHE_NAME = "race-analysis-shell-v29";
const APP_FILES = ["./", "./index.html", "./script.js", "./firebase-memory-loader.js", "./parser.js", "./scoring.js", "./class-history.js", "./lib/pedigree-history.js", "./lib/race-context.js", "./lib/race-relations.js", "./lib/coupon-optimizer.js", "./lib/ekuri.js", "./lib/bulletin-quality.js", "./lib/coupon-results.js", "./lib/coupon-learning.js", "./lib/learning-evaluation.js", "./lib/recovery.js", "./lib/result-evidence.js", "./manifest.webmanifest", "./horse-icon-192.png", "./horse-icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("race-analysis-shell-") && key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const requestUrl = new URL(request.url);
  if (request.method !== "GET" || requestUrl.origin !== self.location.origin || requestUrl.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("./index.html")));
    return;
  }
  if (["/script.js", "/parser.js", "/scoring.js", "/lib/bulletin-quality.js", "/lib/coupon-optimizer.js", "/lib/coupon-learning.js", "/lib/learning-evaluation.js"].includes(requestUrl.pathname)) {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
      return response;
    }).catch(() => caches.match(request)));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    }
    return response;
  })));
});
