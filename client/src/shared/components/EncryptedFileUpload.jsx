import { useState, useRef } from 'react';
import {
  generateKey,
  exportKey,
  bufferToBase64,
} from '../utils/crypto.js';
import { apiFetch, getCsrfToken, API_BASE } from '../utils/api.js';
import { getAccessToken } from '../store/index.js';
import { storeFileKey } from '../utils/keyStore.js';
import styles from './EncryptedFileUpload.module.scss';

const IV_LENGTH  = 12; // 96-bit for AES-GCM
const MAX_BYTES  = 20 * 1024 * 1024; // 20 MB

/**
 * Encrypt a file's ArrayBuffer with AES-256-GCM.
 * Returns { cipherBuffer, iv, key } — all raw.
 */
async function encryptFileBuffer(arrayBuffer) {
  const key = await generateKey();
  const iv  = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    arrayBuffer
  );

  return { cipherBuffer, iv, key };
}

export default function EncryptedFileUpload({
  entityType,
  entityId,
  onSuccess,
  accept = '.pdf,.jpg,.jpeg,.png,.dcm,.tiff',
}) {
  const [progress, setProgress]   = useState(0);
  const [status, setStatus]       = useState('idle'); // idle | encrypting | uploading | done | error
  const [errorMsg, setErrorMsg]   = useState('');
  const [fileName, setFileName]   = useState('');
  const inputRef = useRef(null);

  async function handleFile(file) {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setErrorMsg(`File too large. Maximum size is ${MAX_BYTES / 1024 / 1024} MB.`);
      setStatus('error');
      return;
    }

    const originalMime = file.type || 'application/octet-stream';
    setFileName(file.name);
    setErrorMsg('');
    setProgress(0);

    try {
      // ── Step 1: Read file as ArrayBuffer ──────────────────────────────────
      setStatus('encrypting');
      const arrayBuffer = await file.arrayBuffer();

      // ── Step 2: AES-256-GCM encrypt in browser ────────────────────────────
      const { cipherBuffer, iv, key } = await encryptFileBuffer(arrayBuffer);

      // Export key and IV as base64 for storage/transmission
      const keyB64 = await exportKey(key);
      const ivB64  = bufferToBase64(iv);

      // ── Step 3: Build multipart form with encrypted bytes ─────────────────
      setStatus('uploading');

      const blob     = new Blob([cipherBuffer], { type: 'application/octet-stream' });
      const formData = new FormData();
      formData.append('file',       blob, file.name);
      formData.append('entityType', entityType);
      formData.append('entityId',   entityId);

      // XHR for progress tracking
      const fileId = await new Promise(async (resolve, reject) => {
        const csrfToken = await getCsrfToken();
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            setProgress(Math.round((e.loaded / e.total) * 90)); // 90% for upload
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            const json = JSON.parse(xhr.responseText);
            resolve(json.data?.id);
          } else {
            try {
              const json = JSON.parse(xhr.responseText);
              reject(new Error(json.error ?? `Upload failed: ${xhr.status}`));
            } catch {
              reject(new Error(`Upload failed: ${xhr.status}`));
            }
          }
        });

        xhr.addEventListener('error', () => reject(new Error('Network error during upload')));

        xhr.open('POST', `${API_BASE}/files/upload`);
        xhr.withCredentials = true;
        xhr.setRequestHeader('Authorization', `Bearer ${getAccessToken()}`);
        xhr.setRequestHeader('x-csrf-token', csrfToken);
        xhr.setRequestHeader('x-client-encrypted', 'true');
        xhr.setRequestHeader('x-original-mime', originalMime);
        xhr.send(formData);
      });

      // ── Step 4: Send IV to server (PATCH /files/:id/iv) ───────────────────
      await apiFetch(`/files/${fileId}/iv`, {
        method : 'PATCH',
        body: JSON.stringify({ iv: ivB64 }),
      });

      setProgress(100);
      setStatus('done');

      // ── Step 5: Persist key to IndexedDB (survives session/tab close) ──────
      await storeFileKey(fileId, keyB64, ivB64, file.name);

      onSuccess?.({ fileId, fileName: file.name, ivB64, keyB64 });
    } catch (err) {
      console.error('[EncryptedFileUpload]', err);
      setErrorMsg(err.message);
      setStatus('error');
    }
  }

  function handleInputChange(e) {
    handleFile(e.target.files?.[0]);
    // Reset input so same file can be re-selected
    e.target.value = '';
  }

  function handleDrop(e) {
    e.preventDefault();
    handleFile(e.dataTransfer.files?.[0]);
  }

  const isActive = status === 'encrypting' || status === 'uploading';

  return (
    <div className={styles.wrapper}>
      <div
        className={`${styles.dropzone} ${isActive ? styles.active : ''} ${status === 'done' ? styles.done : ''} ${status === 'error' ? styles.errored : ''}`}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => !isActive && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Upload encrypted file"
        onKeyDown={(e) => e.key === 'Enter' && !isActive && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className={styles.hiddenInput}
          onChange={handleInputChange}
          aria-hidden="true"
        />

        {status === 'idle' && (
          <>
            <div className={styles.icon} aria-hidden="true">🔒</div>
            <p className={styles.dropText}>Drop file here or click to browse</p>
            <p className={styles.hint}>Encrypted before upload · Max 20 MB</p>
            <p className={styles.hint}>PDF, JPEG, PNG, DICOM, TIFF</p>
          </>
        )}

        {status === 'encrypting' && (
          <>
            <div className={styles.icon} aria-hidden="true">🔐</div>
            <p className={styles.dropText}>Encrypting {fileName}…</p>
            <p className={styles.hint}>AES-256-GCM in browser</p>
          </>
        )}

        {status === 'uploading' && (
          <>
            <div className={styles.icon} aria-hidden="true">⬆</div>
            <p className={styles.dropText}>Uploading {fileName}…</p>
          </>
        )}

        {status === 'done' && (
          <>
            <div className={styles.icon} aria-hidden="true">✅</div>
            <p className={styles.dropText}>{fileName} uploaded</p>
            <p className={styles.hint}>Encrypted and stored securely</p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className={styles.icon} aria-hidden="true">❌</div>
            <p className={styles.dropText}>Upload failed</p>
            <p className={styles.errorText}>{errorMsg}</p>
          </>
        )}
      </div>

      {(status === 'uploading' || status === 'encrypting') && (
        <div className={styles.progressBar} role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className={styles.progressFill} style={{ width: `${progress}%` }} />
          <span className={styles.progressLabel}>{progress}%</span>
        </div>
      )}

      {status === 'done' && (
        <button
          className={styles.resetBtn}
          onClick={() => { setStatus('idle'); setProgress(0); setFileName(''); }}
        >
          Upload another file
        </button>
      )}

      {status === 'error' && (
        <button
          className={styles.resetBtn}
          onClick={() => { setStatus('idle'); setErrorMsg(''); }}
        >
          Try again
        </button>
      )}
    </div>
  );
}
