const CACHE_NAME = 'hh-static-cache-v9-security';
const STATIC_ASSETS = [
  '/login',
  '/market-events',
  '/inventory',
  '/manifest.json',
  '/favicon.ico',
  '/hh-logo.png'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      console.log('[Service Worker] Pre-caching offline UI shells...');
      return cache.addAll(STATIC_ASSETS).catch(function(err) {
        console.warn('[Service Worker] Failed to pre-cache some assets:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Cleaning expired cache:', cacheName);
            return caches.delete(cacheName);
          }

          // Defense in depth for same-version reinstallations: authenticated API
          // responses must never survive in Cache Storage.
          return caches.open(cacheName).then(function(cache) {
            return cache.keys().then(function(requests) {
              return Promise.all(
                requests.map(function(request) {
                  const pathname = new URL(request.url).pathname;
                  if (pathname === '/api' || pathname.startsWith('/api/')) {
                    return cache.delete(request);
                  }
                  return false;
                })
              );
            });
          });
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// Fetch Interceptor
self.addEventListener('fetch', function(event) {
  const requestUrl = new URL(event.request.url);

  // Bypass non-GET requests entirely
  if (event.request.method !== 'GET') {
    return;
  }

  const isApiRequest = requestUrl.pathname === '/api' || requestUrl.pathname.startsWith('/api/');
  const isHtmlRequest = event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html');

  // Authenticated API responses are always network-only. Offline domain data is
  // handled by the app's explicitly scoped IndexedDB stores, never Cache Storage.
  if (isApiRequest) {
    event.respondWith(
      fetch(event.request).catch(function() {
        console.warn('[Service Worker] API fetch failed (offline):', requestUrl.pathname);
        return new Response(
          JSON.stringify({ detail: "Offline - network unavailable", offline: true }),
          {
            status: 503,
            statusText: "Service Unavailable",
            headers: { "Content-Type": "application/json" }
          }
        );
      })
    );
    return;
  }

  // 1. HTML requests: Network-First (always fresh when online, offline shell fallback)
  if (isHtmlRequest) {
    event.respondWith(
      fetch(event.request).then(function(networkResponse) {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      }).catch(function() {
        console.log('[Service Worker] Serving cache offline for:', requestUrl.pathname);
        return caches.match(event.request).then(function(cachedResponse) {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Offline fallback for HTML requests
          if (isHtmlRequest) {
            return caches.match('/login') || caches.match('/');
          }
        });
      })
    );
    return;
  }

  // 2. Static Assets (images, css, js) caching strategy: Cache-First, fallback to Network
  event.respondWith(
    caches.match(event.request).then(function(cachedResponse) {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then(function(networkResponse) {
        if (networkResponse && networkResponse.status === 200 && event.request.url.startsWith(self.location.origin)) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      });
    })
  );
});

// Push event listener
self.addEventListener('push', function(event) {
  let data = { title: 'H+H Hub', body: 'New stock update ready.' };
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { title: 'H+H Hub', body: event.data.text() };
    }
  }
  
  const options = {
    body: data.body,
    icon: '/hh-logo.png',
    badge: '/hh-logo.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: '1'
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options).catch(function(err) {
      console.warn('[Service Worker] Notification show failed:', err);
    })
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.openWindow('/')
  );
});
