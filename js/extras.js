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
// 알림 켜기: 단계마다 무엇이 막혔는지 알려 줘요
async function pushOn() {
  if (!pushSupported()) throw new Error('이 기기 · 브라우저는 알림을 지원하지 않아요. 폰에 설치한 앱에서 켜 주세요');
  let perm = Notification.permission;
  if (perm !== 'granted') perm = await Notification.requestPermission();
  if (perm !== 'granted') { const e = new Error('denied'); e.denied = true; throw e; }
  let key, reg, sub;
  try { key = await sbFn('pushKey', []); } catch (e) { throw new Error('서버에서 알림 키를 받지 못했어요: ' + (e.message || e)); }
  try { reg = await swReady(); } catch (e) { throw new Error(e.message); }
  const want = b64uToU8(key);
  try {
    sub = await reg.pushManager.getSubscription();
    if (sub && sub.options && sub.options.applicationServerKey) {   // 서버 키가 바뀌었으면 새로
      const cur = new Uint8Array(sub.options.applicationServerKey);
      if (cur.length !== want.length || cur.some((x, i) => x !== want[i])) { await sub.unsubscribe(); sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
  } catch (e) { throw new Error('이 기기를 알림 받을 곳으로 등록하지 못했어요: ' + (e.message || e)); }
  try { await pushSave(sub); } catch (e) { throw new Error('서버에 이 기기를 저장하지 못했어요: ' + (e.message || e)); }
  LS.set('push_on', '1');
}
async function pushOff() {
  const sub = await pushSub();
  if (sub) { try { await sbq(sbClient().from('push_subs').delete().eq('endpoint', sub.endpoint)); } catch (e) {} try { await sub.unsubscribe(); } catch (e) {} }
  LS.del('push_on');
}
// 설정 화면의 '알림' 칸
let pushErr = '', pushBusy = false;
function openNotify() { openSettings(); setTimeout(() => { const el = $('set-notify'); if (el) el.scrollIntoView({ block: 'center' }); }, 150); }
async function drawNotify() {
  const el = $('set-notify'); if (!el) return;
  const sup = pushSupported(), perm = sup ? Notification.permission : 'unsupported', p = pushPrefs();
  const sub = sup ? await pushSub() : null;
  // 서버에 이 기기가 저장돼 있는지도 확인 (상태 줄에 보여 줘요)
  let saved = null;
  if (sub) { try { saved = !!(await sbq(sbClient().from('push_subs').select('endpoint').eq('endpoint', sub.endpoint).maybeSingle())); } catch (e) { saved = null; } }
  const on = !!sub && perm !== 'denied' && !!LS.get('push_on');
  const diag = `권한 ${({ granted: '허용', denied: '차단', default: '아직', unsupported: '지원 안 함' })[perm] || perm} · 기기 등록 ${sub ? '있음' : '없음'} · 서버 ${saved === null ? '–' : saved ? '저장됨' : '없음'}${sub ? ' · ' + esc(new URL(sub.endpoint).hostname) : ''}`;
  const guide = `<ol class="set-guide"><li>폰 <b>설정 → 애플리케이션 → 나의 서재 → 알림</b>에서 <b>알림 허용</b>을 켜요</li>
      <li>목록에 ‘나의 서재’ 알림이 없으면 <b>설정 → 애플리케이션 → Chrome → 알림</b>도 켜져 있는지 봐요 (앱이 크롬으로 열려서요)</li>
      <li>앱으로 돌아와서 위 스위치를 다시 켜요</li></ol>`;
  el.innerHTML = `
    <label class="tg-check" style="margin-top:0"><input type="checkbox" id="pn-main" ${on ? 'checked' : ''} ${pushBusy || !sup ? 'disabled' : ''} onchange="pushToggle(this.checked)">
      <b>이 기기에서 알림 받기</b> <span class="small">${pushBusy ? '켜는 중…' : on ? '켜짐' : '꺼짐'}</span></label>
    <div class="small" style="line-height:1.7;margin-top:6px">${!sup ? '⚠ 이 브라우저는 알림을 지원하지 않아요. 폰에 설치한 앱에서 켜 주세요.'
      : perm === 'denied' ? `⚠ 폰에서 이 앱의 알림이 막혀 있어요. 앱 안에서는 폰 설정을 바꿀 수 없어서, 아래처럼 한 번만 허용해 주세요.${guide}`
      : pushErr ? `⚠ ${esc(pushErr)}` : on ? '알림이 오는 기기예요. 끄면 폰 설정과 상관없이 이 기기로는 알림을 안 보내요.' : '켜면 폰이 알림 허용을 물어봐요. 기기마다 따로 켜요.'}</div>
    <div class="${on ? '' : 'dim'}">
      <label class="tg-check"><input type="checkbox" ${p.due ? 'checked' : ''} ${on ? '' : 'disabled'} onchange="pushPref('due', this.checked)"> 📚 반납일 알림 <span class="small">전날 저녁 8시 · 당일 아침 8시</span></label>
      <label class="tg-check"><input type="checkbox" ${p.together ? 'checked' : ''} ${on ? '' : 'disabled'} onchange="pushPref('together', this.checked)"> 💬 짝꿍 소식 <span class="small">내 문장에 ♡ · 한마디, 같이 읽을 책</span></label>
      ${on ? `<div class="actions" style="margin-top:10px"><button class="btn grow" onclick="pushTestUI(this)">테스트 알림 보내기</button></div>` : ''}
    </div>
    <div class="small" style="margin-top:10px;color:var(--faint)">${diag}</div>`;
}
async function pushToggle(want) {
  pushErr = ''; pushBusy = true; drawNotify();
  try {
    if (want) { await pushOn(); toast('알림을 켰어요 · 테스트 알림을 보내 보세요'); }
    else { await pushOff(); toast('이 기기 알림을 껐어요'); }
  } catch (e) { if (!e.denied) pushErr = e.message || String(e); }
  pushBusy = false; drawNotify();
}
async function pushPref(k, v) {
  const p = Object.assign(pushPrefs(), { [k]: v }); LS.set(PUSH_PREFS_KEY, JSON.stringify(p));
  const sub = await pushSub(); if (sub) { try { await pushSave(sub); toast('저장했어요'); } catch (e) { toast('⚠ ' + (e.message || e)); } }
}
async function pushTestUI(btn) {
  btn.disabled = true; btn.textContent = '보내는 중…';
  try { const r = await sbFn('pushTest', []); toast(`보냈어요 (${r && r.sent != null ? r.sent : r}대). 몇 초 안에 알림이 와요`); if (r && r.errors && r.errors.length) { pushErr = '보내기 실패: ' + r.errors.join(' / '); drawNotify(); } }
  catch (e) { pushErr = e.message || String(e); toast('⚠ ' + pushErr); drawNotify(); }
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

/* 읽고 싶은 책에 잘못 들어가 있던 시작일 한 번 정리 (v2.12) */
(() => {
  const t = setInterval(() => {
    if (!S.loaded) return; clearInterval(t);
    if (LS.get('fix_wish_start_v1')) return;
    const list = S.books.filter(b => b['상태'] === '읽을예정' && b['시작일']);
    list.forEach(b => patchBook(b.ID, { '시작일': '' }));
    LS.set('fix_wish_start_v1', '1');
    if (list.length && S.view === 'library') renderLibrary();
  }, 500);
})();


/* ===================================================================
   업데이트 해줘요! (v2.13.2): 바꾸고 싶은 걸 모아 두었다가 한 번에 복사 → Claude에 붙여넣기
   업데이트가 되면 '업데이트됐어요'로 날짜 · 버전을 남기고 목록은 비워요
   =================================================================== */
const REQ_KEY = 'update_reqs_v1';
function reqData() {
  const st = (S.settings || {}).updReq;
  if (st && Array.isArray(st.items)) return st;
  try { return JSON.parse(LS.get(REQ_KEY) || 'null') || { items: [], log: [] }; } catch (e) { return { items: [], log: [] }; }
}
async function reqSave(d) {
  d.log = (d.log || []).slice(0, 30);
  LS.set(REQ_KEY, JSON.stringify(d));
  S.settings = Object.assign({}, S.settings, { updReq: d });
  if (Store.kind === 'supabase') { try { await Store.run('saveSettings', { updReq: d }); saveCache(); } catch (e) {} }
}
function openReq() { go('req'); }
const reqDay = t => { const d = new Date(t); return isNaN(d) ? '' : `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`; };
const reqTime = t => { const d = new Date(t); return isNaN(d) ? '' : `${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
function renderReqView() {
  const el = $('v-req'); if (!el) return;
  const d = reqData(), items = d.items || [], last = (d.log || [])[0];
  const newVer = d.copiedVer && d.copiedVer !== APP_VERSION && items.length;
  el.innerHTML = `<div class="topbar"><button class="iconbtn" onclick="goBack()">← 설정</button></div>
    <div class="view-head"><h1>업데이트 해줘요!</h1><p>바꾸고 싶은 걸 생각날 때마다 적어 두고, 모아서 한 번에 Claude에게 보내요.</p></div>
    <div class="panel2 req-st">${items.length ? `<b>대기 중 ${items.length}개</b>${d.copiedAt ? ` · ${esc(reqTime(d.copiedAt))}에 복사함` : ' · 아직 안 보냄'}` : '<b>대기 중인 요청이 없어요</b>'}
      ${last ? `<div class="small" style="margin-top:4px">마지막 업데이트: ${esc(reqDay(last.at))} · v${esc(last.ver)} · ${last.items.length}개 반영</div>` : ''}
      ${newVer ? `<div class="notice" style="margin-top:8px">복사한 뒤 새 버전(v${esc(d.copiedVer)} → v${APP_VERSION})이 나왔어요. 반영됐으면 아래 <b>업데이트됐어요</b>를 눌러 비워 주세요.</div>` : ''}</div>
    <div class="req-add"><textarea class="field" id="req-in" rows="2" placeholder="예: 메모도 꾹 눌러서 여러 개 고르기" onkeydown="if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();reqAdd()}"></textarea>
      <button class="btn primary" onclick="reqAdd()">추가</button></div>
    <div class="req-list">${items.map((it, i) => `<div class="req-it"><span class="req-n">${i + 1}</span><div class="grow" onclick="reqEdit(${i})">${esc(it.text)}<div class="small">${esc(reqTime(it.at))}</div></div>
      <button class="req-x" onclick="reqDel(${i})" aria-label="지우기">✕</button></div>`).join('') || '<div class="empty" style="padding:24px 0">위 칸에 적어 보세요</div>'}</div>
    ${items.length ? `<div class="actions" style="margin-top:12px"><button class="btn primary grow" onclick="reqCopy()">📋 전체 복사 (Claude에 붙여넣기)</button></div>
      <div class="actions"><button class="btn grow" onclick="reqDone()">✅ 업데이트됐어요 · 기록하고 비우기</button></div>` : ''}
    ${(d.log || []).length ? `<div class="sec-head tight"><h2>지난 업데이트</h2></div>${d.log.map(l => `<details class="req-log"><summary>${esc(reqDay(l.at))} · v${esc(l.ver)} · ${l.items.length}개</summary>
      <ol>${l.items.map(x => `<li>${esc(x.text)}</li>`).join('')}</ol></details>`).join('')}` : ''}`;
}
async function reqAdd() {
  const t = $('req-in'), v = t.value.trim(); if (!v) return;
  const d = reqData(); d.items = [...(d.items || []), { text: v, at: new Date().toISOString() }];
  t.value = ''; await reqSave(d); renderReqView(); setTimeout(() => { const x = $('req-in'); if (x) x.focus(); }, 30);
}
async function reqEdit(i) {
  const d = reqData(), it = d.items[i]; if (!it) return;
  const v = prompt('고치기', it.text); if (v == null) return;
  if (!v.trim()) { reqDel(i); return; }
  it.text = v.trim(); await reqSave(d); renderReqView();
}
async function reqDel(i) { const d = reqData(); d.items.splice(i, 1); await reqSave(d); renderReqView(); }
function reqText(d) {
  return `나의 서재 앱 업데이트 요청 (지금 v${APP_VERSION} · ${S.today})\n${d.items.map((x, i) => `${i + 1}. ${x.text}`).join('\n')}\n\n업데이트해줘`;
}
async function reqCopy() {
  const d = reqData(), text = reqText(d);
  try { await navigator.clipboard.writeText(text); toast('복사했어요 · Claude 대화창에 붙여넣으세요'); }
  catch (e) { modal(`<h3>복사해서 쓰세요</h3><textarea class="field" style="min-height:200px" onfocus="this.select()">${esc(text)}</textarea><div class="actions"><button class="btn primary grow" onclick="closeModal()">닫기</button></div>`); }
  d.copiedAt = new Date().toISOString(); d.copiedVer = APP_VERSION; await reqSave(d); renderReqView();
}
async function reqDone() {
  const d = reqData(); if (!d.items.length) return;
  if (!confirm(`${d.items.length}개가 반영됐나요? 오늘 날짜(v${APP_VERSION})로 기록하고 목록을 비울게요.`)) return;
  d.log = [{ at: new Date().toISOString(), ver: APP_VERSION, items: d.items }, ...(d.log || [])];
  d.items = []; d.copiedAt = ''; d.copiedVer = '';
  await reqSave(d); renderReqView(); toast('기록했어요 · 다음 요청을 적어 보세요');
}
function reqRowSub() { const d = reqData(), n = (d.items || []).length; return n ? `대기 중 ${n}개${d.copiedVer && d.copiedVer !== APP_VERSION ? ' · 새 버전 나옴' : ''}` : '바꾸고 싶은 걸 적어 두고 한 번에 복사'; }
