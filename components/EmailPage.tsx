import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Application } from './ApplicationOcrSection';
import { ActionButton } from './ActionButton';
import { CameraView } from './CameraView';
import { ThumbnailGallery } from './ThumbnailGallery';
import { Spinner } from './Spinner';

// 기존 ImageInput 대신 파일 입력을 직접 처리(이미지+PDF)
// 필요 시 별도 컴포넌트로 분리해도 됩니다.

export type ImageInfo = { file: File; base64: string; mimeType: string; name?: string };
type PdfInfo = { file: File; base64: string; mimeType: 'application/pdf'; name: string };

function estimateBase64Bytes(b64: string) {
  const i = b64.indexOf('base64,');
  const pure = i >= 0 ? b64.slice(i + 'base64,'.length) : b64;
  return Math.floor(pure.length * 0.75);
}

async function resizeImageToJpeg(
  file: File,
  maxW: number,
  quality: number
): Promise<{ base64: string; mimeType: string; name: string }> {
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

// 총합 3.5MB 이하 목표 (이미지만 축소; PDF는 그대로)
async function shrinkImagesToMaxSize(images: ImageInfo[], maxTotalBytes = 3_500_000) {
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

  // 마지막 패스 기준으로 가능한 만큼만 포함
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

const MAX_FILES = 15;

const EmailModal: React.FC<Props> = ({ isOpen, onClose, application, userName, onSendSuccess }) => {
  const [toEmail, setToEmail] = useState('');
  const [images, setImages] = useState<ImageInfo[]>([]);
  const [pdfs, setPdfs] = useState<PdfInfo[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const subject = useMemo(() => {
    const site = application?.site_name ?? '';
    return site ? `[KTL] ${site} 사진/문서 전달` : `[KTL] 사진/문서 전달`;
  }, [application?.site_name]);

  const bodyText = useMemo(() => {
    const lines = [
      `안녕하십니까, KTL ${userName}입니다.`,
      ``,
      application?.receipt_no ? `접수번호: ${application.receipt_no}` : ``,
      application?.site_name ? `현장: ${application.site_name}` : ``,
      ``,
      `요청하신 자료(사진/기록부)를 암호화 ZIP으로 첨부드립니다.`,
      `※ 비밀번호는 신청자 전화번호 뒷 4자리입니다. (전화번호가 없으면 별도 안내)`,
      ``,
      `※ 본 메일은 발신 전용(no-reply) 주소에서 발송되었습니다. 회신 메일은 확인되지 않습니다.`,
    ].filter(Boolean);
    return lines.join('\n');
  }, [userName, application?.receipt_no, application?.site_name]);

  useEffect(() => {
    if (!isOpen) return;
    setToEmail(application?.applicant_email || '');
    setImages([]);
    setPdfs([]);
    setStatus(null);
    setIsCameraOpen(false);
  }, [isOpen, application]);

  const emailValid = useMemo(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail.trim()), [toEmail]);
  if (!isOpen) return null;

  const totalCount = images.length + pdfs.length;

  const handleFilePick = async (files: FileList | null) => {
    if (!files) return;

    const incoming: Array<ImageInfo | PdfInfo> = [];
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        const base64 = await new Promise<string>((res) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.readAsDataURL(file);
        });
        incoming.push({ file, base64, mimeType: file.type, name: file.name });
      } else if (file.type === 'application/pdf') {
        const base64 = await new Promise<string>((res) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.readAsDataURL(file);
        });
        incoming.push({ file, base64, mimeType: 'application/pdf', name: file.name });
      }
    }

    const room = Math.max(0, MAX_FILES - totalCount);
    const picked = incoming.slice(0, room);
    const dropped = incoming.length - picked.length;

    const imgs = picked.filter((x): x is ImageInfo => (x as any).mimeType?.startsWith('image/'));
    const docs = picked.filter((x): x is PdfInfo => (x as any).mimeType === 'application/pdf');

    setImages((prev) => [...prev, ...imgs]);
    setPdfs((prev) => [...prev, ...docs]);

    if (dropped > 0) {
      setStatus({ type: 'info', text: `최대 ${MAX_FILES}개까지 첨부됩니다. 초과 ${dropped}개는 제외되었습니다.` });
    }
  };

  const handleCameraCapture = (file: File, base64: string, mimeType: string) => {
    if (!mimeType.startsWith('image/')) return;
    if (totalCount >= MAX_FILES) {
      setStatus({ type: 'info', text: `최대 ${MAX_FILES}개까지 첨부됩니다.` });
      return;
    }
    setImages((prev) => [...prev, { file, base64, mimeType }]);
    setIsCameraOpen(false);
  };

  const handleDeleteImage = (idx: number) => setImages((prev) => prev.filter((_, i) => i !== idx));
  const handleDeletePdf = (idx: number) => setPdfs((prev) => prev.filter((_, i) => i !== idx));

  const handleSend = async () => {
    if (!emailValid) return setStatus({ type: 'error', text: '유효한 수신 이메일을 입력하세요.' });
    if (totalCount === 0) return setStatus({ type: 'error', text: '파일을 최소 1개 첨부하세요.' });

    setIsSending(true);
    setStatus(null);

    try {
      // 이미지 축소(총 3.5MB 목표). PDF는 원본 유지.
      const processedImages = await shrinkImagesToMaxSize(images, 3_500_000);

      // PDF는 그대로 포함
      const pdfPayload = pdfs.map((p) => ({ name: p.name || 'doc.pdf', content: p.base64 }));

      // 축소 과정에서 제외 발생 안내
      if (processedImages.length < images.length) {
        setStatus({ type: 'info', text: `용량 제한으로 이미지 ${images.length - processedImages.length}개가 제외되었습니다.` });
      }

      const payload = {
        to: toEmail.trim(),
        meta: {
          subject,
          bodyText,
          receipt_no: application?.receipt_no ?? '',
          site_name: application?.site_name ?? '',
          applicant_phone: (application as any)?.applicant_phone ?? '',
        },
        attachments: [
          ...processedImages.map((p) => ({ name: p.name || 'photo.jpg', content: p.base64 })),
          ...pdfPayload,
        ],
      };

      const base = import.meta.env.VITE_SUPABASE_FUNCTION_URL; // 예: https://xxx.functions.supabase.co
      if (!base) throw new Error('서버 URL 미설정(VITE_SUPABASE_FUNCTION_URL).');
      const res = await fetch(`${base}/send-photos`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(payload),
       });
      
      if (!res.ok) {
        if (res.status === 413) throw new Error('첨부 용량이 너무 큽니다. 파일 수를 줄이거나 해상도를 낮춰 다시 시도하세요.');
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
          자료 전송: <span className="text-sky-400">{application.receipt_no}</span>
        </h2>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-6 overflow-y-auto pr-1">
          {/* 좌측 정보 */}
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

          {/* 우측 첨부 */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-100">첨부(이미지/PDF, 최대 {MAX_FILES}개)</h3>
              <ActionButton variant="secondary" onClick={() => setIsCameraOpen((v) => !v)} disabled={isSending}>
                {isCameraOpen ? '카메라 닫기' : '카메라 열기'}
              </ActionButton>
            </div>

            {isCameraOpen ? (
              <CameraView onCapture={handleCameraCapture} onClose={() => setIsCameraOpen(false)} />
            ) : (
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  disabled={isSending}
                  className="block w-full text-sm text-slate-200 file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-slate-600 file:text-white hover:file:bg-slate-500"
                  onChange={(e) => handleFilePick(e.target.files)}
                />
                <p className="mt-2 text-xs text-slate-400">이미지는 자동으로 용량 최적화되어 전송됩니다. PDF는 원본 그대로 첨부됩니다.</p>
              </div>
            )}

            {/* 이미지 썸네일 */}
            <ThumbnailGallery
              images={images}
              currentIndex={-1}
              onSelectImage={() => {}}
              onDeleteImage={handleDeleteImage}
              disabled={isSending}
            />

            {/* PDF 목록 */}
            {pdfs.length > 0 && (
              <div className="bg-slate-700/40 rounded-md p-3">
                <div className="text-sm font-semibold text-slate-200 mb-2">PDF 첨부</div>
                <ul className="space-y-2">
                  {pdfs.map((p, idx) => (
                    <li key={idx} className="flex items-center justify-between text-sm text-slate-200">
                      <span className="truncate">{p.name || 'document.pdf'}</span>
                      <button
                        type="button"
                        onClick={() => handleDeletePdf(idx)}
                        className="text-xs px-2 py-1 rounded bg-slate-600 hover:bg-slate-500"
                        disabled={isSending}
                      >
                        삭제
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
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
              disabled={isSending || !emailValid || totalCount === 0}
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
