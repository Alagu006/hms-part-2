import { Link } from 'react-router-dom';
import styles from './HomePage.module.scss';

// ── Feature data (only features actually in the codebase) ─────────────────────
const FEATURES = [
  {
    icon: '🗓️',
    title: 'Appointment Booking',
    desc: 'Patients can book, view, and manage appointments with doctors online — no phone calls needed.',
  },
  {
    icon: '📋',
    title: 'Electronic Health Records',
    desc: 'Complete patient timelines, prescriptions, vitals, lab results, and discharge summaries in one place.',
  },
  {
    icon: '💊',
    title: 'Pharmacy & Prescriptions',
    desc: 'Digital prescriptions flow directly to the pharmacy for accurate, fast dispensing.',
  },
  {
    icon: '🔬',
    title: 'Lab Management',
    desc: 'Lab orders, sample tracking, and results are managed end-to-end with real-time status updates.',
  },
  {
    icon: '🖥️',
    title: 'Telemedicine',
    desc: 'Secure video consultations between patients and doctors — accessible from any device.',
  },
  {
    icon: '🏥',
    title: 'Bed & Inventory Tracking',
    desc: 'Live bed matrix, blood bank levels, and medical inventory with QR-code scanning.',
  },
  {
    icon: '💳',
    title: 'Billing & Payments',
    desc: 'Automated bill generation with integrated Razorpay payment processing for patients.',
  },
  {
    icon: '📊',
    title: 'Analytics & Reports',
    desc: 'Admins get real-time dashboards, financial summaries, and exportable operational reports.',
  },
  {
    icon: '🤖',
    title: 'AI Health Assistant',
    desc: 'An AI-powered chatbot (Gemini / OpenAI) helps patients navigate their health records and queries.',
  },
];

// ── Security highlights ───────────────────────────────────────────────────────
const SECURITY = [
  {
    icon: '🔐',
    title: 'RS256 JWT Authentication',
    desc: 'Asymmetric RSA key-pair signing ensures tokens cannot be forged — even if the public key is exposed.',
  },
  {
    icon: '🛡️',
    title: 'Argon2id Password Hashing',
    desc: 'Industry-leading password hashing resistant to GPU and side-channel attacks.',
  },
  {
    icon: '🔒',
    title: 'Field-Level Encryption',
    desc: 'Sensitive data (emails, phone numbers) is encrypted at rest in PostgreSQL using pgcrypto.',
  },
  {
    icon: '🚫',
    title: 'CSRF Protection',
    desc: 'Double-CSRF token pattern prevents cross-site request forgery on every state-changing request.',
  },
  {
    icon: '📝',
    title: 'Full Audit Logging',
    desc: 'Every API action is logged with user, IP, timestamp, and response — fully reviewable by admins.',
  },
  {
    icon: '🎭',
    title: '19-Role RBAC',
    desc: 'Fine-grained role-based access control ensures staff only see and do what their role permits.',
  },
];

// ── Roles showcase ────────────────────────────────────────────────────────────
const ROLES = [
  { icon: '👨‍⚕️', label: 'Doctors' },
  { icon: '👩‍⚕️', label: 'Nurses' },
  { icon: '🧪', label: 'Lab Technicians' },
  { icon: '💊', label: 'Pharmacists' },
  { icon: '🏥', label: 'Receptionists' },
  { icon: '📦', label: 'Inventory' },
  { icon: '💰', label: 'Billing' },
  { icon: '👤', label: 'HR Managers' },
  { icon: '🖥️', label: 'IT Admins' },
  { icon: '🩺', label: 'Patients' },
];

