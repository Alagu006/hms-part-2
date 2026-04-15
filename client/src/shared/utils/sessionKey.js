/**
 * sessionKey.js
 *
 * Manages a per-session AES-256-GCM key used to encrypt all API request
 * payloads and decrypt encrypted API responses.
 *
 * Lifecycle:
 *   - Generated fresh on every login (initSessionKey)
 *   - Stored only in memory (module-level variable) — never written to
 *     localStorage or sessionStorage, so it cannot be exfiltrated by XSS
 *     reading storage APIs
 *   - Cleared on logout (clearSessionKey)
 *
 * The public key (base64) is sent to the server on login so the server
 * can encrypt responses back. The server wraps its response in:
 *   { encrypted: true, iv: "<base64>", ciphertext: "<base64>" }
 */

import { generateKey, exportKey, encrypt, decrypt } from './crypto.js';

// In-memory only — intentionally NOT in sessionStorage
let _sessionKey = null;
let _sessionKeyB64 = null;

/**
 * Generate a fresh session key. Call this immediately after a successful login.
 * Returns the base64-encoded public key to send to the server.
 */
export async function initSessionKey() {
  _sessionKey    = await generateKey();
  _sessionKeyB64 = await exportKey(_sessionKey);
  return _sessionKeyB64;
}

/**
 * Get the current session key (CryptoKey object).
 * Returns null if not initialised (user not logged in).
 */
export function getSessionKey() {
  return _sessionKey;
}

/**
 * Get the base64 export of the session key (for sending to server).
 */
export function getSessionKeyB64() {
  return _sessionKeyB64;
}

/**
 * Clear the session key on logout.
 */
export function clearSessionKey() {
  _sessionKey    = null;
  _sessionKeyB64 = null;
}

/**
 * Encrypt a JSON-serialisable payload with the session key.
 * Returns { iv, ciphertext } — both base64.
 * Falls back to returning the original payload if no session key exists
 * (e.g. during login itself).
 */
export async function encryptPayload(data) {
  if (!_sessionKey) return null; // no key yet — caller sends plain
  return encrypt(data, _sessionKey);
}

/**
 * Decrypt a server response envelope { iv, ciphertext } with the session key.
 * Returns the decrypted object.
 */
export async function decryptResponse({ iv, ciphertext }) {
  if (!_sessionKey) throw new Error('No session key — cannot decrypt response');
  const str = await decrypt({ iv, ciphertext }, _sessionKey);
  return JSON.parse(str);
}
