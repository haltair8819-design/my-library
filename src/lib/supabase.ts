import { createClient } from '@supabase/supabase-js'
import { LS } from './core'

// 화면에 노출돼도 되는 값만 (.env → Vercel 환경변수)
export const SB_URL = import.meta.env.VITE_SUPABASE_URL as string
export const SB_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string

export const sb = createClient(SB_URL, SB_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: 'mylib-auth' },
})

// 로그인 정보는 폰에 저장돼 있어 바로 읽어요 (인터넷이 없어도)
export function sbSession(): { user: { id: string; email?: string } } | null {
  try { const s = JSON.parse(LS.get('mylib-auth') || 'null'); return s && s.user ? s : null } catch { return null }
}
export function sbUid() { const s = sbSession(); return s ? s.user.id : '' }
