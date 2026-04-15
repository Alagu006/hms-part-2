import { Link } from 'react-router-dom';
import styles from './AboutPage.module.scss';

const TECH_STACK = [
  { category: 'Frontend', items: ['React 18 + Vite', 'React Router 6', 'Zustand', 'TanStack Query v5', 'SCSS Modules', 'Framer Motion', 'Socket.io Client'] },
  { category: 'Backend', items: ['Node.js + Express', 'ES Modules', 'Socket.io', 'BullMQ + Redis', 'Nodemailer', 'Puppeteer (PDF)'] },
  { category: 'Database', items: ['PostgreSQL 17', 'pgcrypto (field encryption)', 'Redis 7 (cache & queues)'] },
  { category: 'Security', items: ['JWT RS256 (asymmetric)', 'Argon2id hashing', 'CSRF double-token', 'Helmet.js', 'Rate limiting', 'AES-256-GCM file encryption', 'Zero Trust'] },
  { category: 'Integrations', items: ['Razorpay (payments)', 'Gemini / OpenAI / Ollama (AI)', 'Web Push (VAPID)', 'ClamScan (virus scan)'] },
];

const SECURITY_FEATURES = [
  {
    icon: '🔑',
    title: 'Asymmetric JWT (RS256)',
    detail: 'Access tokens are signed with a private RSA key and verified with the public key. Tokens expire in 15 minutes; refresh tokens live in Redis for 7 days.',
  },
  {
    icon: '🔒',
    title: 'Argon2id Password Hashing',
    detail: 'Passwords are never stored in plain text. Argon2id is the winner of the Password Hashing Competition and is resistant to GPU brute-force and side-channel attacks.',
  },
  {
    icon: '🛡️',
    title: 'CSRF Double-Token Protection',
    detail: 'Every state-changing request requires a CSRF token validated against a signed cookie, preventing cross-site request forgery attacks.',
  },
  {
    icon: '🗄️',
    title: 'Database Field Encryption',
    detail: 'Sensitive columns (email, phone) are encrypted at rest using PostgreSQL\'s pgcrypto extension with a server-managed key.',
  },
  {
    icon: '📁',
    title: 'AES-256-GCM File Encryption',
    detail: 'Patient files are encrypted client-side before upload. The server never sees plaintext file content; decryption keys are session-scoped.',
  },
  {
    icon: '📋',
    title: 'Immutable Audit Trail',
    detail: 'Every API request is logged with the user identity, IP address, action, and response code. Admins can review the full audit log at any time.',
  },
  {
    icon: '🚦',
    title: 'Rate Limiting & IP Blocking',
    detail: 'Redis-backed per-IP rate limiting prevents brute-force attacks. Admins can manually block suspicious IP addresses system-wide.',
  },
  {
    icon: '🎭',
    title: 'Role-Based Access Control',
    detail: '19 roles with fine-grained permissions. Every route — frontend and backend — is independently guarded. No role can escalate its own privileges.',
  },
];

const OBJECTIVES = [
  'Digitise all patient-facing workflows from registration to discharge.',
  'Eliminate paper-based prescriptions, lab orders, and handover notes.',
  'Provide real-time visibility into bed availability, inventory, and blood bank levels.',
  'Enable secure telemedicine consultations without third-party platforms.',
  'Give administrators actionable analytics and a full audit trail.',
  'Demonstrate enterprise-grade security practices in a college project context.',
];

export default function AboutPage() {
  return (
    <div className={styles.page}>

      {/* ── Page Hero ─────────────────────────────────────────────────────── */}
      <section className={styles.hero} aria-labelledby="about-heading">
        <div className={styles.heroInner}>
          <span className={styles.badge}>About the Project</span>
          <h1 id="about-heading" className={styles.heroTitle}>
            Zero Trust Based Hospital<br />
            <span className={styles.heroAccent}>Management System</span>
          </h1>
          <p className={styles.heroDesc}>
            A full-stack, production-grade hospital management system built as a college
            capstone project — covering every workflow from patient registration to discharge,
            backed by enterprise-level security.
          </p>
        </div>
      </section>

      {/* ── Mission ───────────────────────────────────────────────────────── */}
      <section className={styles.section} aria-labelledby="mission-heading">
        <div className={styles.inner}>
          <div className={styles.twoCol}>
            <div>
              <span className={styles.sectionLabel}>Our Mission</span>
              <h2 id="mission-heading" className={styles.sectionTitle}>
                Bridging Technology and Patient Care
              </h2>
              <p className={styles.body}>
                City General HMS was built to prove that a small team can design and deliver
                a secure, scalable, and genuinely useful healthcare platform. Every design
                decision — from the database schema to the UI — was made with real hospital
                workflows in mind.
              </p>
              <p className={styles.body}>
                The system serves 19 distinct roles across clinical, administrative, and
                support functions, all from a single unified codebase with zero shared
                credentials between roles.
              </p>
            </div>

            <ul className={styles.objectiveList} aria-label="Project objectives">
              {OBJECTIVES.map((obj) => (
                <li key={obj} className={styles.objectiveItem}>
                  <span className={styles.checkIcon} aria-hidden="true">✓</span>
                  <span>{obj}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Tech Stack ────────────────────────────────────────────────────── */}
      <section className={`${styles.section} ${styles.sectionAlt}`} aria-labelledby="tech-heading">
        <div className={styles.inner}>
          <div className={styles.centeredHeader}>
            <span className={styles.sectionLabel}>Under the Hood</span>
            <h2 id="tech-heading" className={styles.sectionTitle}>Technologies Used</h2>
            <p className={styles.sectionDesc}>
              Every technology was chosen for production-readiness, not just familiarity.
            </p>
          </div>

          <div className={styles.techGrid}>
            {TECH_STACK.map(({ category, items }) => (
              <div key={category} className={styles.techCard}>
                <h3 className={styles.techCategory}>{category}</h3>
                <ul className={styles.techList}>
                  {items.map((item) => (
                    <li key={item} className={styles.techItem}>
                      <span className={styles.techDot} aria-hidden="true" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Security ──────────────────────────────────────────────────────── */}
      <section className={styles.securitySection} aria-labelledby="security-heading">
        <div className={styles.inner}>
          <div className={styles.centeredHeader}>
            <span className={`${styles.sectionLabel} ${styles.sectionLabelLight}`}>Zero Trust Architecture</span>
            <h2 id="security-heading" className={`${styles.sectionTitle} ${styles.sectionTitleLight}`}>
              Security Features in Depth
            </h2>
            <p className={`${styles.sectionDesc} ${styles.sectionDescLight}`}>
              Security is not an afterthought — it is built into every layer of the stack.
            </p>
          </div>

          <ul className={styles.securityGrid} role="list">
            {SECURITY_FEATURES.map(({ icon, title, detail }) => (
              <li key={title} className={styles.securityCard}>
                <span className={styles.securityIcon} aria-hidden="true">{icon}</span>
                <div>
                  <h3 className={styles.securityTitle}>{title}</h3>
                  <p className={styles.securityDetail}>{detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────────────── */}
      <section className={styles.cta} aria-labelledby="cta-about-heading">
        <div className={styles.ctaInner}>
          <h2 id="cta-about-heading" className={styles.ctaTitle}>Want to explore the system?</h2>
          <p className={styles.ctaDesc}>Sign in with your credentials to access your role-specific dashboard.</p>
          <div className={styles.ctaBtns}>
            <Link to="/login" className={styles.ctaPrimary}>Sign In</Link>
            <Link to="/contact" className={styles.ctaOutline}>Contact Us</Link>
          </div>
        </div>
      </section>

    </div>
  );
}
