import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../../shared/store/index.js';
import { initSessionKey } from '../../shared/utils/sessionKey.js';
import styles from './Login.module.scss';

// Steps: 'login' | 'twofa' | 'forgot_email' | 'forgot_otp' | 'forgot_newpass'
export default function Login() {
  const location = useLocation();
  const [step, setStep] = useState('login');

  // Login state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // 2FA state
  const [twoFaUserId, setTwoFaUserId] = useState('');
  const [twoFaOtp, setTwoFaOtp]       = useState('');

  // Forgot password state
  const [fpUsername, setFpUsername] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [error, setError] = useState(location.state?.reason ?? '');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  const { setAuth } = useStore();
  const navigate = useNavigate();

  // ---------------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------------
  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const csrfRes = await fetch('/api/auth/csrf-token', { credentials: 'include' });
      const { csrfToken } = await csrfRes.json();

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();

      if (!res.ok) { setError(data.error || 'Login failed'); return; }

      if (data.mustChangePassword) {
        navigate('/first-login', { state: { username } });
        return;
      }

      if (data.requires2fa) {
        setTwoFaUserId(data.userId);
        setTwoFaOtp('');
        setStep('twofa');
        setInfo('A verification code has been sent to your registered email.');
        return;
      }

      // Generate a fresh session encryption key and send it to the server
      const clientKeyB64 = await initSessionKey();

      setAuth({ user: data.user, accessToken: data.accessToken });
      navigate('/dashboard');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Forgot — step 1: submit employee ID to receive OTP
  // ---------------------------------------------------------------------------
  async function handleRequestOtp(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const csrfRes = await fetch('/api/auth/csrf-token', { credentials: 'include' });
      const { csrfToken } = await csrfRes.json();

      await fetch('/api/auth/otp/request', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ username: fpUsername }),
      });

      // Always advance (avoid username enumeration)
      setInfo('If that Employee ID exists, an OTP has been sent to the registered email.');
      setStep('forgot_otp');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Forgot — step 2: verify OTP, advance to new password
  // ---------------------------------------------------------------------------
  function handleOtpNext(e) {
    e.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(otp)) {
      setError('OTP must be exactly 6 digits.');
      return;
    }
    setInfo('');
    setStep('forgot_newpass');
  }

  // ---------------------------------------------------------------------------
  // Forgot — step 3: set new password
  // ---------------------------------------------------------------------------
  async function handleChangePassword(e) {
    e.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const csrfRes = await fetch('/api/auth/csrf-token', { credentials: 'include' });
      const { csrfToken } = await csrfRes.json();

      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ username: fpUsername, otp, newPassword, confirmPassword }),
      });
      const data = await res.json();

      if (!res.ok) { setError(data.error || 'Failed to change password.'); return; }

      // Success — back to login
      setStep('login');
      setFpUsername(''); setOtp(''); setNewPassword(''); setConfirmPassword('');
      setInfo('Password changed successfully. Please sign in with your new password.');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------
  function resetToLogin() {
    setStep('login');
    setError('');
    setInfo('');
    setFpUsername(''); setOtp(''); setNewPassword(''); setConfirmPassword('');
  }

  // ---------------------------------------------------------------------------
  // 2FA — verify OTP after password check
  // ---------------------------------------------------------------------------
  async function handleTwoFaVerify(e) {
    e.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(twoFaOtp)) {
      setError('Code must be exactly 6 digits.');
      return;
    }
    setLoading(true);
    try {
      const csrfRes = await fetch('/api/auth/csrf-token', { credentials: 'include' });
      const { csrfToken } = await csrfRes.json();

      const res = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ userId: twoFaUserId, otp: twoFaOtp }),
      });
      const data = await res.json();

      if (!res.ok) { setError(data.error || 'Verification failed.'); return; }

      await initSessionKey();
      setAuth({ user: data.user, accessToken: data.accessToken });
      navigate('/dashboard');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------
  if (step === 'twofa') {
    return (
      <div className={styles.wrapper}>
        <BrandPanel />
        <div className={styles.formPanel}>
          <motion.form
            className={styles.form}
            onSubmit={handleTwoFaVerify}
            noValidate
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          >
            <MobileLogoRow />
            <div className={styles.formHeader}>
              <h1 className={styles.title}>Two-Factor Auth</h1>
              <p className={styles.subtitle}>Enter the 6-digit code sent to your registered email.</p>
            </div>

            {info  && <p className={styles.infoMsg}>{info}</p>}
            {error && <p className={styles.error}>{error}</p>}

            <label className={styles.label}>
              Verification Code
              <div className={styles.inputWrapper}>
                <span className={styles.inputIcon}>🔐</span>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={twoFaOtp}
                  onChange={(e) => setTwoFaOtp(e.target.value.replace(/\D/g, ''))}
                  className={styles.input}
                  autoComplete="one-time-code"
                  autoFocus
                  required
                />
              </div>
            </label>

            <button type="submit" className={styles.btn} disabled={loading || twoFaOtp.length !== 6}>
              {loading ? 'Verifying…' : 'Verify Code'}
            </button>
            <button type="button" className={styles.linkBtn} onClick={() => { setStep('login'); setError(''); setInfo(''); setTwoFaOtp(''); }}>
              ← Back to Sign In
            </button>
          </motion.form>
        </div>
      </div>
    );
  }

  if (step === 'forgot_email') {
    return (
      <div className={styles.wrapper}>
        <BrandPanel />
        <div className={styles.formPanel}>
          <motion.form
            className={styles.form}
            onSubmit={handleRequestOtp}
            noValidate
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          >
            <MobileLogoRow />
            <div className={styles.formHeader}>
              <h1 className={styles.title}>Forgot Password</h1>
              <p className={styles.subtitle}>Enter your Employee ID or Patient MRN and we'll send an OTP to your registered email.</p>
            </div>

            {error && <p className={styles.error}>{error}</p>}

            <label className={styles.label}>
              Employee ID / Patient MRN
              <div className={styles.inputWrapper}>
                <span className={styles.inputIcon}>🪪</span>
                <input
                  type="text"
                  value={fpUsername}
                  onChange={(e) => setFpUsername(e.target.value)}
                  className={styles.input}
                  autoComplete="username"
                  required
                />
              </div>
            </label>

            <button type="submit" className={styles.btn} disabled={loading || !fpUsername.trim()}>
              {loading ? 'Sending…' : 'Send OTP'}
            </button>
            <button type="button" className={styles.linkBtn} onClick={resetToLogin}>
              ← Back to Sign In
            </button>
          </motion.form>
        </div>
      </div>
    );
  }

  if (step === 'forgot_otp') {
    return (
      <div className={styles.wrapper}>
        <BrandPanel />
        <div className={styles.formPanel}>
          <motion.form
            className={styles.form}
            onSubmit={handleOtpNext}
            noValidate
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          >
            <MobileLogoRow />
            <div className={styles.formHeader}>
              <h1 className={styles.title}>Enter OTP</h1>
            </div>
            {info && <p className={styles.infoMsg}>{info}</p>}
            {error && <p className={styles.error}>{error}</p>}

            <label className={styles.label}>
              6-digit OTP
              <div className={styles.inputWrapper}>
                <span className={styles.inputIcon}>🔑</span>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  className={styles.input}
                  autoComplete="one-time-code"
                  required
                />
              </div>
            </label>

            <button type="submit" className={styles.btn} disabled={otp.length !== 6}>
              Verify OTP
            </button>
            <button type="button" className={styles.linkBtn} onClick={() => { setStep('forgot_email'); setError(''); setInfo(''); }}>
              ← Back
            </button>
          </motion.form>
        </div>
      </div>
    );
  }

  if (step === 'forgot_newpass') {
    return (
      <div className={styles.wrapper}>
        <BrandPanel />
        <div className={styles.formPanel}>
          <motion.form
            className={styles.form}
            onSubmit={handleChangePassword}
            noValidate
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          >
            <MobileLogoRow />
            <div className={styles.formHeader}>
              <h1 className={styles.title}>New Password</h1>
              <p className={styles.subtitle}>Must be 12+ characters with uppercase, lowercase, number, and special character.</p>
            </div>

            {error && <p className={styles.error}>{error}</p>}

            <label className={styles.label}>
              New Password
              <div className={styles.inputWrapper}>
                <span className={styles.inputIcon}>🔒</span>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className={styles.input}
                  autoComplete="new-password"
                  required
                />
              </div>
            </label>

            <label className={styles.label}>
              Confirm Password
              <div className={styles.inputWrapper}>
                <span className={styles.inputIcon}>🔒</span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={styles.input}
                  autoComplete="new-password"
                  required
                />
              </div>
            </label>

            <button type="submit" className={styles.btn} disabled={loading || !newPassword || !confirmPassword}>
              {loading ? 'Saving…' : 'Set New Password'}
            </button>
            <button type="button" className={styles.linkBtn} onClick={() => { setStep('forgot_otp'); setError(''); }}>
              ← Back
            </button>
          </motion.form>
        </div>
      </div>
    );
  }

  // Default: login
  return (
    <div className={styles.wrapper}>
      <BrandPanel />
      <div className={styles.formPanel}>
        <motion.form
          className={styles.form}
          onSubmit={handleLogin}
          noValidate
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
        >
          <MobileLogoRow />
          <div className={styles.formHeader}>
            <h1 className={styles.title}>Welcome back</h1>
            <p className={styles.subtitle}>Sign in to your HMS account</p>
          </div>

          <div className={styles.divider} />

          {error && <p className={styles.error}>{error}</p>}
          {info && <p className={styles.infoMsg}>{info}</p>}

          <label className={styles.label}>
            Employee ID / Patient MRN
            <div className={styles.inputWrapper}>
              <span className={styles.inputIcon}>🪪</span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={styles.input}
                autoComplete="username"
                placeholder="e.g. EMP-001"
                required
              />
            </div>
          </label>

          <label className={styles.label}>
            Password
            <div className={styles.inputWrapper}>
              <span className={styles.inputIcon}>🔒</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={styles.input}
                autoComplete="current-password"
                placeholder="Enter your password"
                required
              />
            </div>
          </label>

          <button type="submit" className={styles.btn} disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>

          <button type="button" className={styles.linkBtn} onClick={() => { setStep('forgot_email'); setError(''); setInfo(''); }}>
            Forgot Password?
          </button>
        </motion.form>
      </div>
    </div>
  );
}

