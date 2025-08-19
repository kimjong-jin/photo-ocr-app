import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { ImageInput, ImageInfo as BaseImageInfo } from './components/ImageInput';
import { CameraView } from './components/CameraView';
import { ImagePreview } from './components/ImagePreview';
import { OcrControls } from './components/OcrControls';
import { OcrResultDisplay } from './components/OcrResultDisplay';
import { extractTextFromImage } from './services/geminiService';
import { dataURLtoBlob, generateCompositeImage, CompositeImageInput } from './services/imageStampingService'; // generateStampedImage 제거
import { sendToClaydoxApi, ClaydoxPayload, generateKtlJsonForPreview } from './services/claydoxApiService';
import JSZip from 'jszip';
import KtlPreflightModal, { KtlPreflightData } from './components/KtlPreflightModal';
import { ThumbnailGallery } from './components/ThumbnailGallery';
import { Type } from '@google/genai';
import { PhotoLogJob, ExtractedEntry, JobPhoto } from './PhotoLogPage';
import { ActionButton } from './components/ActionButton';
import { Spinner } from './components/Spinner';
import { TN_IDENTIFIERS, TP_IDENTIFIERS } from './shared/constants';

type KtlApiCallStatus = 'idle' | 'success' | 'error';

interface RawEntrySingle { time: string; value: string; }
interface RawEntryTnTp { time: string; value_tn?: string; value_tp?: string; }
type RawEntryUnion = RawEntrySingle | RawEntryTnTp;

const TrashIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12.56 0c1.153 0 2.24.03 3.22.077m3.22-.077L10.88 5.79m2.558 0c-.29.042-.58.083-.87.124" />
  </svg>
);

