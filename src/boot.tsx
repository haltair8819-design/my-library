/* 앱 시작 · 로그인 · 공유 받기 · 알림으로 열기 · 돌아왔을 때 새로 받기 (예전 boot.js · store-supabase.js) */
import { S, LS, emit, book, localToday, type Rec, type View } from './lib/core'
import { sb, sbUid } from './lib/supabase'
import { Store } from './lib/store/server'
import { loadCache, refresh, flush, applyPending, splitLogs, IDB, CACHE_KEY, OUTBOX_KEY } from './lib/store/local'
import { fixOneDayLogsOnce, togetherOn } from './lib/book'
import { patchBook } from './lib/store/local'
import { tgRefresh } from './lib/together'
import { pushRefreshLater } from './lib/push'
import { go, show, initNav, TOP_VIEWS, canShow, enterHooks } from './lib/nav'
import { modal, closeModal, toast, toastAction } from './lib/ui'
import { processVoiceQueue } from './lib/voice'
import { noteOf } from './lib/notes'
import { APP_VERSION } from './lib/patchNotes'
import { applyMode } from './lib/theme'
import { openSnipInBook } from './views/Book'
import { openSnipForm, cleanShared } from './views/SnipForm'
import { openBookPicker, takeQuick } from './views/Records'
import { openPatchNotes } from './views/Settings'
import { reqStartup } from './views/Req'

canShow.together = togetherOn
canShow.note = (id: string) => !!noteOf(id)
enterHooks.notes = () => { processVoiceQueue() }

export async function sbLogin(next?: string) {
  const back = location.origin + '/' + (next ? '?' + next : '')
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: back } })
  if (error) toast('⚠ 로그인을 시작하지 못했어요: ' + error.message)
}
function openLogin() {
  modal(<><h3>나의 서재</h3>
    <div className="small" style={{ lineHeight: 1.7, marginBottom: 6 }}>구글 계정으로 시작해요. 처음이면 빈 서재가 열리고, 쓰던 기록이 있으면 그대로 불러와요.</div>
    <div className="actions"><button className="btn primary grow" onClick={() => sbLogin()}>Google로 시작하기</button></div></>, { locked: true })
}

