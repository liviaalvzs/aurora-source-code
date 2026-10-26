// Guarda o app para abrir sem internet. Rede primeiro (pega a versão nova), cache só quando estiver offline.
// Os dados (Supabase) e a prévia de links nunca passam pelo cache.
const CACHE = "aurora-v1";
const SHELL = ["/", "/style.css", "/app.js", "/manifest.webmanifest", "/icon.svg", "/icon-192.png",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== "GET" || u.pathname.startsWith("/api/") || u.hostname.endsWith("supabase.co") || u.hostname.endsWith("openlibrary.org")) return;
  e.respondWith(
    fetch(req).then(res => {
      // capas e imagens de outros sites voltam "opacas" (sem status), mas podem ser guardadas
      if (res.ok || (res.type === "opaque" && req.destination === "image")) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(m => m || (req.mode === "navigate" ? caches.match("/") : Response.error())))
  );
});
