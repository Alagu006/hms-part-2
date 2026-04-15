import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { initTheme } from './shared/utils/darkMode.js';

// Apply stored theme before first render to avoid flash
initTheme();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);

// ✅ Register SW only in production
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', async () => {
    try {
      const { Workbox } = await import('workbox-window'); // dynamic import
      const wb = new Workbox('/sw.js', { type: 'module' });
      wb.addEventListener('installed', (event) => {
        if (!event.isUpdate) console.log('[SW] Installed for first time');
      });
      wb.addEventListener('controlling', () => {
        console.log('[SW] Now controlling the page');
      });
      await wb.register();
    } catch (err) {
      console.warn('[SW] Registration failed:', err);
    }
  });
}