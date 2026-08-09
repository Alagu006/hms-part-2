import { useState, useEffect, useRef } from 'react';
import { useStore, getAccessToken } from '../../shared/store/index.js';
import { apiFetch, API_BASE } from '../../shared/utils/api.js';
import { encryptProfileImage, decryptProfileImageToUrl } from '../../shared/utils/crypto.js';
import { storeFileKey, getFileKey } from '../../shared/utils/keyStore.js';
import styles from './UserProfile.module.scss';

// ---------------------------------------------------------------------------
// Authenticated profile image — decrypt if key is available
// ---------------------------------------------------------------------------
function ProfileImage({ fileId, initials }) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    if (!fileId) return;
    let cancelled = false;
    let objectUrl = null;

    (async () => {
      try {
        const token = getAccessToken();
        const res = await fetch(`${API_BASE}/files/profile-image/${fileId}`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;

        // Check if server signals encryption
        const ivB64     = res.headers.get('X-Encryption-IV');
        const encrypted = res.headers.get('X-Encrypted') === 'true';
        const mime      = res.headers.get('Content-Type') ?? 'image/jpeg';
        const buffer    = await res.arrayBuffer();

        if (encrypted && ivB64) {
          const record = await getFileKey(fileId);
          if (record?.keyB64) {
            objectUrl = await decryptProfileImageToUrl(buffer, ivB64, record.keyB64, mime);
          } else {
            // Key not found — fall back to initials
            return;
          }
        } else {
          // Plain image (legacy)
          const blob = new Blob([buffer], { type: mime });
          objectUrl = URL.createObjectURL(blob);
        }

        if (!cancelled) setSrc(objectUrl);
      } catch { /* fall back to initials */ }
    })();

    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [fileId]);

  if (src) return <img src={src} alt="Profile" className={styles.avatarImg} />;
  return <div className={styles.avatar}>{initials}</div>;
}

