// 인터넷이 되면 항상 최신 파일을 받고, 안 되면 저장해 둔 파일로 연다.
const CACHE = 'wordbook-2026-10-27.1'; // index.html 의 v= 값과 같이 바꾼다
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'words.csv', 'shadowing.json','manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // 구글 시트 요청은 건드리지 않는다
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // ?t=… 같은 꼬리는 떼고 저장해서 같은 파일이 여러 번 쌓이지 않게 한다
  const key = url.origin + url.pathname;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }) // 브라우저 캐시 대신 서버에 새 버전이 있는지 확인한다
      .then(res => {
        const copy = res.clone();
        if (res.ok) caches.open(CACHE).then(c => c.put(key, copy));
        return res;
      })
      .catch(() => caches.match(key).then(r => r || caches.match('index.html'))),
  );
});
