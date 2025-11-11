// services/email/client.ts
export async function sendPhotos({
  to, attachments, meta,
}: {
  to: string;
  attachments: { name: string; content: string }[];
  meta?: { subject?: string; bodyText?: string; receipt_no?: string; site_name?: string };
}) {
  const base = import.meta.env.VITE_SUPABASE_FUNCTION_URL; // 예: https://xxx.functions.supabase.co
  if (!base) throw new Error('VITE_SUPABASE_FUNCTION_URL is not set');
  const res = await fetch(`${base}/send-photos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ to, attachments, meta }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json;
}
