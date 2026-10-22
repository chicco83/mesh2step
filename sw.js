/*
 * Mesh2STEP — sw.js (service worker)
 * Versione: 1.13.1 — 2026-10-22 09:19 (Europe/Rome)
 * Cache "app shell" per l'uso offline: prima la cache, poi aggiornamento in background.
 * Cambiare CACHE a ogni versione per invalidare i file vecchi.
 */
// [2026-10-07 v1.5.0] const CACHE = 'mesh2step-1.4.1';
// [2026-10-07 v1.5.1] const CACHE = 'mesh2step-1.5.0';
// [2026-10-07 v1.6.0] const CACHE = 'mesh2step-1.5.1';
// [2026-10-07 v1.7.0] const CACHE = 'mesh2step-1.6.0';
// [2026-10-08 v1.8.0] const CACHE = 'mesh2step-1.7.0';
// [2026-10-09 09:53 v1.9.0] const CACHE = 'mesh2step-1.8.0';
// [2026-10-21 14:15 v1.10.0] const CACHE = 'mesh2step-1.9.0';
// [2026-10-21 18:27 v1.11.0] const CACHE = 'mesh2step-1.10.0';
// [2026-10-21 19:26 v1.11.1] const CACHE = 'mesh2step-1.11.0';
// [2026-10-21 20:51 v1.11.2] const CACHE = 'mesh2step-1.11.1';
// [2026-10-21 21:49 v1.12.0] const CACHE = 'mesh2step-1.11.2';
// [2026-10-21 22:59 v1.13.0] const CACHE = 'mesh2step-1.12.0';
// [2026-10-22 09:19 v1.13.1] const CACHE = 'mesh2step-1.13.0';
const CACHE = 'mesh2step-1.13.1';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'src/app.js', 'src/worker.js', 'src/core.js',
  'vendor/three.module.min.js', 'vendor/OrbitControls.js', 'vendor/manifold.js', 'vendor/manifold.wasm', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => {
    const net = fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
