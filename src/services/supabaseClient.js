import { createClient } from '@supabase/supabase-js'

// Browser-side client — uses the anon/public key only (safe to ship in the
// bundle; RLS is what actually restricts access), never the service_role
// key from api/_lib/supabase.js, which must never reach client code. Vite
// only exposes env vars prefixed VITE_ to import.meta.env, so these are
// deliberately separate names from the server-side SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY, not the same vars reused.
//
// persistSession + autoRefreshToken are supabase-js defaults — listed
// explicitly here so "session persisted, auto-refreshed" is a visible
// decision in this file, not an implicit default someone could
// accidentally turn off without noticing what broke.
let client = null

export function getSupabaseClient() {
  if (client) return client
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null
  client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
  return client
}
