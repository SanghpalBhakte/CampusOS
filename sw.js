const CACHE_NAME = 'clarity-desk-v28';
const PRECACHE_ASSETS = [
  './',
  './index.html',
  'index.html',
  './style.css',
  'style.css',
  './app.js',
  'app.js',
  './data.js',
  './firebase-config.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './badge-96.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        PRECACHE_ASSETS.map((asset) => cache.add(asset).catch(() => {}))
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // Skip Firebase Firestore / Auth / Gemini / Groq API traffic from SW caching
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('firebase') || url.hostname.includes('groq.com')) {
    return;
  }

  // Network-First for Navigation and JS files to prevent stale cache lock
  if (e.request.mode === 'navigate' || url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    e.respondWith(
      fetch(e.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(e.request) || caches.match('./index.html') || caches.match('index.html') || caches.match('./'))
    );
    return;
  }

  // Stale-While-Revalidate for other static assets
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      const fetchPromise = fetch(e.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});

// ── Notification Click & Web Push Handlers ──────────────────────
const NOTIF_DEFAULT_ICON = './icon-192.png';
const NOTIF_DEFAULT_BADGE = './badge-96.png'; // monochrome transparent PNG for Android status bar

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || './#dashboard';
  const absoluteTarget = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Find an existing app window and navigate it to the right screen
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          return client.focus().then(() => {
            if ('navigate' in client) {
              return client.navigate(absoluteTarget);
            }
          });
        }
      }
      // No existing window — open a new one
      if (clients.openWindow) {
        return clients.openWindow(absoluteTarget);
      }
    })
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'Clarity Desk', body: 'You have a new update.' };
  if (event.data) {
    try { data = event.data.json(); } catch(err) { data.body = event.data.text() || data.body; }
  }
  const title = data.title || 'Clarity Desk';
  const body  = data.body  || 'Tap to open the app.';
  const tag   = data.tag   || 'cd-push-default';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:      data.icon  || NOTIF_DEFAULT_ICON,
      badge:     data.badge || NOTIF_DEFAULT_BADGE,
      tag,
      renotify:  true,
      data:      data.data  || { url: './#dashboard' }
    })
  );
});
