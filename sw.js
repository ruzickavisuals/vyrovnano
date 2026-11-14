// Rychlý start i offline: soubory aplikace se berou rovnou z paměti zařízení a na pozadí se
// při každém otevření stáhne čerstvá verze. Vymění se celá najednou (nikdy napůl) a platí od dalšího otevření.
// Ukládají se jen soubory aplikace – nikdy data účtu ani skupin ze serveru.
const CACHE = 'vyrovnano-v13';
const ASSETS = [
  './', 'index.html', 'styles.css', 'app.js', 'logic.js', 'sync.js', 'auth.js', 'push.js', 'import.js', 'emoji.js', 'config.js',
  'vendor/preact-htm.js', 'vendor/qrcode.js', 'manifest.webmanifest', 'privacy.html',
  'brand/logo-dark.svg', 'brand/logo-light.svg', 'brand/icon-32.png', 'brand/icon-180.png', 'brand/icon-192.png', 'brand/icon-512.png',
];
const stamp = (res) => (res && (res.headers.get('etag') || res.headers.get('last-modified'))) || '';

let refreshing = null;
function refreshAll() {
  refreshing = refreshing || (async () => {
    const fresh = await Promise.all(ASSETS.map((u) => fetch(u, { cache: 'no-cache' })));
    if (!fresh.every((r) => r.ok)) return;
    const cache = await caches.open(CACHE);
    const old = await Promise.all(ASSETS.map((u) => cache.match(u)));
    const changed = old.some((o, i) => o && stamp(o) !== stamp(fresh[i]));
    await Promise.all(fresh.map((r, i) => cache.put(ASSETS[i], r)));
    // Otevřené aplikaci dáme vědět, že je připravená novější verze.
    if (changed) (await self.clients.matchAll({ type: 'window' })).forEach((c) => c.postMessage({ type: 'updated' }));
  })().catch(() => {}).finally(() => { refreshing = null; });
  return refreshing;
}

self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(refreshAll()); });
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
  const nav = request.mode === 'navigate';
  e.respondWith(
    caches.match(request, { ignoreSearch: nav }).then((hit) => hit || fetch(request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
      }
      return res;
    }))
  );
  if (nav) e.waitUntil(refreshAll());
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
