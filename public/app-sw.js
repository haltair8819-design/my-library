/* 나의 서재 — 서비스 워커에 붙는 부분 (vite-plugin-pwa가 만든 sw.js가 불러와요)
 * · 폰 알림 받기 · 누르기 (반납일 · 짝꿍 반응 · 같이 읽기)
 * · 다른 앱에서 '공유 → 나의 서재'로 보낸 글 · 사진 받기 */

self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method === 'POST' && new URL(req.url).pathname.endsWith('/share-target')) e.respondWith(takeShare(req))
})

self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {} } catch (err) { d = { body: e.data ? e.data.text() : '' } }
  e.waitUntil(self.registration.showNotification(d.title || '나의 서재', {
    body: d.body || '', tag: d.tag || undefined, icon: '/icon-192.png', badge: '/icon-192.png', lang: 'ko', data: { url: d.url || '/' } }))
})
self.addEventListener('notificationclick', e => {
  e.notification.close()
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.registration.scope).href
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const c = list.find(x => x.url.startsWith(self.registration.scope))
    if (c) { await c.focus(); c.postMessage({ type: 'open', url }); return }
    await self.clients.openWindow(url)
  })())
})

// 공유받은 글 · 사진을 잠시 보관하고 앱을 열어 줌 (앱이 읽은 뒤 바로 지움)
async function takeShare(req) {
  const back = new URL('/?share=1', self.registration.scope).href
  try {
    const f = await req.formData()
    const c = await caches.open('share')
    for (const k of await c.keys()) await c.delete(k)
    const files = f.getAll('images').filter(x => x && typeof x !== 'string' && x.size)
    for (let i = 0; i < files.length; i++) {
      await c.put(new URL('/_share/img/' + i, self.registration.scope).href,
        new Response(files[i], { headers: { 'Content-Type': files[i].type || 'image/jpeg', 'X-Name': encodeURIComponent(files[i].name || 'image' + i) } }))
    }
    const meta = { title: String(f.get('title') || ''), text: String(f.get('text') || ''), url: String(f.get('url') || ''), n: files.length, at: Date.now() }
    await c.put(new URL('/_share/meta', self.registration.scope).href, new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }))
  } catch (err) { /* 무시 */ }
  return Response.redirect(back, 303)
}
