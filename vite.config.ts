// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const API_PORT = process.env.VITE_API_PORT || '3001';
const FRONTEND_PORT = process.env.VITE_PORT || '5173';

export default defineConfig({
  // Vercel serves from the domain root, so keep base at '/'
  // (Only use '/TyronesMacros/' if deploying to GitHub Pages.)
  base: '/',
  build: { outDir: 'dist', emptyOutDir: true },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
      },
      manifest: {
        name: "Tyrone’s Macros",
        short_name: 'Macros',
        start_url: '/',
        display: 'standalone',
        background_color: '#0d4b78',
        theme_color: '#0d4b78',
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
      '/api': { target: `http://localhost:${API_PORT}`, changeOrigin: true, secure: false },
    },
  },
});