export default function HomePage() {
  return (
    <div className={styles.page}>

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className={styles.hero} aria-labelledby="hero-heading">
        <div className={styles.heroInner}>
          <div className={styles.heroBadge}>
            <span className={styles.heroBadgeDot} aria-hidden="true" />
            Hospital Management System
          </div>

          <h1 id="hero-heading" className={styles.heroTitle}>
            Modern Healthcare,<br />
            <span className={styles.heroAccent}>Seamlessly Managed</span>
          </h1>

          <p className={styles.heroSubtitle}>
            Zero Trust Hospital's integrated platform connects patients, doctors, nurses,
            and administrators — delivering faster care with enterprise-grade security.
          </p>

          <div className={styles.heroCtas}>
            <Link to="/login" className={styles.ctaPrimary}>
              Sign In to Portal
              <span aria-hidden="true"> →</span>
            </Link>
            <Link to="/about" className={styles.ctaSecondary}>
              Learn More
            </Link>
          </div>

          <div className={styles.heroStats} role="list" aria-label="System statistics">
            {[
              { value: '19', label: 'Staff Roles' },
              { value: '25+', label: 'Modules' },
              { value: '360°', label: 'Patient View' },
            ].map(({ value, label }) => (
              <div key={label} className={styles.heroStat} role="listitem">
                <span className={styles.heroStatValue}>{value}</span>
                <span className={styles.heroStatLabel}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Decorative blobs */}
        <div className={styles.blob1} aria-hidden="true" />
        <div className={styles.blob2} aria-hidden="true" />
      </section>

      {/* ── Features ──────────────────────────────────────────────────────── */}
      <section className={styles.section} aria-labelledby="features-heading">
        <div className={styles.sectionInner}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionLabel}>What We Offer</span>
            <h2 id="features-heading" className={styles.sectionTitle}>
              Everything a Modern Hospital Needs
            </h2>
            <p className={styles.sectionDesc}>
              From patient registration to discharge, every workflow is covered in one unified system.
            </p>
          </div>

          <ul className={styles.featureGrid} role="list">
            {FEATURES.map(({ icon, title, desc }) => (
              <li key={title} className={styles.featureCard}>
                <span className={styles.featureIcon} aria-hidden="true">{icon}</span>
                <h3 className={styles.featureTitle}>{title}</h3>
                <p className={styles.featureDesc}>{desc}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Who Uses It ───────────────────────────────────────────────────── */}
      <section className={styles.rolesSection} aria-labelledby="roles-heading">
        <div className={styles.sectionInner}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionLabel}>Built for Everyone</span>
            <h2 id="roles-heading" className={styles.sectionTitle}>
              One Platform, Every Role
            </h2>
            <p className={styles.sectionDesc}>
              19 distinct roles, each with a tailored dashboard and access controls.
            </p>
          </div>

          <ul className={styles.rolesGrid} role="list">
            {ROLES.map(({ icon, label }) => (
              <li key={label} className={styles.roleChip}>
                <span aria-hidden="true">{icon}</span>
                <span>{label}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Security ──────────────────────────────────────────────────────── */}
      <section className={styles.securitySection} aria-labelledby="security-heading">
        <div className={styles.sectionInner}>
          <div className={styles.sectionHeader}>
            <span className={`${styles.sectionLabel} ${styles.sectionLabelLight}`}>Zero Trust Security</span>
            <h2 id="security-heading" className={`${styles.sectionTitle} ${styles.sectionTitleLight}`}>
              Security at Every Layer
            </h2>
            <p className={`${styles.sectionDesc} ${styles.sectionDescLight}`}>
              Patient data is protected by multiple independent security controls — not just a password.
            </p>
          </div>

          <ul className={styles.securityGrid} role="list">
            {SECURITY.map(({ icon, title, desc }) => (
              <li key={title} className={styles.securityCard}>
                <span className={styles.securityIcon} aria-hidden="true">{icon}</span>
                <div>
                  <h3 className={styles.securityTitle}>{title}</h3>
                  <p className={styles.securityDesc}>{desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── CTA Banner ────────────────────────────────────────────────────── */}
      <section className={styles.ctaBanner} aria-labelledby="cta-heading">
        <div className={styles.ctaBannerInner}>
          <h2 id="cta-heading" className={styles.ctaBannerTitle}>
            Ready to get started?
          </h2>
          <p className={styles.ctaBannerDesc}>
            Sign in with your Employee ID or Patient MRN to access your personalised dashboard.
          </p>
          <Link to="/login" className={styles.ctaPrimary}>
            Sign In to Portal
            <span aria-hidden="true"> →</span>
          </Link>
        </div>
      </section>

    </div>
  );
}
