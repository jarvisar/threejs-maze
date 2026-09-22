// Service worker: keeps a copy of the whole game so it starts with no connection, which also makes it installable.
// Not bundled: the build (see vite.config.js) fills in FILES and VERSION and writes it out as sw.js.

const FILES = self.__FILES__;
// Other projects can share this origin (e.g. a GitHub Pages user site), so only touch caches that are ours.
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
        // Network first, so a new version shows up on the next visit; the saved page when offline.
        event.respondWith(fetch(request).catch(() => caches.match(new URL('index.html', location).href, { cacheName: CACHE, ignoreVary: true })));
        return;
    }
    // Everything else has a content hash in its name (or is an icon), so the saved copy is always right.
    // ignoreVary: servers can send 'Vary: Origin', and crossorigin module scripts carry an Origin the saved request lacked.
    event.respondWith(caches.match(request, { cacheName: CACHE, ignoreVary: true }).then((cached) => cached ?? fetch(request)));
});
