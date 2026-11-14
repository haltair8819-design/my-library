/* 폰 알림 (웹 푸시): 반납일 · 짝꿍 소식 — 예전 extras.js */
import { LS, type Rec } from './core'
import { sb, sbUid } from './supabase'
import { sbq, sbFn } from './store/server'

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
const PUSH_PREFS_KEY = 'push_prefs_v1'
export function pushPrefs(): Rec { try { return Object.assign({ due: true, together: true }, JSON.parse(LS.get(PUSH_PREFS_KEY) || '{}')) } catch { return { due: true, together: true } } }
export function setPushPrefs(p: Rec) { LS.set(PUSH_PREFS_KEY, JSON.stringify(p)) }
function b64uToU8(s0: string) { let s = s0.replace(/-/g, '+').replace(/_/g, '/'); s += '='.repeat((4 - s.length % 4) % 4); const b = atob(s); return Uint8Array.from(b, c => c.charCodeAt(0)) }
const swReady = () => Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, no) => setTimeout(() => no(new Error('앱을 한 번 닫았다가 다시 열어 주세요 (준비 중)')), 4000))])
export async function pushSub(): Promise<PushSubscription | null> { if (!pushSupported()) return null; try { const reg = await swReady(); return await reg.pushManager.getSubscription() } catch { return null } }
export async function pushSave(sub: PushSubscription) {
  const j = sub.toJSON() as Rec
  await sbq(sb.rpc('save_push_sub', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_prefs: pushPrefs() }))
}
export class DeniedError extends Error { denied = true }
// 알림 켜기: 단계마다 무엇이 막혔는지 알려 줘요
export async function pushOn() {
  if (!pushSupported()) throw new Error('이 기기 · 브라우저는 알림을 지원하지 않아요. 폰에 설치한 앱에서 켜 주세요')
  let perm = Notification.permission
  if (perm !== 'granted') perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new DeniedError('denied')
  let key: string, reg: ServiceWorkerRegistration, sub: PushSubscription | null
  try { key = await sbFn('pushKey', []) } catch (e) { throw new Error('서버에서 알림 키를 받지 못했어요: ' + ((e as Error).message || e)) }
  try { reg = await swReady() } catch (e) { throw new Error((e as Error).message) }
  const want = b64uToU8(key)
  try {
    sub = await reg.pushManager.getSubscription()
    if (sub && sub.options && sub.options.applicationServerKey) {   // 서버 키가 바뀌었으면 새로
      const cur = new Uint8Array(sub.options.applicationServerKey)
      if (cur.length !== want.length || cur.some((x, i) => x !== want[i])) { await sub.unsubscribe(); sub = null }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want })
  } catch (e) { throw new Error('이 기기를 알림 받을 곳으로 등록하지 못했어요: ' + ((e as Error).message || e)) }
  try { await pushSave(sub) } catch (e) { throw new Error('서버에 이 기기를 저장하지 못했어요: ' + ((e as Error).message || e)) }
  LS.set('push_on', '1')
}
export async function pushOff() {
  const sub = await pushSub()
  if (sub) { try { await sbq(sb.from('push_subs').delete().eq('endpoint', sub.endpoint)) } catch { /* 무시 */ } try { await sub.unsubscribe() } catch { /* 무시 */ } }
  LS.del('push_on')
}
// 앱을 열 때 알림 기기 정보를 한 번 새로 저장 (주인이 바뀌었거나 키가 바뀐 경우 대비)
export function pushRefreshLater() {
  setTimeout(async () => {
    if (!LS.get('push_on') || !sbUid()) return
    const sub = await pushSub(); if (sub && Notification.permission === 'granted') { try { await pushSave(sub) } catch { /* 무시 */ } }
  }, 6000)
}
// 짝꿍에게 알리기 (실패해도 조용히)
export function notifyPartner(kind: string, id: string) { if (id) sbFn('notify', [kind, id]).catch(() => { /* 무시 */ }) }