function route() {
  const startBook = new URLSearchParams(location.search).get('book')
  const st = history.state   // 새로고침해도 보던 탭 그대로
  if (!startBook && st && (['memo', 'graph', 'stats', 'notes', 'more'].includes(st.view) || (['together', 'plib'].includes(st.view) && togetherOn()))) S.view = st.view
  if (!startBook && st && st.view === 'note' && st.id && noteOf(st.id)) { S.view = 'note'; S.noteId = st.id }
  if (startBook && book(startBook)) { S.bookId = startBook; S.view = 'book' }
  const keep = history.state && !history.state.modal ? history.state.depth || 0 : 0
  history.replaceState({ view: S.view, id: S.bookId || '', depth: S.view === 'library' ? 0 : Math.max(keep, TOP_VIEWS.includes(S.view as View) ? 1 : keep) }, '')
  show(S.view)
}
function checkNewVersion() {
  const seen = LS.get('seen_ver')
  LS.set('seen_ver', APP_VERSION)
  if (seen && seen !== APP_VERSION) setTimeout(() => toastAction(<>v{APP_VERSION}로 업데이트됐어요 · <u>바뀐 점 보기</u></>, openPatchNotes), 900)
}
// 다른 앱에서 '공유 → 나의 서재'로 보낸 글: 어느 책에 넣을지 고르고 → 필사 입력 창
async function takeShared() {
  if (new URLSearchParams(location.search).get('share') !== '1') return
  history.replaceState(Object.assign({}, history.state, { view: S.view, id: S.bookId || '' }), '', location.pathname)
  let meta: Rec | null = null; const files: File[] = []
  try {
    const c = await caches.open('share')
    const r = await c.match(new URL('/_share/meta', location.href).href)
    if (r) {
      meta = await r.json()
      for (let i = 0; i < (meta!.n || 0); i++) {
        const x = await c.match(new URL('/_share/img/' + i, location.href).href)
        if (x) { const bl = await x.blob(); files.push(new File([bl], decodeURIComponent(x.headers.get('X-Name') || 'image.jpg'), { type: bl.type || 'image/jpeg' })) }
      }
    }
    await caches.delete('share')
  } catch { /* 무시 */ }
  if (!meta || (!files.length && !String(meta.text || meta.title || meta.url || '').trim())) { toast('공유받은 내용이 없어요'); return }
  const sh = cleanShared(meta)
  const what = files.length ? `사진 ${files.length}장` : `글 ${sh.text.length.toLocaleString()}자`
  openBookPicker(`어느 책에 넣을까요? (공유받은 ${what})`, id => {
    go('book', id)
    if (files.length && !sh.text) { openSnipForm(null); toast('사진으로 필사하는 기능은 없어졌어요 · 문장을 직접 적어 주세요'); return }
    openSnipForm(null, undefined, { text: sh.text, page: sh.page, raw: sh.raw, ai: true })
  }, sh.text && !files.length ? sh.text.slice(0, 140) : undefined)
}
// 알림을 눌러 열었을 때: ?book= · ?snip= · ?view=together
export function openAppUrl(url: string) {
  let u: URL; try { u = new URL(url, location.href) } catch { return }
  const p = u.searchParams
  try { history.replaceState(Object.assign({}, history.state, { view: S.view, id: S.bookId || '' }), '', location.pathname) } catch { /* 무시 */ }
  const run = () => {
    const snip = p.get('snip'), bk = p.get('book')
    if (snip) { if (S.snips.some((s: Rec) => s.ID === snip)) openSnipInBook(snip); else toast('그 문장을 찾지 못했어요') }
    else if (bk && book(bk)) go('book', bk)
    else if (p.get('view') === 'together' && togetherOn()) go('together')
  }
  if (S.loaded) run(); else { const t = setInterval(() => { if (S.loaded) { clearInterval(t); run() } }, 300) }
}
function afterLoad() {
  route(); takeShared()
  const sp = new URLSearchParams(location.search)
  if (sp.get('snip') || sp.get('view')) openAppUrl(location.href); else takeQuick()
  checkNewVersion(); setTimeout(processVoiceQueue, 2500)
  setTimeout(fixOneDayLogsOnce, 3000)
  // 읽고 싶은 책에 잘못 들어가 있던 시작일 한 번 정리 (v2.12)
  if (!LS.get('fix_wish_start_v1')) { S.books.filter((b: Rec) => b['상태'] === '읽을예정' && b['시작일']).forEach((b: Rec) => patchBook(b.ID, { '시작일': '' })); LS.set('fix_wish_start_v1', '1') }
  if (togetherOn()) tgRefresh(true)
  reqStartup()
  pushRefreshLater()
}
export async function boot() {
  S.today = localToday()
  if (!Store.ready()) { S.needLogin = true; S.loaded = false; emit(); openLogin(); return }
  S.needLogin = false
  const c = await loadCache()
  if (c && c.books) {
    S.books = c.books; S.snips = c.snippets || []; S.memos = c.memos || []; S.logs = []; S.notes = c.notes || []; S.ver = c.ver || ''; if (c.settings) S.settings = c.settings
    splitLogs(); applyPending()
    S.loaded = true; afterLoad()
    refresh(false).then(() => flush())
  } else {
    emit()
    const ok = await refresh(true)
    if (ok) afterLoad()
    flush()
  }
}

export function startApp() {
  applyMode()
  initNav()
  window.addEventListener('online', () => { emit(); flush() })
  window.addEventListener('offline', () => emit())
  let lastTg = 0
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !S.loaded) return
    S.today = localToday()
    flush()
    if (Date.now() - (S.lastRefresh || 0) > 60000) { S.lastRefresh = Date.now(); refresh(false) }
    if (togetherOn() && Date.now() - lastTg > 90000) { lastTg = Date.now(); tgRefresh(true) }
  })
  // 알림을 누르면 열린 앱에 주소가 와요
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'open') openAppUrl(e.data.url) })
  // 로그인을 마치고 돌아오면 (또는 로그인 상태가 바뀌면) 서재 열기
  sb.auth.onAuthStateChange((ev) => {
    if ((ev === 'SIGNED_IN' || ev === 'INITIAL_SESSION') && sbUid() && S.needLogin && !S.loaded) {
      S.needLogin = false
      setTimeout(() => { closeModal(); const p = new URLSearchParams(location.search); if (p.has('code')) history.replaceState(history.state, '', location.pathname); boot() }, 50)
    }
    if (ev === 'SIGNED_OUT' && S.loaded) { IDB.del(CACHE_KEY); LS.del(OUTBOX_KEY); location.replace('/') }
  })
  const p = new URLSearchParams(location.search)
  const err = p.get('error_description') || (location.hash.match(/error_description=([^&]+)/) || [])[1]
  if (err) { history.replaceState(history.state, '', location.pathname); setTimeout(() => toast('⚠ 로그인 실패: ' + decodeURIComponent(err.replace(/\+/g, ' '))), 300) }
  // 로그인하고 막 돌아왔으면 (?code=) 로그인 마무리를 기다렸다가 시작
  if (p.has('code') && !sbUid()) { S.needLogin = true; emit(); setTimeout(() => { if (S.needLogin && !sbUid()) { history.replaceState(history.state, '', location.pathname); openLogin() } }, 8000); return }
  boot()
}
