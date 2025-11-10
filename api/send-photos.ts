import type { VercelRequest, VercelResponse } from '@vercel/node';

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.SENDER_EMAIL;
  const senderName = process.env.SENDER_NAME || 'KTL Photos';

  if (!apiKey || !senderEmail) {
    return res.status(500).json({ error: 'Server email env is missing (BREVO_API_KEY or SENDER_EMAIL).' });
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
      payload.attachment = attachments.map(a => ({ name: a.name, content: a.content }));
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

    if (!brevoRes.ok) {
      const text = await brevoRes.text();
      return res.status(brevoRes.status).json({ error: text || `Brevo error ${brevoRes.status}` });
    }

    const data = await brevoRes.json().catch(() => ({}));
    return res.status(200).json({ ok: true, data });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}
