// supabase/functions/send-photos/index.ts
// deno-lint-ignore-file no-explicit-any
import { handleSendPhotos } from '../../../services/email/handler.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'content-type, api-key',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Access-Control-Allow-Origin': '*', 'content-type': 'application/json' },
    });
  }

  const body = await req.json();
  const { status, json } = await handleSendPhotos(body, {
    BREVO_API_KEY: Deno.env.get('BREVO_API_KEY'),
    SENDER_EMAIL: Deno.env.get('SENDER_EMAIL'),
    SENDER_NAME: Deno.env.get('SENDER_NAME') ?? 'KTL Photos',
  });

  return new Response(JSON.stringify(json), {
    status,
    headers: { 'Access-Control-Allow-Origin': '*', 'content-type': 'application/json' },
  });
});
