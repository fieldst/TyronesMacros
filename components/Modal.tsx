import React from 'react'

type Props = {
  isOpen: boolean
  onClose: () => void
  title?: string
  children?: React.ReactNode
}

export default function Modal({ isOpen, onClose, title, children }: Props) {
  if (!isOpen) return null
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl">
          {title ? (
            <div className="px-5 py-4 border-b text-lg font-semibold">{title}</div>
          ) : null}
          <div className="p-5">{children}</div>
        </div>
      </div>
    </div>
  )
}
