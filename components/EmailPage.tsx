import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Application } from './ApplicationOcrSection';
import { ActionButton } from './ActionButton';
import { ImageInput, type ImageInfo } from './ImageInput';
import { CameraView } from './CameraView';
import { ThumbnailGallery } from './ThumbnailGallery';
import { Spinner } from './Spinner';

/* =========================
   이미지/보안 유틸
========================= */

// base64(본문만) 바이트 수 추정
function estimateBase64Bytes(b64Body: string) {
  return Math.floor(b64Body.length * 0.75);
}

// data URL에서 base64 본문만 추출
function extractBase64Body(dataUrlOrBody: string) {
  const i = dataUrlOrBody.indexOf('base64,');
  return i >= 0 ? dataUrlOrBody.slice(i + 'base64,'.length) : dataUrlOrBody;
}

// 동시 실행 제한 유틸 (메모리/CPU 스파이크 완화)
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async function runner() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

// 의심스러운 동형이의 문자 간단 감지(선택적 경고)
const CONFUSABLE_RANGES: Array<[number, number]> = [
  [0x0400, 0x04FF], // Cyrillic
  [0x0370, 0x03FF], // Greek
  [0x3100, 0x312F], // Bopomofo
  [0x0530, 0x058F], // Armenian
];
function hasSuspiciousUnicode(s: string) {
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (CONFUSABLE_RANGES.some(([a, b]) => code >= a && code <= b)) return true;
  }
  return false;
}

// --- allowlist & 도메인 유틸 ---
const ALLOWED_DOMAINS = ['customer.co.kr', 'partner.com', 'ktl.or.kr']; // 정책에 맞게 조정
function domainOf(email: string) {
  const m = email.trim().toLowerCase().match(/@([^@]+)$/);
  return m ? m[1] : '';
}

// 메일 헤더 인젝션 방지(개행 제거 + 길이 제한)
function sanitizeHeaderValue(s: string, limit = 200) {
  return (s || '').replace(/[\r\n]+/g, ' ').slice(0, limit);
}

/* =========================
   클라이언트 암호화(AES-GCM, 비번=전화번호 뒷4자리)
========================= */
function onlyDigits(s: string) {
  return (s || '').replace(/\D+/g, '');
}
function last4FromApplication(app: any): string | null {
  const candidates = [
    app?.applicant_phone, app?.applicant_tel, app?.applicant_mobile,
    app?.phone, app?.tel, app?.mobile,
  ];
  for (const cand of candidates) {
    const d = onlyDigits(String(cand || ''));
    if (d.length >= 4) return d.slice(-4);
  }
  return null;
}
function toB64(u8: Uint8Array) {
  let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s);
}
function fromB64(b64: string) {
  const bin = atob(b64); const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
async function deriveKeyFromPassword(password: string, salt: Uint8Array) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 150_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
async function aesGcmEncrypt(bytes: Uint8Array, password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKeyFromPassword(password, salt);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { salt: toB64(salt), iv: toB64(iv), ciphertext: toB64(new Uint8Array(ct)) };
}
async function b64BodyToBytes(b64Body: string) {
  return fromB64(b64Body); // base64 본문 -> 바이너리
}

async function resizeImageToJpeg(
  file: File,
  maxW: number,
  quality: number
): Promise<{ base64Body: string; mimeType: string; name: string }> {
  let bmp: ImageBitmap | null = null;
  const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';

  try {
    bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxW / bmp.width);
    const w = Math.max(1, Math.floor(bmp.width * scale));
    const h = Math.max(1, Math.floor(bmp.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: false })!;
    ctx.drawImage(bmp, 0, 0, w, h);

    const blob: Blob = await new Promise<Blob>((res, rej) => {
      canvas.toBlob((b) => (b ? res(b) : rej(new Error('이미지 인코딩 실패'))), 'image/jpeg', quality);
    });

    const base64Body = await new Promise<string>((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => {
        const s = String(fr.result || '');
        res(extractBase64Body(s));
      };
      fr.onerror = () => rej(new Error('파일 읽기 실패'));
      fr.readAsDataURL(blob);
    });

    // 캔버스 즉시 해제
    canvas.width = 0;
    canvas.height = 0;

    return { base64Body, mimeType: 'image/jpeg', name };
  } finally {
    try { (bmp as any)?.close?.(); } catch {}
  }
}

