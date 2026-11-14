/* 화면 전환 · 뒤로 가기 — 예전 앱(v2.14.3)과 같은 규칙
 *  아래 탭(서재 · 기록 · 함께 · 연결망 · 더보기)은 쌓지 않아요.
 *  서재가 맨 아래(depth 0) → 다른 탭(depth 1) → 그 위 화면들(depth 2, 3 …). 서재에서 뒤로 가면 앱이 닫혀요.
 *  창(입력 · 설정 창)이 열려 있으면 뒤로 가기는 창만 닫아요. */
import { S, emit, book, resolveId, type View } from './core'
import { M, closeModal } from './ui'

export const TOP_VIEWS: View[] = ['library', 'notes', 'memo', 'together', 'graph', 'more']
// 화면마다 아래 탭 어디에 불이 켜지는지
export const TAB_OF: Partial<Record<View, View>> = { book: 'library', snips: 'library', note: 'notes', blist: 'more', stats: 'more', ai: 'more', settings: 'more', life: 'library', share: 'together', shared: 'together', req: 'more', pbook: 'together', plib: 'together' }
const hDepth = () => (history.state && history.state.depth) || 0
// 화면을 떠나기 전에 할 일 (예: 쓰던 글 저장) — 화면이 스스로 등록
export const leaveHooks: Partial<Record<View, () => void>> = {}
export const enterHooks: Partial<Record<View, () => void>> = {}
export const canShow: { together: () => boolean; note: (id: string) => boolean } = { together: () => true, note: () => true }

export function show(view0: View) {
  let view = view0
  if (view === 'memo') view = 'notes'   // v2.14: 노트 · 메모를 '기록' 하나로
  if (view === 'notes' && S.view !== 'notes' && S.view !== 'note') S.seedRand = Math.random()   // 기록 탭에 들어올 때마다 새 글감
  if (view !== 'book' && S.snipSel) S.snipSel = null
  if (view !== 'notes' && S.recSel) S.recSel = null
  if (S.view !== view && leaveHooks[S.view as View]) leaveHooks[S.view as View]!()
  S.view = view
  const f = enterHooks[view]; if (f) f()
  emit()
}
export function go(view: View, id?: string) {
  if (S.view === 'library' || S.view === 'snips') S.scrollMem[S.view] = window.scrollY
  if (view === 'book') { if (S.bookId !== id) { S.bookTab = '필사'; S.snipSel = null } S.bookId = id; if (S.view !== 'book') S.prevView = S.view }
  if (view === 'note') S.noteId = id
  if (view === 'pbook') id = S.pbookId
  const url = view === 'book' ? '?book=' + encodeURIComponent(id || '') : location.pathname
  const d = hDepth(), modalTop = !!(history.state && history.state.modal)
  const st = (dep: number) => ({ view, id: id || '', depth: dep })
  try {
    if (TOP_VIEWS.includes(view)) {
      const want = view === 'library' ? 0 : 1
      if (d === want) history.replaceState(st(want), '', url)
      else if (d < want) history.pushState(st(want), '', url)
      else { S.pendingNav = { view, id, depth: want, url }; if (M.node) { S.popClosing = true; closeModal(); S.popClosing = false } history.go(want - d); return }   // 위에 쌓인 화면을 걷어 내고 탭으로
    } else if (modalTop) history.replaceState(st(d), '', url)   // 열린 창 자리를 그 화면으로
    else history.pushState(st(d + 1), '', url)
  } catch { /* 무시 */ }
  if (M.node) { S.popClosing = true; closeModal(); S.popClosing = false }
  show(view); restoreScroll(view)
}
export function restoreScroll(view: View) {
  const y = (view === 'library' || view === 'snips') ? (S.scrollMem[view] || 0) : 0
  window.scrollTo(0, y)
  requestAnimationFrame(() => window.scrollTo(0, y))   // 그림이 늦게 그려질 때 한 번 더
  if (y) setTimeout(() => window.scrollTo(0, y), 60)
}
export function goBack() { try { history.back() } catch { go('library') } }
export function bookBack() {
  const prev = S.prevView
  if (prev === 'library' || prev === 'snips' || prev === 'blist') goBack(); else go('library')
}

export function initNav() {
  window.addEventListener('popstate', e => {
    if (S.ignorePop) { S.ignorePop = false; return }
    if (S.pendingNav) {   // 탭 이동: 걷어 낸 뒤 그 자리를 탭으로
      const p = S.pendingNav; S.pendingNav = null
      try { history.replaceState({ view: p.view, id: p.id || '', depth: p.depth }, '', p.url) } catch { /* 무시 */ }
      show(p.view); restoreScroll(p.view)
      return
    }
    if (M.node) {   // 창이 열려 있으면 뒤로 가기는 창만 닫기
      if (M.locked) { try { history.pushState(Object.assign({}, history.state, { modal: true, depth: hDepth() + 1 }), '', location.href) } catch { /* 무시 */ } return }
      S.popClosing = true; closeModal(); S.popClosing = false
      if (!e.state || e.state.view === S.view) return
    }
    if (S.view === 'library' || S.view === 'snips') S.scrollMem[S.view] = window.scrollY
    setTimeout(() => { if (S.view === 'library' || S.view === 'snips') restoreScroll(S.view) }, 0)
    const st = e.state || {}
    const tg = canShow.together()
    if (st.view === 'book' && st.id && book(st.id)) { S.bookId = st.id; show('book') }
    else if (st.view === 'blist' && S.blist) show('blist')
    else if (['snips', 'settings', 'life', 'req', 'stats', 'ai', 'graph', 'notes', 'memo', 'more'].includes(st.view)) show(st.view)
    else if (['share', 'shared', 'together', 'plib'].includes(st.view)) show(tg ? st.view : 'library')
    else if (st.view === 'pbook' && st.id) { S.pbookId = st.id; show(tg ? 'pbook' : 'library') }
    else if (st.view === 'note' && st.id && canShow.note(st.id)) { S.noteId = resolveId(st.id); show('note') }
    else show('library')
  })
}
