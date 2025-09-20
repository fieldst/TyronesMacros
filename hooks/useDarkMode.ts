// hooks/useDarkMode.ts
import { useEffect, useState } from 'react'

export function useDarkMode() {
  const [dark, setDark] = useState<boolean>(
    document.documentElement.classList.contains('dark')
  );

  // Keep state in sync with the DOM class (covers manual toggles or other tabs)
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const isDark = document.documentElement.classList.contains('dark');
      setDark(isDark);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  function setTheme(nextDark: boolean) {
    if (nextDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
      setDark(true);
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
      setDark(false);
    }
  }

  function toggleDark() {
    setTheme(!dark);
  }

  return { dark, toggleDark, setTheme }
}
