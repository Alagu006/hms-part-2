/**
 * Telemedicine in-call chat encryption.
 * AES-256-GCM with a cryptographically random 96-bit IV per message.
 * The IV is prepended to the ciphertext and transmitted alongside it.
 *
 * Wire format: "<base64(iv)>.<base64(ciphertext+authTag)>"
 */

/**
 * Import a raw base64 AES-256 key for use with AES-GCM.
 * @param {string} keyBase64
 * @returns {Promise<CryptoKey>}
 */
async function importKey(keyBase64) {
  const keyBytes = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a plaintext string.
 * @param {string} plaintext
 * @param {string} keyBase64  — 32-byte key as base64
 * @returns {Promise<{ ciphertext: string, iv: string }>}
 *   ciphertext and iv are both base64 strings
 */
export async function encryptChatMessage(plaintext, keyBase64) {
  const key = await importKey(keyBase64);

  // CRITICAL: fresh random IV for every message — never reuse
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM

  const encoded = new TextEncoder().encode(plaintext);
  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );

  const ivB64 = btoa(String.fromCharCode(...iv));
  const ctB64 = btoa(String.fromCharCode(...new Uint8Array(ciphertextBuf)));

  return { ciphertext: ctB64, iv: ivB64 };
}

/**
 * Decrypt a ciphertext string.
 * @param {string} ciphertext  — base64
 * @param {string} iv          — base64 (12 bytes)
 * @param {string} keyBase64   — 32-byte key as base64
 * @returns {Promise<string>}
 */
export async function decryptChatMessage(ciphertext, iv, keyBase64) {
  if (!ciphertext || !iv || !keyBase64) {
    throw new Error('Missing ciphertext, iv, or key');
  }

  const key = await importKey(keyBase64);

  const ivBytes = Uint8Array.from(atob(iv), (c) => c.charCodeAt(0));
  const ctBytes = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));

  const plaintextBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes },
    key,
    ctBytes
  );

  return new TextDecoder().decode(plaintextBuf);
}
