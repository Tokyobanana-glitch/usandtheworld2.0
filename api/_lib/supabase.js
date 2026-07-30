import { createClient } from '@supabase/supabase-js'

// Server-side only — SUPABASE_SERVICE_ROLE_KEY bypasses RLS entirely and must
// never reach the client bundle. This file is only ever imported from api/*.js
// and api/_lib/*.js, which run inside Vercel Functions; never import it from src/.
let client = null

export function getSupabase() {
  if (client) return client
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  client = createClient(url, key, { auth: { persistSession: false } })
  return client
}
