// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      devOptions: { enabled: true },
      manifest: {
        name: "Tyrone's Macros",
        short_name: 'Macros',
        start_url: '/',
        display: 'standalone',
        background_color: '#0a0f1c',
        theme_color: '#0a0f1c',
        icons: []
      },
    }),
  ],
});
