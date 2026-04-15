import { useState, useEffect, useCallback } from 'react';

const DISMISS_KEY = 'pwa-dismissed';

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [visible, setVisible] = useState(false);

  const dismiss = useCallback(() => {
    localStorage.setItem(DISMISS_KEY, '1');
    setVisible(false);
  }, []);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY)) return;

    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setVisible(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setVisible(false);
    if (outcome === 'accepted') {
      localStorage.setItem(DISMISS_KEY, '1');
    }
  }, [deferredPrompt]);

  if (!visible) return null;

  return (
    <div style={{
      position  : 'fixed',
      bottom    : 0,
      left      : 0,
      right     : 0,
      zIndex    : 9998,
      display   : 'flex',
      alignItems: 'center',
      gap       : '12px',
      padding   : '12px 20px',
      background: '#0f1b35',
      color     : '#fff',
      fontSize  : '0.9rem',
      boxShadow : '0 -2px 12px rgba(0,0,0,0.3)',
    }}>
      <span style={{ flex: 1 }}>
        Install HMS App for offline access
      </span>
      <button
        onClick={handleInstall}
        style={{
          background : '#00a896',
          color      : '#fff',
          border     : 'none',
          borderRadius: '6px',
          padding    : '6px 16px',
          cursor     : 'pointer',
          fontWeight : '600',
          fontSize   : '0.85rem',
        }}
      >
        Install
      </button>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          background : 'transparent',
          color      : '#94a3b8',
          border     : 'none',
          cursor     : 'pointer',
          fontSize   : '1.1rem',
          lineHeight : 1,
          padding    : '2px 6px',
        }}
      >
        ✕
      </button>
    </div>
  );
}
