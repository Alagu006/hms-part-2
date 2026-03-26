/**
 * AES-256-GCM helpers using the Web Crypto API (browser-native, zero deps).
 *
 * Key derivation: PBKDF2-SHA256, 310,000 iterations (OWASP 2023 recommendation).
 * Output format for encrypt(): { iv: base64, ciphertext: base64, tag is appended by WebCrypto }
 */

const ALGO       = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH  = 12; // 96-bit IV recommended for GCM

// ---------------------------------------------------------------------------
// Key import / derivation
// ---------------------------------------------------------------------------

/**
 * Import a raw 32-byte key (base64 string) as a CryptoKey.
 * Use this when you already have a key from the server.
 */
export async function importKey(base64Key) {
  const raw = base64ToBuffer(base64Key);
  return crypto.subtle.importKey('raw', raw, { name: ALGO }, false, ['encrypt', 'decrypt']);
}

/**
 * Derive a CryptoKey from a passphrase + salt using PBKDF2.
 *
 * @param {string} passphrase
 * @param {Uint8Array|string} salt  - raw bytes or base64 string
 */
export async function deriveKey(passphrase, salt) {
  const saltBytes = typeof salt === 'string' ? base64ToBuffer(salt) : salt;
  const enc       = new TextEncoder();

  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name      : 'PBKDF2',
      salt      : saltBytes,
      iterations: 310_000,
      hash      : 'SHA-256',
    },
    baseKey,
    { name: ALGO, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Generate a fresh random AES-256-GCM CryptoKey.
 */
export async function generateKey() {
  return crypto.subtle.generateKey({ name: ALGO, length: KEY_LENGTH }, true, ['encrypt', 'decrypt']);
}

/**
 * Export a CryptoKey to base64 string.
 */
export async function exportKey(cryptoKey) {
  const raw = await crypto.subtle.exportKey('raw', cryptoKey);
  return bufferToBase64(raw);
}

// ---------------------------------------------------------------------------
// Encrypt
// ---------------------------------------------------------------------------

/**
 * Encrypt a string or object.
 *
 * @param {string|object} data
 * @param {CryptoKey}     key
 * @returns {{ iv: string, ciphertext: string }}  — both base64
 */
export async function encrypt(data, key) {
  const enc       = new TextEncoder();
  const plaintext = typeof data === 'string' ? data : JSON.stringify(data);
  const iv        = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const cipherbuffer = await crypto.subtle.encrypt(
    { name: ALGO, iv },
    key,
    enc.encode(plaintext)
  );

  return {
    iv        : bufferToBase64(iv),
    ciphertext: bufferToBase64(cipherbuffer),
  };
}

// ---------------------------------------------------------------------------
// Decrypt
// ---------------------------------------------------------------------------

/**
 * Decrypt back to string.
 *
 * @param {{ iv: string, ciphertext: string }} payload
 * @param {CryptoKey} key
 * @returns {string}
 */
export async function decrypt({ iv, ciphertext }, key) {
  const dec = new TextDecoder();

  const plainbuffer = await crypto.subtle.decrypt(
    { name: ALGO, iv: base64ToBuffer(iv) },
    key,
    base64ToBuffer(ciphertext)
  );

  return dec.decode(plainbuffer);
}

/**
 * Decrypt and JSON.parse in one step.
 */
export async function decryptJson(payload, key) {
  const str = await decrypt(payload, key);
  return JSON.parse(str);
}

// ---------------------------------------------------------------------------
// JWT payload helpers
// Encrypts the JWT string itself before handing it to the client,
// and decrypts it before attaching to Authorization header.
// ---------------------------------------------------------------------------

/**
 * Wrap a JWT string in AES-256-GCM encryption.
 * The session key should be derived per-session and stored in sessionStorage.
 *
 * @param {string}    jwtString
 * @param {CryptoKey} sessionKey
 * @returns {string}  — JSON string: { iv, ciphertext }
 */
export async function encryptToken(jwtString, sessionKey) {
  const payload = await encrypt(jwtString, sessionKey);
  return JSON.stringify(payload);
}

/**
 * Unwrap an encrypted JWT string.
 *
 * @param {string}    encryptedToken  — JSON string from encryptToken
 * @param {CryptoKey} sessionKey
 * @returns {string}  — raw JWT string
 */
export async function decryptToken(encryptedToken, sessionKey) {
  const payload = JSON.parse(encryptedToken);
  return decrypt(payload, sessionKey);
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

export function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary  = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Generate a random salt (16 bytes) as base64.
 */
export function generateSalt() {
  return bufferToBase64(crypto.getRandomValues(new Uint8Array(16)));
}

// ---------------------------------------------------------------------------
// Messaging helpers — group key encrypt/decrypt
// ---------------------------------------------------------------------------

/**
 * Encrypt a plaintext message string with a group AES-256-GCM key.
 * @param {string}    text
 * @param {CryptoKey} groupKey
 * @returns {Promise<{ ciphertext: string, iv: string }>}  — both base64
 */
export async function encryptMessage(text, groupKey) {
  return encrypt(text, groupKey);
}

/**
 * Decrypt a message ciphertext with a group AES-256-GCM key.
 * @param {string}    ciphertext  — base64
 * @param {string}    iv          — base64
 * @param {CryptoKey} groupKey
 * @returns {Promise<string>}
 */
export async function decryptMessage(ciphertext, iv, groupKey) {
  return decrypt({ ciphertext, iv }, groupKey);
}
