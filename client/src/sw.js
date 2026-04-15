import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';

// ── Cache names ──────────────────────────────
const CACHE_STATIC  = 'hms-static-v1';
const CACHE_API     = 'hms-api-v1';
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

// ── Cache API requests ──────────────────────
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({ cacheName: CACHE_API, networkTimeoutSeconds: 8, plugins: [expirationPlugin] })
);

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

// ── Background sync for failed POST /vitals ─
const SYNC_TAG = 'vitals-sync';
const FAILED_DB = 'hms-failed-vitals';
const STORE_NAME = 'pending';

async function openFailedDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FAILED_DB, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'url', autoIncrement: false });
      }
    };
  });
}

async function replayVitals() {
  try {
    const db = await openFailedDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const all = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    for (const entry of all) {
      try {
        await fetch(entry.url, { method: entry.method, headers: entry.headers, body: entry.body });
        const delTx = db.transaction(STORE_NAME, 'readwrite');
        delTx.objectStore(STORE_NAME).delete(entry.url);
      } catch {}
    }
  } catch (err) {
    console.error('[SW] vitals-sync replay failed:', err);
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) event.waitUntil(replayVitals());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'POST') return;
  if (!request.url.endsWith('/vitals')) return;

  event.respondWith(
    fetch(request.clone()).catch(async () => {
      try {
        const db = await openFailedDb();
        const body = await request.clone().text();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const headersObj = {};
        request.headers.forEach((v, k) => (headersObj[k] = v));

        await new Promise((resolve, reject) => {
          const req = store.put({ url: request.url, method: request.method, headers: headersObj, body, ts: Date.now() });
          req.onsuccess = resolve;
          req.onerror = () => reject(req.error);
        });

        await self.registration.sync.register(SYNC_TAG);
        return new Response(JSON.stringify({ queued: true, message: 'Request queued for sync' }), { status: 202, headers: { 'Content-Type': 'application/json' } });
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Failed to queue request' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
    })
  );
});