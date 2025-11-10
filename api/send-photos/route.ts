import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Attachment = { name: string; content: string };
type Body = { to: string; subject: string; htmlContent: string; attachments?: Attachment[] };

export async function POST(req: NextRequest) {
  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  const SENDER_EMAIL = process.env.SENDER_EMAIL || 'no-reply@example.com';
  const SENDER_NAME = process.env.SENDER_NAME || 'KTL';

  if (!BREVO_API_KEY) {
    return NextResponse.json({ error: 'Missing BREVO_API_KEY' }, { status: 500 });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { to, subject, htmlContent, attachments } = body || {};
  if (!to || !subject || !htmlContent) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const payload = {
    sender: { email: SENDER_EMAIL, name: SENDER_NAME },
    to: [{ email: to }],
    subject,
    htmlContent,
    attachment: attachments && attachments.length ? attachments : undefined,
  };

  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': BREVO_API_KEY,
      },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try { const j = await r.json(); msg = j?.message || j?.error || msg; } catch {}
      return NextResponse.json({ error: `Brevo error: ${msg}` }, { status: 502 });
    }

    const data = await r.json();
    return NextResponse.json({ ok: true, data }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Unknown server error' }, { status: 500 });
  }
}
