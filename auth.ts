import { supabase } from './supabaseClient'
import type { User } from '@supabase/supabase-js'

/** Return the current user's id (or null if logged out) */
export async function getCurrentUserId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

/** Convenience: return the full user object (or null) */
export async function getCurrentUser(): Promise<User | null> {
  const { data: { user } } = await supabase.auth.getUser()
  return user ?? null
}

/** Email/password sign-in */
export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

/** Email/password sign-up; stores full_name in user_metadata */
export async function signUpWithEmail(fullName: string, email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: window.location.origin, // optional
    }
  })
  if (error) throw error
  return data
}

/** Sign out current user */
export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

/** Subscribe to auth state changes; returns an unsubscribe function */
export function onAuthChange(cb: (user: User | null) => void) {
  const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(session?.user ?? null)
  })
  return () => sub.subscription.unsubscribe()
}

/** Friendly display name (full_name → email → null) */
export async function getDisplayName(): Promise<string | null> {
  const u = await getCurrentUser()
  if (!u) return null
  const name = (u.user_metadata as any)?.full_name as string | undefined
  return (name?.trim() || u.email || null)
}
