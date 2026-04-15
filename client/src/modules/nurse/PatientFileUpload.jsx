import { useState, useRef } from 'react';
import { apiFetch } from '../../shared/utils/authHeaders.js';
import { generateKey, exportKey, encryptFile, bufferToBase64 } from '../../shared/utils/crypto.js';
import { storeFileKey } from '../../shared/utils/keyStore.js';
import styles from './PatientFileUpload.module.scss';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';
const MAX_SIZE = 20 * 1024 * 1024; // 20 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export default function PatientFileUpload({ assignments, loading = false }) {
  const [patientId, setPatientId] = useState('');
  const [file, setFile]           = useState(null);
  const [status, setStatus]       = useState(''); // '' | 'encrypting' | 'uploading' | 'done' | 'error'
  const [error, setError]         = useState('');
  const [uploadedKey, setUploadedKey] = useState(''); // exported AES key (base64) — nurse stores this
  const fileRef = useRef(null);

  function reset() {
    setFile(null);
    setStatus('');
    setError('');
    setUploadedKey('');
    if (fileRef.current) fileRef.current.value = '';
  }

  function handleFileChange(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!ALLOWED_TYPES.includes(f.type)) {
      setError('Only JPEG, PNG, WebP, and PDF files are allowed.');
      return;
    }
    if (f.size > MAX_SIZE) {
      setError('File exceeds 20 MB limit.');
      return;
    }
    setError('');
    setFile(f);
  }

  async function handleUpload(e) {
    e.preventDefault();
    if (!patientId) { setError('Select a patient first.'); return; }
    if (!file)      { setError('Choose a file to upload.'); return; }

    setError('');
    setStatus('encrypting');

    try {
      // 1. Generate a fresh AES-256-GCM key for this file
      const key = await generateKey();

      // 2. Read file as ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();

      // 3. Encrypt client-side
      const { encryptedBuffer, iv } = await encryptFile(arrayBuffer, key);

      // 4. Build multipart form — send encrypted bytes
      const blob = new Blob([encryptedBuffer], { type: 'application/octet-stream' });
      const form = new FormData();
      form.append('file', blob, file.name);
      form.append('entityType', 'PATIENT');
      form.append('entityId', patientId);

      setStatus('uploading');

      // 5. Upload (apiFetch handles auth headers; use raw fetch for FormData)
      const token = sessionStorage.getItem('accessToken');
      const csrfRes = await fetch('/api/auth/csrf-token', { credentials: 'include' });
      const { csrfToken } = await csrfRes.json();

      const res = await fetch(`${API_BASE}/files/upload`, {
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

      const { data } = await res.json();

      // 6. Send IV to server (separate PATCH as per existing pattern)
      await apiFetch(`${API_BASE}/files/${data.id}/iv`, {
        method: 'PATCH',
        body: JSON.stringify({ iv }),
      });

      // 7. Persist key to IndexedDB
      const exportedKey = await exportKey(key);
      await storeFileKey(data.id, exportedKey, iv, file.name);
      setUploadedKey(exportedKey);
      setStatus('done');
    } catch (err) {
      setError(err.message || 'Upload failed');
      setStatus('error');
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h2 className={styles.title}>Upload Patient File</h2>
        <p className={styles.hint}>Files are encrypted in your browser before upload.</p>
      </div>

      <form onSubmit={handleUpload} className={styles.form}>
        <label className={styles.label}>
          Patient
          <select
            value={patientId}
            onChange={(e) => setPatientId(e.target.value)}
            className={styles.select}
            required
            disabled={loading || assignments.length === 0}
          >
            {loading ? (
              <option value="">Loading patients…</option>
            ) : assignments.length === 0 ? (
              <option value="">No patients assigned today</option>
            ) : (
              <>
                <option value="">Select patient…</option>
                {assignments.map((a) => (
                  <option key={a.patientId} value={a.patientId}>
                    {a.firstName} {a.lastName} — {a.mrn}
                  </option>
                ))}
              </>
            )}
          </select>
        </label>

        <label className={styles.label}>
          File <span className={styles.hint2}>(JPEG, PNG, WebP, PDF · max 20 MB)</span>
          <input
            ref={fileRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.pdf"
            onChange={handleFileChange}
            className={styles.fileInput}
          />
        </label>

        {file && (
          <div className={styles.fileInfo}>
            {file.name} — {(file.size / 1024).toFixed(1)} KB
          </div>
        )}

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          <button
            type="submit"
            className={styles.uploadBtn}
            disabled={status === 'encrypting' || status === 'uploading'}
          >
            {status === 'encrypting' ? '🔒 Encrypting…'
              : status === 'uploading' ? '⬆ Uploading…'
              : '🔒 Encrypt & Upload'}
          </button>
          {(status === 'done' || status === 'error') && (
            <button type="button" className={styles.resetBtn} onClick={reset}>
              Upload another
            </button>
          )}
        </div>
      </form>

      {status === 'done' && (
        <div className={styles.success}>
          <p>File uploaded successfully. Save the encryption key below — it is required to decrypt this file.</p>
          <div className={styles.keyBox}>
            <span className={styles.keyLabel}>Encryption Key (AES-256)</span>
            <code className={styles.keyValue}>{uploadedKey}</code>
            <button
              className={styles.copyBtn}
              onClick={() => navigator.clipboard.writeText(uploadedKey)}
              type="button"
            >
              Copy
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
