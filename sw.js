// Offline režim: nejdřív síť (ať je vždy čerstvá verze), při výpadku poslední uložená kopie.
// Ukládají se jen soubory aplikace – nikdy data účtu ani skupin ze serveru.
const CACHE = 'vyrovnano-v10';

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
    // 'no-cache' = vždy si u serveru ověřit, jestli není novější verze souboru.
    fetch(request.url, { cache: 'no-cache' })
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

// Notifikace: zobrazení zprávy ze serveru a otevření aplikace po klepnutí.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch {}
  e.waitUntil(self.registration.showNotification(d.title || 'Vyrovnáno', {
    body: d.body || '', icon: 'brand/icon-192.png', badge: 'brand/icon-192.png', tag: d.tag || undefined,
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow('./');
  }));
});
