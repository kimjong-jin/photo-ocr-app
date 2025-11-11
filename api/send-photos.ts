// api/send-photos.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

function stripDataPrefix(b64: string) {
  const i = b64.indexOf('base64,');
  return i >= 0 ? b64.slice(i + 'base64,'.length) : b64.trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS (필요시 좁혀도 됨)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
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
    // 일부 런타임에서 req.body가 string일 수 있음
    const raw = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
    const { to, subject, htmlContent, textContent, attachments } = raw as {
      to: string;
      subject: string;
      htmlContent?: string;
      textContent?: string;
      attachments?: { name: string; content: string }[];
    };

    if (!to || !subject || (!htmlContent && !textContent)) {
      return res.status(400).json({ error: 'to/subject and htmlContent or textContent required.' });
    }

    const payload: any = {
      sender: { email: senderEmail, name: senderName },
      to: [{ email: to }],
      subject,
      htmlContent: htmlContent ?? (textContent || '').replace(/\n/g, '<br>'),
      textContent,
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
      const friendly =
        typeof msg === 'string'
          ? msg
          : msg?.message || msg?.error || `Brevo error ${brevoRes.status}`;
      return res.status(brevoRes.status).json({ error: friendly });
    }

    let data: any = {};
    try { data = JSON.parse(text); } catch {}

    return res.status(200).json({ ok: true, data });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}
