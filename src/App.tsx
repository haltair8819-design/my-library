/* 앱 뼈대: 화면 하나 + 아래 탭 5개 + ＋ 버튼 + 창 · 알림 · 녹음 창 · 잠금 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { S, LS, subscribe, getVersion, book, type View } from './lib/core'
import { togetherOn } from './lib/book'
import { go, TAB_OF } from './lib/nav'
import { R, cancelRecording, finishRecording } from './lib/voice'
import { ModalHost, Toast, ToTop } from './components/common'
import { LibraryView } from './views/Library'
import { BookView, AllSnipsView } from './views/Book'
import { RecordsView, openNewRecord, openQuickMenu } from './views/Records'
import { NoteView } from './views/NoteEditor'
import { GraphView } from './views/Graph'
import { StatsView, BookListView } from './views/Stats'
import { AIView } from './views/AI'
import { LifeView } from './views/Life'
import { TogetherView, PartnerLibView, PartnerBookView, ShareListView } from './views/Together'
import { MoreView, SettingsView, LockScreen } from './views/Settings'
import { ReqView } from './views/Req'
import { openSnipForm } from './views/SnipForm'
import { openBookForm } from './views/BookForms'

const ICONS: Record<string, React.ReactNode> = {
  library: <svg viewBox="0 0 24 24"><path d="M4 19V5a1 1 0 0 1 1-1h3v16H5a1 1 0 0 1-1-1zM8 4h4v16H8M12 6.5l3.6-1 3.4 13.6-3.6 1z" /></svg>,
  notes: <svg viewBox="0 0 24 24"><path d="M5 20l1.2-4.2L16.5 5.5a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L9.2 18.8z" /><path d="M14.5 7.5l2.8 2.8M5 20h14" /></svg>,
  together: <svg viewBox="0 0 24 24"><circle cx="8.5" cy="8" r="3" /><circle cx="16" cy="9" r="2.5" /><path d="M3 19c.6-3.3 2.8-5 5.5-5s4.9 1.7 5.5 5M14.2 14.3c.6-.2 1.2-.3 1.8-.3 2.3 0 4.2 1.5 4.8 4.5" /></svg>,
  graph: <svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2.4" /><circle cx="18" cy="8" r="2.4" /><circle cx="9" cy="18" r="2.4" /><circle cx="18" cy="18" r="1.8" /><path d="M8.2 7 15.8 7.6M7 8.3l1.4 7.4M16.4 9.8l-5.5 6.6M11.4 18h4.8" /></svg>,
  more: <svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="18" cy="12" r="1.6" /></svg>,
}
const TABS: [View, string][] = [['library', '서재'], ['notes', '기록'], ['together', '함께'], ['graph', '연결망'], ['more', '더보기']]
const FAB_VIEWS = ['library', 'memo', 'notes', 'book']
const FAB_LABEL: Record<string, string> = { library: '책 추가', notes: '새 기록', book: '이 책에 문장 추가' }

function Nav() {
  const tab = TAB_OF[S.view as View] || S.view
  return <nav className="nav" id="nav">{TABS.filter(([v]) => v !== 'together' || togetherOn()).map(([v, label]) =>
    <button key={v} data-v={v} className={tab === v ? 'on' : ''} onClick={() => go(v)}>{ICONS[v]}{label}{v === 'together' && <i className={'tg-dot ' + ((S.tg.incoming || []).length ? '' : 'hidden')} />}</button>)}</nav>
}
// ＋ 버튼: 지금 보고 있는 탭에 맞는 것만 (서재 → 책 추가, 기록 → 새 기록, 책 → 문장)
function Fab() {
  const hide = !FAB_VIEWS.includes(S.view) || (S.view === 'book' && !!S.snipSel) || (S.view === 'notes' && !!S.recSel) || !S.loaded
  const click = () => {
    if (S.view === 'book' && book(S.bookId)) openSnipForm(null, S.bookTab === '생각' ? '생각' : '인용')
    else if (S.view === 'library') openBookForm(null)
    else if (S.view === 'notes') openNewRecord()
    else openQuickMenu()
  }
  return <button className={'fab ' + (hide ? 'hidden' : '')} id="fab" aria-label={FAB_LABEL[S.view] || '빠르게 남기기'} onClick={click}>＋</button>
}
function RecOverlay() {
  if (R.busy) return <div id="rec"><div className="rec-sheet busy"><span className="spin" /> {R.busy}</div></div>
  if (!R.on) return <div id="rec" />
  const label = ({ memo: '말한 내용을 메모로 정리해요. 할 일이 있으면 따로 뽑아요.', snip: '책 문장을 읽어 주세요. "48쪽"처럼 쪽수도 말하면 쪽수 칸에 넣어요.', note: '말한 그대로 글로 옮겨요.' } as Record<string, string>)[R.mode] || ''
  return <div id="rec"><div className="rec-sheet" role="dialog" aria-label="녹음 중">
    <div className="rec-top"><span className="rec-dot" /><b id="rec-t">{Math.floor(R.sec / 60)}:{String(R.sec % 60).padStart(2, '0')}</b><span className="small">최대 5분</span></div>
    <div className="rec-bar"><i id="rec-lv" style={{ width: Math.min(100, R.level * 260) + '%' }} /></div>
    <div className="small" style={{ margin: '8px 0 14px', lineHeight: 1.55 }}>{label}</div>
    <div className="actions" style={{ margin: 0 }}><button className="btn" onClick={cancelRecording}>취소</button>
      <button className="btn primary grow" onClick={finishRecording}>녹음 끝 · 정리하기</button></div></div></div>
}
function CurrentView() {
  switch (S.view as View) {
    case 'book': return <BookView />
    case 'snips': return <AllSnipsView />
    case 'notes': case 'memo': return <RecordsView />
    case 'note': return <NoteView />
    case 'graph': return <GraphView />
    case 'stats': return <StatsView />
    case 'blist': return <BookListView />
    case 'ai': return <AIView />
    case 'life': return <LifeView />
    case 'together': return <TogetherView />
    case 'plib': case 'shared': return <PartnerLibView />
    case 'pbook': return <PartnerBookView />
    case 'share': return <ShareListView />
    case 'more': return <MoreView />
    case 'settings': return <SettingsView />
    case 'req': return <ReqView />
    default: return <LibraryView />
  }
}
// 앱 잠금: 열 때 · 1분 넘게 다른 앱을 쓰다 돌아올 때
function useLock() {
  const [locked, setLocked] = useState(!!LS.get('pin_hash'))
  useEffect(() => {
    let hiddenAt = 0
    const f = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now()
      else if (hiddenAt && Date.now() - hiddenAt > 60000 && LS.get('pin_hash')) setLocked(true)
    }
    document.addEventListener('visibilitychange', f); return () => document.removeEventListener('visibilitychange', f)
  }, [])
  return [locked, () => setLocked(false)] as const
}

export default function App() {
  useSyncExternalStore(subscribe, getVersion)
  const [locked, unlock] = useLock()
  useEffect(() => { document.body.classList.toggle('ai-mode', S.view === 'ai') })
  return <>
    <div className="wrap"><CurrentView /></div>
    <Fab />
    <Nav />
    <ModalHost />
    <RecOverlay />
    {locked && <LockScreen onOpen={unlock} />}
    <ToTop />
    <Toast />
  </>
}
