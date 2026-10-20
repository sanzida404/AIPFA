// AIPFA install shell. Only public static files are cached; account and API data stay network-only.
const SHELL_CACHE = 'aipfa-shell-v5';
const SHELL_FILES = ['/', '/index.html', '/style.css', '/app.js', '/assistantextras.js', '/pwa.js', '/manifest.webmanifest', '/icons/icon-180.png', '/icons/icon-192.png', '/icons/icon-512.png'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('aipfa-shell-') && key !== SHELL_CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const request = e.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    e.respondWith(fetch(request, { cache: 'no-store' }).then((response) => {
      if (response.ok) caches.open(SHELL_CACHE).then((cache) => cache.put('/', response.clone()));
      return response;
    }).catch(async () => (await caches.match('/')) || (await caches.match('/index.html'))));
    return;
  }
  if (SHELL_FILES.includes(url.pathname)) {
    e.respondWith(fetch(request, { cache: 'no-store' }).then((response) => {
      if (response.ok) caches.open(SHELL_CACHE).then((cache) => cache.put(request, response.clone()));
      return response;
    }).catch(async () => (await caches.match(request)) || Response.error()));
  }
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow('/');
  }));
});
