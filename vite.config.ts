// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Local dev:
 *  - FRONTEND_PORT defaults to 5173
 *  - API_PORT defaults to 3002 (change with VITE_API_PORT)
 *
 * Production:
 *  - On Vercel, app is served from "/" (base must be "/")
 *  - If you ever deploy to GitHub Pages, set VITE_USE_GHPAGES=1 at build time
 *    to switch base to "/TyronesMacros/"
 */
const API_PORT = process.env.VITE_API_PORT || '3002';
const FRONTEND_PORT = process.env.VITE_PORT || '5173';
const USE_GHPAGES = process.env.VITE_USE_GHPAGES === '1';

export default defineConfig({
  // Vercel needs "/" — only use "/TyronesMacros/" for GitHub Pages builds
  base: USE_GHPAGES ? '/TyronesMacros/' : '/',

  build: { outDir: 'dist', emptyOutDir: true },

  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: { globPatterns: ['**/*.{js,css,html,ico,png,svg}'] },
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: "Tyrone's Macros",
        short_name: 'Macros',
        description: 'A simple mobile app that tracks daily countdown macros',
        theme_color: '#0d4b78',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/', // important for Vercel
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],

  server: {
    port: Number(FRONTEND_PORT),
    proxy: {
      // Use configured API_PORT in dev; this proxy is ignored in production
      '/api': { target: `http://localhost:${API_PORT}`, changeOrigin: true, secure: false },
    },
  },
});
