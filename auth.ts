import { supabase } from './supabaseClient';

export async function signInWithEmail(email: string) {
  const { error } = await supabase.auth.signInWithOtp({ email });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export function onAuthChange(cb: (userId: string | null) => void) {
  supabase.auth.onAuthStateChange((_evt, session) => {
    cb(session?.user?.id ?? null);
  });
}

export async function getUserId() {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}
