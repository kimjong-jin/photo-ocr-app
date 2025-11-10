// api/send-photos.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

function stripDataPrefix(b64: string) {
  const i = b64.indexOf('base64,');
  return i >= 0 ? b64.slice(i + 'base64,'.length) : b64.trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS (동일 도메인이어도 안전하게)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, api-key');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.SENDER_EMAIL;
  const senderName = process.env.SENDER_NAME || 'KTL Photos';

  if (!apiKey || !senderEmail) {
    return res.status(500).json({
      error: 'Server email env is missing: BREVO_API_KEY or SENDER_EMAIL.',
    });
  }

  try {
    const { to, subject, htmlContent, attachments } = req.body as {
      to: string;
      subject: string;
      htmlContent: string;
      attachments?: { name: string; content: string }[];
    };

    if (!to || !subject || !htmlContent) {
      return res.status(400).json({ error: 'to/subject/htmlContent required.' });
    }

    const payload: any = {
      sender: { email: senderEmail, name: senderName },
      to: [{ email: to }],
      subject,
      htmlContent: htmlContent.replace(/\n/g, '<br>'),
    };

    if (attachments?.length) {
      payload.attachment = attachments.map((a) => ({
        name: a.name,
        content: stripDataPrefix(a.content),
      }));
    }

    const brevoRes = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify(payload),
    });

    const text = await brevoRes.text();
    if (!brevoRes.ok) {
      let msg: any = text;
      try { msg = JSON.parse(text); } catch {}
      return res.status(brevoRes.status).json({ error: msg || `Brevo error ${brevoRes.status}` });
    }

    let data: any = {};
    try { data = JSON.parse(text); } catch {}

    return res.status(200).json({ ok: true, data });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}
