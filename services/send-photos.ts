// api/send-photos.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const MAX_ATTACHMENTS = 15;
const MAX_TOTAL_BYTES = 3_800_000; // 클라 3.5MB 목표 + 여유

function stripDataPrefix(b64: string) {
  const i = b64.indexOf('base64,');
  return i >= 0 ? b64.slice(i + 'base64,'.length) : b64.trim();
}

// JPEG/PNG 시그니처 확인
function isLikelyImage(buf: Buffer) {
  if (buf.length < 8) return false;
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const isPng =
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a;
  return isJpeg || isPng;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
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
    return res.status(500).json({ error: 'Server email env is missing: BREVO_API_KEY or SENDER_EMAIL.' });
  }

  try {
    const { to, attachments, meta } = req.body as {
      to: string;
      attachments: { name: string; content: string }[];
      meta?: { subject?: string; bodyText?: string; receipt_no?: string; site_name?: string };
    };

    if (!to || !attachments || !Array.isArray(attachments) || attachments.length === 0) {
      return res.status(400).json({ error: 'to and attachments are required.' });
    }

    if (attachments.length > MAX_ATTACHMENTS) {
      return res.status(400).json({ error: `Too many attachments. Max ${MAX_ATTACHMENTS}.` });
    }

    let totalBytes = 0;
    const safeAttachments: { name: string; content: string }[] = [];

    for (const att of attachments) {
      const b64 = stripDataPrefix(att.content);
      totalBytes += Math.floor(b64.length * 0.75);
      if (totalBytes > MAX_TOTAL_BYTES) {
        return res.status(413).json({ error: 'Payload too large after attachments.' });
      }

      let buf: Buffer;
      try {
        buf = Buffer.from(b64, 'base64');
      } catch {
        return res.status(400).json({ error: 'Invalid base64 attachment.' });
      }
      if (!isLikelyImage(buf)) {
        return res.status(400).json({ error: 'Only image attachments (JPEG/PNG) are allowed.' });
      }

      const safeName = (att.name || 'photo.jpg').replace(/[^\w.\-ㄱ-ㅎ가-힣 ]/g, '_').slice(0, 100) || 'photo.jpg';
      safeAttachments.push({
        name: safeName.match(/\.(jpg|jpeg|png)$/i) ? safeName : safeName + '.jpg',
        content: b64,
      });
    }

    const site = (meta?.site_name || '').toString().slice(0, 120);
    const receipt = (meta?.receipt_no || '').toString().slice(0, 120);

    const subject = site ? `[KTL] ${site} 사진 전달` : `[KTL] 사진 전달`;
    const bodyTextLines = [
      `안녕하십니까, KTL 입니다.`,
      receipt ? `접수번호: ${receipt}` : ``,
      site ? `현장: ${site}` : ``,
      ``,
      `요청하신 사진을 첨부드립니다.`,
      ``,
      `※ 본 메일은 발신 전용(no-reply) 주소에서 발송되었습니다. 회신 메일은 확인되지 않습니다.`,
    ].filter(Boolean);
    const htmlContent = bodyTextLines.join('<br>');

    const payload: any = {
      sender: { email: senderEmail, name: senderName },
      to: [{ email: to }],
      subject,
      htmlContent,
      attachment: safeAttachments,
    };

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
      const code = brevoRes.status === 413 ? 413 : brevoRes.status;
      return res.status(code).json({ error: msg || `Brevo error ${brevoRes.status}` });
    }

    let data: any = {};
    try { data = JSON.parse(text); } catch {}

    return res.status(200).json({ ok: true, data });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}
