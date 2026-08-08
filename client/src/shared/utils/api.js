import axios from 'axios';
import { useStore } from '../store/index.js';
import { encryptPayload, decryptResponse, getSessionKeyB64 } from './sessionKey.js';

// Canonical base URL for the entire client. Import from here everywhere —
// never redefine `import.meta.env.VITE_API_URL` in individual components.
export const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

const api = axios.create({
  baseURL        : API_BASE,
  timeout        : 15000,
  headers        : { 'Content-Type': 'application/json' },
  withCredentials: true,
});

// Cache the CSRF token
let csrfToken = null;
export async function getCsrfToken() {
  if (csrfToken) return csrfToken;
  const res = await fetch(`${API_BASE}/auth/csrf-token`, { credentials: 'include' });
  const data = await res.json();
  csrfToken = data.csrfToken;
  return csrfToken;
}

const MUTATING = ['post', 'put', 'patch', 'delete'];

// ── 401 → refresh → retry ─────────────────────────────────────────────────────
// Access tokens expire after 15 minutes. On a 401, exchange the HttpOnly refresh
// cookie for a new access token and replay the failed request once. If refresh
// fails, the session is gone and we fall back to a full logout.
let refreshInFlight = null;

async function refreshAccessToken() {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method      : 'POST',
        credentials : 'include',
        headers     : { 'Content-Type': 'application/json', 'x-csrf-token': await getCsrfToken() },
      });
      if (!res.ok) throw new Error('Refresh failed');
      const data = await res.json();
      if (!data?.accessToken) throw new Error('Refresh returned no token');
      return data.accessToken;
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

// ── Request interceptor — auth + CSRF + payload encryption ───────────────────
api.interceptors.request.use(async (config) => {
  // Replayed request — token/CSRF/encryption already prepared on first attempt
  if (config._retried) return config;

  // Attach Bearer token
  const token = useStore.getState()?.accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;

  // CSRF for mutating requests
  if (MUTATING.includes(config.method?.toLowerCase())) {
    config.headers['x-csrf-token'] = await getCsrfToken();
  }

  // FormData needs the browser to set the multipart boundary — drop the default
  const isFormData = typeof FormData !== 'undefined' && config.data instanceof FormData;
  if (isFormData) delete config.headers['Content-Type'];

  // Encrypt JSON body for mutating requests
  if (MUTATING.includes(config.method?.toLowerCase()) && config.data) {
    try {
      const plainData = typeof config.data === 'string'
        ? JSON.parse(config.data)
        : config.data;

      const encrypted = await encryptPayload(plainData);
      if (encrypted) {
        config.data = { encrypted: true, iv: encrypted.iv, ciphertext: encrypted.ciphertext };
        config.headers['X-Encrypted'] = '1';
        const keyB64 = getSessionKeyB64();
        if (keyB64) config.headers['X-Client-Key'] = keyB64;
      }
    } catch {
      // Not JSON-serialisable (e.g. FormData) — send as-is
    }
  }

  return config;
});

// ── Response interceptor — decrypt + error handling ──────────────────────────
api.interceptors.response.use(
  async (response) => {
    // Transparently decrypt if server returned an encrypted envelope
    if (response.data?.encrypted === true && response.data.iv && response.data.ciphertext) {
      try {
        response.data = await decryptResponse(response.data);
      } catch {
        // Decryption failed — return raw
      }
    }
    return response;
  },
  async (error) => {
    const status   = error.response?.status;
    const original = error.config;

    // 401 → try to refresh the access token once, then replay the request
    if (status === 401 && original && !original._retried) {
      try {
        const accessToken = await refreshAccessToken();
        if (accessToken) {
          const { user } = useStore.getState();
          useStore.getState()?.setAuth?.({ user, accessToken });
          original._retried = true;
          original.headers = original.headers ?? {};
          original.headers.Authorization = `Bearer ${accessToken}`;
          return api(original);
        }
      } catch {
        // Refresh failed — fall through to logout below
      }
    }

    if (status === 401) {
      useStore.getState()?.clearAuth?.();
      window.location.href = '/login';
    }
    if (status === 403) {
      csrfToken = null;
    }
    return Promise.reject(error);
  }
);

// ── Error normalisation (mirrors the old apiFetch behaviour) ─────────────────
async function normalizeError(error) {
  const status = error.response?.status;
  if (status === 403) return new Error('Access denied — you do not have permission for this action');
  if (status === 404) return new Error('Resource not found');

  let data = error.response?.data;
  // Error envelopes may themselves be encrypted
  if (data?.encrypted === true && data.iv && data.ciphertext) {
    try { data = await decryptResponse(data); } catch { /* keep raw */ }
  }

  const msg = data?.message ?? data?.error
    ?? (data?.issues?.map((i) => `${i.field}: ${i.message}`).join('; '))
    ?? error.message;
  return new Error(msg);
}

// ── Convenience wrapper over the axios instance ──────────────────────────────
// Preserves the old apiFetch(url, { method, body, headers }) signature so
// existing call sites behave identically: it returns parsed JSON, a Blob for
// `responseType: 'blob'`, an ArrayBuffer for `responseType: 'arraybuffer'`,
// or null on 401. Every request still flows through the axios interceptors
// above (CSRF, encryption, auth attachment), so this is the single client.
export async function apiFetch(url, options = {}) {
  const { method = 'GET', body, headers, responseType, ...rest } = options;

  const config = {
    url,
    method   : method.toLowerCase(),
    headers  : headers ?? {},
    ...rest,
  };
  if (responseType) config.responseType = responseType;
  if (body !== undefined) config.data = body;

  try {
    const response = await api(config);
    return response.data;
  } catch (error) {
    if (error.response?.status === 401) return null;
    throw await normalizeError(error);
  }
}

export default api;
