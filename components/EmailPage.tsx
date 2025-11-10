// components/EmailModal.tsx
import React, { useEffect, useRef, useState } from 'react';
import { ActionButton } from './ActionButton';
import { ImageInput, ImageInfo } from './ImageInput';
import { CameraView } from './CameraView';
import { ThumbnailGallery } from './ThumbnailGallery';
import { Spinner } from './Spinner';

export interface ApplicationForEmail {
  id: number;
  receipt_no: string;
  site_name: string;
  applicant_email: string;
}

interface EmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  application: ApplicationForEmail;
  userName: string;
  onSendSuccess: (appId: number) => Promise<void>;
}

const toPureBase64 = (s: string) => {
  const i = s.indexOf('base64,');
  return i >= 0 ? s.slice(i + 'base64,'.length) : s.trim();
};

const EmailModal: React.FC<EmailModalProps> = ({
  isOpen, onClose, application, userName, onSendSuccess
}) => {
  const [recipientEmail, setRecipientEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [htmlContent, setHtmlContent] = useState('');
  const [attachments, setAttachments] = useState<ImageInfo[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && application) {
      setRecipientEmail(application.applicant_email || '');
      setSubject(`[KTL] ${application.site_name} 정도검사 기록부 전달`);
      setHtmlContent(
`안녕하십니까, KTL ${userName}입니다.

접수번호: ${application.receipt_no}
현장: ${application.site_name}

정도검사가 완료되어 기록부 사본을 보내드리오니, 업무에 참고 바랍니다.

감사합니다.

본 메일은 발신 전용(no-reply) 주소에서 발송되었으며, 회신하신 메일은 확인되지 않습니다.`
      );
      setAttachments([]);
      setStatusMessage(null);
      setIsCameraOpen(false);
    }
  }, [isOpen, application, userName]);

  useEffect(() => {
    if (!statusMessage) return;
    const t = setTimeout(() => setStatusMessage(null), 5000);
    return () => clearTimeout(t);
  }, [statusMessage]);

  if (!isOpen) return null;

  const handleSend = async () => {
    if (!recipientEmail.trim()) return setStatusMessage({ type: 'error', text: '수신자 이메일이 없습니다.' });
    if (!subject) return setStatusMessage({ type: 'error', text: '제목을 입력해주세요.' });
    if (!htmlContent) return setStatusMessage({ type: 'error', text: '내용을 입력해주세요.' });

    setIsSending(true);
    setStatusMessage(null);

    try {
      const res = await fetch('/api/send-photos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          to: recipientEmail.trim(),
          subject,
          htmlContent,
          attachments: attachments.map(a => ({
            name: a.file.name,
            content: toPureBase64(a.base64),
          })),
        }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP ${res.status}`);
      }

      await onSendSuccess(application.id);
      setStatusMessage({ type: 'success', text: '메일이 성공적으로 전송되었습니다.' });
      setTimeout(onClose, 1200);
    } catch (e: any) {
      setStatusMessage({ type: 'error', text: `전송 실패: ${e.message}` });
    } finally {
      setIsSending(false);
    }
  };

  const handleImagesSet = (newImages: ImageInfo[]) => setAttachments(prev => [...prev, ...newImages]);
  const handleCameraCapture = (file: File, base64: string, mimeType: string) => {
    setAttachments(prev => [...prev, { file, base64, mimeType }]);
    setIsCameraOpen(false);
  };
  const handleDeleteAttachment = (i: number) => setAttachments(prev => prev.filter((_, idx) => idx !== i));

  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={onClose} role="dialog" aria-modal="true" aria-label="이메일 전송 모달">
      <div className="bg-slate-800 p-6 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <h2 className="text-2xl font-bold text-sky-400 mb-4 pb-3 border-b border-slate-700">
          이메일 전송: {application.receipt_no}
        </h2>

        <div className="overflow-y-auto flex-grow pr-2 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">수신</label>
                <input type="email" value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)} disabled={isSending}
                  className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md shadow-sm text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">제목</label>
                <input type="text" value={subject} onChange={e => setSubject(e.target.value)} disabled={isSending}
                  className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md shadow-sm text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">내용</label>
                <textarea value={htmlContent} onChange={e => setHtmlContent(e.target.value)} rows={8} disabled={isSending}
                  className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md shadow-sm text-sm" />
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-slate-100">사진 첨부</h3>
              {isCameraOpen ? (
                <CameraView onCapture={handleCameraCapture} onClose={() => setIsCameraOpen(false)} />
              ) : (
                <ImageInput onImagesSet={handleImagesSet} onOpenCamera={() => setIsCameraOpen(true)} isLoading={isSending} ref={fileInputRef} selectedImageCount={attachments.length} />
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
        </div>

        <div className="mt-6 pt-4 border-t border-slate-700 space-y-3">
          {statusMessage && (
            <p className={`text-sm text-center p-3 rounded-md ${statusMessage.type === 'success' ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>
              {statusMessage.text}
            </p>
          )}
          <div className="flex flex-col sm:flex-row gap-4">
            <ActionButton onClick={onClose} variant="secondary" disabled={isSending} fullWidth>취소</ActionButton>
            <ActionButton onClick={handleSend} disabled={isSending || !recipientEmail} fullWidth icon={isSending ? <Spinner size="sm" /> : undefined}>
              {isSending ? '전송 중...' : '전송'}
            </ActionButton>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmailModal;
