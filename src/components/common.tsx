/* 화면 공통 조각 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { S, spineColor, dayDiff, type Rec } from '../lib/core'
import { M, T, closeModal } from '../lib/ui'

export function Spine({ b, className, style }: { b: Rec; className?: string; style?: React.CSSProperties }) {
  const bg = { background: spineColor(b), ...style }
  if (b['표지URL']) return <div className={'spine ' + (className || '')} style={bg}><img src={b['표지URL']} alt="" /></div>
  return <div className={'spine ' + (className || '')} style={bg}>{String(b['제목'] || '').slice(0, 8)}</div>
}

export function DueBadge({ b }: { b: Rec }) {
  const d = dayDiff(b['반납일'])
  if (d === null) return null
  if (d < 0) return <span className="badge due-late">반납 {-d}일 지남</span>
  if (d === 0) return <span className="badge due-late">오늘 반납</span>
  return <span className={'badge ' + (d <= 3 ? 'due-soon' : '')}>반납 D-{d}</span>
}
// 도서관 예약 수령일 (v2.15)
export function PickBadge({ b }: { b: Rec }) {
  const d = dayDiff(b['수령일'])
  if (d === null) return null
  if (d < 0) return <span className="badge due-late">수령 {-d}일 지남</span>
  if (d === 0) return <span className="badge due-late">오늘 수령</span>
  return <span className={'badge ' + (d <= 3 ? 'due-soon' : '')}>수령 D-{d}</span>
}

// 검색어 둘레만 잘라서 <mark>로 칠하기
export function Highlight({ text, q, plain }: { text: unknown; q: string; plain?: boolean }) {
  const terms = q.replace(/^#/, '').toLowerCase().split(/\s+/).filter(t => t.length >= 1)
  const src = String(text || '')
  let piece = src, pre = '', post = ''
  if (!plain) {
    const low = src.toLowerCase()
    let pos = -1
    terms.forEach(t => { const i = low.indexOf(t); if (i >= 0 && (pos < 0 || i < pos)) pos = i })
    const start = Math.max(0, pos - 40); piece = src.slice(start, start + 160)
    pre = start > 0 ? '…' : ''; post = start + 160 < src.length ? '…' : ''
  }
  if (!terms.length) return <>{pre}{piece}{post}</>
  const re = new RegExp('(' + terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi')
  const parts = piece.split(re)
  return <>{pre}{parts.map((p, i) => i % 2 ? <mark key={i}>{p}</mark> : p)}{post}</>
}

/* ----- 꾹 누르기 (손가락 · 마우스 모두) ----- */
export function longPress(fn: () => void, ms = 450) {
  let t: number | null = null, sx = 0, sy = 0
  const clear = () => { if (t) clearTimeout(t); t = null }
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button > 0 || (e.target as HTMLElement).closest('.drag-h')) return
      sx = e.clientX; sy = e.clientY; clear()
      const el = e.currentTarget as HTMLElement & { _lp?: number }
      t = window.setTimeout(() => { t = null; S.lpFired = Date.now(); el._lp = Date.now(); try { navigator.vibrate?.(25) } catch { /* 무시 */ } fn() }, ms)
    },
    onPointerMove: (e: React.PointerEvent) => { if (t && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) clear() },
    onPointerUp: clear, onPointerCancel: clear, onPointerLeave: clear,
    onContextMenu: (e: React.MouseEvent) => { if (S.lpFired && Date.now() - S.lpFired < 1500) e.preventDefault() },
    onClickCapture: (e: React.MouseEvent) => { const el = e.currentTarget as HTMLElement & { _lp?: number }; if (el._lp && Date.now() - el._lp < 800) { el._lp = 0; e.stopPropagation(); e.preventDefault() } },
  }
}

/* ----- % 버튼 (폰 숫자 자판엔 %가 없어서) ----- */
export function PctBtn({ get, set }: { get: () => string; set: (v: string) => void }) {
  return <button type="button" className="btn pct-btn" title="%로 넣기" onClick={() => { const v = get().trim(); set(/%$/.test(v) ? v.replace(/%/g, '') : v.replace(/%/g, '') + '%') }}>%</button>
}

/* ----- 창 · 토스트 ----- */
export function ModalHost() {
  if (!M.node) return <div id="modal" />
  return <div id="modal"><div className="backdrop" onClick={e => { if (e.target === e.currentTarget && !M.locked) closeModal() }}><div className="sheet" key={M.key}>{M.node}</div></div></div>
}
export function Toast() {
  return <div className={'toast ' + (T.show ? 'show' : '')} style={T.action ? { pointerEvents: 'auto' } : undefined}
    onClick={() => { const f = T.action; if (!f) return; T.show = false; T.action = null; f() }}>{T.msg}</div>
}
export function Sub({ children }: { children: ReactNode }) { return <span style={{ fontWeight: 400, color: 'var(--faint)', fontSize: 13 }}>{children}</span> }
export function Faint({ children }: { children: ReactNode }) { return <span style={{ fontWeight: 400, color: 'var(--faint)' }}>{children}</span> }
export function Spin() { return <span className="spin" /> }

// 맨 위로: 아래로 많이 내려가면 나타나요
export function ToTop() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    let tick = false
    const f = () => { if (tick) return; tick = true; requestAnimationFrame(() => { tick = false; setOn(window.scrollY > 700 && !['ai', 'note', 'graph'].includes(S.view)) }) }
    window.addEventListener('scroll', f, { passive: true }); return () => window.removeEventListener('scroll', f)
  }, [])
  return <button id="totop" className={'totop ' + (on ? 'on' : '')} aria-label="맨 위로" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>↑</button>
}

// 자동으로 커지는 글 칸
export function useAutoGrow(max = 220) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const grow = () => { const t = ref.current; if (!t) return; t.style.height = 'auto'; t.style.height = Math.min(max, t.scrollHeight) + 'px' }
  return { ref, grow }
}
