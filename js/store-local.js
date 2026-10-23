/* 나의 서재 — 기기 저장 · 대기 목록 · 동기화 (저장소 종류와 상관없이 공통)
 * 화면 · 기능 파일은 서버를 직접 부르지 않고 Store.run(…)만 써요. 저장소를 바꿀 때는 store-*.js만 갈아 끼우면 돼요. */

/* ----- 기기에 저장해 두는 데이터 (다음에 열 때 바로 보이도록) ----- */
const CACHE_KEY = 'lib_cache_v1', OUTBOX_KEY = 'lib_outbox_v1';
function localToday() { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
// 기기 저장: 큰 데이터는 IndexedDB (용량 넉넉), 작은 설정·대기 목록은 localStorage
const IDB = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('my-library', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const run = (mode, fn) => open().then(db => new Promise((res, rej) => {
    const t = db.transaction('kv', mode), q = fn(t.objectStore('kv'));
    t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  }));
  return {
    get: k => run('readonly', st => st.get(k)).catch(() => undefined),
    set: (k, v) => run('readwrite', st => st.put(v, k)).catch(() => false),
    del: k => run('readwrite', st => st.delete(k)).catch(() => false)
  };
})();
let cacheTimer = null;
function saveCache() {
  if (!S.loaded) return;
  clearTimeout(cacheTimer);
  cacheTimer = setTimeout(() => {
    IDB.set(CACHE_KEY, { ver: S.ver || '', books: S.books, snippets: S.snips, memos: S.memos.concat(S.logs || []), notes: S.notes, settings: S.settings, at: Date.now() });
  }, 250);
}
async function loadCache() {
  let c = await IDB.get(CACHE_KEY);
  if (!c) {   // 예전 버전(localStorage)에 저장된 것 옮기기
    try { c = JSON.parse(LS.get(CACHE_KEY) || 'null'); } catch (e) { c = null; }
    if (c) { await IDB.set(CACHE_KEY, c); LS.del(CACHE_KEY); }
  }
  return c || null;
}

