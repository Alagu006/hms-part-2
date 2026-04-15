import { useState } from 'react';
import { Link } from 'react-router-dom';
import styles from './ContactPage.module.scss';

const CONTACT_INFO = [
  {
    icon: '📍',
    label: 'Address',
    value: '123 Medical Avenue, Healthcare District\nCity — 400001, India',
    href: null,
  },
  {
    icon: '📞',
    label: 'Phone',
    value: '+91 12345 67890',
    href: 'tel:+911234567890',
  },
  {
    icon: '✉️',
    label: 'Email',
    value: 'info@citygeneralhospital.local',
    href: 'mailto:info@citygeneralhospital.local',
  },
  {
    icon: '🕐',
    label: 'Working Hours',
    value: 'Emergency: 24 × 7\nOPD: Mon–Sat, 8 AM – 8 PM',
    href: null,
  },
];

const DEPARTMENTS = [
  { name: 'General Medicine', ext: '101' },
  { name: 'Cardiology', ext: '102' },
  { name: 'Orthopaedics', ext: '103' },
  { name: 'Paediatrics', ext: '104' },
  { name: 'Radiology', ext: '105' },
  { name: 'Laboratory', ext: '106' },
  { name: 'Pharmacy', ext: '107' },
  { name: 'Billing & Accounts', ext: '108' },
];

