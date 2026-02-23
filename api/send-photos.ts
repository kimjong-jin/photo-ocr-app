// api/send-photos.ts

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const MAX_ATTACHMENTS = 15;
const MAX_TOTAL_BYTES = 3_800_000; // 클라 3.5MB 목표 + 여유
const ALLOW_ZIP = (process.env.ALLOW_ZIP ?? '') === '1';

function stripDataPrefix(b64: string) {
  const i = b64.indexOf('base64,');
  // data:...;base64, 또는 "base64," 접두사만 들어와도 제거
  return i >= 0 ? b64.slice(i + 'base64,'.length) : b64.trim().replace(/^base64,?/, '');
}

// MIME 시그니처
function isJpeg(buf: Buffer) {
  return buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8;
}
function isPng(buf: Buffer) {
  return (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  );
}
function isPdf(buf: Buffer) {
  return (
    buf.length >= 5 &&
    buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d // %PDF-
  );
}
function isZip(buf: Buffer) {
  // PK\x03\x04 (일반), PK\x05\x06 (EOCD), PK\x07\x08 (스플릿)
  return (
    buf.length >= 4 &&
    buf[0] === 0x50 && buf[1] === 0x4b &&
    ((buf[2] === 0x03 && buf[3] === 0x04) ||
     (buf[2] === 0x05 && buf[3] === 0x06) ||
     (buf[2] === 0x07 && buf[3] === 0x08))
  );
}
function isAllowedAttachment(buf: Buffer) {
  if (isJpeg(buf) || isPng(buf) || isPdf(buf)) return true;
  if (ALLOW_ZIP && isZip(buf)) return true; // 토글로 ZIP 허용
  return false;
}

export default async function handler(req: any, res: any) {
  // CORS (원한다면 특정 도메인으로 잠그세요)
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN ?? '*');
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

      let buf: Buffer;
      try {
        buf = Buffer.from(b64, 'base64');
      } catch {
        return res.status(400).json({ error: 'Invalid base64 attachment.' });
      }

      // 정확한 총 용량 체크(디코딩된 바이트 기준)
      totalBytes += buf.length;
      if (totalBytes > MAX_TOTAL_BYTES) {
        return res.status(413).json({ error: 'Payload too large after attachments.' });
      }

      if (!isAllowedAttachment(buf)) {
        const msg = ALLOW_ZIP
          ? 'Only JPEG/PNG/PDF/ZIP attachments are allowed.'
          : 'Only JPEG/PNG/PDF attachments are allowed.';
        return res.status(415).json({ error: msg });
      }

      // 안전 파일명 + 확장자 보정
      const cleaned = (att.name || 'file')
        .replace(/[^\w.\-ㄱ-ㅎ가-힣 ]/g, '_')
        .slice(0, 100) || 'file';

      const hasAllowedExt = ALLOW_ZIP
        ? /\.(jpg|jpeg|png|pdf|zip)$/i.test(cleaned)
        : /\.(jpg|jpeg|png|pdf)$/i.test(cleaned);

      const finalName = hasAllowedExt
        ? cleaned
        : isZip(buf)
          ? `${cleaned}.zip`
          : isPdf(buf)
            ? `${cleaned}.pdf`
            : `${cleaned}.jpg`;

      safeAttachments.push({ name: finalName, content: b64 });
    }

    const site = (meta?.site_name || '').toString().slice(0, 120);
    const receipt = (meta?.receipt_no || '').toString().slice(0, 120);

    const subject =
      (meta?.subject && String(meta.subject).slice(0, 200)) ||
      (site ? `[KTL] ${site} 사진/문서 전달` : `[KTL] 사진/문서 전달`);

    const bodyText =
      (meta?.bodyText && String(meta.bodyText)) ||
      [
        `안녕하십니까, KTL 입니다.`,
        receipt ? `접수번호: ${receipt}` : ``,
        site ? `현장: ${site}` : ``,
        ``,
        `요청하신 자료(사진/문서)를 첨부드립니다.`,
        ``,
        `※ 본 메일은 발신 전용(no-reply) 주소에서 발송되었습니다. 회신 메일은 확인되지 않습니다.`,
      ].filter(Boolean).join('\n');

    const htmlContent = bodyText.replace(/\n/g, '<br>');

    const payload = {
      sender: { email: senderEmail, name: senderName },
      to: [{ email: to }],
      subject,
      htmlContent,
      attachment: safeAttachments, // Brevo: { name, content(base64) }[]
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
