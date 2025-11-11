import React, { useState } from 'react';
import { ActionButton } from '../components/ActionButton';
import { Spinner } from '../components/Spinner';
import type { Application } from '../components/ApplicationOcrSection';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  application: Application;
  userName: string;
  onSendSuccess: (appId: number) => void;
};

const EmailModal: React.FC<Props> = ({ isOpen, onClose, application, userName, onSendSuccess }) => {
  const [subject, setSubject] = useState<string>(`[KTL] 시험·검사 안내 – ${application.site_name}`);
  const [body, setBody] = useState<string>([
    `${application.applicant_name} 담당자님,`,
    ``,
    `KTL ${userName}입니다. 아래 건으로 시험·검사 일정을 안내드립니다.`,
    ``,
    `- 접수번호: ${application.receipt_no}`,
    `- 현장(회사명): ${application.site_name}`,
    ``,
    `문의 사항은 본 메일에 회신 부탁드립니다.`,
    ``,
    `감사합니다.`,
    `KTL ${userName}`,
  ].join('\n'));
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSend = async () => {
    setIsSending(true);
    setError(null);
    try {
      // 서버의 이메일 전송 API 라우트(예: /api/send-email)를 호출합니다.
      // 프로젝트에 이미 있는 라우트를 사용하세요. (BREVO 등 환경변수는 서버쪽에서 사용)
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: application.applicant_email,
          subject,
          text: body,
          html: body.replace(/\n/g, '<br/>'),
          meta: {
            receipt_no: application.receipt_no,
            site_name: application.site_name,
            applicant_name: application.applicant_name,
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Email API failed with ${res.status}`);
      }

      onSendSuccess(application.id);
      onClose();
    } catch (e: any) {
      setError(e?.message || '이메일 전송에 실패했습니다.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl bg-slate-800 border border-slate-700 shadow-xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-white">이메일 보내기</h3>
          <button
            onClick={onClose}
            className="text-slate-300 hover:text-white rounded-md px-2 py-1"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3">
          <div className="text-sm text-slate-300 bg-slate-700/40 rounded-lg p-3">
            <div><span className="font-semibold">수신</span>: {application.applicant_name} &lt;{application.applicant_email}&gt;</div>
            <div><span className="font-semibold">접수번호</span>: {application.receipt_no}</div>
            <div><span className="font-semibold">현장</span>: {application.site_name}</div>
          </div>

          <div>
            <label className="block text-sm mb-1 text-slate-300">제목</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-md bg-white text-slate-900 p-2 border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <div>
            <label className="block text-sm mb-1 text-slate-300">본문</label>
            <textarea
              rows={10}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full rounded-md bg-white text-slate-900 p-2 border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm p-2 bg-red-900/30 rounded-md">{error}</p>
          )}

          <div className="flex gap-2 justify-end pt-2">
            <ActionButton variant="secondary" onClick={onClose} disabled={isSending}>
              취소
            </ActionButton>
            <ActionButton onClick={handleSend} disabled={isSending}>
              {isSending ? <Spinner size="sm" /> : '전송'}
            </ActionButton>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmailModal;
