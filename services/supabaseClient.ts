// services/supabaseClient.ts
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// 빌드/런타임에서 누락 즉시 확인
if (!url || !anonKey) {
  throw new Error(
    'Missing Supabase env vars: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY'
  );
}

export const supabase = createClient(url, anonKey);
export default supabase;
