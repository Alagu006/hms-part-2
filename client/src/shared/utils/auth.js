// Create a callback that can be set by the store to handle auth clearing
let clearAuthCallback = null;
export function setClearAuthCallback(callback) {
  clearAuthCallback = callback;
}