// 총합 3.5MB 이하 목표
async function shrinkToMaxSize(images: ImageInfo[], maxTotalBytes = 3_500_000) {
  const passes: Array<[number, number]> = [
    [1600, 0.8],
    [1400, 0.72],
    [1200, 0.66],
    [1000, 0.6],
    [800, 0.55],
    [700, 0.5],
    [600, 0.45],
  ];

  for (const [w, q] of passes) {
    const processed = await mapLimit(images, 2, (img) => resizeImageToJpeg(img.file, w, q));
    const total = processed.reduce((s, p) => s + estimateBase64Bytes(p.base64Body), 0);
    if (total <= maxTotalBytes) return processed;
  }

  // 마지막 패스 기준으로 가능한 만큼만 포함
  const fallback = await mapLimit(images, 2, (img) => resizeImageToJpeg(img.file, 600, 0.45));
  const result: typeof fallback = [];
  let accum = 0;
  for (const p of fallback) {
    const sz = estimateBase64Bytes(p.base64Body);
    if (accum + sz > maxTotalBytes) break;
    result.push(p);
    accum += sz;
  }
  return result;
}

type Props = {
  isOpen: boolean;
  onClose: () => void;
  application: Application;
  userName: string;
  onSendSuccess: (appId: number) => void | Promise<void>;
};

const MAX_IMAGES = 15;

