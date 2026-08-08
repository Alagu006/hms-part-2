/**
 * Telemedicine in-call chat encryption.
 * AES-256-GCM with a cryptographically random 96-bit IV per message.
 * The IV is prepended to the ciphertext and transmitted alongside it.
 *
 * Wire format: "<base64(iv)>.<base64(ciphertext+authTag)>"
 *
 * Key agreement: ECDH (P-256) over the authenticated telemedicine socket.
 * Each participant generates an ECDH keypair and exchanges only its PUBLIC
 * key via the socket; both sides derive the SAME AES-256 key by running HKDF
 * over the ECDH shared secret with identical salt/info. The private key never
 * leaves the client and no AES key ever crosses the wire.
 */

const HKDF_SALT = new Uint8Array([
  0x68, 0x6d, 0x73, 0x2d, 0x74, 0x65, 0x6c, 0x65,
  0x6d, 0x65, 0x64, 0x69, 0x63, 0x69, 0x6e, 0x65,
]);
const HKDF_INFO = new TextEncoder().encode('hms-telemedicine-chat-v1');

/**
 * Generate an ECDH keypair for room-chat key agreement.
 * @returns {Promise<{ keyPair: CryptoKeyPair, publicKeyJwk: object }>}
 */
export async function generateRoomKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false, // private key non-extractable — it must never leave this client
    ['deriveKey', 'deriveBits']
  );
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  return { keyPair, publicKeyJwk };
}

/**
 * Derive the shared AES-256 chat key from our private key and the peer's
 * public key. Both participants compute the same value, so both end up with
 * the same base64 key for the existing encrypt/decrypt helpers.
 *
 * @param {CryptoKey} privateKey     — our ECDH private key
 * @param {object}    peerPublicKeyJwk — peer's exported public key (JWK)
 * @returns {Promise<string>} — 32-byte AES key as base64
 */
export async function deriveRoomKey(privateKey, peerPublicKeyJwk) {
  const peerPublicKey = await crypto.subtle.importKey(
    'jwk',
    peerPublicKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerPublicKey },
    privateKey,
    256
  );

  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    sharedSecret,
    { name: 'HKDF' },
    false,
    ['deriveKey']
  );

  const aesKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: HKDF_INFO },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    true, // extractable so the base64 form can feed the encrypt/decrypt helpers
    ['encrypt', 'decrypt']
  );

  const raw = await crypto.subtle.exportKey('raw', aesKey);
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

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
