import React, { useEffect } from 'react'

type Props = {
  isOpen: boolean
  onClose: () => void
  title?: string
  children?: React.ReactNode
}

export default function Modal({ isOpen, onClose, title, children }: Props) {
  // Close on ESC key
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50">
      {/* Overlay click closes */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white dark:bg-neutral-900 rounded-2xl shadow-xl">
          {(title || true) && (
            <div className="px-5 py-4 border-b flex items-center justify-between">
              {title ? (
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {title}
                </h2>
              ) : <div />}

              {/* X button always visible */}
              <button
                type="button"
                onClick={onClose}
                className="ml-2 rounded-lg p-1 text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500 dark:text-gray-300 dark:hover:bg-neutral-800"
                aria-label="Close"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.75}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          <div className="p-5">{children}</div>
        </div>
      </div>
    </div>
  )
}
