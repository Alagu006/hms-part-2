import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useDarkMode } from '../../shared/hooks/useDarkMode.js';
import styles from './Navbar.module.scss';

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();
  const { isDark, toggle: toggleDark } = useDarkMode();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close menu on route change
  useEffect(() => setMenuOpen(false), [location.pathname]);

  const navLinks = [
    { to: '/', label: 'Home' },
    { to: '/about', label: 'About' },
    { to: '/contact', label: 'Contact' },
  ];

  return (
    <header className={`${styles.header} ${scrolled ? styles.scrolled : ''}`} role="banner">
      <nav className={styles.nav} aria-label="Main navigation">
        {/* Brand */}
        <Link to="/" className={styles.brand} aria-label="City General Hospital — Home">
          <span className={styles.brandIcon} aria-hidden="true">🏥</span>
          <span className={styles.brandText}>
            <span className={styles.brandName}>Zero Trust Based</span>
            <span className={styles.brandSub}>Hospital portal</span>
          </span>
        </Link>

        {/* Desktop links */}
        <ul className={styles.links} role="list">
          {navLinks.map(({ to, label }) => (
            <li key={to}>
              <Link
                to={to}
                className={`${styles.link} ${location.pathname === to ? styles.active : ''}`}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>

        {/* CTA */}
        <div className={styles.cta}>
          <Link to="/login" className={styles.loginBtn}>
            Sign In
          </Link>
        </div>

        {/* Hamburger */}
        <button
          className={`${styles.hamburger} ${menuOpen ? styles.open : ''}`}
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        >
          <span />
          <span />
          <span />
        </button>
      </nav>

      {/* Mobile menu */}
      <div
        id="mobile-menu"
        className={`${styles.mobileMenu} ${menuOpen ? styles.mobileOpen : ''}`}
        aria-hidden={!menuOpen}
      >
        <ul role="list">
          {navLinks.map(({ to, label }) => (
            <li key={to}>
              <Link
                to={to}
                className={`${styles.mobileLink} ${location.pathname === to ? styles.active : ''}`}
              >
                {label}
              </Link>
            </li>
          ))}
          <li>
            <Link to="/login" className={styles.mobileCta}>
              Sign In
            </Link>
          </li>
        </ul>
      </div>
    </header>
  );
}
