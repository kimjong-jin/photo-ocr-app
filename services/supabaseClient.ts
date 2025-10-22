import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let supabase: SupabaseClient | null = null;

if (url && key) {
  supabase = createClient(url, key);
} else {
  // ❗여기서 throw 하지 말 것
  console.warn('[Supabase] Missing env vars: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Running without Supabase.');
}

export { supabase };
