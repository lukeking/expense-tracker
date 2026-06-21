import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt' (not 'autoUpdate'): the new SW still precaches the whole build in the
      // background, but it stays waiting instead of silently reloading the page — which
      // used to wipe in-progress form input mid-typing. UpdateBanner surfaces a manual
      // 更新 button; ignoring it lets the new SW activate on the next app open. Stale-chunk
      // protection is preserved (the old SW keeps serving the old, still-cached chunks).
      registerType: 'prompt',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        cleanupOutdatedCaches: true,
      },
      manifest: {
        name: 'Expense Tracker',
        short_name: 'Expenses',
        description: 'Personal expense tracker',
        theme_color: '#1e40af',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
});
