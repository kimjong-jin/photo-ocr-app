// src/services/email/brevo.ts
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

export type SendPhotosMeta = { subject?: string; bodyText?: string; receipt_no?: string; site_name?: string };

export async function sendPhotosEmail({
  to,
  attachments,
  meta,
  senderEmail,
  senderName = 'KTL Photos',
  apiKey,
}: {
  to: string;
  attachments: { name: string; content: string }[];
  meta?: SendPhotosMeta;
  senderEmail: string;
  senderName?: string;
  apiKey: string;
}) {
  const site = (meta?.site_name || '').toString().slice(0, 120);
  const receipt = (meta?.receipt_no || '').toString().slice(0, 120);

  const subject = meta?.subject || (site ? `[KTL] ${site} 사진 전달` : `[KTL] 사진 전달`);
  const bodyTextLines = [
    `안녕하십니까, KTL 입니다.`,
    receipt ? `접수번호: ${receipt}` : ``,
    site ? `현장: ${site}` : ``,
    ``,
    meta?.bodyText || `요청하신 사진을 첨부드립니다.`,
    ``,
    `※ 본 메일은 발신 전용(no-reply) 주소에서 발송되었습니다. 회신 메일은 확인되지 않습니다.`,
  ].filter(Boolean);
  const htmlContent = bodyTextLines.join('<br>');

  const payload = {
    sender: { email: senderEmail, name: senderName },
    to: [{ email: to }],
    subject,
    htmlContent,
    attachment: attachments,
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
    throw new Error(`Brevo error ${code}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }

  try { return JSON.parse(text); } catch { return {}; }
}
