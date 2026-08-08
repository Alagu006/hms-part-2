import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';

// ── Cache names ──────────────────────────────
const CACHE_STATIC  = 'hms-static-v1';
const CACHE_FONTS   = 'hms-fonts-v1';
const CACHE_IMAGES  = 'hms-images-v1';

// ── Precache build assets ───────────────────
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ── Cache JS/CSS/Workers ───────────────────
const cacheablePlugin = new CacheableResponsePlugin({ statuses: [0, 200] });
const expirationPlugin = new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 7 * 24 * 3600 });

registerRoute(
  ({ request }) => ['script', 'style', 'worker'].includes(request.destination),
  new CacheFirst({ cacheName: CACHE_STATIC, plugins: [cacheablePlugin, expirationPlugin] })
);

// API responses (/api/*) are deliberately NOT cached. They carry PHI and
// per-session encrypted envelopes; storing them — or the Authorization /
// X-Client-Key headers used to replay them — in Cache Storage or IndexedDB
// would persist patient data and secrets on disk beyond the session.

// ── Cache fonts ─────────────────────────────
registerRoute(
  ({ request }) => request.destination === 'font',
  new StaleWhileRevalidate({ cacheName: CACHE_FONTS, plugins: [cacheablePlugin] })
);

// ── Cache images/icons ─────────────────────
registerRoute(
  ({ request }) => ['image', 'icon'].includes(request.destination),
  new CacheFirst({ cacheName: CACHE_IMAGES, plugins: [cacheablePlugin, expirationPlugin] })
);

// ── SPA navigation (serve index.html) ──────
registerRoute(
  new NavigationRoute(
    new NetworkFirst({ cacheName: 'hms-nav-v1', plugins: [cacheablePlugin] }),
    { denylist: [/\/api\//] }
  )
);

// ── Purge PHI persisted by older service-worker versions ─────────────────────
// Older SWs cached all /api/* responses (hms-api-v*) and queued failed vitals
// POSTs — including their Authorization / X-Client-Key headers — in the
// hms-failed-vitals IndexedDB. Delete both on activation so nothing sensitive
// survives on disk from before this hardening.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter((n) => /^hms-api-/.test(n)).map((n) => caches.delete(n))
    );
    if (typeof indexedDB !== 'undefined') {
      await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase('hms-failed-vitals');
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      });
    }
  })());
});