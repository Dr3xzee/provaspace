// ============================================
// PROVASPACE — Service Worker
// Caches the app shell so the SPA-style pages load instantly and work offline.
// Firestore/Auth/Paystack calls always go to the network (not cached) — only static
// assets are cached here.
// ============================================

const CACHE_NAME = 'provaspace-shell-v1';

const APP_SHELL = [
  '/',
  '/index.html',
  '/client-dashboard.html',
  '/space.html',
  '/post-gig.html',
  '/profile.html',
  '/company-profile.html',
  '/disputes.html',
  '/contract-detail.html',
  '/login.html',
  '/signup.html',
  '/admin.html',
  '/css/style.css',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache Firebase/Firestore/Auth/Paystack/API calls — always go live
  if (
    url.origin.includes('firestore.googleapis.com') ||
    url.origin.includes('googleapis.com') ||
    url.origin.includes('identitytoolkit') ||
    url.origin.includes('paystack.co') ||
    url.origin.includes('cloudinary.com')
  ) {
    return;
  }

  // App shell / static assets: cache-first, fall back to network
  if (event.request.method === 'GET' && url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        return cached || fetch(event.request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        }).catch(() => cached);
      })
    );
  }
});
