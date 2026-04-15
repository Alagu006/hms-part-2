import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Navbar from './Navbar.jsx';
import Footer from './Footer.jsx';
import styles from './PublicLayout.module.scss';

export default function PublicLayout() {
  const { pathname } = useLocation();

  // Scroll to top on route change
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);

  return (
    <div className={styles.layout}>
      <Navbar />
      <main className={styles.main} id="main-content">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
