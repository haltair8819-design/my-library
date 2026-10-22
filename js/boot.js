/* 나의 서재 — 앱 시작 · 새 버전 알림
 * 화면 · 기능 파일은 서버를 직접 부르지 않고 Store.run(…)만 써요. 저장소를 바꿀 때는 store-*.js만 갈아 끼우면 돼요. */

/* ----- 앱 시작 ----- */
async function boot() {
  S.today = localToday();
  showLock();
  const startBook = new URLSearchParams(location.search).get('book');
  const route = () => {
    const st = history.state;   // 새로고침해도 보던 탭 그대로
    if (!startBook && st && ['memo', 'graph', 'stats', 'notes', 'more'].includes(st.view)) S.view = st.view;
    if (!startBook && st && st.view === 'note' && st.id && noteOf(st.id)) { S.view = 'note'; S.noteId = resolveId(st.id); }
    if (startBook && book(startBook)) { S.bookId = startBook; S.view = 'book'; }
    history.replaceState({ view: S.view, id: S.bookId || '' }, '');
    show(S.view);
  };
  renderSync();
  if (!Store.ready()) { S.needLogin = true; show('library'); $('list').innerHTML = '<div class="empty">서버를 연결하면 서재가 열려요.</div>'; Store.openSetup(); return; }
  const c = await loadCache();
  if (c && c.books) {
    S.books = c.books; S.snips = c.snippets || []; S.memos = c.memos || []; S.logs = []; S.notes = c.notes || []; S.ver = c.ver || ''; if (c.settings) S.settings = c.settings;
    splitLogs(); applyPending();
    S.loaded = true; route(); takeShared(); takeQuick(); checkNewVersion(); setTimeout(processVoiceQueue, 2500);
    refresh(false).then(() => flush());
  } else {
    show('library'); $('list').innerHTML = '<div class="empty">처음 한 번 불러오는 중이에요…</div>';
    refresh(true).then(ok => { if (ok) { route(); takeShared(); takeQuick(); } checkNewVersion(); flush(); });
  }
}
window.addEventListener('online', () => { renderSync(); flush(); });
window.addEventListener('offline', renderSync);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !S.loaded) return;
  flush();
  if (Date.now() - (S.lastRefresh || 0) > 60000) { S.lastRefresh = Date.now(); refresh(false); }
});

/* ----- 새 버전 알림 (서비스 워커) ----- */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data && e.data.type === 'updated') {
      toastAction('새 버전이 있어요 · <u>눌러서 적용</u>', () => location.reload());
    }
  });
  try { navigator.serviceWorker.startMessages(); } catch (e) {}
}


