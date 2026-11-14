/* 디자인 테마 · 포인트 색 · 밝게/어둡게 — 이 폰에만 저장 (예전 scan-share.js · lists-voice.js와 같은 값) */
import { LS } from './core'

export const THEMES = [
  { id: 'manuscript', name: '원고지', desc: '필사 노트처럼 줄 친 종이 위에 문장이 놓여요', sw: ['#F2F3EF', '#2D4F86', '#E9C8C0'] },
  { id: 'marker', name: '형광펜', desc: '하얀 바탕에 제목마다 형광펜을 그어요', sw: ['#FFFFFF', '#1B1B19', '#FFE66B'] },
  { id: 'bunko', name: '문고판', desc: '책마다 표지 색이 화면을 채워요', sw: ['#ECEEF1', '#23489A', '#B23A48'] },
  { id: 'classic', name: '숲', desc: '크림색 종이에 짙은 초록', sw: ['#F6F2EA', '#3D5A4C', '#FFFDF8'] },
]
// 포인트 색: 디자인은 그대로 두고 버튼 · 강조 색만 바꿔요 ('' = 디자인 기본색)
export const ACCENTS: [string, string][] = [['', '기본'], ['#2D4F86', '남색'], ['#3D5A4C', '초록'], ['#1F7A8C', '청록'], ['#5B4BA0', '보라'], ['#8C3B6E', '자주'], ['#B23A48', '빨강'], ['#C0661A', '주황'], ['#8C5E4A', '갈색'], ['#2A2A28', '먹색']]
export const MODES: [string, string][] = [['light', '밝게'], ['dark', '어둡게']]   // '휴대폰 따라'는 v2.11.4에서 뺐어요
export const curTheme = () => document.documentElement.dataset.theme || 'manuscript'
export const curAccent = () => LS.get('accent') || ''
export const curMode = () => LS.get('mode') === 'dark' ? 'dark' : 'light'
export function accentVars(c: string, dark: boolean) {
  if (!c) return ''
  return `--accent:${dark ? `color-mix(in srgb, ${c} 62%, white)` : c};--accent-soft:${dark ? `color-mix(in srgb, ${c} 30%, #15161a)` : `color-mix(in srgb, ${c} 13%, white)`};`
}
export function applyAccent() {
  const d = document.documentElement.style, c = curAccent(), dark = document.documentElement.dataset.mode === 'dark'
  if (!c) { d.removeProperty('--accent'); d.removeProperty('--accent-soft'); return }
  d.setProperty('--accent', dark ? `color-mix(in srgb, ${c} 62%, white)` : c)
  d.setProperty('--accent-soft', dark ? `color-mix(in srgb, ${c} 30%, #15161a)` : `color-mix(in srgb, ${c} 13%, white)`)
}
export function applyMode() {
  document.documentElement.dataset.mode = curMode()
  applyAccent()
  const paper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim()
  document.querySelectorAll('meta[name="theme-color"]').forEach(x => { x.setAttribute('content', paper); x.removeAttribute('media') })
}
export function saveDesign(d: { theme: string; accent: string; mode: string }) {
  document.documentElement.dataset.theme = d.theme; LS.set('theme', d.theme)
  LS.set('accent', d.accent); LS.set('mode', d.mode)
  applyMode()
}