const sanitizeFilenameComponent = (c: string): string =>
  c ? c.replace(/[/\\[\]:*?"<>|]/g, '_').replace(/__+/g, '_') : '';

const generateIdentifierSequence = (ocrData: ExtractedEntry[] | null): string => {
  if (!ocrData) return "";
  let seq = "";
  const excluded = ["현장"];
  const process = (id?: string) => {
    if (!id) return null;
    let base = id.replace(/[0-9]/g, '');
    if (base.endsWith('P')) base = base.slice(0, -1);
    if (excluded.includes(base)) return null;
    return base.length > 0 ? base : null;
  };
  for (const e of ocrData) {
    const p1 = process(e.identifier); if (p1) seq += p1;
    const p2 = process(e.identifierTP); if (p2) seq += p2;
  }
  return seq;
};

const generatePromptForFieldCount = (receiptNum: string, siteLoc: string, item: string): string => {
  let p = `제공된 측정 장비의 이미지를 분석해주세요.\n컨텍스트:\n- 접수번호: ${receiptNum}\n- 현장/위치: ${siteLoc}\n- 항목/파라미터: ${item || '현장 계수 값'}`;
  if (item === "TN/TP") {
    p += `\n- 이미지에서 TN 및 TP 각각의 시간 및 값 쌍을 추출해주세요. "value_tn"과 "value_tp" 필드를 사용하세요.`;
    p += `\n\nJSON 출력 형식 예시 (TN/TP):\n[\n  { "time": "2025/07/10 10:00", "value_tn": "15.3", "value_tp": "1.2" }\n]`;
  } else {
    p += `\n\nJSON 출력 형식 예시 (${item}):\n[\n  { "time": "2025/07/10 10:00", "value": "15.3" }\n]`;
  }
  return p + `\n\n중요: 반드시 유효한 JSON 배열만 반환하세요.`;
};

interface Props {
  userName: string;
  jobs: PhotoLogJob[];
  setJobs: React.Dispatch<React.SetStateAction<PhotoLogJob[]>>;
  activeJobId: string | null;
  setActiveJobId: (id: string | null) => void;
  siteLocation: string;
  onDeleteJob: (jobId: string) => void;
}

const FieldCountPage: React.FC<Props> = ({ userName, jobs, setJobs, activeJobId, setActiveJobId, siteLocation, onDeleteJob }) => {
  const activeJob = useMemo(() => jobs.find(j => j.id === activeJobId), [jobs, activeJobId]);

  const [isLoading, setIsLoading] = useState(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isSendingToClaydox, setIsSendingToClaydox] = useState(false);
  const [isKtlPreflightModalOpen, setKtlPreflightModalOpen] = useState(false);
  const [ktlPreflightData, setKtlPreflightData] = useState<KtlPreflightData | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState(-1);
  const [batchSendProgress, setBatchSendProgress] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const updateActiveJob = useCallback((fn: (j: PhotoLogJob) => PhotoLogJob) => {
    if (!activeJobId) return;
    setJobs(p => p.map(j => j.id === activeJobId ? fn(j) : j));
  }, [activeJobId, setJobs]);

  // ---------- KTL 전송 (단일) ----------
  const handleSendToClaydoxConfirmed = useCallback(async () => {
    setKtlPreflightModalOpen(false);
    if (!activeJob || !activeJob.processedOcrData || !userName || activeJob.photos.length === 0) {
      updateActiveJob(j => ({ ...j, submissionStatus: 'error', submissionMessage: "필수 데이터 누락" }));
      return;
    }
    updateActiveJob(j => ({ ...j, submissionStatus: 'sending', submissionMessage: "전송 중..." }));
    try {
      const payload: ClaydoxPayload = {
        receiptNumber: activeJob.receiptNumber, siteLocation, item: activeJob.selectedItem,
        updateUser: userName, ocrData: activeJob.processedOcrData, pageType: 'FieldCount'
      };
      const baseName = `${activeJob.receiptNumber}_수질_${sanitizeFilenameComponent(activeJob.selectedItem.replace('/', '_'))}_현장적용계수`;

      // 합성 JPG
      const compInputs: CompositeImageInput[] = activeJob.photos.map(p => ({ base64: p.base64, mimeType: p.mimeType, comment: activeJob.photoComments[p.uid] }));
      const compUrl = await generateCompositeImage(compInputs, { receiptNumber: activeJob.receiptNumber, siteLocation, item: activeJob.selectedItem }, 'image/jpeg');
      const compFile = new File([dataURLtoBlob(compUrl)], `${baseName}.jpg`, { type: 'image/jpeg' });

      // ✅ ZIP: 원본만
      const zip = new JSZip();
      for (const img of activeJob.photos) {
        const raw = `data:${img.mimeType};base64,${img.base64}`;
        zip.file(`${baseName}_${sanitizeFilenameComponent(img.file.name)}`, dataURLtoBlob(raw));
      }
      const zipFile = new File([await zip.generateAsync({ type: "blob" })], `${baseName}.zip`, { type: 'application/zip' });

      const res = await sendToClaydoxApi(payload, [compFile, zipFile], activeJob.selectedItem, [`${baseName}.jpg`, `${baseName}.zip`]);
      updateActiveJob(j => ({ ...j, submissionStatus: 'success', submissionMessage: res.message }));
    } catch (e: any) {
      updateActiveJob(j => ({ ...j, submissionStatus: 'error', submissionMessage: `KTL 전송 실패: ${e.message}` }));
    }
  }, [activeJob, siteLocation, userName, updateActiveJob]);

  // ---------- KTL 일괄 ----------
  const handleBatchSendToKtl = async () => {
    const targets = jobs.filter(j => j.processedOcrData?.length && j.photos.length > 0);
    if (!targets.length) { alert("전송할 작업 없음"); return; }
    setIsSendingToClaydox(true);
    for (let i = 0; i < targets.length; i++) {
      const job = targets[i];
      try {
        const payload: ClaydoxPayload = { receiptNumber: job.receiptNumber, siteLocation, item: job.selectedItem, updateUser: userName, ocrData: job.processedOcrData!, pageType: 'FieldCount' };
        const baseName = `${job.receiptNumber}_수질_${sanitizeFilenameComponent(job.selectedItem.replace('/', '_'))}_현장적용계수`;

        const compInputs: CompositeImageInput[] = job.photos.map(p => ({ base64: p.base64, mimeType: p.mimeType, comment: job.photoComments[p.uid] }));
        const compUrl = await generateCompositeImage(compInputs, { receiptNumber: job.receiptNumber, siteLocation, item: job.selectedItem }, 'image/jpeg');
        const compFile = new File([dataURLtoBlob(compUrl)], `${baseName}.jpg`, { type: 'image/jpeg' });

        // ✅ ZIP: 원본만
        const zip = new JSZip();
        for (const img of job.photos) {
          const raw = `data:${img.mimeType};base64,${img.base64}`;
          zip.file(`${baseName}_${sanitizeFilenameComponent(img.file.name)}`, dataURLtoBlob(raw));
        }
        const zipFile = new File([await zip.generateAsync({ type: "blob" })], `${baseName}.zip`, { type: 'application/zip' });

        await sendToClaydoxApi(payload, [compFile, zipFile], job.selectedItem, [`${baseName}.jpg`, `${baseName}.zip`]);
        setJobs(p => p.map(j => j.id === job.id ? { ...j, submissionStatus: 'success', submissionMessage: '전송 성공' } : j));
      } catch (e: any) {
        setJobs(p => p.map(j => j.id === job.id ? { ...j, submissionStatus: 'error', submissionMessage: `전송 실패: ${e.message}` } : j));
      }
    }
    setIsSendingToClaydox(false);
  };

  // ---------- UI ----------
  return (
    <div className="w-full max-w-4xl bg-slate-800 rounded-xl p-6 space-y-6">
      <h2 className="text-2xl font-bold text-sky-400">현장 계수 (P2)</h2>
      {/* ...중략: 목록/이미지 입력/미리보기/OCR/결과 표시... */}
      <div className="mt-8 border-t pt-6">
        <ActionButton onClick={handleBatchSendToKtl} disabled={isSendingToClaydox} fullWidth variant="secondary">
          {isSendingToClaydox ? "전송 중..." : "이 페이지의 모든 작업 전송"}
        </ActionButton>
      </div>
      {isKtlPreflightModalOpen && ktlPreflightData && (
        <KtlPreflightModal isOpen onClose={() => setKtlPreflightModalOpen(false)} onConfirm={handleSendToClaydoxConfirmed} preflightData={ktlPreflightData} />
      )}
    </div>
  );
};

export default FieldCountPage;
