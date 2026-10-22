/* 나의 서재 — 폰 알림 · 자동 백업 · 바코드 (v2.11)
 * 알림 · 백업은 Supabase로 저장할 때만 써요. 바코드는 어느 저장소든 돼요. */

/* ===================================================================
   폰 알림 (웹 푸시): 반납일 · 짝꿍 소식
   =================================================================== */
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const PUSH_PREFS_KEY = 'push_prefs_v1';
function pushPrefs() { try { return Object.assign({ due: true, together: true }, JSON.parse(LS.get(PUSH_PREFS_KEY) || '{}')); } catch (e) { return { due: true, together: true }; } }
function b64uToU8(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); s += '='.repeat((4 - s.length % 4) % 4); const b = atob(s); return Uint8Array.from(b, c => c.charCodeAt(0)); }
const swReady = () => Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(new Error('앱을 한 번 닫았다가 다시 열어 주세요 (준비 중)')), 4000))]);
async function pushSub() { if (!pushSupported()) return null; try { const reg = await swReady(); return await reg.pushManager.getSubscription(); } catch (e) { return null; } }
async function pushSave(sub) {
  const j = sub.toJSON();
  await sbq(sbClient().rpc('save_push_sub', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_prefs: pushPrefs() }));
}
async function pushOn() {
  if (!pushSupported()) { toast('이 기기 · 브라우저는 알림을 지원하지 않아요'); return false; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('알림이 막혀 있어요. 폰 설정 → 앱 → 나의 서재 → 알림을 켜 주세요'); return false; }
  try {
    const key = await sbFn('pushKey', []);
    const reg = await swReady();
    let sub = await reg.pushManager.getSubscription();
    const want = b64uToU8(key);
    if (sub && sub.options && sub.options.applicationServerKey) {   // 서버 키가 바뀌었으면 새로
      const cur = new Uint8Array(sub.options.applicationServerKey);
      if (cur.length !== want.length || cur.some((x, i) => x !== want[i])) { await sub.unsubscribe(); sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
    await pushSave(sub);
    LS.set('push_on', '1'); return true;
  } catch (e) { toast('⚠ 알림을 켜지 못했어요: ' + (e.message || e)); return false; }
}
async function pushOff() {
  const sub = await pushSub();
  if (sub) { try { await sbq(sbClient().from('push_subs').delete().eq('endpoint', sub.endpoint)); } catch (e) {} try { await sub.unsubscribe(); } catch (e) {} }
  LS.del('push_on');
}
async function openNotify() {
  if (Store.kind !== 'supabase') { toast('알림은 Supabase로 저장할 때 쓸 수 있어요'); return; }
  const sub = await pushSub(), perm = 'Notification' in window ? Notification.permission : 'default', p = pushPrefs();
  const on = !!sub && perm === 'granted';
  modal(`<h3>폰 알림</h3>
    <div class="small" style="line-height:1.7">${!pushSupported() ? '⚠ 이 기기 · 브라우저는 알림을 지원하지 않아요. 폰에 설치한 앱에서 켜 주세요.'
      : perm === 'denied' ? '⚠ 알림이 막혀 있어요. 폰 설정 → 애플리케이션 → 나의 서재 → 알림을 허용한 뒤 다시 켜 주세요.'
      : on ? '✓ 이 기기로 알림을 받고 있어요.' : '이 기기로 받을 알림을 켜요. 기기마다 따로 켜야 해요.'}</div>
    <label class="tg-check"><input type="checkbox" id="pn-due" ${p.due ? 'checked' : ''} onchange="pushPref('due', this.checked)"> 📚 반납일 알림 <span class="small">전날 저녁 8시 · 당일 아침 8시</span></label>
    <label class="tg-check"><input type="checkbox" id="pn-tg" ${p.together ? 'checked' : ''} onchange="pushPref('together', this.checked)"> 💬 짝꿍 소식 <span class="small">내 문장에 ♡ · 한마디, 같이 읽을 책</span></label>
    <div class="actions">${on ? `<button class="btn" onclick="pushOff().then(()=>{toast('이 기기 알림을 껐어요');openNotify()})">알림 끄기</button>
      <button class="btn primary grow" onclick="pushTestUI(this)">테스트 알림 보내기</button>`
      : `<button class="btn" onclick="closeModal()">닫기</button><button class="btn primary grow" ${pushSupported() && perm !== 'denied' ? '' : 'disabled'} onclick="pushOn().then(ok=>{if(ok){toast('알림을 켰어요');openNotify()}})">알림 켜기</button>`}</div>`);
}
async function pushPref(k, v) {
  const p = Object.assign(pushPrefs(), { [k]: v }); LS.set(PUSH_PREFS_KEY, JSON.stringify(p));
  const sub = await pushSub(); if (sub) { try { await pushSave(sub); toast('저장했어요'); } catch (e) { toast('⚠ ' + (e.message || e)); } }
}
async function pushTestUI(btn) {
  btn.disabled = true; btn.textContent = '보내는 중…';
  try { await sbFn('pushTest', []); toast('보냈어요. 몇 초 안에 알림이 와요'); }
  catch (e) { toast('⚠ ' + (e.message || e)); }
  finally { btn.disabled = false; btn.textContent = '테스트 알림 보내기'; }
}
// 앱을 열 때 알림 기기 정보를 한 번 새로 저장 (주인이 바뀌었거나 키가 바뀐 경우 대비)
setTimeout(async () => {
  if (Store.kind !== 'supabase' || !LS.get('push_on') || !sbUid()) return;
  const sub = await pushSub(); if (sub && Notification.permission === 'granted') { try { await pushSave(sub); } catch (e) {} }
}, 6000);
// 짝꿍에게 알리기 (실패해도 조용히)
function notifyPartner(kind, id) { if (Store.kind === 'supabase' && id) sbFn('notify', [kind, id]).catch(() => {}); }

// 알림을 눌러 열었을 때: ?book= · ?snip= · ?view=together
function openAppUrl(url) {
  let u; try { u = new URL(url, location.href); } catch (e) { return; }
  const p = u.searchParams;
  try { history.replaceState({ view: S.view, id: S.bookId || '' }, '', location.pathname); } catch (e) {}
  const run = () => {
    if (p.get('snip')) { const id = p.get('snip'); if (S.snips.some(s => s.ID === id)) openSnipInBook(id); else toast('그 문장을 찾지 못했어요'); }
    else if (p.get('book') && book(p.get('book'))) go('book', p.get('book'));
    else if (p.get('view') === 'together' && typeof togetherOn === 'function' && togetherOn()) go('together');
  };
  if (S.loaded) run(); else { const t = setInterval(() => { if (S.loaded) { clearInterval(t); run(); } }, 300); }
}

/* ===================================================================
   자동 백업: 매주 일요일 새벽 서버가 계정별로 전체 기록을 파일로 (최근 8개)
   =================================================================== */
async function openBackups() {
  if (Store.kind !== 'supabase') { toast('자동 백업은 Supabase로 저장할 때 돼요. 지금은 구글 시트가 백업이에요'); return; }
  modal(`<h3>자동 백업</h3><div class="small" style="line-height:1.7">매주 일요일 새벽 3시에 책 · 필사 · 노트 · 메모 · 독서 기록 전체를 서버의 내 백업 칸에 파일로 남겨요. 최근 8주치를 보관해요.</div>
    <div id="bk-list"><div class="drill"><span class="spin"></span> 불러오는 중…</div></div>
    <div class="actions"><button class="btn" onclick="closeModal()">닫기</button><button class="btn primary grow" id="bk-now" onclick="backupNowUI()">지금 백업하기</button></div>`);
  drawBackups();
}
async function drawBackups() {
  const el = $('bk-list'); if (!el) return;
  try {
    const files = await sbq(sbClient().storage.from('backups').list(sbUid(), { limit: 50, sortBy: { column: 'name', order: 'desc' } }));
    const list = (files || []).filter(f => /\.json\.gz$/.test(f.name)).sort((a, b) => b.name.localeCompare(a.name));
    el.innerHTML = list.length ? `<div class="panel2">${list.map(f => `<div class="kw-row"><b style="font-weight:500">${esc(f.name.slice(0, 10).replace(/-/g, '.'))}</b>
        <span class="small">${f.metadata && f.metadata.size ? Math.max(1, Math.round(f.metadata.size / 1024)) + 'KB' : ''}</span>
        <button class="btn" onclick="downloadBackup('${esc(f.name)}', this)">내려받기</button></div>`).join('')}</div>`
      : '<div class="small" style="margin-top:10px">아직 백업이 없어요. 이번 주 일요일에 처음 만들어져요. 지금 바로 만들 수도 있어요.</div>';
  } catch (e) { el.innerHTML = `<div class="small" style="margin-top:10px">⚠ ${esc(e.message || e)}</div>`; }
}
async function backupNowUI() {
  const b = $('bk-now'); if (b) { b.disabled = true; b.textContent = '백업하는 중…'; }
  try { const r = await sbFn('backupNow', []); toast(`백업했어요 · 책 ${r.counts.books}권 · 필사 ${r.counts.snippets}개`); drawBackups(); }
  catch (e) { toast('⚠ ' + (e.message || e)); }
  finally { if ($('bk-now')) { $('bk-now').disabled = false; $('bk-now').textContent = '지금 백업하기'; } }
}
async function downloadBackup(name, btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await sbq(sbClient().storage.from('backups').download(`${sbUid()}/${name}`));
    let blob = r;
    try { blob = await new Response(r.stream().pipeThrough(new DecompressionStream('gzip'))).blob(); name = name.replace(/\.gz$/, ''); } catch (e) {}
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([blob], { type: 'application/json' })); a.download = '나의서재-백업-' + name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  } catch (e) { toast('⚠ ' + (e.message || e)); }
  finally { if (btn) btn.disabled = false; }
}

