// src/components/EmailPage.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Application } from './ApplicationOcrSection';
import { ActionButton } from './ActionButton';
import { ImageInput, type ImageInfo } from './ImageInput';
import { CameraView } from './CameraView';
import { ThumbnailGallery } from './ThumbnailGallery';
import { Spinner } from './Spinner';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  application: Application;
  userName: string;
  onSendSuccess: (appId: number) => void | Promise<void>;
};

const EmailModal: React.FC<Props> = ({ isOpen, onClose, application, userName, onSendSuccess }) => {
  const [toEmail, setToEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<ImageInfo[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 모달 열릴 때 초기화
  useEffect(() => {
    if (!isOpen) return;
    setToEmail(application?.applicant_email || '');
    setSubject(`[KTL] ${application?.site_name ?? ''} 정도검사 기록부 전달`);
    setBody(
      [
        `안녕하십니까, KTL ${userName}입니다.`,
        ``,
        `접수번호: ${application?.receipt_no ?? ''}`,
        `현장: ${application?.site_name ?? ''}`,
        ``,
        `정도검사가 완료되어 기록부 사본을 보내드리오니, 업무에 참고 바랍니다.`,
        ``,
        `감사합니다.`,
        ``,
        `※ 본 메일은 발신 전용(no-reply) 주소에서 발송되었습니다. 회신하신 메일은 확인되지 않습니다.`,
      ].join('\n')
    );
    setAttachments([]);
    setStatus(null);
    setIsCameraOpen(false);
  }, [isOpen, application, userName]);

  const emailValid = useMemo(() => {
    const v = toEmail.trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }, [toEmail]);

  if (!isOpen) return null;

  // 첨부 추가(파일 선택)
  const handleImagesSet = (newImages: ImageInfo[]) => {
    setAttachments((prev) => [...prev, ...newImages]);
  };

  // 첨부 추가(카메라 캡처)
  const handleCameraCapture = (file: File, base64: string, mimeType: string) => {
    setAttachments((prev) => [...prev, { file, base64, mimeType }]);
    setIsCameraOpen(false);
  };

  // 첨부 삭제
  const handleDeleteAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // 전송
  const handleSend = async () => {
    if (!emailValid) {
      setStatus({ type: 'error', text: '유효한 수신 이메일을 입력하세요.' });
      return;
    }
    if (!subject.trim()) {
      setStatus({ type: 'error', text: '제목을 입력하세요.' });
      return;
    }
    if (!body.trim()) {
      setStatus({ type: 'error', text: '본문을 입력하세요.' });
      return;
    }

    setIsSending(true);
    setStatus(null);

    try {
      // 서버리스 함수로 전송 (환경변수/키는 서버에서만 사용)
      const payload = {
        to: toEmail.trim(),
        subject: subject.trim(),
        htmlContent: body.replace(/\n/g, '<br>'),
        attachments:
          attachments.length > 0
            ? attachments.map((att) => ({
                name: att.file?.name || 'attachment',
                // 서버에서 dataURL 접두어를 제거하므로 그대로 보냄
                content: att.base64,
              }))
            : undefined,
      };

      const res = await fetch('/api/send-photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
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
          이메일 전송: <span className="text-sky-400">{application.receipt_no}</span>
        </h2>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-6 overflow-y-auto pr-1">
          {/* 메타/본문 */}
          <div className="space-y-4">
            <div className="text-sm text-slate-300 bg-slate-700/40 rounded-lg p-3">
              <div className="truncate">
                <span className="font-semibold">수신(이름)</span>: {application.applicant_name}
              </div>
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
              {!emailValid && (
                <p className="mt-1 text-xs text-red-300">유효한 이메일 주소를 입력하세요.</p>
              )}
            </div>

            <div>
              <label className="block text-sm mb-1 text-slate-300">제목</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={isSending}
                className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md text-sm"
              />
            </div>

            <div>
              <label className="block text-sm mb-1 text-slate-300">본문</label>
              <textarea
                rows={10}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={isSending}
                className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md text-sm"
              />
            </div>
          </div>

          {/* 첨부 */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-100">사진 첨부</h3>
              <div className="flex gap-2">
                <ActionButton
                  variant="secondary"
                  onClick={() => setIsCameraOpen((v) => !v)}
                  disabled={isSending}
                >
                  {isCameraOpen ? '카메라 닫기' : '카메라 열기'}
                </ActionButton>
              </div>
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

        {/* 하단 액션 */}
        <div className="mt-6 pt-4 border-t border-slate-700 space-y-3">
          {status && (
            <p
              className={`text-sm text-center p-3 rounded-md ${
                status.type === 'success'
                  ? 'bg-green-900/40 text-green-300'
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
              disabled={isSending || !emailValid || !subject.trim() || !body.trim()}
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
