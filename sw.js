// Offline režim: nejdřív síť (ať je vždy čerstvá verze), při výpadku poslední uložená kopie.
// Ukládají se jen soubory aplikace – nikdy data účtu ani skupin ze serveru.
const CACHE = 'vyrovnano-v3';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) =>
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
);

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const own = request.url.startsWith(self.location.origin + '/');
  if (request.method !== 'GET' || !own) return;
  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request, { ignoreSearch: request.mode === 'navigate' }))
  );
});
