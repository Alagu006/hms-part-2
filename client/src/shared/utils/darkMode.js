/**
 * Dark mode utility — persists preference to localStorage,
 * applies the `data-theme` attribute on <html>.
 * Supports: 'light' | 'dark' | 'high-contrast'
 */

const KEY = 'hms-theme';

export function getStoredTheme() {
  return localStorage.getItem(KEY) ?? 'light';
}

export function applyTheme(theme) {
  // Add smooth transition class
  document.body.classList.add('theme-transitioning');
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(KEY, theme);
  // Remove transition class after animation completes
  setTimeout(() => document.body.classList.remove('theme-transitioning'), 350);
}

export function cycleTheme() {
  const current = getStoredTheme();
  const themes = ['light', 'dark', 'high-contrast'];
  const idx = themes.indexOf(current);
  const next = themes[(idx + 1) % themes.length];
  applyTheme(next);
  return next;
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