/* ----- 바로 저장 (먼저 화면에 반영 → 뒤에서 시트에 저장, 끊기면 다시 시도) ----- */
S.outbox = (() => { try { return JSON.parse(LS.get(OUTBOX_KEY) || '[]'); } catch (e) { return []; } })();
S.outbox.forEach(o => { o.sending = false; });
S.idMap = {};
S.syncState = '';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const isTemp = id => /^T/.test(String(id || ''));
S.memos = [];
// 바로 저장되는 종류: 저장 함수 → 목록 이름
const OPS = { saveSnippet: { list: 'snips', del: 'deleteSnippet' }, saveMemo: { list: 'memos', del: 'deleteMemo' }, saveNote: { list: 'notes', del: 'deleteNote' } };
const DEL_OPS = { deleteSnippet: 'snips', deleteMemo: 'memos', deleteNote: 'notes' };
const resolveId = id => (id && S.idMap[id]) || id;
function persistOutbox() { LS.set(OUTBOX_KEY, JSON.stringify(S.outbox.map(o => Object.assign({}, o, { sending: false })))); renderSync(); }
function normKw(k) { return uniq(String(k || '').split(/[,#\n]/).map(x => x.trim())).join(', '); }

function upsertLocal(list, x) { const arr = S[list]; const i = arr.findIndex(y => y.ID === x.ID); if (i >= 0) arr[i] = x; else arr.push(x); }
function upsertSnipLocal(x) { upsertLocal('snips', x); }
function queue(op) {
  op.cid = op.cid || uid();
  if (OPS[op.fn]) {
    const ex = S.outbox.find(o => o.fn === op.fn && o.data.ID === op.data.ID && !o.sending);
    if (ex) { ex.data = op.data; ex.local = op.local; ex.error = ''; if (op.args && op.args[0]) ex.args = op.args; persistOutbox(); saveCache(); flush(); return; }
  }
  if (DEL_OPS[op.fn] && isTemp(op.id) && !S.outbox.some(o => o.sending && o.data && o.data.ID === op.id)) {
    S.outbox = S.outbox.filter(o => !(o.data && o.data.ID === op.id));
    persistOutbox(); saveCache(); return;
  }
  if (op.fn === 'updateBookFields') {
    const ex = S.outbox.find(o => o.fn === 'updateBookFields' && o.id === op.id && !o.sending);
    if (ex) { Object.assign(ex.patch, op.patch); ex.error = ''; persistOutbox(); saveCache(); flush(); return; }
  }
  S.outbox.push(op); persistOutbox(); saveCache(); flush();
}
// 서버에서 새로 받은 데이터 위에, 아직 저장 못 한 변경을 다시 얹기
function applyPending() {
  S.outbox.forEach(o => {
    if (OPS[o.fn]) upsertLocal(o.list || OPS[o.fn].list, Object.assign({}, o.local));
    else if (DEL_OPS[o.fn]) { const L = o.list || DEL_OPS[o.fn]; S[L] = S[L].filter(x => x.ID !== o.id); }
    else if (o.fn === 'updateBookFields') { const b = book(o.id); if (b) Object.assign(b, o.patch); }
  });
}
function remapId(from, to) {
  S.idMap[from] = to;
  S.outbox.forEach(o => {
    if (o.data && o.data.ID === from) { o.data.ID = to; if (o.local) o.local.ID = to; }
    if (o.id === from) o.id = to;
  });
}

let flushing = false, flushTimer = null;
async function flush() {
  if (flushing || !Store.ready() || !S.outbox.length) { renderSync(); return; }
  flushing = true; S.syncState = 'saving'; renderSync();
  let changedIds = false;
  try {
    while (S.outbox.length) {
      const op = S.outbox[0];
      if (op.error) break;   // 실패한 건 사용자가 다시 시도할 때까지 멈춤
      op.sending = true;
      try {
        if (OPS[op.fn]) {
          const list = op.list || OPS[op.fn].list;
          const d = Object.assign({}, op.data, { _cid: op.cid });
          const temp = isTemp(d.ID); if (temp) d.ID = '';
          const saved = await Store.run(op.fn, d, ...(op.args || []));
          S[list] = S[list].filter(x => x.ID !== op.data.ID && x.ID !== saved.ID);
          S[list].push(saved);
          if (temp) { remapId(op.data.ID, saved.ID); changedIds = true; }
        } else if (DEL_OPS[op.fn]) {
          await Store.run(op.fn, op.id);
        } else if (op.fn === 'updateBookFields') {
          const saved = await Store.run('updateBookFields', op.id, op.patch);
          updateBook(saved);
          S.outbox.slice(1).forEach(o => { if (o.fn === 'updateBookFields' && o.id === op.id) Object.assign(saved, o.patch); });
        }
      } catch (e) {
        op.sending = false;
        if (!e.network) { op.error = e.message || String(e); toast('⚠ 저장하지 못한 기록이 있어요: ' + op.error); }
        break;
      }
      S.outbox.shift(); persistOutbox(); saveCache();
    }
  } finally {
    flushing = false;
    S.syncState = S.outbox.length ? (S.outbox[0].error ? 'error' : 'waiting') : '';
    renderSync();
    clearTimeout(flushTimer);
    if (S.syncState === 'waiting') flushTimer = setTimeout(flush, 30000);
    if (changedIds && !$('modal').innerHTML) { if (S.view === 'book') renderBook(); else if (S.view === 'notes') renderMemoView(); else if (S.view === 'notes') renderNoteList(); }
    if (changedIds && S.noteId && S.idMap[S.noteId]) { S.noteId = S.idMap[S.noteId]; try { history.replaceState({ view: S.view, id: S.noteId }, ''); } catch (e) {} }
  }
}
function renderSync() {
  const el = $('sync'); if (!el) return;
  const n = S.outbox.length;
  let t = '', cls = '';
  if (n && S.outbox.some(o => o.error)) { t = `저장 실패 ${n}`; cls = 'err'; }
  else if (n && navigator.onLine === false) { t = `오프라인 · 대기 ${n}`; }
  else if (n) { t = flushing ? '저장 중…' : `저장 대기 ${n}`; }
  else if (S.refreshing) { t = '새로 고치는 중…'; cls = 'quiet'; }
  el.textContent = t; el.className = 'sync ' + cls; el.classList.toggle('hidden', !t);
}
function openSync() {
  if (!S.outbox.length) return;
  const name = o => o.fn === 'saveSnippet' ? '문장 저장: ' + String(o.local && (o.local['제목'] || o.local['내용']) || '').slice(0, 24)
    : o.fn === 'saveMemo' && o.list === 'logs' ? '독서 기록: ' + ((book(o.local && o.local['책ID']) || {})['제목'] || '')
    : o.fn === 'deleteMemo' && o.list === 'logs' ? '독서 기록 삭제'
    : o.fn === 'saveMemo' ? (o.local && o.local['종류'] === '할일' ? '할 일: ' : '메모: ') + String(o.local && o.local['내용'] || '').slice(0, 24)
    : o.fn === 'deleteSnippet' ? '문장 삭제' : o.fn === 'deleteMemo' ? '메모 삭제' : '책 정보: ' + ((book(o.id) || {})['제목'] || '');
  modal(`<h3>아직 시트에 저장되지 않은 기록</h3>
    <div class="small" style="margin-bottom:10px">이 기기에는 저장되어 있어요. 인터넷이 연결되면 자동으로 올라가요.</div>
    ${S.outbox.map((o, i) => `<div class="kw-row"><b style="font-weight:500">${esc(name(o))}</b><span>${o.error ? '⚠ ' + esc(o.error) : '대기 중'}</span>
      ${o.error ? `<button class="btn" style="padding:4px 10px;font-size:13px" onclick="dropOp(${i})">버리기</button>` : ''}</div>`).join('')}
    <div class="actions"><button class="btn" onclick="closeModal()">닫기</button>
      <button class="btn primary grow" onclick="retrySync()">지금 다시 시도</button></div>`);
}
function retrySync() { S.outbox.forEach(o => { o.error = ''; }); persistOutbox(); closeModal(); flush(); }
function dropOp(i) {
  if (!confirm('이 기록을 버릴까요? 되돌릴 수 없어요.')) return;
  const o = S.outbox.splice(i, 1)[0];
  if (o && OPS[o.fn] && isTemp(o.data.ID)) { const L = o.list || OPS[o.fn].list; S[L] = S[L].filter(x => x.ID !== o.data.ID); }
  persistOutbox(); saveCache(); closeModal(); if (S.outbox.length) openSync(); show(S.view);
}

/* ----- 시트와 맞추기 ----- */
async function refresh(first) {
  S.refreshing = true; renderSync();
  try {
    const d = await Store.run('sync', first ? '' : (S.ver || ''));
    if (d.settings) S.settings = d.settings;
    if (!d.same) {
      mergeSync(d);
      S.loaded = true; saveCache();
      if (!$('modal').innerHTML || first) rerender();
    } else { S.ver = d.ver; saveCache(); if (S.view === 'library') renderStats(); }
    S.lastRefresh = Date.now();
    return true;
  } catch (e) {
    if (first) {
      $('list').innerHTML = `<div class="empty">${esc(e.message || e)}<br><br><button class="btn" onclick="refresh(true)">다시 시도</button> <button class="btn" onclick="Store.openSetup()">서버 연결</button></div>`;
    }
    return false;
  } finally { S.refreshing = false; renderSync(); }
}
// 전체 또는 바뀐 것만 받은 결과를 합치기
function mergeSync(d) {
  if (d.full || !S.loaded) {
    const keepTemp = (S.notes || []).filter(n => isTemp(n.ID));   // 막 만든, 아직 안 올라간 글은 지키기
    S.books = d.books || []; S.snips = d.snippets || []; S.memos = d.memos || []; S.logs = []; S.notes = (d.notes || []).concat(keepTemp);
  } else {
    // 지운 것 먼저, 그다음 새로 받은 것 (같은 번호가 다시 생겼을 때를 위해)
    const TAB = { '책': 'books', '필사': 'snips', '메모': 'memos', '노트': 'notes' };
    (d.deleted || []).forEach(x => { const k = TAB[x.t]; if (k) S[k] = S[k].filter(r => r.ID !== x.id); if (k === 'memos') S.logs = S.logs.filter(r => r.ID !== x.id); });
    const merge = (key, rows) => {
      const arr = S[key], idx = new Map(arr.map((x, i) => [x.ID, i]));
      (rows || []).forEach(r => { const i = idx.get(r.ID); if (i != null) arr[i] = r; else { idx.set(r.ID, arr.length); arr.push(r); } });
    };
    merge('books', d.books); merge('snips', d.snippets); merge('memos', d.memos); merge('notes', d.notes);
  }
  S.ver = d.ver;
  splitLogs();
  applyPending();
}
// 독서 기록은 메모 시트에 '독서기록' 종류로 들어가요 (서버를 바꾸지 않으려고). 앱에서는 따로 모아 써요
S.logs = [];
// 앱이 쓰는 기록 줄 (메모 화면엔 안 보임). 종류 칸이 바뀌어도 알아보도록 내용 모양으로도 확인해요
const isOrderRow = m => !!m && (m['종류'] === '필사순서' || /^순서[@:]/.test(String(m['내용'] || '')));
const isReadRow = m => !!m && (m['종류'] === '독서기록' || (!!m['책ID'] && /^\d{4}-\d{2}-\d{2}\s*·\s*p\.\d+/.test(String(m['내용'] || ''))));
const isLogRow = m => isOrderRow(m) || isReadRow(m);
const readLogs = () => (S.logs || []).filter(isReadRow);
function splitLogs() {
  const seen = new Set(), memos = [], logs = [];
  S.memos.concat(S.logs || []).forEach(x => { if (!x || seen.has(x.ID)) return; seen.add(x.ID); (isLogRow(x) ? logs : memos).push(x); });
  S.memos = memos; S.logs = logs;
}
function rerender() {
  if (S.view === 'book' && !book(S.bookId)) S.view = 'library';
  if (S.view === 'graph' || S.view === 'ai' || S.view === 'note') return;   // 그물망 · 대화 · 쓰는 글은 보던 화면 유지
  show(S.view);
}

