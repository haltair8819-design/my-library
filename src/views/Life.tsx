/* 인생 문장 모아 보기 (v2.13) — ★1 마음에 드는 · ★2 인생 · ★3 찐 인생 */
import { S, emit, book, sText, pgLabel, hasPage, snipPage, type Rec } from '../lib/core'
import { lifeOf, LIFE, LIFE_S } from '../lib/book'
import { go, goBack } from '../lib/nav'
import { openSnipInBook } from './Book'

S.lifeF = 0; S.lifeLimit = 40
export function openLife() { S.lifeF = 0; S.lifeLimit = 40; go('life') }
export function LifeView() {
  const all: Rec[] = S.snips.filter((s: Rec) => lifeOf(s) > 0)
  const list = all.filter(s => !S.lifeF || lifeOf(s) === S.lifeF)
    .sort((a, b) => lifeOf(b) - lifeOf(a) || String((book(a['책ID']) || {})['제목'] || '').localeCompare(String((book(b['책ID']) || {})['제목'] || '')) || (snipPage(a) || 0) - (snipPage(b) || 0))
  const cnt = (n: number) => all.filter(s => lifeOf(s) === n).length
  return <section id="v-life">
    <div className="topbar"><button className="iconbtn" onClick={goBack}>← 뒤로</button></div>
    <div className="view-head"><h1>인생 문장</h1><p>{all.length ? `${all.length}개 · 필사를 열어 ★을 눌러 담아요` : '필사를 열어 ‘인생 문장’ ★을 누르면 여기 모여요. 여러 개는 꾹 눌러 골라서 한 번에.'}</p></div>
    <div className="chips" id="life-f"><button className={'chip ' + (!S.lifeF ? 'on' : '')} onClick={() => { S.lifeF = 0; S.lifeLimit = 40; emit() }}>전체 {all.length}</button>
      {[3, 2, 1].map(n => <button key={n} className={'chip ' + (S.lifeF === n ? 'on' : '')} onClick={() => { S.lifeF = n; S.lifeLimit = 40; emit() }}>{'★'.repeat(n)} {LIFE_S[n]} {cnt(n)}</button>)}</div>
    <div className="life-list">{list.length ? list.slice(0, S.lifeLimit).map(s => { const b = book(s['책ID']) || {}, n = lifeOf(s)
      return <div className={'life-card l' + n} key={s.ID} onClick={() => openSnipInBook(s.ID)}><div className="life-st">{'★'.repeat(n)}<span>{LIFE[n]}</span></div>
        {s['제목'] && <div className="stitle">{s['제목']}</div>}<div className="txt">{sText(s)}</div>
        <div className="life-src">{b['제목'] || ''}{b['저자'] ? ' · ' + b['저자'] : ''}{hasPage(s) ? ' · ' + pgLabel(s['쪽수']) : ''}</div></div> }) : <div className="empty">아직 없어요</div>}</div>
    {list.length > S.lifeLimit && <button className="btn tg-more" onClick={() => { S.lifeLimit += 40; emit() }}>더보기 ({list.length - S.lifeLimit}개 남음)</button>}
  </section>
}
