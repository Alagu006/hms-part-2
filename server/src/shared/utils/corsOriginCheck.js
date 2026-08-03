/**
 * Shared CORS origin validator used by both the Express HTTP server (app.js)
 * and Socket.io (socket.js).
 *
 * - Allow-list is driven by CLIENT_ORIGIN (comma-separated).
 * - Requests with no Origin header (mobile apps, curl, same-origin) are allowed.
 * - In non-production environments any https:// origin is allowed so the HTTPS
 *   dev client (vite plugin-basic-ssl) works without editing the allow-list.
 *
 * Signature matches the CORS `origin` callback: (origin, callback).
 */
export function corsOriginCheck(origin, callback) {
  // Allow requests with no origin (e.g. mobile apps, curl)
  if (!origin) return callback(null, true);

  const allowed = (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map(o => o.trim());

  // Also allow any https:// origin in development
  if (process.env.NODE_ENV !== 'production' && origin.startsWith('https://')) {
    return callback(null, true);
  }

  if (allowed.includes(origin)) return callback(null, true);
  callback(new Error(`CORS blocked: ${origin}`));
}
