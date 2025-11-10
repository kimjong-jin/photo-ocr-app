// app/api/send-photos/route.ts
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';           // or 'edge' if you prefer (Brevo API works with either)
export const dynamic = 'force-dynamic';    // avoid static caching for API

type Attachment = {
  name: string;
  content: string; // base64 (no data URL prefix)
};

type SendEmailBody = {
  to: string;
  subject: string;
  htmlContent: string;
  attachments?: Attachment[];
};

// Utility: strip data URL prefix if present
function normalizeBase64(b64: string): string {
  const ix = b64.indexOf('base64,');
  return ix >= 0 ? b64.substring(ix + 'base64,'.length) : b64;
}

export async function POST(req: NextRequest) {
  try {
    const BREVO_API_KEY = process.env.BREVO_API_KEY;
    const SENDER_EMAIL = process.env.SENDER_EMAIL || 'no-reply@example.com';
    const SENDER_NAME = process.env.SENDER_NAME || 'KTL';

    if (!BREVO_API_KEY) {
      return NextResponse.json(
        { error: 'Missing BREVO_API_KEY in server environment.' },
        { status: 500 },
      );
    }

    let body: SendEmailBody;
    try {
      body = (await req.json()) as SendEmailBody;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    const { to, subject, htmlContent } = body || {};
    if (!to || !subject || !htmlContent) {
      return NextResponse.json(
        { error: 'Missing required fields: to, subject, htmlContent.' },
        { status: 400 },
      );
    }

    const attachments =
      body.attachments && body.attachments.length > 0
        ? body.attachments.map((a) => ({
            name: a.name,
            content: normalizeBase64(a.content),
          }))
        : undefined;

    const brevoPayload = {
      sender: { email: SENDER_EMAIL, name: SENDER_NAME },
      to: [{ email: to }],
      subject,
      htmlContent,
      attachment: attachments,
    };

    const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': BREVO_API_KEY,
      },
      body: JSON.stringify(brevoPayload),
    });

    if (!brevoRes.ok) {
      let message = `HTTP ${brevoRes.status}`;
      try {
        const err = await brevoRes.json();
        message = err?.message || err?.error || JSON.stringify(err);
      } catch {
        // non-JSON
      }
      return NextResponse.json({ error: `Brevo error: ${message}` }, { status: 502 });
    }

    const data = await brevoRes.json();
    return NextResponse.json({ ok: true, data }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || 'Unknown server error.' },
      { status: 500 },
    );
  }
}
