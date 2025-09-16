import { createClient } from '@supabase/supabase-js';

// Cast import.meta to any to satisfy TS when vite/client types aren't loaded
const env = (import.meta as any).env;

const supabaseUrl = env?.VITE_SUPABASE_URL as string;
const supabaseAnonKey = env?.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local / Vercel Env Vars');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
