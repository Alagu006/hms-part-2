import { Link } from 'react-router-dom';
import styles from './Footer.module.scss';

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className={styles.footer} role="contentinfo">
      <div className={styles.inner}>
        {/* Brand column */}
        <div className={styles.col}>
          <Link to="/" className={styles.brand} aria-label="City General Hospital">
            <span aria-hidden="true">🏥</span>
            <span>Zero Trust Based Hospital Portal</span>
          </Link>
          <p className={styles.tagline}>
            Compassionate care, powered by technology.
          </p>
        </div>

        {/* Navigation */}
        <div className={styles.col}>
          <h3 className={styles.colTitle}>Navigation</h3>
          <ul className={styles.colLinks}>
            <li><Link to="/">Home</Link></li>
            <li><Link to="/about">About</Link></li>
            <li><Link to="/contact">Contact</Link></li>
            <li><Link to="/login">Staff Login</Link></li>
          </ul>
        </div>

        {/* Contact */}
        <div className={styles.col}>
          <h3 className={styles.colTitle}>Contact</h3>
          <ul className={styles.colLinks}>
            <li>
              <a href="tel:+911234567890" aria-label="Call us">
                📞 +91 12345 67890
              </a>
            </li>
            <li>
              <a href="mailto:info@citygeneralhospital.local" aria-label="Email us">
                ✉️ info@citygeneralhospital.local
              </a>
            </li>
            <li>
              <span>📍 123 Medical Avenue, City — 400001</span>
            </li>
          </ul>
        </div>
      </div>

      <div className={styles.bottom}>
        <p>© {year} City General Hospital. All rights reserved.</p>
        <p className={styles.disclaimer}>
          This is a college project demonstration system.
        </p>
      </div>
    </footer>
  );
}
