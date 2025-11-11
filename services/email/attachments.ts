// src/services/email/attachments.ts
export const MAX_ATTACHMENTS = 15;
export const MAX_TOTAL_BYTES = 3_800_000; // 클라 3.5MB 목표 + 여유

export function stripDataPrefix(b64: string) {
  const i = b64.indexOf('base64,');
  return i >= 0 ? b64.slice(i + 'base64,'.length) : b64.trim();
}

// JPEG/PNG 시그니처 확인
export function isLikelyImage(buf: Buffer) {
  if (buf.length < 8) return false;
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const isPng =
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a;
  return isJpeg || isPng;
}

export type RawAttachment = { name: string; content: string };
export type SafeAttachment = { name: string; content: string };

export function sanitizeAndValidateAttachments(attachments: RawAttachment[]): SafeAttachment[] {
  if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
    throw new Error('to and attachments are required.');
  }
  if (attachments.length > MAX_ATTACHMENTS) {
    throw new Error(`Too many attachments. Max ${MAX_ATTACHMENTS}.`);
  }

  let totalBytes = 0;
  const safe: SafeAttachment[] = [];

  for (const att of attachments) {
    const b64 = stripDataPrefix(att.content);
    totalBytes += Math.floor(b64.length * 0.75);
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error('Payload too large after attachments.');
    }

    let buf: Buffer;
    try {
      buf = Buffer.from(b64, 'base64');
    } catch {
      throw new Error('Invalid base64 attachment.');
    }
    if (!isLikelyImage(buf)) {
      throw new Error('Only image attachments (JPEG/PNG) are allowed.');
    }

    const safeName =
      (att.name || 'photo.jpg').replace(/[^\w.\-ㄱ-ㅎ가-힣 ]/g, '_').slice(0, 100) || 'photo.jpg';

    safe.push({
      name: /\.(jpg|jpeg|png)$/i.test(safeName) ? safeName : `${safeName}.jpg`,
      content: b64,
    });
  }
  return safe;
}
