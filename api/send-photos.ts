import type { VercelRequest, VercelResponse } from '@vercel/node';

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const MAX_ATTACHMENTS = 15;
const MAX_TOTAL_BYTES = 3_800_000; // 프런트 3.3~3.5MB + 여유

function stripDataPrefix(b64: string) {
  if (!b64 || typeof b64 !== 'string') return '';
  const i = b64.indexOf('base64,');
  return i >= 0 ? b64.slice(i + 'base64,'.length) : b64.trim();
}

// JPEG/PNG/PDF 시그니처 확인
function isLikelyJpeg(buf: Buffer) {
  return buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8;
}
function isLikelyPng(buf: Buffer) {
  return (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  );
}
function isLikelyPdf(buf: Buffer) {
  // %PDF-
  return buf.length >= 5 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d;
}
function isAllowedPlainAttachment(buf: Buffer) {
  return isLikelyJpeg(buf) || isLikelyPng(buf) || isLikelyPdf(buf);
}

// 안전한 파일명(확장자 유지, 허용 문자 외 치환)
function sanitizeFilename(name: string, fallback: string) {
  const safe = (name || fallback).replace(/[^\w.\-ㄱ-ㅎ가-힣 ]/g, '_').slice(0, 100);
  return safe || fallback;
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
  const senderName = process.env.SENDER_NAME || 'KTL';

  if (!apiKey || !senderEmail) {
    return res.status(500).json({ error: 'Server email env is missing: BREVO_API_KEY or SENDER_EMAIL.' });
  }

  try {
    const { to, attachments, meta } = req.body as {
      to: string;
      attachments: { name: string; content: string }[];
      meta?: {
        subject?: string;
        bodyText?: string;
        receipt_no?: string;
        site_name?: string;
        encryption_notice?: string;
        kind?: '기록부' | '사진' | string;
        total_size_mb?: string;
      };
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
      if (!att || typeof att.name !== 'string' || typeof att.content !== 'string') {
        console.error('Bad attachment item:', att);
        return res.status(400).json({ error: 'Attachment item must include name and content (base64).' });
      }

      const raw = stripDataPrefix(att.content);
      if (!raw) {
        console.error('Empty base64 after strip:', att.name);
        return res.status(400).json({ error: 'Attachment content is empty.' });
      }

      totalBytes += Math.floor(raw.length * 0.75);
      if (totalBytes > MAX_TOTAL_BYTES) {
        return res.status(413).json({ error: 'Payload too large after attachments.' });
      }

      let buf: Buffer;
      try {
        buf = Buffer.from(raw, 'base64');
      } catch (e) {
        console.error('Base64 decode failed for:', att.name, e);
        return res.status(400).json({ error: 'Invalid base64 attachment.' });
      }

      const isEncrypted = /\.enc$/i.test(att.name); // 암호화 파일은 시그니처 검사 스킵
      if (!isEncrypted && !isAllowedPlainAttachment(buf)) {
        console.error('Signature check failed for:', att.name);
        return res.status(400).json({ error: 'Only JPEG/PNG/PDF or encrypted .enc attachments are allowed.' });
      }

      const safeName = sanitizeFilename(att.name, isEncrypted ? 'file.enc' : 'file');
      safeAttachments.push({ name: safeName, content: raw }); // Brevo는 base64 본문만 요구
    }

    const kind = (meta?.kind && String(meta.kind)) || '기록부';
    const site = (meta?.site_name || '').toString().slice(0, 120);
    const receipt = (meta?.receipt_no || '').toString().slice(0, 120);

    const subject =
      (meta?.subject && String(meta.subject).slice(0, 200)) ||
      (site ? `[KTL] ${site} ${kind} 전달` : `[KTL] ${kind} 전달`);

    const lines: string[] = [];
    if (meta?.bodyText) {
      lines.push(
        String(meta.bodyText)
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .slice(0, 4000)
      );
    } else {
      lines.push(
        '안녕하십니까, KTL 입니다.',
        receipt ? `접수번호: ${receipt}` : '',
        site ? `현장: ${site}` : '',
        '',
        `요청하신 ${kind}를 첨부드립니다.`,
        ''
      );
    }
    if (meta?.encryption_notice) lines.push(meta.encryption_notice);
    lines.push('※ 본 메일은 발신 전용(no-reply) 주소에서 발송되었습니다. 회신 메일은 확인되지 않습니다.');

    const htmlContent = lines.filter(Boolean).join('<br>');

    const payload: any = {
      sender: { email: senderEmail, name: senderName },
      to: [{ email: to }],
      subject,
      htmlContent,
      attachment: safeAttachments, // [{name, content(base64)}]
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
      console.error('Brevo error:', code, msg);
      return res.status(code).json({ error: msg || `Brevo error ${brevoRes.status}` });
    }

    let data: any = {};
    try { data = JSON.parse(text); } catch {}

    return res.status(200).json({ ok: true, data });
  } catch (e: any) {
    console.error('Unhandled send-photos error:', e);
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}