/* ── Shared sub-components ─────────────────────────────────────────────── */
function BrandPanel() {
  return (
    <div className={styles.brandPanel}>
      <div className={styles.brandLogo}>🏥</div>
      <h2 className={styles.brandTitle}>Hospital Management System</h2>
      <p className={styles.brandSubtitle}>
        Streamlined care coordination for modern healthcare teams.
      </p>
      <div className={styles.brandFeatures}>
        <div className={styles.brandFeature}>
          <div className={styles.brandFeatureIcon}>🩺</div>
          Patient records &amp; appointments
        </div>
        <div className={styles.brandFeature}>
          <div className={styles.brandFeatureIcon}>💊</div>
          Prescriptions &amp; lab results
        </div>
        <div className={styles.brandFeature}>
          <div className={styles.brandFeatureIcon}>📊</div>
          Analytics &amp; reporting
        </div>
        <div className={styles.brandFeature}>
          <div className={styles.brandFeatureIcon}>🔒</div>
          Role-based secure access
        </div>
      </div>
    </div>
  );
}

function MobileLogoRow() {
  return (
    <div className={styles.mobileLogoRow}>
      <span className={styles.mobileLogo}>🏥</span>
      <span className={styles.mobileBrandName}>HMS</span>
    </div>
  );
}
