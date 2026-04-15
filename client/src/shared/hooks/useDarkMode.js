import { useState, useEffect } from 'react';
import { getStoredTheme, applyTheme } from '../utils/darkMode.js';

export function useDarkMode() {
  const [theme, setTheme] = useState(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function toggle() {
    setTheme(t => {
      const next = t === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      return next;
    });
  }

  return { theme, toggle, isDark: theme === 'dark' };
}
