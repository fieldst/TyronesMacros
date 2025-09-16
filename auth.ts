// auth.ts
import { supabase } from './supabaseClient';

// Subscribe to auth changes
export function onAuthChange(cb: (userId: string | null) => void) {
  const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(session?.user?.id ?? null);
  });
  return () => sub.subscription.unsubscribe();
}

export async function getUserId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function getUserProfile(): Promise<{ email: string | null; full_name: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  return {
    email: user?.email ?? null,
    full_name: (user?.user_metadata as any)?.full_name ?? null,
  };
}

export async function signUpWithPassword(email: string, password: string, fullName?: string) {
  // Store full_name inside user metadata so we can display it right away
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName ?? '' } },
  });
  if (error) throw error;
  return data;
}

export async function signInWithPassword(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function updateFullName(fullName: string) {
  const { data, error } = await supabase.auth.updateUser({
    data: { full_name: fullName },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
