import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../../shared/store/index.js';
import styles from './ForcePasswordChange.module.scss';

const PASSWORD_RE = /^(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{12,256}$/;

export default function ForcePasswordChange() {
  const [form, setForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState('password'); // 'password' | 'otp'
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState('');
  const [loading, setLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const { setAuth } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const username = location.state?.username ?? '';

  function validate() {
    const errs = {};

    if (!form.currentPassword) {
      errs.currentPassword = 'Current password is required';
    }

    if (!PASSWORD_RE.test(form.newPassword)) {
      errs.newPassword =
        'Must be at least 12 characters with uppercase, lowercase, number, and special character';
    }

    if (form.newPassword !== form.confirmPassword) {
      errs.confirmPassword = 'Passwords do not match';
    }

    return errs;
  }

  function field(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: undefined }));
    setApiError('');
  }

  async function requestOtp() {
    if (!username) return;
    setLoading(true);
    try {
      const res = await fetch('/api/auth/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      if (res.ok) setOtpSent(true);
    } finally {
      setLoading(false);
    }
  }

  async function handlePasswordNext(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }

    await requestOtp();
    setStep('otp');
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    setApiError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, otp, newPassword: form.newPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        setApiError(data.error || 'Failed to change password');
        return;
      }

      navigate('/login', { replace: true });
    } catch {
      setApiError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.wrapper}>
      {step === 'password' ? (
        <form className={styles.form} onSubmit={handlePasswordNext} noValidate>
          <h1 className={styles.title}>Change Your Password</h1>
          <p className={styles.subtitle}>
            You must set a new password before accessing your account.
          </p>

          {apiError && <p className={styles.error}>{apiError}</p>}

          <label className={styles.label}>
            Current Password
            <input
              type="password"
              value={form.currentPassword}
              onChange={(e) => field('currentPassword', e.target.value)}
              className={styles.input}
              autoComplete="current-password"
            />
            {errors.currentPassword && (
              <span className={styles.fieldError}>{errors.currentPassword}</span>
            )}
          </label>

          <label className={styles.label}>
            New Password
            <input
              type="password"
              value={form.newPassword}
              onChange={(e) => field('newPassword', e.target.value)}
              className={styles.input}
              autoComplete="new-password"
            />
            {errors.newPassword && (
              <span className={styles.fieldError}>{errors.newPassword}</span>
            )}
            <span className={styles.hint}>
              Min 12 chars with uppercase, lowercase, number, and special character.
            </span>
          </label>

          <label className={styles.label}>
            Confirm New Password
            <input
              type="password"
              value={form.confirmPassword}
              onChange={(e) => field('confirmPassword', e.target.value)}
              className={styles.input}
              autoComplete="new-password"
            />
            {errors.confirmPassword && (
              <span className={styles.fieldError}>{errors.confirmPassword}</span>
            )}
          </label>

          <button type="submit" className={styles.btn} disabled={loading}>
            {loading ? 'Sending OTP…' : 'Next'}
          </button>
        </form>
      ) : (
        <form className={styles.form} onSubmit={handleChangePassword} noValidate>
          <h1 className={styles.title}>Enter Verification Code</h1>
          <p className={styles.subtitle}>
            An OTP has been sent to your registered email. Enter it below to confirm.
          </p>

          {apiError && <p className={styles.error}>{apiError}</p>}

          <label className={styles.label}>
            One-Time Password
            <input
              type="text"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className={styles.input}
              placeholder="6-digit code"
              maxLength={6}
              autoComplete="one-time-code"
            />
          </label>

          <button type="submit" className={styles.btn} disabled={loading || otp.length !== 6}>
            {loading ? 'Changing password…' : 'Change Password'}
          </button>

          <button
            type="button"
            className={styles.resendBtn}
            onClick={requestOtp}
            disabled={loading}
          >
            Resend OTP
          </button>
        </form>
      )}
    </div>
  );
}
