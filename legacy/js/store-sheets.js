/* 나의 서재 — 저장 담당 (구글 시트 + Apps Script)
 * 화면 · 기능 파일은 서버를 직접 부르지 않고 Store.run(…)만 써요. 저장소를 바꿀 때는 store-*.js만 갈아 끼우면 돼요. */

/* ===== 서버 연결 (앱 ↔ 구글 시트) ===== */
const LS = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
const API = { url: LS.get('api_url') || '', key: LS.get('api_key') || '' };
const LONG_FNS = { autoKeywords: 1, askAssistant: 1 };
const WRITE_FNS = { saveBook: 1, finishBook: 1, deleteBook: 1, saveSettings: 1, renameKeyword: 1, autoKeywords: 1 };

async function rpc(fn, ...args) {
  if (!API.url || !API.key) { const e = new Error('먼저 ⚙ 설정에서 서버를 연결해 주세요'); e.network = true; throw e; }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), LONG_FNS[fn] ? 360000 : 60000);
  let r;
  try {
    r = await fetch(API.url, {
      method: 'POST', redirect: 'follow', signal: ctl.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ k: API.key, fn, args })
    });
  } catch (e) {
    const err = new Error(navigator.onLine === false ? '인터넷에 연결되어 있지 않아요' : '서버에 연결하지 못했어요');
    err.network = true; throw err;
  } finally { clearTimeout(timer); }
  let j;
  try { j = await r.json(); } catch (e) {
    const err = new Error('서버 답을 읽지 못했어요. 배포의 액세스 권한이 "모든 사용자"인지 확인해 주세요');
    err.network = true; throw err;
  }
  if (!j.ok) throw new Error(j.error || '알 수 없는 오류');
  return j.data;
}
function call(fn, ...args) {
  return Store.run(fn, ...args).then(r => { if (WRITE_FNS[fn]) setTimeout(saveCache, 30); return r; })
    .catch(e => { toast('⚠ ' + (e.message || e)); throw e; });
}
function callQuiet(fn, ...args) { return Store.run(fn, ...args).catch(() => null); }


/* ----- 처음 연결 ----- */
function openConnect() {
  modal(`<h3>서버 연결</h3>
    <div class="small" style="line-height:1.6;margin-bottom:6px">Apps Script의 <b>웹 앱 URL</b>과 setupApi 실행 로그의 <b>연결 키</b>를 붙여넣으세요. 이 기기에 한 번만 넣으면 돼요.</div>
    <label>웹 앱 URL</label><input class="field" id="c-url" value="${esc(API.url)}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off">
    <label>연결 키</label><input class="field" id="c-key" value="${esc(API.key)}" placeholder="40자리 키" autocomplete="off">
    <div id="c-msg" class="small" style="margin-top:8px"></div>
    <div class="actions">${API.url ? '<button class="btn" onclick="closeModal()">취소</button>' : ''}
      <button class="btn primary grow" id="c-go" onclick="saveConnect()">연결하기</button></div>`);
}
async function saveConnect() {
  const url = $('c-url').value.trim(), key = $('c-key').value.trim();
  if (!/^https:\/\/script\.google(usercontent)?\.com\/.+\/exec/.test(url)) { $('c-msg').textContent = 'URL은 https://script.google.com/macros/s/…/exec 모양이에요'; return; }
  if (!key) { $('c-msg').textContent = '연결 키를 넣어 주세요'; return; }
  const old = { url: API.url, key: API.key };
  API.url = url; API.key = key; $('c-go').disabled = true; $('c-msg').textContent = '확인하는 중…';
  try {
    await rpc('ping');
    LS.set('api_url', url); LS.set('api_key', key);
    if (old.url && old.url !== url) { IDB.del(CACHE_KEY); LS.del(CACHE_KEY); S.ver = ''; S.loaded = false; }
    closeModal(); toast('연결됐어요');
    if (!S.loaded) $('list').innerHTML = '<div class="empty">처음 한 번 불러오는 중이에요…</div>';
    await refresh(true); flush();
  } catch (e) {
    API.url = old.url; API.key = old.key; $('c-go').disabled = false;
    $('c-msg').textContent = '⚠ ' + (e.message || e);
  }
}
function resetLocal() {
  if (S.outbox.length && !confirm(`아직 시트에 안 올라간 기록 ${S.outbox.length}개가 있어요. 그래도 비울까요?`)) return;
  IDB.del(CACHE_KEY); LS.del(CACHE_KEY); LS.del(OUTBOX_KEY); S.outbox = []; S.ver = ''; S.loaded = false;
  closeModal(); $('list').innerHTML = '<div class="empty">새로 불러오는 중…</div>'; refresh(true);
}


/* ----- 저장 담당 (Store): 화면 · 기능 파일은 이것만 써요 -----
 * kind · label: 무엇에 저장하는지, ready(): 쓸 준비가 됐는지, run(이름, …값): 저장 · 불러오기 · AI 등 서버 일,
 * openSetup(): 처음 연결 화면. 새 저장소(Supabase · 구글 드라이브)는 같은 모양의 객체를 만들어 Store에 넣으면 돼요. */
const SheetsStore = {
  kind: 'sheets',
  label: '구글 시트',
  ready: () => !!(API.url && API.key),
  run: (fn, ...args) => rpc(fn, ...args),
  openSetup: () => openConnect()
};
let Store = SheetsStore;