// ---------------------------------------------------------------------------
// Field row
// ---------------------------------------------------------------------------
function Field({ label, value }) {
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.fieldValue}>{value || '—'}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export default function UserProfile() {
  const user = useStore((s) => s.user);
  const [profile, setProfile]     = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [fileId, setFileId]       = useState(null);
  const fileRef = useRef(null);

  // 2FA state
  const [twoFaEnabled, setTwoFaEnabled]   = useState(false);
  const [twoFaLoading, setTwoFaLoading]   = useState(true);
  const [twoFaStep, setTwoFaStep]         = useState('idle'); // 'idle' | 'confirm_enable' | 'confirm_disable'
  const [twoFaOtp, setTwoFaOtp]           = useState('');
  const [twoFaMsg, setTwoFaMsg]           = useState('');
  const [twoFaError, setTwoFaError]       = useState('');
  const [twoFaWorking, setTwoFaWorking]   = useState(false);

  useEffect(() => {
    apiFetch(`/auth/me`)
      .then((data) => {
        const p = data?.data ?? data;
        setProfile(p);
        if (p?.profileImageFileId) setFileId(p.profileImageFileId);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Fetch 2FA status
  useEffect(() => {
    apiFetch(`/auth/2fa/status`)
      .then((data) => setTwoFaEnabled(data?.enabled ?? false))
      .catch(() => {})
      .finally(() => setTwoFaLoading(false));
  }, []);

  const initials = `${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`.toUpperCase();
  const roles = (Array.isArray(profile?.roles) ? profile.roles : Array.isArray(user?.roles) ? user.roles : [user?.roles].filter(Boolean))
    .join(', ').replace(/_/g, ' ');

  async function handleImageUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
    if (!ALLOWED.includes(file.type)) {
      setUploadMsg('Only JPEG, PNG, or WebP images are allowed.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadMsg('Image must be under 5 MB.');
      return;
    }

    setUploading(true);
    setUploadMsg('Encrypting…');
    try {
      const userId = profile?.id ?? user?.id;

      // 1. Encrypt in browser
      const arrayBuffer = await file.arrayBuffer();
      const { encryptedBlob, keyB64, ivB64 } = await encryptProfileImage(arrayBuffer);

      const form = new FormData();
      form.append('file', encryptedBlob, file.name);

      const token = getAccessToken();
      const csrfRes = await fetch('/api/auth/csrf-token', { credentials: 'include' });
      const { csrfToken } = await csrfRes.json();

      setUploadMsg('Uploading…');

      // 2. Upload encrypted bytes — tell server the original MIME
      const res = await fetch(`${API_BASE}/files/profile-image/${userId}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-csrf-token': csrfToken,
          'x-client-encrypted': 'true',
          'x-original-mime': file.type,
        },
        body: form,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Upload failed');
      }

      const { data: uploaded } = await res.json();

      // 3. Send IV to server
      await apiFetch(`/files/profile-image/${uploaded.id}/iv`, {
        method: 'PATCH',
        body: JSON.stringify({ iv: ivB64 }),
      });

      // 4. Persist key to IndexedDB
      await storeFileKey(uploaded.id, keyB64, ivB64, file.name);

      // 5. Link to profile
      await apiFetch(`/auth/image`, {
        method: 'PATCH',
        body: JSON.stringify({ profileImageFileId: uploaded.id }),
      });

      setFileId(uploaded.id);
      setUploadMsg('Profile photo updated.');
    } catch (err) {
      setUploadMsg(err.message || 'Upload failed.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  // ---------------------------------------------------------------------------
  // 2FA handlers
  // ---------------------------------------------------------------------------
  async function handleTwoFaToggle() {
    setTwoFaError('');
    setTwoFaMsg('');
    setTwoFaOtp('');
    setTwoFaWorking(true);
    try {
      const endpoint = twoFaEnabled ? '/auth/2fa/disable/request' : '/auth/2fa/enable/request';
      await apiFetch(endpoint, { method: 'POST', body: JSON.stringify({}) });
      setTwoFaStep(twoFaEnabled ? 'confirm_disable' : 'confirm_enable');
      setTwoFaMsg('A verification code has been sent to your registered email.');
    } catch (err) {
      setTwoFaError(err.message || 'Failed to send code.');
    } finally {
      setTwoFaWorking(false);
    }
  }

  async function handleTwoFaConfirm(e) {
    e.preventDefault();
    setTwoFaError('');
    if (!/^\d{6}$/.test(twoFaOtp)) {
      setTwoFaError('Code must be exactly 6 digits.');
      return;
    }
    setTwoFaWorking(true);
    try {
      const endpoint = twoFaStep === 'confirm_enable'
        ? '/auth/2fa/enable/confirm'
        : '/auth/2fa/disable/confirm';
      await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({ otp: twoFaOtp }),
      });
      const nowEnabled = twoFaStep === 'confirm_enable';
      setTwoFaEnabled(nowEnabled);
      setTwoFaStep('idle');
      setTwoFaOtp('');
      setTwoFaMsg(nowEnabled ? '2FA is now enabled on your account.' : '2FA has been disabled.');
    } catch (err) {
      setTwoFaError(err.message || 'Verification failed.');
    } finally {
      setTwoFaWorking(false);
    }
  }

  function handleTwoFaCancel() {
    setTwoFaStep('idle');
    setTwoFaOtp('');
    setTwoFaError('');
    setTwoFaMsg('');
  }

  return (
    <div className={styles.page}>      <div className={styles.card}>
        {/* Avatar / photo */}
        <div className={styles.avatarWrap}>
          <div className={styles.avatarContainer}>
            <ProfileImage fileId={fileId} initials={initials} />
            <button
              className={styles.photoBtn}
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label="Change profile photo"
              title="Change profile photo"
            >
              {uploading ? '…' : '📷'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: 'none' }}
              onChange={handleImageUpload}
            />
          </div>
          {uploadMsg && (
            <p className={uploadMsg.includes('updated') ? styles.uploadSuccess : styles.uploadError}>
              {uploadMsg}
            </p>
          )}
          <div className={styles.name}>
            {profile?.firstName ?? user?.firstName} {profile?.lastName ?? user?.lastName}
          </div>
          <div className={styles.roleTag}>{roles}</div>
        </div>

        {loading && <div className={styles.loading}>Loading profile…</div>}
        {error   && <div className={styles.error}>{error}</div>}

        {profile && !loading && (
          <div className={styles.fields}>
            <Field label="First Name"    value={profile.firstName} />
            <Field label="Last Name"     value={profile.lastName} />
            <Field label="Email"         value={profile.email} />
            <Field label="Role(s)"       value={roles} />
            <Field label="ID"            value={profile.mrn ?? profile.employeeId ?? profile.id} />
            <Field label="Department"    value={profile.departmentName} />
            <Field label="Phone"         value={profile.phone} />
            <Field label="Gender"        value={profile.gender} />
            <Field label="Date of Birth" value={profile.dateOfBirth
              ? new Date(profile.dateOfBirth).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
              : null}
            />
            <Field label="Account Status" value={profile.isActive ? 'Active' : 'Inactive'} />
            <Field label="Member Since"   value={profile.createdAt
              ? new Date(profile.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
              : null}
            />
          </div>
        )}

        {/* ── 2FA Settings ─────────────────────────────────────────────── */}
        {!twoFaLoading && (
          <div className={styles.twoFaSection}>
            <div className={styles.twoFaHeader}>
              <div>
                <p className={styles.twoFaTitle}>Two-Factor Authentication</p>
                <p className={styles.twoFaSubtitle}>
                  {twoFaEnabled
                    ? 'Enabled — a verification code is required at each login.'
                    : 'Disabled — add an extra layer of security to your account.'}
                </p>
              </div>
              <span className={twoFaEnabled ? styles.twoFaBadgeOn : styles.twoFaBadgeOff}>
                {twoFaEnabled ? 'ON' : 'OFF'}
              </span>
            </div>

            {twoFaMsg   && <p className={styles.twoFaSuccess}>{twoFaMsg}</p>}
            {twoFaError && <p className={styles.twoFaError}>{twoFaError}</p>}

            {twoFaStep === 'idle' && (
              <button
                className={twoFaEnabled ? styles.twoFaBtnDisable : styles.twoFaBtnEnable}
                onClick={handleTwoFaToggle}
                disabled={twoFaWorking}
              >
                {twoFaWorking ? 'Sending code…' : twoFaEnabled ? 'Disable 2FA' : 'Enable 2FA'}
              </button>
            )}

            {(twoFaStep === 'confirm_enable' || twoFaStep === 'confirm_disable') && (
              <form className={styles.twoFaForm} onSubmit={handleTwoFaConfirm} noValidate>
                <label className={styles.twoFaLabel}>
                  Enter the 6-digit code from your email
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={twoFaOtp}
                    onChange={(e) => { setTwoFaOtp(e.target.value.replace(/\D/g, '')); setTwoFaError(''); }}
                    className={styles.twoFaInput}
                    autoComplete="one-time-code"
                    autoFocus
                    required
                  />
                </label>
                <div className={styles.twoFaActions}>
                  <button
                    type="submit"
                    className={twoFaStep === 'confirm_enable' ? styles.twoFaBtnEnable : styles.twoFaBtnDisable}
                    disabled={twoFaWorking || twoFaOtp.length !== 6}
                  >
                    {twoFaWorking ? 'Verifying…' : 'Confirm'}
                  </button>
                  <button type="button" className={styles.twoFaBtnCancel} onClick={handleTwoFaCancel}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
