// PWA: register service worker (vite-plugin-pwa)
//import { registerSW } from 'virtual:pwa-register'
//registerSW({ immediate: true })
// PWA: register service worker with update prompt
import { registerSW } from 'virtual:pwa-register'

const updateSW = registerSW({
  onNeedRefresh() {
    const ok = confirm('A new version is available. Update now?')
    if (ok) updateSW()
  },
  onOfflineReady() {
    // console.log('Ready to work offline')
  },
})

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// ⬇️ Load global styles (Tailwind)
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
