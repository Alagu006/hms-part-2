/**
 * Dark mode utility — persists preference to localStorage,
 * applies/removes the `data-theme="dark"` attribute on <html>.
 */

const KEY = 'hms-theme';

export function getStoredTheme() {
  return localStorage.getItem(KEY) ?? 'light';
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(KEY, theme);
}

export function toggleTheme() {
  const current = getStoredTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}

export function initTheme() {
  applyTheme(getStoredTheme());
}
