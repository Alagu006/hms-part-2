/**
 * In-memory group key cache — intentionally NOT persisted to sessionStorage
 * or localStorage. Keys live only for the duration of this page session and
 * are cleared when the tab is closed or the user logs out.
 *
 * Kept in a separate module so the auth store can call clearGroupKeyCache()
 * on logout without creating a circular dependency with MessagingLayout.
 */

export const _groupKeyCache = new Map(); // groupId → CryptoKey

/** Call on logout to wipe all cached group keys from memory. */
export function clearGroupKeyCache() {
  _groupKeyCache.clear();
}
