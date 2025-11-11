import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Application } from './ApplicationOcrSection';
import { ActionButton } from './ActionButton';
import { ImageInput, type ImageInfo } from './ImageInput';
import { CameraView } from './CameraView';
import { ThumbnailGallery } from './ThumbnailGallery';
import { Spinner } from './Spinner';

// ===== 이미지 유틸 =====
function estimateBase64Bytes(b64: string) {
  const i = b64.indexOf('base64,');
  const pure = i >= 0 ? b64.slice(i + 'base64,'.length) : b64;
  return Math.floor(pure.length * 0.75);
}

async function resizeImageToJpeg(file: File, maxW: number, quality: number): Promise<{ base64: string; mimeType: string; name: string }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxW / bmp.width);
  const w = Math.max(1, Math.floor(bmp.width * scale));
  const h = Math.max(1, Math.floor(bmp.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, w, h);

  const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', quality)!);
  const base64 = await new Promise<string>((res) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.readAsDataURL(blob);
  });
  return { base64, mimeType: 'image/jpeg', name: file.name.replace(/\.[^.]+$/, '') + '.jpg' };
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
    const processed = await Promise.all(images.map((img) => resizeImageToJpeg(img.file, w, q)));
    const total = processed.reduce((s, p) => s + estimateBase64Bytes(p.base64), 0);
    if (total <= maxTotalBytes) return processed;
  }

  // 마지막 패스(가장 작은 설정) 기준으로 가능한 만큼만 포함
  const fallback = await Promise.all(images.map((img) => resizeImageToJpeg(img.file, 600, 0.45)));
  const result: typeof fallback = [];
  let accum = 0;
  for (const p of fallback) {
    const sz = estimateBase64Bytes(p.base64);
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

  const emailValid = useMemo(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail.trim()), [toEmail]);
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
    if (attachments.length === 0) return setStatus({ type: 'error', text: '사진을 최소 1장 첨부하세요.' });

    setIsSending(true);
    setStatus(null);

    try {
      const capped = attachments.slice(0, MAX_IMAGES);
      const processed = await shrinkToMaxSize(capped, 3_500_000);

      // 축소 과정에서 일부 제외되었는지 간단 안내
      if (processed.length < capped.length) {
        setStatus({ type: 'info', text: `용량 제한으로 ${capped.length - processed.length}장은 제외되었습니다.` });
      }

      const payload = {
        to: toEmail.trim(),
        meta: {
          subject,
          bodyText,
          receipt_no: application?.receipt_no ?? '',
          site_name: application?.site_name ?? '',
        },
        attachments: processed.map((p) => ({ name: p.name, content: p.base64 })),
      };

      const res = await fetch('/api/send-photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        if (res.status === 413) throw new Error('첨부 용량이 너무 큽니다. 사진 수를 줄이거나 해상도를 낮춰 다시 시도하세요.');
        const data = await res.json().catch(() => ({} as any));
        throw new Error(data?.error || `Email API failed with ${res.status}`);
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
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={onClose} role="dialog" aria-modal="true">
      <div className="bg-slate-800 w-full max-w-4xl max-h-[92vh] rounded-xl border border-slate-700 shadow-2xl p-6 flex flex-col" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl sm:text-2xl font-semibold text-white">
          사진 전송: <span className="text-sky-400">{application.receipt_no}</span>
        </h2>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-6 overflow-y-auto pr-1">
          <div className="space-y-4">
            <div className="text-sm text-slate-300 bg-slate-700/40 rounded-lg p-3">
              <div className="truncate"><span className="font-semibold">수신(이름)</span>: {application.applicant_name}</div>
              <div><span className="font-semibold">접수번호</span>: {application.receipt_no}</div>
              <div className="truncate"><span className="font-semibold">현장</span>: {application.site_name}</div>
            </div>

            <div>
              <label className="block text-sm mb-1 text-slate-300">수신 이메일</label>
              <input
                type="email"
                value={toEmail}
                onChange={(e) => setToEmail(e.target.value)}
                disabled={isSending}
                className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md text-sm"
                placeholder={application.applicant_email}
              />
              {!emailValid && <p className="mt-1 text-xs text-red-300">유효한 이메일 주소를 입력하세요.</p>}
            </div>

            <div>
              <label className="block text-sm mb-1 text-slate-300">제목(고정)</label>
              <input type="text" value={subject} readOnly className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md text-sm opacity-70 cursor-not-allowed" />
            </div>
            <div>
              <label className="block text-sm mb-1 text-slate-300">본문(고정)</label>
              <textarea rows={8} value={bodyText} readOnly className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md text-sm opacity-70 cursor-not-allowed" />
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
            <p className={`text-sm text-center p-3 rounded-md ${
              status.type === 'success' ? 'bg-green-900/40 text-green-300'
              : status.type === 'info' ? 'bg-sky-900/40 text-sky-300'
              : 'bg-red-900/40 text-red-300'
            }`}>
              {status.text}
            </p>
          )}
          <div className="flex flex-col sm:flex-row gap-3">
            <ActionButton onClick={onClose} variant="secondary" disabled={isSending} fullWidth>취소</ActionButton>
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
