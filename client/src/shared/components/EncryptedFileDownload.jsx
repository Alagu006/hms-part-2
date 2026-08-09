import { useState } from 'react';
import { importKey, base64ToBuffer } from '../utils/crypto.js';
import api from '../utils/api.js';
import { getFileKey } from '../utils/keyStore.js';
import styles from './EncryptedFileDownload.module.scss';

/**
 * Decrypt an AES-256-GCM encrypted ArrayBuffer.
 *
 * @param {ArrayBuffer} cipherBuffer  — raw encrypted bytes from server
 * @param {string}      ivB64         — base64 IV from X-Encryption-IV header
 * @param {CryptoKey}   key           — imported AES-GCM CryptoKey
 * @returns {Promise<ArrayBuffer>}    — decrypted plaintext bytes
 */
async function decryptBuffer(cipherBuffer, ivB64, key) {
  const iv = base64ToBuffer(ivB64);
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv) },
    key,
    cipherBuffer
  );
}

/**
 * Trigger a browser download of an ArrayBuffer.
 */
function triggerDownload(buffer, fileName, mimeType) {
  const blob = new Blob([buffer], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after a tick to allow download to start
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Retrieve the AES key for a file from IndexedDB (with sessionStorage fast path).
 * Returns null if not found.
 */
async function getStoredKey(fileId) {
  const record = await getFileKey(fileId);
  return record?.keyB64 ?? null;
}

export default function EncryptedFileDownload({ fileId, fileName, mimeType }) {
  const [status, setStatus]   = useState('idle'); // idle | downloading | decrypting | done | error
  const [errorMsg, setErrorMsg] = useState('');

  async function handleDownload() {
    setStatus('downloading');
    setErrorMsg('');

    try {
      // ── Step 1: Fetch encrypted file from server ──────────────────────────
      const res = await api.get(`/files/${fileId}/download`, { responseType: 'arraybuffer' });

      // ── Step 2: Extract IV from response header ───────────────────────────
      const ivB64        = res.headers['x-encryption-iv'];
      const isEncrypted  = res.headers['x-encrypted'] === 'true';
      const serverMime   = mimeType ?? res.headers['content-type'] ?? 'application/octet-stream';

      const cipherBuffer = res.data;

      // ── Step 3: Retrieve AES key from session storage ─────────────────────
      if (!isEncrypted || !ivB64) {
        // File was not client-encrypted (legacy or plain upload) — download as-is
        triggerDownload(cipherBuffer, fileName ?? `file_${fileId}`, serverMime);
        setStatus('done');
        return;
      }

      setStatus('decrypting');

      const keyB64 = await getStoredKey(fileId);
      if (!keyB64) {
        throw new Error(
          'Decryption key not found in this session. ' +
          'Files can only be decrypted in the session they were uploaded, ' +
          'or if the key was explicitly shared.'
        );
      }

      // ── Step 4: Import key and decrypt ───────────────────────────────────
      const cryptoKey     = await importKey(keyB64);
      const plainBuffer   = await decryptBuffer(cipherBuffer, ivB64, cryptoKey);

      // ── Step 5: Verify integrity (optional SHA-256 check) ─────────────────
      // Server sends X-Checksum-SHA256 of the encrypted bytes.
      // We verify the ciphertext checksum before decryption.
      const serverChecksum = res.headers['x-checksum-sha256'];
      if (serverChecksum) {
        const hashBuffer = await crypto.subtle.digest('SHA-256', cipherBuffer);
        const hashArray  = Array.from(new Uint8Array(hashBuffer));
        const hashHex    = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
        if (hashHex !== serverChecksum) {
          throw new Error('File integrity check failed. The file may have been tampered with.');
        }
      }

      // ── Step 6: Trigger browser download ─────────────────────────────────
      triggerDownload(plainBuffer, fileName ?? `file_${fileId}`, serverMime);
      setStatus('done');

      // Reset to idle after a moment
      setTimeout(() => setStatus('idle'), 3000);
    } catch (err) {
      console.error('[EncryptedFileDownload]', err);
      let msg = err.message;
      // Axios error payload for an ArrayBuffer response is raw JSON bytes
      if (err.response?.data && typeof err.response.data === 'object') {
        try {
          const text = new TextDecoder().decode(err.response.data);
          msg = JSON.parse(text).error ?? msg;
        } catch { /* keep axios message */ }
      }
      setErrorMsg(msg);
      setStatus('error');
    }
  }

  const label = {
    idle       : '⬇ Download',
    downloading: 'Downloading…',
    decrypting : 'Decrypting…',
    done       : '✓ Downloaded',
    error      : '✕ Failed',
  }[status];

  return (
    <div className={styles.wrapper}>
      <button
        className={`${styles.btn} ${styles[status]}`}
        onClick={handleDownload}
        disabled={status === 'downloading' || status === 'decrypting'}
        aria-label={`Download ${fileName ?? 'file'}`}
        aria-busy={status === 'downloading' || status === 'decrypting'}
      >
        {label}
      </button>

      {status === 'downloading' || status === 'decrypting' ? (
        <div className={styles.spinner} aria-hidden="true" />
      ) : null}

      {status === 'error' && (
        <p className={styles.errorText} role="alert">{errorMsg}</p>
      )}

      {status === 'done' && (
        <p className={styles.successText}>File decrypted and saved to your device.</p>
      )}
    </div>
  );
}
