// ===============================
// File: components/EmailModal.tsx
// (안전 개선: 서버 경유 발송, ZIP AES 암호화, 키 비노출, 용량/파일명 검증, 리소스 해제)
// ===============================


import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Application } from './ApplicationOcrSection';
import { ActionButton } from './ActionButton';
import { CameraView } from './CameraView';
import { ThumbnailGallery } from './ThumbnailGallery';
import { Spinner } from './Spinner';
import * as zip from '@zip.js/zip.js';


export type ImageInfo = { file: File; base64: string; mimeType: string; name?: string };
type PdfInfo = { file: File; base64: string; mimeType: 'application/pdf'; name: string };


type Props = {
isOpen: boolean;
onClose: () => void;
application: Application;
userName: string;
onSendSuccess: (appId: number) => void | Promise<void>;
};


const MAX_FILES = 15;
const MAX_SINGLE_BYTES = 10 * 1024 * 1024; // 10MB (단일 파일)
const MAX_TOTAL_BYTES = 20 * 1024 * 1024; // 20MB (총합)


// 파일명 안전화
function sanitizeFilename(name: string) {
const base = name.replace(/[\r\n]/g, ' ').trim();
return base.replace(/[^\w.\-ㄱ-힣\s]/g, '_');
}


async function blobToBase64NoPrefix(blob: Blob): Promise<string> {
const s = await new Promise<string>((resolve, reject) => {
const reader = new FileReader();
reader.onloadend = () => {
if (typeof reader.result === 'string') {
const i = reader.result.indexOf(',');
resolve(i >= 0 ? reader.result.slice(i + 1) : reader.result);
} else reject(new Error('Base64 변환 실패'));
};
reader.onerror = reject;
reader.readAsDataURL(blob);
});
return s;
}


async function resizeImageToJpeg(
file: File,
maxW: number,
quality: number
): Promise<{ base64: string; mimeType: string; name: string }> {
const bmp = await createImageBitmap(file);
try {
const scale = Math.min(1, maxW / bmp.width);
const w = Math.max(1, Math.floor(bmp.width * scale));
const h = Math.max(1, Math.floor(bmp.height * scale));


const canvas = document.createElement('canvas');
canvas.width = w; canvas.height = h;
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('Canvas not supported');
ctx.drawImage(bmp, 0, 0, w, h);


const blob: Blob = await new Promise((res, rej) => {
const done = (b: Blob | null) => b ? res(b) : rej(new Error('toBlob 실패'));
canvas.toBlob(done, 'image/jpeg', quality);
});


const base64 = await new Promise<string>((res, rej) => {
const fr = new FileReader();
fr.onload = () => res(String(fr.result));
fr.onerror = rej;
fr.readAsDataURL(blob);
});
return { base64, mimeType: 'image/jpeg', name: sanitizeFilename(file.name.replace(/\.[^.]+$/, '')) + '.jpg' };
} finally {
(bmp as any).close?.();
}
}


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
`안녕하십니까, KTL ${userName}입니다.`, ``,
application?.receipt_no ? `접수번호: ${application.receipt_no}` : ``,
}
