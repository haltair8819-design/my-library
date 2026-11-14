import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { startApp } from './boot'
import { registerSW } from 'virtual:pwa-register'
import { toastAction } from './lib/ui'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
startApp()

// 새 버전이 올라오면 알려 주고, 누르면 바로 적용
const update = registerSW({
  onNeedRefresh() { toastAction('새 버전이 있어요 · 눌러서 적용', () => update(true)) },
})
