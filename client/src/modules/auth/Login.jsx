import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../shared/store/index.js';
import styles from './Login.module.scss';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { setAuth } = useStore();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Login failed');
        return;
      }

      if (data.mustChangePassword) {
        navigate('/first-login', { state: { username } });
        return;
      }

      setAuth({ user: data.user, accessToken: data.accessToken });
      navigate('/');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.wrapper}>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <h1 className={styles.title}>HMS Login</h1>

        {error && <p className={styles.error}>{error}</p>}

        <label className={styles.label}>
          Employee ID
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={styles.input}
            autoComplete="username"
            required
          />
        </label>

        <label className={styles.label}>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={styles.input}
            autoComplete="current-password"
            required
          />
        </label>

        <button type="submit" className={styles.btn} disabled={loading}>
          {loading ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}
