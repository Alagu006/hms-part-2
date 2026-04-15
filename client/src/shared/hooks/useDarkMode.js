import { useState, useEffect } from 'react';
import { getStoredTheme, applyTheme, cycleTheme } from '../utils/darkMode.js';

export function useDarkMode() {
  const [theme, setTheme] = useState(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Cycle through light → dark → high-contrast → light
  function cycle() {
    setTheme(() => {
      const next = cycleTheme();
      return next;
    });
  }

  // Simple toggle (light ↔ dark, skips high-contrast)
  function toggle() {
    setTheme(t => {
      const next = t === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      return next;
    });
  }

  function setSpecific(t) {
    applyTheme(t);
    setTheme(t);
  }

  return {
    theme,
    toggle,
    cycle,
    setTheme: setSpecific,
    isDark: theme === 'dark',
    isHighContrast: theme === 'high-contrast',
  };
}
