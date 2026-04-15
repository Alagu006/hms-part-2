/**
 * Returns the socket base URL.
 *
 * Always returns '' so socket.io connects to the same origin as the page.
 * Vite proxies /socket.io → http://localhost:5000, which works for both
 * localhost (laptop) and mobile (https://ip:5173 → proxy → http://localhost:5000).
 * This avoids mixed-content errors where an HTTPS page tries to open a plain HTTP socket.
 */
export function getSocketUrl() {
  return '';
}
