/**
 * Dark mode utility — persists preference to localStorage,
 * applies the `data-theme` attribute on <html>.
 * Supports: 'light' | 'dark' | 'high-contrast'
 */

const KEY = 'hms-theme';

/** Returns system preference: 'dark' or 'light' */
function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Returns stored theme, falling back to system preference */
export function getStoredTheme() {
  return localStorage.getItem(KEY) ?? getSystemTheme();
}

/** Returns true if the user prefers reduced motion */
function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function applyTheme(theme) {
  // Only animate if user hasn't opted out of motion
  if (!prefersReducedMotion()) {
    document.body.classList.add('theme-transitioning');
    setTimeout(() => document.body.classList.remove('theme-transitioning'), 350);
  }
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(KEY, theme);
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
