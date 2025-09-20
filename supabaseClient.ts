import { createClient } from '@supabase/supabase-js'

// Vite envs (make sure these are set)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnon) {
  console.warn(
    '[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
    'Auth will not work until these are configured.'
  )
}

export const supabase = createClient(supabaseUrl!, supabaseAnon!)