const EmailModal: React.FC<Props> = ({ isOpen, onClose, application, userName, onSendSuccess }) => {
  const [toEmail, setToEmail] = useState('');
  const [attachments, setAttachments] = useState<ImageInfo[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);

  const subject = useMemo(() => {
    const site = application?.site_name ?? '';
    return site ? `[KTL] ${site} 사진 전달` : `[KTL] 사진 전달`;
  }, [application?.site_name]);

  const bodyText = useMemo(() => {
    const lines = [
      `안녕하십니까, KTL ${userName}입니다.`,
      ``,
      application?.receipt_no ? `접수번호: ${application.receipt_no}` : ``,
      application?.site_name ? `현장: ${application.site_name}` : ``,
      ``,
      `요청하신 사진을 첨부드립니다.`,
      ``,
      `[중요] 첨부파일은 고객 보호를 위해 암호화되었습니다. 비밀번호는 신청인 전화번호 뒷 4자리입니다.`,
      `※ 본 메일은 발신 전용(no-reply) 주소에서 발송되었습니다. 회신 메일은 확인되지 않습니다.`,
    ].filter(Boolean);
    return lines.join('\n');
  }, [userName, application?.receipt_no, application?.site_name]);

  useEffect(() => {
    if (!isOpen) return;
    setToEmail(application?.applicant_email || '');
    setAttachments([]);
    setStatus(null);
    setIsCameraOpen(false);
  }, [isOpen, application]);

  const emailValid = useMemo(() => {
    const el = emailInputRef.current;
    if (!el) return false;
    return el.validity.valid;
  }, [toEmail]);

  if (!isOpen) return null;

  const handleImagesSet = (newImages: ImageInfo[]) => {
    const filtered = newImages.filter((i) => i.mimeType.startsWith('image/'));
    const room = Math.max(0, MAX_IMAGES - attachments.length);
    const incoming = filtered.slice(0, room);
    const dropped = filtered.length - incoming.length;
    setAttachments((prev) => [...prev, ...incoming]);
    if (dropped > 0) setStatus({ type: 'info', text: `사진은 최대 ${MAX_IMAGES}장까지 첨부됩니다. 초과 ${dropped}장은 제외되었습니다.` });
  };

  const handleCameraCapture = (file: File, base64: string, mimeType: string) => {
    if (!mimeType.startsWith('image/')) return;
    if (attachments.length >= MAX_IMAGES) {
      setStatus({ type: 'info', text: `사진은 최대 ${MAX_IMAGES}장까지 첨부됩니다.` });
      return;
    }
    setAttachments((prev) => [...prev, { file, base64, mimeType }]);
    setIsCameraOpen(false);
  };

  const handleDeleteAttachment = (idx: number) => setAttachments((prev) => prev.filter((_, i) => i !== idx));

  const handleSend = async () => {
    if (!emailValid) return setStatus({ type: 'error', text: '유효한 수신 이메일을 입력하세요.' });
    if (hasSuspiciousUnicode(toEmail)) {
      return setStatus({ type: 'error', text: '수신 이메일에 의심스러운 문자가 포함되어 있습니다. 주소를 다시 확인하세요.' });
    }
    if (attachments.length === 0) return setStatus({ type: 'error', text: '사진을 최소 1장 첨부하세요.' });

    // 허용 도메인 검사
    const dom = domainOf(toEmail);
    if (!ALLOWED_DOMAINS.includes(dom)) {
      return setStatus({ type: 'error', text: '허용되지 않은 수신 도메인입니다. 주소를 다시 확인하세요.' });
    }

    // 비밀번호(신청인 전화번호 뒷4자리) 계산
    const pin = last4FromApplication(application as any);
    if (!pin || pin.length !== 4) {
      return setStatus({ type: 'error', text: '신청인의 전화번호 정보가 없어 암호화 비밀번호(뒷 4자리)를 생성할 수 없습니다.' });
    }

    setIsSending(true);
    setStatus(null);

    try {
      const capped = attachments.slice(0, MAX_IMAGES);
      const processed = await shrinkToMaxSize(capped, 3_500_000);

      if (processed.length < capped.length) {
        setStatus({ type: 'info', text: `용량 제한으로 ${capped.length - processed.length}장은 제외되었습니다.` });
      }

      // 클라이언트 측 AES-GCM 암호화
      const encryptedAttachments = [];
      for (const p of processed) {
        const bytes = await b64BodyToBytes(p.base64Body);
        const enc = await aesGcmEncrypt(bytes, pin);
        encryptedAttachments.push({
          name: p.name + '.enc',
          mimeType: 'application/octet-stream',
          base64: enc.ciphertext,
          meta: { alg: 'AES-GCM-256', salt: enc.salt, iv: enc.iv },
        });
      }

      // 전송 전 요약(휴먼 에러 방지)
      const totalBytes = encryptedAttachments.reduce((s, a) => s + estimateBase64Bytes(a.base64), 0);
      const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
      const confirmMsg =
        `전송 대상: ${toEmail}\n도메인: ${dom}\n암호화 첨부: ${encryptedAttachments.length}개\n총용량(암호문 기준): ${totalMB} MB\n\n전송하시겠습니까?`;
      if (!window.confirm(confirmMsg)) {
        setIsSending(false);
        return;
      }

      const csrf = (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content || '';
      const cleanSubject = sanitizeHeaderValue(subject) + ' (암호화 첨부)';

      const payload = {
        to: toEmail.trim(),
        meta: {
          subject: cleanSubject,
          bodyText,
          receipt_no: application?.receipt_no ?? '',
          site_name: application?.site_name ?? '',
          // 서버가 원하면 메타에 "암호는 신청인 전화 뒷 4자리" 안내만 포함(실제 숫자는 절대 포함 금지)
          encryption_notice: '첨부는 AES-GCM으로 암호화되었습니다. 비밀번호는 신청인 전화번호 뒷 4자리입니다.',
        },
        attachments: encryptedAttachments,
      };

      const res = await fetch('/api/send-photos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf && { 'X-CSRF-Token': csrf }),
        },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        if (res.status === 413) throw new Error('첨부 용량이 너무 큽니다. 사진 수를 줄이거나 해상도를 낮춰 다시 시도하세요.');
        throw new Error('전송에 실패했습니다. 잠시 후 다시 시도하거나 관리자에게 문의하세요.');
      }

      await onSendSuccess(application.id);
      setStatus({ type: 'success', text: '메일이 성공적으로 전송되었습니다.' });
      setTimeout(onClose, 1500);
    } catch (e: any) {
      setStatus({ type: 'error', text: e?.message || '전송 실패' });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-slate-800 w-full max-w-4xl max-h-[92vh] rounded-xl border border-slate-700 shadow-2xl p-6 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl sm:text-2xl font-semibold text-white">
          사진 전송: <span className="text-sky-400">{application.receipt_no}</span>
        </h2>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-6 overflow-y-auto pr-1">
          <div className="space-y-4">
            <div className="text-sm text-slate-300 bg-slate-700/40 rounded-lg p-3">
              <div className="truncate">
                <span className="font-semibold">수신(이름)</span>: {application.applicant_name}
              </div>
              <div>
                <span className="font-semibold">접수번호</span>: {application.receipt_no}
              </div>
              <div className="truncate">
                <span className="font-semibold">현장</span>: {application.site_name}
              </div>
            </div>

            <div>
              <label className="block text-sm mb-1 text-slate-300">수신 이메일</label>
              <input
                ref={emailInputRef}
                type="email"
                value={toEmail}
                onChange={(e) => setToEmail(e.target.value)}
                disabled={isSending}
                className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md text-sm"
                placeholder={application.applicant_email}
                autoComplete="email"
                inputMode="email"
              />
              {!emailValid && <p className="mt-1 text-xs text-red-300">유효한 이메일 주소를 입력하세요.</p>}
              {toEmail && !ALLOWED_DOMAINS.includes(domainOf(toEmail)) && (
                <p className="mt-1 text-xs rounded bg-red-900/30 text-red-200 p-2">
                  외부/비허용 도메인입니다. 전송 전 반드시 주소를 확인하세요.
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm mb-1 text-slate-300">제목(고정)</label>
              <input
                type="text"
                value={subject + ' (암호화 첨부)'}
                readOnly
                className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md text-sm opacity-70 cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-sm mb-1 text-slate-300">본문(고정)</label>
              <textarea
                rows={8}
                value={bodyText}
                readOnly
                className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md text-sm opacity-70 cursor-not-allowed"
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-100">사진 첨부(최대 {MAX_IMAGES}장)</h3>
              <ActionButton variant="secondary" onClick={() => setIsCameraOpen((v) => !v)} disabled={isSending}>
                {isCameraOpen ? '카메라 닫기' : '카메라 열기'}
              </ActionButton>
            </div>

            {isCameraOpen ? (
              <CameraView onCapture={handleCameraCapture} onClose={() => setIsCameraOpen(false)} />
            ) : (
              <ImageInput
                ref={fileInputRef}
                onImagesSet={handleImagesSet}
                onOpenCamera={() => setIsCameraOpen(true)}
                isLoading={isSending}
                selectedImageCount={attachments.length}
              />
            )}

            <ThumbnailGallery
              images={attachments}
              currentIndex={-1}
              onSelectImage={() => {}}
              onDeleteImage={handleDeleteAttachment}
              disabled={isSending}
            />
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-slate-700 space-y-3">
          {status && (
            <p
              className={`text-sm text-center p-3 rounded-md ${
                status.type === 'success'
                  ? 'bg-green-900/40 text-green-300'
                  : status.type === 'info'
                  ? 'bg-sky-900/40 text-sky-300'
                  : 'bg-red-900/40 text-red-300'
              }`}
            >
              {status.text}
            </p>
          )}
          <div className="flex flex-col sm:flex-row gap-3">
            <ActionButton onClick={onClose} variant="secondary" disabled={isSending} fullWidth>
              취소
            </ActionButton>
            <ActionButton
              onClick={handleSend}
              disabled={isSending || !emailValid || attachments.length === 0}
              fullWidth
              icon={isSending ? <Spinner size="sm" /> : undefined}
            >
              {isSending ? '전송 중...' : '전송'}
            </ActionButton>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmailModal;
