// components/ThemeToggle.tsx
import React from 'react'
import { useDarkMode } from '../hooks/useDarkMode'

export default function ThemeToggle() {
  const { dark, toggleDark } = useDarkMode()
  return (
    <button
      onClick={toggleDark}
      className="px-3 py-1 rounded-xl bg-gray-200 dark:bg-gray-700 dark:text-gray-100 shadow-sm"
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {dark ? '☀️ Light' : '🌙 Dark'}
    </button>
  )
}
