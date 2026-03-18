/**
 * @file sw.js
 * @description Service Worker para PWA.
 *
 * ESTRATEGIA:
 * - Cache-first para assets estáticos (CSS, JS, fonts, imágenes)
 * - Network-first para API calls (Supabase)
 * - Offline fallback para páginas navegadas
 *
 * NOTA: En producción se debe usar Serwist o Workbox.
 * Este SW básico provee funcionalidad offline mínima.
 */

const CACHE_NAME = "pos-tienda-v1";
const STATIC_ASSETS = [
  "/",
  "/caja",
  "/gastos",
  "/inventario",
  "/cierre",
  "/reportes",
  "/manifest.json",
];

// Install: pre-cache static assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch: network-first for API, cache-first for static
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== "GET") return;

  // Supabase API calls: network-first
  if (url.hostname.includes("supabase")) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        // Cache successful responses
        if (response.ok && response.type === "basic") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
