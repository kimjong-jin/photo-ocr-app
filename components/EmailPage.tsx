// components/EmailModal.tsx (compact)
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Application } from './ApplicationOcrSection';
import { ActionButton } from './ActionButton';
import { ImageInput, type ImageInfo } from './ImageInput';
import { CameraView } from './CameraView';
import { ThumbnailGallery } from './ThumbnailGallery';
import { Spinner } from './Spinner';

const MAX_IMAGES = 15;
const ENABLE_ENCRYPTION = true;

/* ---------- utils (짧게) ---------- */
const estimateBase64Bytes = (b: string) => Math.floor(b.length * 0.75);
const extractBase64Body = (s: string) => {
  const i = s.indexOf('base64,'); return i >= 0 ? s.slice(i + 7) : s;
};
async function resizeImageToJpeg(file: File, maxW: number, q: number) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxW / bmp.width);
  const w = Math.max(1, Math.floor(bmp.width * scale));
  const h = Math.max(1, Math.floor(bmp.height * scale));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  const blob: Blob = await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('encode fail')), 'image/jpeg', q));
  const base64Body = await new Promise<string>((res, rej) => {
    const fr = new FileReader(); fr.onload = () => res(extractBase64Body(String(fr.result||'')));
    fr.onerror = () => rej(new Error('read fail')); fr.readAsDataURL(blob);
  });
  c.width = 0; c.height = 0; (bmp as any)?.close?.();
  return { base64Body, mimeType: 'image/jpeg', name: file.name.replace(/\.[^.]+$/, '') + '.jpg' };
}
async function shrinkToMaxSize(images: ImageInfo[], maxBytes = 3_500_000) {
  const passes: Array<[number, number]> = [[1600,0.8],[1400,0.72],[1200,0.66],[1000,0.6],[800,0.55],[700,0.5],[600,0.45]];
  for (const [w,q] of passes) {
    const ps = await Promise.all(images.map(i => resizeImageToJpeg(i.file, w, q)));
    const total = ps.reduce((s,p)=>s+estimateBase64Bytes(p.base64Body),0);
    if (total<=maxBytes) return ps;
  }
  const fb = await Promise.all(images.map(i => resizeImageToJpeg(i.file, 600, 0.45)));
  const out:any[]=[]; let acc=0;
  for (const p of fb){ const sz=estimateBase64Bytes(p.base64Body); if (acc+sz>maxBytes) break; out.push(p); acc+=sz; }
  return out;
}
/* AES-GCM (비번=신청인 전화번호 뒷4자리) */
const onlyDigits = (s:string)=> (s||'').replace(/\D+/g,'');
const last4 = (app:any)=> {
  for (const k of ['applicant_phone','applicant_tel','applicant_mobile','phone','tel','mobile']) {
    const d=onlyDigits(String(app?.[k]||'')); if (d.length>=4) return d.slice(-4);
  } return null;
};
const toB64 = (u8:Uint8Array)=> btoa(String.fromCharCode(...u8));
const fromB64 = (b64:string)=> Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
async function keyFromPwd(pwd:string,salt:Uint8Array){
  const km=await crypto.subtle.importKey('raw',new TextEncoder().encode(pwd),{name:'PBKDF2'},false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:150000,hash:'SHA-256'},km,{name:'AES-GCM',length:256},false,['encrypt']);
}
async function aesGcmEncrypt(bytes:Uint8Array,pwd:string){
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await keyFromPwd(pwd,salt);
  const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,bytes);
  return { salt:toB64(salt), iv:toB64(iv), ciphertext:toB64(new Uint8Array(ct)) };
}

/* ---------- component ---------- */
type Props = {
  isOpen: boolean; onClose: () => void;
  application: Application; userName: string;
  onSendSuccess: (appId: number) => void | Promise<void>;
};

