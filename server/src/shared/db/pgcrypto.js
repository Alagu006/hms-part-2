import { query } from './pool.js';

// pgcrypto symmetric encryption key — must be set in env, never hardcoded
const PG_CRYPTO_KEY = process.env.PG_CRYPTO_KEY;

if (!PG_CRYPTO_KEY) {
  throw new Error('PG_CRYPTO_KEY environment variable is required');
}

/**
 * Encrypt a plaintext value using pgcrypto pgp_sym_encrypt.
 * Returns the encrypted bytea as a hex string for storage in TEXT columns.
 *
 * @param {string} value
 * @returns {Promise<string>}  — encrypted hex string
 */
export async function pgEncrypt(value) {
  if (value === null || value === undefined) return null;
  const { rows } = await query(
    `SELECT encode(pgp_sym_encrypt($1::text, $2), 'hex') AS encrypted`,
    [String(value), PG_CRYPTO_KEY]
  );
  return rows[0].encrypted;
}

/**
 * Decrypt a hex-encoded pgcrypto value back to plaintext.
 *
 * @param {string} encryptedHex
 * @returns {Promise<string>}
 */
export async function pgDecrypt(encryptedHex) {
  if (encryptedHex === null || encryptedHex === undefined) return null;
  const { rows } = await query(
    `SELECT pgp_sym_decrypt(decode($1, 'hex'), $2) AS decrypted`,
    [encryptedHex, PG_CRYPTO_KEY]
  );
  return rows[0].decrypted;
}

/**
 * Encrypt multiple fields of an object in parallel.
 * Returns a new object with the specified fields encrypted.
 *
 * @param {object}   obj
 * @param {string[]} fields
 * @returns {Promise<object>}
 */
export async function pgEncryptFields(obj, fields) {
  const result = { ...obj };
  await Promise.all(
    fields.map(async (field) => {
      if (result[field] !== undefined && result[field] !== null) {
        result[field] = await pgEncrypt(result[field]);
      }
    })
  );
  return result;
}

/**
 * Decrypt multiple fields of an object in parallel.
 *
 * @param {object}   obj
 * @param {string[]} fields
 * @returns {Promise<object>}
 */
export async function pgDecryptFields(obj, fields) {
  const result = { ...obj };
  await Promise.all(
    fields.map(async (field) => {
      if (result[field] !== undefined && result[field] !== null) {
        result[field] = await pgDecrypt(result[field]);
      }
    })
  );
  return result;
}
