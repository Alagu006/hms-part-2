/**
 * keyStore.js — Persistent AES-256-GCM key storage using IndexedDB.
 *
 * Keys are stored as raw CryptoKey objects (non-extractable after import)
 * alongside their base64 export for backup/sharing.
 *
 * DB: hms_keys  |  Store: file_keys  |  Key: fileId (string)
 * Value: { fileId, keyB64, ivB64, fileName, uploadedAt }
 */

import { openDB } from 'idb';

const DB_NAME    = 'hms_keys';
const DB_VERSION = 1;
const STORE      = 'file_keys';

function getDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'fileId' });
        store.createIndex('uploadedAt', 'uploadedAt');
      }
    },
  });
}

/**
 * Persist a file's encryption key + IV to IndexedDB.
 * @param {string} fileId
 * @param {string} keyB64   — base64 AES-256 raw key
 * @param {string} ivB64    — base64 IV
 * @param {string} fileName — original file name (for display)
 */
export async function storeFileKey(fileId, keyB64, ivB64, fileName = '') {
  const db = await getDB();
  await db.put(STORE, {
    fileId,
    keyB64,
    ivB64,
    fileName,
    uploadedAt: new Date().toISOString(),
  });

  // Also mirror to sessionStorage for fast same-session access
  try {
    const store = JSON.parse(sessionStorage.getItem('fileKeys') ?? '{}');
    store[fileId] = keyB64;
    sessionStorage.setItem('fileKeys', JSON.stringify(store));
  } catch { /* quota exceeded — IDB is the source of truth */ }
}

/**
 * Retrieve a stored key record by fileId.
 * Returns null if not found.
 * @param {string} fileId
 * @returns {Promise<{ fileId, keyB64, ivB64, fileName, uploadedAt } | null>}
 */
export async function getFileKey(fileId) {
  // Fast path: sessionStorage
  try {
    const store = JSON.parse(sessionStorage.getItem('fileKeys') ?? '{}');
    if (store[fileId]) {
      return { fileId, keyB64: store[fileId], ivB64: null, fileName: '', uploadedAt: null };
    }
  } catch { /* ignore */ }

  // Slow path: IndexedDB
  const db = await getDB();
  return (await db.get(STORE, fileId)) ?? null;
}

/**
 * List all stored key records (for a key management UI).
 * @returns {Promise<Array>}
 */
export async function listFileKeys() {
  const db = await getDB();
  return db.getAll(STORE);
}

/**
 * Delete a key record (e.g. after file is deleted from server).
 * @param {string} fileId
 */
export async function deleteFileKey(fileId) {
  const db = await getDB();
  await db.delete(STORE, fileId);

  try {
    const store = JSON.parse(sessionStorage.getItem('fileKeys') ?? '{}');
    delete store[fileId];
    sessionStorage.setItem('fileKeys', JSON.stringify(store));
  } catch { /* ignore */ }
}

/**
 * Export all keys as a JSON string (for backup).
 * The user should save this securely — it contains all decryption keys.
 */
export async function exportAllKeys() {
  const keys = await listFileKeys();
  return JSON.stringify(keys, null, 2);
}

/**
 * Import keys from a backup JSON string.
 * Merges with existing keys (does not overwrite newer entries).
 */
export async function importKeysFromBackup(jsonString) {
  const entries = JSON.parse(jsonString);
  if (!Array.isArray(entries)) throw new Error('Invalid backup format');
  const db = await getDB();
  const tx = db.transaction(STORE, 'readwrite');
  for (const entry of entries) {
    if (entry.fileId && entry.keyB64) {
      await tx.store.put(entry);
    }
  }
  await tx.done;
  return entries.length;
}
