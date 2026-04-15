import axios from 'axios';
import { useStore } from '../store/index.js';
import { encryptPayload, decryptResponse, getSessionKeyB64 } from './sessionKey.js';

const api = axios.create({
  baseURL        : import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api',
  timeout        : 15000,
  headers        : { 'Content-Type': 'application/json' },
  withCredentials: true,
});

// Cache the CSRF token
let csrfToken = null;
async function getCsrfToken() {
  if (csrfToken) return csrfToken;
  const res = await fetch('/api/auth/csrf-token', { credentials: 'include' });
  const data = await res.json();
  csrfToken = data.csrfToken;
  return csrfToken;
}

const MUTATING = ['post', 'put', 'patch', 'delete'];

// ── Request interceptor — auth + CSRF + payload encryption ───────────────────
api.interceptors.request.use(async (config) => {
  // Attach Bearer token
  const token = useStore.getState()?.accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;

  // CSRF for mutating requests
  if (MUTATING.includes(config.method?.toLowerCase())) {
    config.headers['x-csrf-token'] = await getCsrfToken();
  }

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
    if (error.response?.status === 401) {
      useStore.getState()?.clearAuth?.();
      window.location.href = '/login';
    }
    if (error.response?.status === 403) {
      csrfToken = null;
    }
    return Promise.reject(error);
  }
);

export default api;
