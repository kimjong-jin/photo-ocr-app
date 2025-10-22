import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const urlRaw = import.meta.env.VITE_SUPABASE_URL?.trim();
const keyRaw = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

function assertEnv() {
  if (!urlRaw || !keyRaw) {
    throw new Error(
      '[Supabase] Missing env: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY ' +
      '(빌드 시점에 주입되어야 함. .env.*와 배포 환경변수 확인)'
    );
  }
  if (!/^https?:\/\//.test(urlRaw)) {
    throw new Error('[Supabase] URL 형식 오류');
  }
}

let supabase: SupabaseClient | null = null;

try {
  assertEnv();
  supabase = createClient(urlRaw!, keyRaw!);
} catch (e) {
  console.error(e);
  supabase = null;
}

export { supabase };
