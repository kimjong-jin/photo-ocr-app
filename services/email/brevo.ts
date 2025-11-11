// src/services/email/brevo.ts
const BREVO_API_URL = process.env.BREVO_API_URL ?? 'https://api.brevo.com/v3/smtp/email';

export class EmailError extends Error {
  constructor(public status: number, public payload?: unknown) {
    super(`EmailError(${status})`);
    this.name = 'EmailError';
  }
}

export type SendPhotosMeta = {
  subject?: string;
  bodyText?: string;
  receipt_no?: string;
  site_name?: string;
  replyTo?: { email: string; name?: string };
  cc?: { email: string; name?: string }[];
  bcc?: { email: string; name?: string }[];
};

type Attachment = { name: string; content: string };

export async function sendPhotosEmail({
  to,
  attachments,
  meta,
  senderEmail,
  senderName = 'KTL Photos',
  apiKey,
  requestId,       // 로깅/추적용 (선택)
  timeoutMs = 15000,
  retries = 1,     // 429/5xx에 한해 1회 재시도
}: {
  to: string;
  attachments: Attachment[];
  meta?: SendPhotosMeta;
  senderEmail: string;
  senderName?: string;
  apiKey: string;
  requestId?: string;
  timeoutMs?: number;
  retries?: number;
}) {
  // ❗ 클라이언트 번들 유입 방지(가벼운 가드)
  if (typeof window !== 'undefined') {
    throw new Error('sendPhotosEmail must be called on the server only.');
  }

  const site = (meta?.site_name || '').toString().slice(0, 120);
  const receipt = (meta?.receipt_no || '').toString().slice(0, 120);
  const subject = meta?.subject || (site ? `[KTL] ${site} 사진 전달` : `[KTL] 사진 전달`);

  const bodyTextLines = [
    '안녕하십니까, KTL 입니다.',
    receipt ? `접수번호: ${receipt}` : '',
    site ? `현장: ${site}` : '',
    '',
    meta?.bodyText || '요청하신 사진을 첨부드립니다.',
    '',
    '※ 본 메일은 발신 전용(no-reply) 주소에서 발송되었습니다. 회신 메일은 확인되지 않습니다.',
  ].filter(Boolean);

  const htmlContent = bodyTextLines.join('<br>');
  const textContent = bodyTextLines.join('\n'); // 일부 수신자/스팸 필터 대비

  const basePayload: any = {
    sender: { email: senderEmail, name: senderName },
    to: [{ email: to }],
    subject,
    htmlContent,
    textContent,
    attachment: attachments,
  };
  if (meta?.replyTo) basePayload.replyTo = meta.replyTo;
  if (meta?.cc?.length) basePayload.cc = meta.cc;
  if (meta?.bcc?.length) basePayload.bcc = meta.bcc;

  const attempt = async () => {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const res = await fetch(BREVO_API_URL, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'api-key': apiKey,
          ...(requestId ? { 'x-request-id': requestId } : {}),
        },
        body: JSON.stringify(basePayload),
        signal: ctrl.signal,
      });

      const text = await res.text();
      const json = safeJson(text);

      if (!res.ok) {
        throw new EmailError(res.status, json || text || `Brevo error ${res.status}`);
      }
      return json ?? {};
    } finally {
      clearTimeout(id);
    }
  };

  try {
    return await attempt();
  } catch (e: any) {
    // 429/5xx 재시도
    if (retries > 0 && e instanceof EmailError && (e.status === 429 || (e.status >= 500 && e.status <= 599))) {
      await sleep(800);
      return attempt();
    }
    throw e;
  }
}

function safeJson(text: string) {
  try { return JSON.parse(text); } catch { return undefined; }
}
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
