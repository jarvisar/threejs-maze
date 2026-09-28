// Service worker. Caches the whole game so it runs offline, which also makes it installable.
// Not bundled. The build (see vite.config.js) fills in FILES and VERSION and writes it out as sw.js.

const FILES = self.__FILES__;
// Other projects can share this origin (e.g. a GitHub Pages user site), so only touch our own caches.
const PREFIX = 'backrooms-simulator-';
const CACHE = PREFIX + self.__VERSION__;

self.addEventListener('install', (event) => {
    // 'reload' skips the HTTP cache, so a stale index.html can't end up next to newer assets.
    event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES.map((file) => new Request(file, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(caches.keys()
        .then((keys) => Promise.all(keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE).map((key) => caches.delete(key))))
        .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;

    if (request.mode === 'navigate') {
        // Network first so a new version shows up on the next visit. Cached page when offline.
        event.respondWith(fetch(request).catch(() => caches.match(new URL('index.html', location).href, { cacheName: CACHE, ignoreVary: true })));
        return;
    }
    // Everything else is content-hashed (or an icon), so the cached copy is always right.
    // ignoreVary because servers can send 'Vary: Origin' and crossorigin module scripts send an Origin the cached
    // request didn't have.
    event.respondWith(caches.match(request, { cacheName: CACHE, ignoreVary: true }).then((cached) => cached ?? fetch(request)));
});