export default function ContactPage() {
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' });
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');

  function validate() {
    const e = {};
    if (!form.name.trim())    e.name    = 'Name is required.';
    if (!form.email.trim())   e.email   = 'Email is required.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Enter a valid email.';
    if (!form.subject.trim()) e.subject = 'Subject is required.';
    if (!form.message.trim()) e.message = 'Message is required.';
    return e;
  }

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
    if (errors[name]) setErrors((er) => ({ ...er, [name]: '' }));
    if (serverError)  setServerError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setServerError('');

    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }

    setLoading(true);
    try {
      // Fetch CSRF token first (same pattern as Login.jsx)
      const csrfRes = await fetch('/api/auth/csrf-token', { credentials: 'include' });
      const { csrfToken } = await csrfRes.json();

      const res = await fetch('/api/contact', {
        method     : 'POST',
        credentials: 'include',
        headers    : { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body       : JSON.stringify(form),
      });

      const data = await res.json();

      if (!res.ok) {
        // Server-side field errors
        if (data.errors) { setErrors(data.errors); return; }
        setServerError(data.error || 'Something went wrong. Please try again.');
        return;
      }

      setSubmitted(true);
    } catch {
      setServerError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className={styles.hero} aria-labelledby="contact-heading">
        <div className={styles.heroInner}>
          <span className={styles.badge}>Get in Touch</span>
          <h1 id="contact-heading" className={styles.heroTitle}>Contact Us</h1>
          <p className={styles.heroDesc}>
            Have a question, need support, or want to reach a specific department?
            We're here to help.
          </p>
        </div>
      </section>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <section className={styles.main} aria-label="Contact information and form">
        <div className={styles.inner}>

          {/* Left: info cards */}
          <div className={styles.infoCol}>
            <h2 className={styles.colTitle}>Hospital Information</h2>

            <ul className={styles.infoCards} role="list">
              {CONTACT_INFO.map(({ icon, label, value, href }) => (
                <li key={label} className={styles.infoCard}>
                  <span className={styles.infoIcon} aria-hidden="true">{icon}</span>
                  <div>
                    <p className={styles.infoLabel}>{label}</p>
                    {href ? (
                      <a href={href} className={styles.infoValue}>{value}</a>
                    ) : (
                      <p className={styles.infoValue} style={{ whiteSpace: 'pre-line' }}>{value}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {/* Department directory */}
            <div className={styles.deptBox}>
              <h3 className={styles.deptTitle}>Department Directory</h3>
              <ul className={styles.deptList} role="list">
                {DEPARTMENTS.map(({ name, ext }) => (
                  <li key={name} className={styles.deptItem}>
                    <span>{name}</span>
                    <a href={`tel:+91123456${ext}`} className={styles.deptExt}>
                      Ext. {ext}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Staff login shortcut */}
            <div className={styles.staffBox}>
              <p className={styles.staffText}>
                Are you a staff member or patient?
              </p>
              <Link to="/login" className={styles.staffBtn}>
                Sign In to Portal →
              </Link>
            </div>
          </div>

          {/* Right: contact form */}
          <div className={styles.formCol}>
            <h2 className={styles.colTitle}>Send a Message</h2>

            {submitted ? (
              <div className={styles.successBox} role="alert">
                <span className={styles.successIcon} aria-hidden="true">✅</span>
                <div>
                  <p className={styles.successTitle}>Message received!</p>
                  <p className={styles.successDesc}>
                    Thank you for reaching out. Our team will get back to you within 1–2 business days.
                  </p>
                  <button
                    className={styles.resetBtn}
                    onClick={() => { setSubmitted(false); setForm({ name: '', email: '', subject: '', message: '' }); }}
                  >
                    Send another message
                  </button>
                </div>
              </div>
            ) : (
              <form className={styles.form} onSubmit={handleSubmit} noValidate aria-label="Contact form">
                <div className={styles.row}>
                  <div className={styles.field}>
                    <label htmlFor="name" className={styles.label}>Full Name <span aria-hidden="true">*</span></label>
                    <input
                      id="name"
                      name="name"
                      type="text"
                      value={form.name}
                      onChange={handleChange}
                      className={`${styles.input} ${errors.name ? styles.inputError : ''}`}
                      autoComplete="name"
                      aria-required="true"
                      aria-describedby={errors.name ? 'name-error' : undefined}
                    />
                    {errors.name && <p id="name-error" className={styles.fieldError} role="alert">{errors.name}</p>}
                  </div>

                  <div className={styles.field}>
                    <label htmlFor="email" className={styles.label}>Email Address <span aria-hidden="true">*</span></label>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      value={form.email}
                      onChange={handleChange}
                      className={`${styles.input} ${errors.email ? styles.inputError : ''}`}
                      autoComplete="email"
                      aria-required="true"
                      aria-describedby={errors.email ? 'email-error' : undefined}
                    />
                    {errors.email && <p id="email-error" className={styles.fieldError} role="alert">{errors.email}</p>}
                  </div>
                </div>

                <div className={styles.field}>
                  <label htmlFor="subject" className={styles.label}>Subject <span aria-hidden="true">*</span></label>
                  <input
                    id="subject"
                    name="subject"
                    type="text"
                    value={form.subject}
                    onChange={handleChange}
                    className={`${styles.input} ${errors.subject ? styles.inputError : ''}`}
                    aria-required="true"
                    aria-describedby={errors.subject ? 'subject-error' : undefined}
                  />
                  {errors.subject && <p id="subject-error" className={styles.fieldError} role="alert">{errors.subject}</p>}
                </div>

                <div className={styles.field}>
                  <label htmlFor="message" className={styles.label}>Message <span aria-hidden="true">*</span></label>
                  <textarea
                    id="message"
                    name="message"
                    rows={5}
                    value={form.message}
                    onChange={handleChange}
                    className={`${styles.textarea} ${errors.message ? styles.inputError : ''}`}
                    aria-required="true"
                    aria-describedby={errors.message ? 'message-error' : undefined}
                  />
                  {errors.message && <p id="message-error" className={styles.fieldError} role="alert">{errors.message}</p>}
                </div>

                <p className={styles.disclaimer}>
                  * This form is for general enquiries only. For medical emergencies, call{' '}
                  <a href="tel:112">112</a> immediately.
                </p>

                <button type="submit" className={styles.submitBtn}>
                  Send Message
                </button>
              </form>
            )}
          </div>

        </div>
      </section>

    </div>
  );
}
