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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
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
    <form onSubmit={handleSubmit} className="space-y-3">
      {mode === 'sign-up' && (
        <div>
          <label className="block text-sm mb-1">Full name</label>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full p-2 border rounded-xl"
            placeholder="Jane Doe"
            required
          />
        </div>
      )}

      <div>
        <label className="block text-sm mb-1">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full p-2 border rounded-xl"
          placeholder="you@example.com"
          required
        />
      </div>

      <div>
        <label className="block text-sm mb-1">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full p-2 border rounded-xl"
          placeholder="••••••••"
          required
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl py-2 px-4 bg-gray-900 text-white"
      >
        {loading ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
      </button>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="text-xs text-center text-gray-600">
        {mode === 'sign-in' ? (
          <button type="button" onClick={() => setMode('sign-up')} className="underline">
            Need an account? Sign up
          </button>
        ) : (
          <button type="button" onClick={() => setMode('sign-in')} className="underline">
            Have an account? Sign in
          </button>
        )}
      </div>
    </form>
  )
}
