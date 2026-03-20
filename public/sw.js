'use strict';

const CACHE = 'qr-generator-v2';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/qrcode.min.js',
  './js/app.js',
  './manifest.json',
  './icon.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())  // inside waitUntil — correct lifecycle order
      .catch(err => console.warn('[SW] Install failed:', err))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    Promise.all([
      // Remove old caches
      caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
      ),
      // Claim clients inside waitUntil — after old caches are cleared
      self.clients.claim(),
    ])
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).catch(() => {
        // Offline fallback: return the cached app shell for navigation requests
        if (e.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
