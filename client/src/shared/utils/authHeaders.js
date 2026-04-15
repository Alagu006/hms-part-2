import { useStore } from '../store';
import { encryptPayload, decryptResponse, getSessionKeyB64 } from './sessionKey.js';

export function authHeaders() {
  const token = sessionStorage.getItem('accessToken');
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

let _csrfToken = null;
export async function getCsrfToken() {
  if (_csrfToken) return _csrfToken;
  const res = await fetch('/api/auth/csrf-token', { credentials: 'include' });
  const data = await res.json();
  _csrfToken = data.csrfToken;
  return _csrfToken;
}

const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Encrypted fetch wrapper.
 *
 * For mutating requests (POST/PUT/PATCH/DELETE):
 *   - If a session key exists, the JSON body is AES-256-GCM encrypted and
 *     sent as { encrypted: true, iv, ciphertext } with header X-Encrypted: 1
 *   - If no session key (e.g. login request itself), body is sent plain
 *
 * For responses:
 *   - If the server returns { encrypted: true, iv, ciphertext }, it is
 *     decrypted transparently before returning to the caller
 *   - Plain JSON responses are returned as-is (backwards compatible)
 */
export async function apiFetch(url, options = {}) {
  const method = (options.method ?? 'GET').toUpperCase();
  const extraHeaders = {};

  // ── CSRF token for mutating requests ──────────────────────────────────────
  if (MUTATING.includes(method)) {
    extraHeaders['x-csrf-token'] = await getCsrfToken();
  }

  // ── Encrypt request body ──────────────────────────────────────────────────
  let body = options.body;
  if (MUTATING.includes(method) && body) {
    try {
      // Parse the body to get the plain object
      const plainData = typeof body === 'string' ? JSON.parse(body) : body;
      const encrypted = await encryptPayload(plainData);

      if (encrypted) {
        // Wrap in envelope and signal to server
        body = JSON.stringify({ encrypted: true, iv: encrypted.iv, ciphertext: encrypted.ciphertext });
        extraHeaders['X-Encrypted'] = '1';
        // Send our public key so server can encrypt its response back
        const keyB64 = getSessionKeyB64();
        if (keyB64) extraHeaders['X-Client-Key'] = keyB64;
      }
    } catch {
      // Body wasn't JSON (e.g. FormData) — send as-is
    }
  }

  // ── Fire request ──────────────────────────────────────────────────────────
  const response = await fetch(url, {
    ...options,
    body,
    credentials: 'include',
    headers: {
      ...authHeaders(),
      ...extraHeaders,
      ...options.headers,
    },
  });

  // ── Auth / error handling ─────────────────────────────────────────────────
  if (response.status === 401) {
    useStore.getState().clearAuth();
    window.location.href = '/login';
    return null;
  }

  if (response.status === 403) {
    _csrfToken = null;
    throw new Error('Access denied — you do not have permission for this action');
  }

  if (response.status === 404) {
    throw new Error('Resource not found');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const msg = error.message ?? error.error
      ?? (error.issues?.map(i => `${i.field}: ${i.message}`).join('; '))
      ?? `Request failed with status ${response.status}`;
    throw new Error(msg);
  }

  // ── Parse response ────────────────────────────────────────────────────────
  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/pdf')) {
    return response.blob();
  }

  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return null;
  }

  const json = await response.json();

  // ── Decrypt response if server encrypted it ───────────────────────────────
  if (json?.encrypted === true && json.iv && json.ciphertext) {
    try {
      return await decryptResponse(json);
    } catch {
      // Decryption failed — return raw (server may not support encryption yet)
      return json;
    }
  }

  return json;
}
