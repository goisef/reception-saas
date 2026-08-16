/**
 * 受付端末 PWA の Service Worker。
 *
 * 方針:
 *  - 受付画面のシェルはキャッシュしておき、通信断でも画面が開くようにする
 *  - API へのリクエストは絶対にキャッシュしない。古い予約情報で受付すると事故になる
 *  - 受付要求のオフライン再送はページ側の localStorage キューが担当する
 *    （Background Sync は iOS Safari が未対応のため当てにしない）
 */

const CACHE = 'reception-shell-v1';
const SHELL = ['/reception', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // API はネットワーク直行。キャッシュした受付結果を返してはいけない
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && request.mode === 'navigate') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || caches.match('/reception'))
      )
  );
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || '受付', {
      body: data.body,
      icon: data.icon,
    })
  );
});
