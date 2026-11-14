/* 나의 서재 — 서비스 워커
 * 앱 화면을 기기에 저장해 두고 바로 띄웁니다. 새 버전이 올라오면 뒤에서 받아 두고 알려줘요.
 * (이 파일은 거의 바꿀 일이 없어요. index.html만 고쳐 올리면 자동으로 반영됩니다.)
 */
const SHELL = 'shell-v7';  // sw.js를 고칠 때만 숫자를 올려요
const ASSETS = 'assets-v1';
const FILES = ['./', './index.html', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './icon-maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== ASSETS).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  // 다른 앱에서 '공유 → 나의 서재'로 보낸 글 · 사진 받기
  if (req.method === 'POST' && new URL(req.url).pathname.endsWith('/share-target')) { e.respondWith(takeShare(req)); return; }
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (/script\.google(usercontent)?\.com$/.test(url.hostname)) return;   // 서버 요청은 그대로
  // 앱 설정 파일(manifest)과 sw.js는 저장해 두지 않고 늘 새로 받음 → 설치할 때 최신 설정(공유 받기 등)이 쓰이도록
  if (url.origin === location.origin && /(manifest\.webmanifest|sw\.js)$/.test(url.pathname)) return;

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

  // 같은 주소의 다른 파일 (js · css · 아이콘): 저장본 우선, 뒤에서 갱신.
  // js · css는 주소 끝에 ?v=버전이 붙어서, 새 버전이 나오면 새 주소로 받아요 (예전 버전 저장본은 지움)
  if (url.origin === location.origin) {
    e.respondWith(caches.open(SHELL).then(async c => {
      const cached = await c.match(req);
      const net = fetch(req).then(async res => {
        if (res.ok) {
          await c.put(req, res.clone());
          if (url.search) (await c.keys()).forEach(k => { const u = new URL(k.url); if (u.pathname === url.pathname && u.search !== url.search) c.delete(k); });
        }
        return res;
      }).catch(() => cached);
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

// 폰 알림 (반납일 · 짝꿍 반응 · 같이 읽기)
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || '나의 서재', {
    body: d.body || '', tag: d.tag || undefined, icon: './icon-192.png', badge: './icon-192.png', lang: 'ko', data: { url: d.url || './' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const c = list.find(x => x.url.startsWith(self.registration.scope));
    if (c) { await c.focus(); c.postMessage({ type: 'open', url }); return; }
    await self.clients.openWindow(url);
  })());
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

// 공유받은 글 · 사진을 잠시 보관하고 앱을 열어 줌 (앱이 읽은 뒤 바로 지움)
async function takeShare(req) {
  const back = new URL('./?share=1', self.registration.scope).href;
  try {
    const f = await req.formData();
    const c = await caches.open('share');
    for (const k of await c.keys()) await c.delete(k);
    const files = f.getAll('images').filter(x => x && typeof x !== 'string' && x.size);
    for (let i = 0; i < files.length; i++) {
      await c.put(new URL('./_share/img/' + i, self.registration.scope).href,
        new Response(files[i], { headers: { 'Content-Type': files[i].type || 'image/jpeg', 'X-Name': encodeURIComponent(files[i].name || 'image' + i) } }));
    }
    const meta = { title: String(f.get('title') || ''), text: String(f.get('text') || ''), url: String(f.get('url') || ''), n: files.length, at: Date.now() };
    await c.put(new URL('./_share/meta', self.registration.scope).href, new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
  } catch (err) {}
  return Response.redirect(back, 303);
}
