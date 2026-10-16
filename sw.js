/* 나의 서재 — 서비스 워커
 * 앱 화면을 기기에 저장해 두고 바로 띄웁니다. 새 버전이 올라오면 뒤에서 받아 두고 알려줘요.
 * (이 파일은 거의 바꿀 일이 없어요. index.html만 고쳐 올리면 자동으로 반영됩니다.)
 */
const SHELL = 'shell-v1';  // sw.js를 고칠 때만 숫자를 올려요
const ASSETS = 'assets-v1';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './icon-maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== ASSETS).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (/script\.google(usercontent)?\.com$/.test(url.hostname)) return;   // 서버 요청은 그대로

  // 앱 화면: 저장된 것을 바로 보여주고, 뒤에서 새 버전 확인
  if (req.mode === 'navigate' || (url.origin === location.origin && /\/(index\.html)?$/.test(url.pathname))) {
    const key = new URL('./index.html', self.registration.scope).href;
    e.respondWith(caches.open(SHELL).then(async c => {
      const cached = await c.match(key);
      const oldText = cached ? cached.clone().text() : Promise.resolve(null);
      const net = fetch(req.url, { cache: 'no-cache' }).then(async res => {
        if (res.ok) {
          const fresh = await res.clone().text();
          const old = await oldText;
          await c.put(key, res.clone());
          if (old !== null && old !== fresh) notify(e.resultingClientId || e.clientId);
        }
        return res;
      }).catch(() => cached);
      if (cached) { e.waitUntil(net); return cached; }
      return net;
    }));
    return;
  }

  // 같은 주소의 다른 파일 (아이콘 등): 저장본 우선, 뒤에서 갱신
  if (url.origin === location.origin) {
    e.respondWith(caches.open(SHELL).then(async c => {
      const cached = await c.match(req);
      const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => cached);
      return cached || net;
    }));
    return;
  }

  // 글꼴 · 책 표지: 한 번 받으면 기기에 보관
  if (req.destination === 'font' || req.destination === 'style' || req.destination === 'image') {
    e.respondWith(caches.open(ASSETS).then(async c => {
      const cached = await c.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') c.put(req, res.clone());
        return res;
      } catch (err) { return cached || Response.error(); }
    }));
  }
});

// 새로 열린 화면이 준비될 때까지 잠깐 기다렸다가 알려줌
async function notify(id) {
  for (let i = 0; i < 20; i++) {
    const c = id ? await self.clients.get(id) : null;
    if (c) { c.postMessage({ type: 'updated' }); return; }
    if (!id) { (await self.clients.matchAll({ type: 'window' })).forEach(x => x.postMessage({ type: 'updated' })); return; }
    await new Promise(r => setTimeout(r, 300));
  }
}
