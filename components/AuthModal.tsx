import React, { useState } from 'react'
import { signInWithEmail, signUpWithEmail } from '../auth'

type AuthMode = 'sign-in' | 'sign-up'

type Props = {
  mode: AuthMode
  onSuccess: () => void
}

export default function AuthModal({ mode: initialMode, onSuccess }: Props) {
  const [mode, setMode] = useState<AuthMode>(initialMode)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    // --- Frontend validation ---
    if (!/\S+@\S+\.\S+/.test(email)) {
      setError('Please enter a valid email address.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.')
      return
    }

    setLoading(true)
    try {
      if (mode === 'sign-in') {
        await signInWithEmail(email.trim(), password)
      } else {
        await signUpWithEmail(fullName.trim(), email.trim(), password)
      }
      onSuccess()
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Context label */}
      <p className="text-sm font-semibold tracking-wide text-gray-800 dark:text-gray-200">
        {mode === 'sign-in' ? 'Sign in' : 'Create your account'}
      </p>

      {mode === 'sign-up' && (
        <div>
          <label
            htmlFor="fullName"
            className="block text-sm mb-1 font-medium text-gray-900 dark:text-gray-100"
          >
            Full name
          </label>
          <input
            id="fullName"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-100 dark:placeholder-gray-400"
            placeholder="Jane Doe"
            required
          />
        </div>
      )}

      <div>
        <label
          htmlFor="email"
          className="block text-sm mb-1 font-medium text-gray-900 dark:text-gray-100"
        >
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-100 dark:placeholder-gray-400"
          placeholder="you@example.com"
          required
          autoComplete="email"
        />
      </div>

      <div>
        <label
          htmlFor="password"
          className="block text-sm mb-1 font-medium text-gray-900 dark:text-gray-100"
        >
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 pr-12 text-gray-900 placeholder-gray-400 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-100 dark:placeholder-gray-400"
            placeholder="••••••••"
            required
            autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
          />
          {/* Show/Hide toggle */}
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute inset-y-0 right-3 flex items-center text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Must be at least 8 characters
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl py-2 px-4 bg-gray-900 text-white font-semibold hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-60 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-gray-300"
      >
        {loading ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
      </button>

      <div className="text-xs text-center">
        {mode === 'sign-in' ? (
          <button
            type="button"
            onClick={() => setMode('sign-up')}
            className="underline text-gray-800 hover:text-gray-900 dark:text-gray-200 dark:hover:text-gray-100 font-semibold"
          >
            Need an account? Sign up
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setMode('sign-in')}
            className="underline text-gray-800 hover:text-gray-900 dark:text-gray-200 dark:hover:text-gray-100 font-semibold"
          >
            Have an account? Sign in
          </button>
        )}
      </div>
    </form>
  )
}