const EmailModal: React.FC<Props> = ({ isOpen, onClose, application, userName, onSendSuccess }) => {
  const [toEmail, setToEmail] = useState(''); const [attachments, setAttachments] = useState<ImageInfo[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [status, setStatus] = useState<{type:'success'|'error'|'info';text:string}|null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const emailInputRef = useRef<HTMLInputElement>(null);

  useEffect(()=>{ if(!isOpen) return;
    setToEmail(application?.applicant_email || ''); setAttachments([]); setStatus(null); setIsCameraOpen(false);
  },[isOpen,application]);

  const subject = useMemo(()=> {
    const base = application?.site_name ? `[KTL] ${application.site_name} 기록부 전달` : '[KTL] 기록부 전달';
    return ENABLE_ENCRYPTION ? `${base} (암호화 첨부)` : base;
  },[application?.site_name]);

  const bodyText = useMemo(()=>[
    `안녕하십니까, KTL ${userName}입니다.`,
    application?.receipt_no ? `접수번호: ${application.receipt_no}` : '',
    application?.site_name ? `현장: ${application.site_name}` : '',
    '', `요청하신 기록부를 첨부드립니다.`, '',
    ENABLE_ENCRYPTION ? `[중요] 첨부는 암호화(.bin)되었습니다. 비밀번호는 신청인 전화번호 뒷 4자리입니다.` : '',
    '※ 본 메일은 발신 전용(no-reply) 주소에서 발송되었습니다.'
  ].filter(Boolean).join('\n'),[userName,application?.receipt_no,application?.site_name]);

  const emailValid = useMemo(()=> {
    const el = emailInputRef.current; return !!el && el.validity.valid;
  },[toEmail]);

  if (!isOpen) return null;

  const handleImagesSet = (list: ImageInfo[]) => {
    const imgs = list.filter(i=>i.mimeType.startsWith('image/'));
    const room = Math.max(0, MAX_IMAGES - attachments.length);
    const picked = imgs.slice(0, room);
    setAttachments(prev=>[...prev, ...picked]);
    const dropped = imgs.length - picked.length;
    if (dropped>0) setStatus({type:'info',text:`이미지는 최대 ${MAX_IMAGES}장까지 첨부됩니다. 초과 ${dropped}장은 제외되었습니다.`});
  };
  const handleCameraCapture = (file:File, base64:string, mimeType:string)=>{
    if (!mimeType.startsWith('image/')) return;
    if (attachments.length>=MAX_IMAGES) return setStatus({type:'info',text:`이미지는 최대 ${MAX_IMAGES}장까지 첨부됩니다.`});
    setAttachments(prev=>[...prev,{file,base64,mimeType}]); setIsCameraOpen(false);
  };
  const handleDelete = (idx:number)=> setAttachments(prev=>prev.filter((_,i)=>i!==idx));

  const handleSend = async ()=>{
    if (!emailValid) return setStatus({type:'error',text:'유효한 수신 이메일을 입력하세요.'});
    if (!attachments.length) return setStatus({type:'error',text:'이미지를 최소 1장 첨부하세요.'});
    let pin: string | null = null;
    if (ENABLE_ENCRYPTION) { pin = last4(application as any); if (!pin) return setStatus({type:'error',text:'신청인 전화번호 뒷 4자리가 필요합니다.'}); }
    setIsSending(true); setStatus(null);
    try{
      const processed = await shrinkToMaxSize(attachments.slice(0,MAX_IMAGES), 3_500_000);
      if (processed.length < Math.min(MAX_IMAGES, attachments.length)) {
        setStatus({type:'info',text:`용량 제한으로 일부 이미지를 제외했습니다.`});
      }
      let outgoing: Array<{name:string; content:string}> = [];
      if (ENABLE_ENCRYPTION) {
        for (const p of processed) {
          const bytes = fromB64(p.base64Body);
          const enc = await aesGcmEncrypt(bytes, pin!);
          outgoing.push({ name: p.name+'.bin', content: `data:application/octet-stream;base64,${enc.ciphertext.replace(/\s+/g,'')}` });
        }
      } else {
        outgoing = processed.map(p=>({ name:p.name, content:`data:${p.mimeType};base64,${p.base64Body.replace(/\s+/g,'')}` }));
      }
      // 총량 컷(옵션)
      const MAX_TOTAL_BYTES = 3_300_000; const trimmed: typeof outgoing = []; let acc=0;
      for (const a of outgoing){ const sz=estimateBase64Bytes(extractBase64Body(a.content)); if (acc+sz>MAX_TOTAL_BYTES) break; trimmed.push(a); acc+=sz; }

      const csrf = (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content || '';
      const payload = {
        to: toEmail.trim(),
        meta: {
          subject, bodyText,
          receipt_no: application?.receipt_no||'', site_name: application?.site_name||'',
          kind:'기록부',
          ...(ENABLE_ENCRYPTION && { encryption_notice:'첨부는 AES-GCM(.bin) 암호화. 비밀번호=신청인 전화번호 뒷 4자리' })
        },
        attachments: trimmed,
      };
      const res = await fetch('/api/send-photos', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', ...(csrf && {'X-CSRF-Token':csrf}) },
        credentials:'same-origin',
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const t = await res.text().catch(()=> ''); console.error('send-photos', res.status, t);
        if (res.status===413) throw new Error('첨부 용량이 큽니다. 이미지 수/해상도를 줄이세요.');
        throw new Error('전송 실패. 잠시 후 다시 시도하거나 관리자에게 문의하세요.');
      }
      await onSendSuccess(application.id);
      setStatus({type:'success',text:'메일이 전송되었습니다.'});
      setTimeout(onClose, 1200);
    }catch(e:any){
      setStatus({type:'error',text:e?.message||'전송 실패'});
    }finally{
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={onClose} role="dialog" aria-modal="true">
      <div className="bg-slate-800 w-full max-w-4xl max-h-[92vh] rounded-xl border border-slate-700 shadow-2xl p-6 flex flex-col" onClick={(e)=>e.stopPropagation()}>
        <h2 className="text-xl sm:text-2xl font-semibold text-white">
          기록부 전송: <span className="text-sky-400">{application.receipt_no}</span>
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
                ref={emailInputRef} type="email" value={toEmail} onChange={(e)=>setToEmail(e.target.value)} disabled={isSending}
                className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md text-sm" placeholder={application.applicant_email}
                autoComplete="email" inputMode="email"
              />
              {!emailValid && <p className="mt-1 text-xs text-red-300">유효한 이메일 주소를 입력하세요.</p>}
            </div>

            <div>
              <label className="block text-sm mb-1 text-slate-300">제목(고정)</label>
              <input type="text" value={subject} readOnly className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md text-sm opacity-70 cursor-not-allowed"/>
            </div>
            <div>
              <label className="block text-sm mb-1 text-slate-300">본문(고정)</label>
              <textarea rows={8} value={bodyText} readOnly className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md text-sm opacity-70 cursor-not-allowed"/>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-100">이미지 첨부(최대 {MAX_IMAGES}장)</h3>
              <ActionButton variant="secondary" onClick={()=>setIsCameraOpen(v=>!v)} disabled={isSending}>
                {isCameraOpen ? '카메라 닫기' : '카메라 열기'}
              </ActionButton>
            </div>

            {isCameraOpen ? (
              <CameraView onCapture={handleCameraCapture} onClose={()=>setIsCameraOpen(false)} />
            ) : (
              <ImageInput onImagesSet={handleImagesSet} onOpenCamera={()=>setIsCameraOpen(true)} isLoading={isSending} selectedImageCount={attachments.length} />
            )}

            <ThumbnailGallery images={attachments} currentIndex={-1} onSelectImage={()=>{}} onDeleteImage={handleDelete} disabled={isSending}/>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-slate-700 space-y-3">
          {status && (
            <p className={`text-sm text-center p-3 rounded-md ${
              status.type==='success'?'bg-green-900/40 text-green-300'
              : status.type==='info'?'bg-sky-900/40 text-sky-300'
              : 'bg-red-900/40 text-red-300'
            }`}>{status.text}</p>
          )}
          <div className="flex flex-col sm:flex-row gap-3">
            <ActionButton onClick={onClose} variant="secondary" disabled={isSending} fullWidth>취소</ActionButton>
            <ActionButton onClick={handleSend} disabled={isSending||!emailValid||attachments.length===0} fullWidth icon={isSending?<Spinner size="sm"/>:undefined}>
              {isSending?'전송 중...':'전송'}
            </ActionButton>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmailModal;
