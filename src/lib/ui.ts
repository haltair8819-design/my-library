/* 알림(토스트) · 창(모달) · 확인 — 화면 공통 */
import type { ReactNode } from 'react'
import { S, emit } from './core'

/* ----- 토스트 ----- */
export const T: { msg: ReactNode; show: boolean; action: (() => void) | null; timer?: number } = { msg: '', show: false, action: null }
export function toast(msg: ReactNode) {
  T.msg = msg; T.show = true; T.action = null
  clearTimeout(T.timer); T.timer = window.setTimeout(() => { T.show = false; emit() }, 2200)
  emit()
}
export function toastAction(msg: ReactNode, fn: () => void, ms = 8000) {
  T.msg = msg; T.show = true; T.action = fn
  clearTimeout(T.timer); T.timer = window.setTimeout(() => { T.show = false; T.action = null; emit() }, ms)
  emit()
}
export function errMsg(e: unknown): string { return String((e && (e as Error).message) || e) }

/* ----- 창 ----- */
export const M: { node: ReactNode | null; key: number; onClose: (() => void) | null; locked: boolean } = { node: null, key: 0, onClose: null, locked: false }
export const modalOpen = () => !!M.node
type ModalOpts = { onClose?: () => void; locked?: boolean }
// 창 열기: 뒤로 가기로 창을 닫을 수 있게 기록 한 칸 쌓기
export function modal(node: ReactNode, opts: ModalOpts = {}) {
  const wasOpen = !!M.node
  if (wasOpen && M.onClose && M.onClose !== opts.onClose) { const f = M.onClose; M.onClose = null; f() }
  M.node = node; M.key++; M.onClose = opts.onClose || null; M.locked = !!opts.locked
  try {
    if (!S.pendingNav && !(history.state && history.state.modal)) history.pushState(Object.assign({}, history.state, { modal: true, depth: ((history.state && history.state.depth) || 0) + 1 }), '', location.href)
  } catch { /* 무시 */ }
  emit()
}
// 같은 창을 다시 그리기 (자리 · 기록은 그대로)
export function remodal(node: ReactNode) { if (!M.node) return; M.node = node; emit() }
export function closeModal() {
  if (!M.node) return
  const f = M.onClose; M.onClose = null; M.node = null; M.locked = false
  if (f) f()
  emit()
  // 창을 열 때 쌓아 둔 '창' 자리 걷기 (바로 다른 화면으로 가면 go()가 그 자리를 써요)
  if (!S.popClosing) setTimeout(() => { if (history.state && history.state.modal && !M.node && !S.pendingNav) { S.ignorePop = true; history.back() } }, 0)
}
