import { useState, lazy, Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import Navbar from './Navbar.jsx';
import Breadcrumb from './Breadcrumb.jsx';
import SessionTimeoutWarning from './SessionTimeoutWarning.jsx';
import MobileBottomNav from './MobileBottomNav.jsx';
import styles from './AppLayout.module.scss';
import { useForceLogout } from '../hooks/useForceLogout.js';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts.js';

const GlobalSearch          = lazy(() => import('./GlobalSearch.jsx'));
const KeyboardShortcutsHelp = lazy(() => import('./KeyboardShortcutsHelp.jsx'));

export default function AppLayout() {
  useForceLogout();

  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen,   setHelpOpen]   = useState(false);

  useKeyboardShortcuts({
    onOpenSearch: () => setSearchOpen(true),
    onOpenHelp  : () => setHelpOpen(true),
  });

  return (
    <div className={styles.layout}>
      <Sidebar onOpenSearch={() => setSearchOpen(true)} />

      <div className={styles.content}>
        <Navbar onOpenSearch={() => setSearchOpen(true)} />

        <main className={styles.main}>
          <Breadcrumb />
          <Outlet />
        </main>
      </div>

      <MobileBottomNav />
      <SessionTimeoutWarning />

      <Suspense fallback={null}>
        {searchOpen && <GlobalSearch onClose={() => setSearchOpen(false)} />}
        {helpOpen   && <KeyboardShortcutsHelp onClose={() => setHelpOpen(false)} />}
      </Suspense>
    </div>
  );
}
