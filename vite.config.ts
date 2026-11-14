import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const shortcut = (name: string, short_name: string, url: string) => ({ name, short_name, url, icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }] })

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 새 버전이 나오면 바로 바꾸지 않고, 알림(토스트)으로 물어본 뒤 새로고침
      registerType: 'prompt',
      includeAssets: ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'],
      workbox: {
        // 폰 알림 받기 · 누르기, 다른 앱에서 공유 받기 (public/app-sw.js)
        importScripts: ['app-sw.js'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/share-target/, /^\/\.well-known\//],
        // 글꼴 · 책 표지: 한 번 받으면 기기에 보관
        runtimeCaching: [
          { urlPattern: ({ url }) => /fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/.test(url.hostname), handler: 'CacheFirst', options: { cacheName: 'fonts', expiration: { maxEntries: 60 } } },
          { urlPattern: ({ request, url }) => request.destination === 'image' && !/supabase\.co$/.test(url.hostname), handler: 'CacheFirst', options: { cacheName: 'covers', expiration: { maxEntries: 600 }, cacheableResponse: { statuses: [0, 200] } } },
        ],
      },
      manifest: {
        id: '/',
        name: '나의 서재',
        short_name: '나의 서재',
        description: '책 기록과 필사를 한곳에',
        lang: 'ko',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#F2F3EF',
        theme_color: '#F2F3EF',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // 다른 앱에서 '공유 → 나의 서재' → 어느 책에 넣을지 고르기
        share_target: {
          action: '/share-target', method: 'POST', enctype: 'multipart/form-data',
          params: { title: 'title', text: 'text', url: 'url', files: [{ name: 'images', accept: ['image/*'] }] },
        },
        // 홈 화면 아이콘을 꾹 누르면 뜨는 바로가기
        shortcuts: [
          shortcut('여기까지 읽었어요', '읽은 쪽', '/?quick=read'), shortcut('필사 쓰기', '필사', '/?quick=snip'), shortcut('빠른 메모', '메모', '/?quick=memo'),
          shortcut('음성 메모', '음성', '/?quick=voice'), shortcut('새 글', '새 글', '/?quick=note'), shortcut('할 일', '할 일', '/?quick=todo'),
        ],
      },
    }),
  ],
})