/* ===================================================================
   바코드로 책 찾기: 책 뒤 ISBN 바코드를 카메라로
   =================================================================== */
let scanStop = null;
async function openBarcode(onCode) {
  if (!('BarcodeDetector' in window)) { toast('이 브라우저는 바코드 인식을 지원하지 않아요. 바코드 아래 숫자(ISBN)를 검색칸에 입력해 주세요'); return; }
  let det;
  try {
    const fm = await BarcodeDetector.getSupportedFormats();
    det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a'].filter(f => fm.includes(f)) });
  } catch (e) { toast('바코드 인식을 시작하지 못했어요'); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false }); }
  catch (e) { toast('카메라를 쓸 수 없어요. 권한을 허용해 주세요'); return; }
  const ov = document.createElement('div'); ov.id = 'scan-ov'; ov.className = 'scan-ov';
  ov.innerHTML = `<video playsinline muted autoplay></video><div class="scan-box"><i></i></div>
    <div class="scan-tip">책 뒤 바코드를 네모 안에 맞춰 주세요</div><button class="btn scan-x" type="button">닫기</button>`;
  document.body.appendChild(ov);
  const video = ov.querySelector('video'); video.srcObject = stream;
  let done = false;
  const stop = () => { done = true; stream.getTracks().forEach(t => t.stop()); ov.remove(); scanStop = null; };
  scanStop = stop;
  ov.querySelector('.scan-x').onclick = stop;
  const seen = {};
  const tick = async () => {
    if (done) return;
    try {
      if (video.readyState >= 2) {
        const codes = await det.detect(video);
        for (const c of codes) {
          const v = String(c.rawValue || '').replace(/\D/g, '');
          if (!/^(97[89]\d{10}|\d{10})$/.test(v)) continue;   // 책 ISBN만 (가격 바코드 등은 넘김)
          seen[v] = (seen[v] || 0) + 1;
          if (seen[v] >= 2) { if (navigator.vibrate) navigator.vibrate(60); stop(); onCode(v); return; }   // 두 번 같은 값이면 확정
        }
      }
    } catch (e) {}
    setTimeout(tick, 180);
  };
  tick();
}
