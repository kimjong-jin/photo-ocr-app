// api/send-photos.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import archiver from 'archiver';
// 플러그인 등록 필수
// eslint-disable-next-line @typescript-eslint/no-var-requires
const zipEncrypted = require('archiver-zip-encrypted');
archiver.registerFormat('zip-encrypted', zipEncrypted);

import { randomBytes } from 'crypto';
import { PassThrough } from 'stream';

export const config = { runtime: 'nodejs' as const };

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const MAX_ATTACHMENTS = 15;
const MAX_TOTAL_BYTES = 3_800_000; // 최종 ZIP 바이트 상한

// ===== 유틸 =====
function stripDataPrefix(b64: string) {
  const i = b64.indexOf('base64,');
  return i >= 0 ? b64.slice(i + 'base64,'.length) : b64.trim();
}

// JPEG/PNG/PDF 시그니처 확인
function isAllowedFile(buf: Buffer) {
  if (buf.length < 8) return false;
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const isPng =
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a;
  const isPdf =
    buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d;
  return isJpeg || isPng || isPdf;
}

function sanitizeName(name: string, fallback = 'file') {
  const safe = (name || fallback).replace(/[^\w.\-ㄱ-ㅎ가-힣 ]/g, '_').slice(0, 100);
  return safe || fallback;
}

function ensureExt(name: string, buf: Buffer) {
  if (/\.[a-z0-9]+$/i.test(name)) return name;
  if (buf[0] === 0xff && buf[1] === 0xd8) return name + '.jpg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return name + '.png';
  if (buf[0] === 0x25 && buf[1] === 0x50) return name + '.pdf';
  return name + '.bin';
}

async function zipWithPassword(
  files: { name: string; b64: string }[],
  password: string
): Promise<Buffer> {
  const archive = archiver('zip-encrypted' as any, {
    zlib: { level: 9 },
    encryptionMethod: 'aes256',
    password,
  });

  const out = new PassThrough();
  const chunks: Buffer[] = [];

  return await new Promise<Buffer>((resolve, reject) => {
    out.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
    out.on('error', reject);
    out.on('end', () => resolve(Buffer.concat(chunks)));

    archive.on('warning', reject);
    archive.on('error', reject);

    archive.pipe(out);

    try {
      for (const f of files) {
        archive.append(Buffer.from(f.b64, 'base64'), { name: f.name });
      }
      archive.finalize();
    } catch (e) {
      reject(e);
    }
  });
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
      meta?: {
        subject?: string;
        bodyText?: string;
        receipt_no?: string;
        site_name?: string;
        applicant_phone?: string; // 전화번호 원문
      };
    };

    if (!to || !attachments || !Array.isArray(attachments) || attachments.length === 0) {
      return res.status(400).json({ error: 'to and attachments are required.' });
    }
    if (attachments.length > MAX_ATTACHMENTS) {
      return res.status(400).json({ error: `Too many attachments. Max ${MAX_ATTACHMENTS}.` });
    }

    // 1) 첨부 정리/검증
    const filesForZip: { name: string; b64: string }[] = [];
    let roughBytes = 0;

    for (const att of attachments) {
      const b64 = stripDataPrefix(att.content);
      roughBytes += Math.floor(b64.length * 0.75);
      if (roughBytes > 20_000_000) {
        return res.status(413).json({ error: 'Payload too large for preprocessing.' });
      }

      let buf: Buffer;
      try {
        buf = Buffer.from(b64, 'base64');
      } catch {
        return res.status(400).json({ error: 'Invalid base64 attachment.' });
      }
      if (!isAllowedFile(buf)) {
        return res.status(400).json({ error: 'Only JPEG/PNG/PDF attachments are allowed.' });
      }

      const safe = sanitizeName(att.name || 'file');
      const finalName = ensureExt(safe, buf);
      filesForZip.push({ name: finalName, b64 });
    }

    // 2) 메타/본문
    const site = (meta?.site_name || '').toString().slice(0, 120);
    const receipt = (meta?.receipt_no || '').toString().slice(0, 120);

    const subject = site ? `[KTL] ${site} 사진/문서 전달` : `[KTL] 사진/문서 전달`;
    const bodyTextLines = [
      `안녕하십니까, KTL 입니다.`,
      receipt ? `접수번호: ${receipt}` : ``,
      site ? `현장: ${site}` : ``,
      ``,
      `요청하신 자료(사진/기록부)를 암호화 ZIP으로 첨부합니다.`,
      `※ 비밀번호는 별도 채널로 안내됩니다.`,
      ``,
      `※ 본 메일은 발신 전용(no-reply) 주소에서 발송되었습니다. 회신은 확인되지 않습니다.`,
    ].filter(Boolean);
    const htmlContent = bodyTextLines.join('<br>');

    // 3) 전화번호 뒷자리 → 비밀번호
    const phoneDigits = String(meta?.applicant_phone || '').replace(/[^\d]/g, '');
    const tail4 = phoneDigits.slice(-4);
    const zipPassword = tail4 || randomBytes(9).toString('base64url');

    // 4) ZIP 생성 및 크기 확인
    const zipBuf = await zipWithPassword(filesForZip, zipPassword);
    if (zipBuf.length > MAX_TOTAL_BYTES) {
      return res.status(413).json({ error: '압축 파일이 너무 큽니다. 파일 수를 줄이거나 해상도를 낮춰 다시 시도하세요.' });
    }

    const zipName =
      (site ? `${sanitizeName(site)}-` : '') +
      (receipt ? `${sanitizeName(receipt)}-` : '') +
      'attachments.zip';

    const payload: any = {
      sender: { email: senderEmail, name: senderName },
      to: [{ email: to }],
      subject,
      htmlContent: htmlContent + '<br><br>첨부: 암호화 ZIP (비밀번호는 별도 전달/전화번호 뒷자리)',
      attachment: [{ name: zipName, content: zipBuf.toString('base64') }],
    };

    // 5) Brevo 전송
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

    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}
