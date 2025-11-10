'use client';
import React, { useEffect, useRef, useState } from 'react';

type Application = {
  id: number;
  receipt_no: string;
  site_name: string;
  applicant_email?: string | null;
};

type ImageInfo = { file: File; base64: string; mimeType: string };

type Props = {
  application: Application;
  userName: string;
  onSent?: (appId: number) => Promise<void>;
};

const EmailPage: React.FC<Props> = ({ application, userName, onSent }) => {
  const [recipientEmail, setRecipientEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [htmlContent, setHtmlContent] = useState('');
  const [attachments, setAttachments] = useState<ImageInfo[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
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
    setStatus(null);
  }, [application, userName]);

  const toBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).replace(/^data:.*;base64,/, ''));
      r.onerror = reject;
      r.readAsDataURL(file);
    });

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const list: ImageInfo[] = [];
    for (const f of Array.from(files)) {
      list.push({ file: f, base64: await toBase64(f), mimeType: f.type || 'application/octet-stream' });
    }
    setAttachments(prev => [...prev, ...list]);
    e.target.value = '';
  };

  const remove = (i: number) => setAttachments(prev => prev.filter((_, idx) => idx !== i));

  const send = async () => {
    if (!recipientEmail.trim()) return setStatus({ type: 'error', text: '수신자 이메일이 없습니다.' });
    if (!subject) return setStatus({ type: 'error', text: '제목을 입력해주세요.' });
    if (!htmlContent) return setStatus({ type: 'error', text: '내용을 입력해주세요.' });

    setIsSending(true);
    setStatus(null);

    try {
      const payload = {
        to: recipientEmail.trim(),
        subject,
        htmlContent: htmlContent.replace(/\n/g, '<br>'),
        attachments: attachments.length
          ? attachments.map(a => ({ name: a.file.name, content: a.base64 }))
          : undefined,
      };

      const res = await fetch('/api/send-photos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); msg = j?.error || msg; } catch {}
        throw new Error(msg);
      }

      if (onSent) await onSent(application.id);
      setStatus({ type: 'success', text: '메일이 성공적으로 전송되었습니다.' });
    } catch (e: any) {
      setStatus({ type: 'error', text: `전송 실패: ${e.message}` });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="p-4 max-w-5xl mx-auto text-slate-100">
      <h1 className="text-2xl font-bold text-sky-400 mb-6">이메일 전송: {application.receipt_no}</h1>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <label className="block text-sm mb-1">수신</label>
            <input
              className="w-full p-2.5 bg-slate-700 border border-slate-500 rounded"
              type="email"
              value={recipientEmail}
              onChange={e => setRecipientEmail(e.target.value)}
              disabled={isSending}
            />
          </div>

          <div>
            <label className="block text-sm mb-1">제목</label>
            <input
              className="w-full p-2.5 bg-slate-700 border border-slate-500 rounded"
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              disabled={isSending}
            />
          </div>

          <div>
            <label className="block text-sm mb-1">내용</label>
            <textarea
              className="w-full p-2.5 bg-slate-700 border border-slate-500 rounded"
              rows={10}
              value={htmlContent}
              onChange={e => setHtmlContent(e.target.value)}
              disabled={isSending}
            />
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => document.getElementById('filePick')?.click()}
              className="px-4 py-2 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-50"
              disabled={isSending}
            >
              파일 추가
            </button>
            <input id="filePick" type="file" accept="image/*" multiple hidden onChange={onFiles} />
          </div>

          <ul className="space-y-2">
            {attachments.map((a, i) => (
              <li key={i} className="flex items-center justify-between bg-slate-800 px-3 py-2 rounded">
                <span className="truncate">{a.file.name}</span>
                <button onClick={() => remove(i)} className="text-sm text-red-300 hover:text-red-200">삭제</button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {status && (
        <p className={`mt-6 text-sm text-center p-3 rounded ${
          status.type === 'success' ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'
        }`}>
          {status.text}
        </p>
      )}

      <div className="mt-4">
        <button
          onClick={send}
          disabled={isSending || !recipientEmail}
          className="w-full md:w-auto px-6 py-2 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-50"
        >
          {isSending ? '전송 중...' : '전송'}
        </button>
      </div>
    </div>
  );
};

export default EmailPage;
