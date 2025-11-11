// services/email/handler.ts
import { sanitizeAndValidateAttachments } from './attachments';
import { sendPhotosEmail } from './brevo';

export type SendPhotosBody = {
  to: string;
  attachments: { name: string; content: string }[];
  meta?: { subject?: string; bodyText?: string; receipt_no?: string; site_name?: string };
};

export async function handleSendPhotos(
  body: SendPhotosBody,
  env: { BREVO_API_KEY?: string; SENDER_EMAIL?: string; SENDER_NAME?: string }
): Promise<{ status: number; json: unknown }> {
  const apiKey = env.BREVO_API_KEY;
  const senderEmail = env.SENDER_EMAIL;
  const senderName = env.SENDER_NAME || 'KTL Photos';

  if (!apiKey || !senderEmail) {
    return { status: 500, json: { error: 'Server email env is missing: BREVO_API_KEY or SENDER_EMAIL.' } };
  }

  const { to, attachments, meta } = body || ({} as SendPhotosBody);
  if (!to) return { status: 400, json: { error: 'to is required.' } };

  try {
    const safeAttachments = sanitizeAndValidateAttachments(attachments);
    const data = await sendPhotosEmail({
      to,
      attachments: safeAttachments,
      meta,
      senderEmail,
      senderName,
      apiKey,
    });
    return { status: 200, json: { ok: true, data } };
  } catch (e: any) {
    const msg = e?.message || 'Unknown error';
    const code = /Payload too large/.test(msg) ? 413 : 400;
    return { status: code, json: { error: msg } };
  }
}
