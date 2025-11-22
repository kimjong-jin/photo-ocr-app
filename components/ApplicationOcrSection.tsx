import React, { useState, useCallback, useEffect } from 'react';
import { ActionButton } from './ActionButton';
import { ImageInput, ImageInfo } from './ImageInput';
import { Spinner } from './Spinner';
import { extractTextFromImage } from '../services/geminiService';
import { Type } from '@google/genai';
import { preprocessImageForGemini } from '../services/imageProcessingService';
import { supabase } from '../services/supabaseClient';
import { sendKakaoTalkMessage } from '../services/claydoxApiService';
import { CameraView } from './CameraView';
import EmailModal from './EmailModal';

export interface Application {
  id: number;
  created_at: string;
  queue_slot: number | null;
  receipt_no: string;
  site_name: string; // 현장(회사명)
  representative_name: string; // 대표자
  applicant_name: string; // 신청인
  applicant_phone: string; // 휴대폰
  applicant_email: string; // 이메일
  maintenance_company?: string;
  user_name?: string;
  p1_check?: boolean;
  p2_check?: boolean;
  p3_check?: boolean;
  p4_check?: boolean;
  p5_check?: boolean;
  p6_check?: boolean;
  p7_check?: boolean;
}

interface ApplicationOcrSectionProps {
  userName: string;
  userContact: string;
  onApplicationSelect: (app: Application) => void;
  siteNameToSync: string;
  appIdToSync: number | null;
  receiptNumberCommonToSync: string;
  applications: Application[];
  setApplications: React.Dispatch<React.SetStateAction<Application[]>>;
  isLoadingApplications: boolean;
  loadApplications: (showError?: (msg: string) => void) => void;
}

const TrashIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12.56 0c1.153 0 2.24.03 3.22.077m3.22-.077L10.88 5.79m2.558 0c-.29.042-.58.083-.87.124" />
  </svg>
);

const EditIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
  </svg>
);

const SaveIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
);

const CancelIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const RefreshIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
  </svg>
);

const SendIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
  </svg>
);

const EmailIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
  </svg>
);

const PlusIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
  </svg>
);

const ApplicationOcrSection: React.FC<ApplicationOcrSectionProps> = ({
  userName,
  userContact,
  onApplicationSelect,
  siteNameToSync,
  appIdToSync,
  receiptNumberCommonToSync,
  applications,
  setApplications,
  isLoadingApplications,
  loadApplications,
}) => {
  const [image, setImage] = useState<ImageInfo | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editedData, setEditedData] = useState<Partial<Application>>({});
  const [kakaoSendingId, setKakaoSendingId] = useState<number | null>(null);
  const [emailModalApp, setEmailModalApp] = useState<Application | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newApplicationData, setNewApplicationData] = useState<Partial<Application>>({});
  const [ocrApiMode, setOcrApiMode] = useState<'gemini' | 'vllm'>('vllm');
  const [isCameraOpen, setIsCameraOpen] = useState(false);

  const clearMessages = () => {
    setError(null);
    setSuccessMessage(null);
  };

  useEffect(() => {
    const handleUpdate = () => {
      console.log('Application list update event received. Refreshing list.');
      loadApplications();
    };
    window.addEventListener('applicationsUpdated', handleUpdate);
    return () => window.removeEventListener('applicationsUpdated', handleUpdate);
  }, [loadApplications]);

  useEffect(() => {
    const syncSiteName = async () => {
      if (appIdToSync !== null && supabase) {
        const appToUpdate = applications.find((app) => app.id === appIdToSync);
        if (appToUpdate && appToUpdate.site_name !== siteNameToSync) {
          const { error } = await supabase
            .from('applications')
            .update({ site_name: siteNameToSync })
            .eq('id', appIdToSync);

          if (!error) {
            setApplications((prevApps) =>
              prevApps.map((app) =>
                app.id === appIdToSync ? { ...app, site_name: siteNameToSync } : app,
              ),
            );
          } else {
            console.error('Failed to sync site name to Supabase:', error);
          }
        }
      }
    };
    syncSiteName();
  }, [siteNameToSync, appIdToSync, applications, setApplications]);

  useEffect(() => {
    const syncReceiptNumber = async () => {
      if (appIdToSync !== null && receiptNumberCommonToSync.trim() && supabase) {
        const appToUpdate = applications.find((app) => app.id === appIdToSync);
        if (appToUpdate && appToUpdate.receipt_no) {
          const parts = appToUpdate.receipt_no.split('-');
          let detailPart = '';
          let currentCommonPart = appToUpdate.receipt_no;

          if (parts.length > 3) {
            detailPart = parts.pop() || '';
            currentCommonPart = parts.join('-');
          }

          if (receiptNumberCommonToSync !== currentCommonPart) {
            const newReceiptNo = detailPart
              ? `${receiptNumberCommonToSync}-${detailPart}`
              : receiptNumberCommonToSync;
            const { error } = await supabase
              .from('applications')
              .update({ receipt_no: newReceiptNo })
              .eq('id', appIdToSync);

            if (!error) {
              setApplications((prevApps) =>
                prevApps.map((app) =>
                  app.id === appIdToSync ? { ...app, receipt_no: newReceiptNo } : app,
                ),
              );
            } else {
              console.error('Failed to sync receipt number to Supabase:', error);
            }
          }
        }
      }
    };
    syncReceiptNumber();
  }, [receiptNumberCommonToSync, appIdToSync, applications, setApplications]);

  const handleImagesSet = useCallback((images: ImageInfo[]) => {
    setImage(images[0] || null);
    clearMessages();
  }, []);

  const handleOpenCamera = useCallback(() => setIsCameraOpen(true), []);
  const handleCloseCamera = useCallback(() => setIsCameraOpen(false), []);
  const handleCameraCapture = useCallback((file: File, base64: string, mimeType: string) => {
    const capturedImage: ImageInfo = { file, base64, mimeType };
    setImage(capturedImage);
    setIsCameraOpen(false);
    clearMessages();
  }, []);

  const handleAnalyzeAndSave = async () => {
    if (!image) {
      setError('분석할 이미지를 먼저 업로드해주세요.');
      return;
    }
    if (!supabase) {
      setError('데이터베이스에 연결할 수 없습니다.');
      return;
    }

    setIsProcessing(true);
    clearMessages();

    const originalApiMode = localStorage.getItem('apiMode') || 'gemini';
    localStorage.setItem('apiMode', ocrApiMode);

    try {
      const currentApps = [...applications];
      const maxSlot = Math.max(
        0,
        ...currentApps.filter((app) => app.queue_slot !== null).map((app) => app.queue_slot!),
      );
      const provisionalSlot = maxSlot + 1;

      const geminiPrompt = `
너는 '검사(시험)신청서' 이미지에서 지정 필드만 추출하는 OCR 파서다.
반드시 단일 JSON 한 줄만 출력하고, 다른 텍스트는 금지한다.

[입력 파라미터]
- slot: "${provisionalSlot}"

[출력 스키마(모두 문자열)]
{"queue_slot":"","receipt_no":"","site_name":"","representative_name":"","applicant_name":"","applicant_phone":"","applicant_email":""}

[출력 형식]
- 출력은 위 7개 키만 포함한 단일 JSON 객체 1개만 허용한다.
- 마크다운 코드블록과 설명 문장은 절대 출력하지 마라.
- 줄바꿈 없이 한 줄로만 출력한다.

[필드별 매핑 규칙]
- site_name: 신청서의 "성적서 발급" 표에 있는 "회사명" → 현장(회사명)
- representative_name: "성적서 발급" 표에 있는 "대표자" → 대표자
- applicant_name: "신청인" 섹션의 "성명" → 신청인
- applicant_phone: "신청인" 섹션의 "휴대폰" → 휴대폰폰
- applicant_email: "신청인" 섹션의 "E-mail" → 이메일

[추출 규칙 (필드별 의미와 대략적 위치)]
- queue_slot:
  - 입력 파라미터 slot 값을 그대로 문자열로 넣는다.
  - 예: slot이 "3"이면 "queue_slot":"3".

- receipt_no:
  - 문서 맨 위 오른쪽 상단에 있는 '접수번호' 라벨 옆 값.
  - 보통 바코드 또는 QR 코드 근처 상단 박스 안에 위치한다.
  - 예: 25-069243-01.
  - 앞뒤 공백만 제거(trim)하고, 형식이 달라도 원문 그대로 유지한다.
  - 없으면 ""(빈 문자열)로 둔다.

- site_name:
  - 문서 중단부의 "성적서 발급" 섹션 표에서 '회사명' 칸의 값.
  - "성적서 발급" 제목 바로 아래 표에서 첫 번째 행/열에 위치하는 회사명을 사용한다.
  - 회사명에 부서명('과', '팀' 등)이 포함된 경우, 전체를 하나의 문자열로 추출한다.
    - 예: 포항시 맑은물사업본부 정수과.
  - 단, 다음과 같은 발급기관/기관장 이름은 site_name으로 사용하면 안 된다:
    - "한국산업기술시험원"
    - "한국산업기술시험원장"
    - "산업기술시험원장"
    - 위와 유사한 발급기관 이름/직함(원장, 소장 등)을 포함하는 문자열
  - 이런 값이 보이면 무시하고, 실제 시험·검사를 의뢰한 현장(회사) 이름만 site_name으로 추출한다.
  - 회사명 안에 "(인)", "(서명)", "직인" 같은 표기들은 절대 포함하지 말고 제거한다.

- representative_name:
  - 같은 "성적서 발급" 섹션 표에서 '대표자' 칸의 값.
  - '회사명'과 같은 표 안에서, '대표자' 라벨이 붙어 있는 셀의 이름을 가져온다.
  - 대표자 이름 뒤에 붙는 "(인)", "(서명)", "직인" 등은 모두 제거하고 이름만 남긴다.

- applicant_name:
  - 문서 하단의 "신청인" 섹션에서 '성명' 칸의 값.
  - 보통 서명란 또는 도장란 근처, '신청인' 제목 아래 표 안에 위치한다.
  - 이름 뒤에 붙는 "(인)", "(서명)", "직인" 등은 모두 제거하고 이름만 남긴다.
    - 예: "홍길동(인)" → "홍길동"

- applicant_email:
  - 같은 "신청인" 섹션에서 E-mail(또는 '이메일') 칸의 값.
  - 앞뒤 공백을 제거한 뒤 소문자화한다.

- applicant_phone:
  - 같은 "신청인" 섹션에서 '휴대폰' 또는 '핸드폰' 라벨이 붙은 칸의 값.
  - 반드시 휴대폰 번호(010, 011, 016, 017, 018, 019로 시작하는 번호)만 사용한다.
  - 02-, 031-, 054-, 055- 등 지역번호(일반 전화번호)로 시작하는 번호는 휴대폰 번호가 아니므로 applicant_phone에 쓰지 말고 무시한다.
  - 휴대폰 번호가 여러 개 보이면 가장 대표로 보이는 하나만 선택한다.
  - 숫자만 추출해 010-0000-0000 또는 011-000-0000 형식으로 하이픈을 넣어 표준화하라.
  - 숫자는 가리지 말고 그대로 유지한다.
  - 번호 형식이 너무 애매하면 ""(빈 문자열)로 둔다.
  - 앞뒤 공백은 제거(trim)한다.

- 위 필드 중 어느 것이든 값이 확실치 않으면 ""(빈 문자열)로 둔다.
`;

      const modelConfig = {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            queue_slot: { type: Type.STRING },
            receipt_no: { type: Type.STRING },
            site_name: { type: Type.STRING },
            representative_name: { type: Type.STRING },
            applicant_name: { type: Type.STRING },
            applicant_phone: { type: Type.STRING },
            applicant_email: { type: Type.STRING },
          },
          required: [
            'queue_slot',
            'receipt_no',
            'site_name',
            'representative_name',
            'applicant_name',
            'applicant_phone',
            'applicant_email',
          ],
        },
      } as const;

      const { base64: preprocessedBase64, mimeType: preprocessedMimeType } =
        await preprocessImageForGemini(image.file, {
          maxWidth: 1600,
          jpegQuality: 0.9,
          grayscale: true,
        });

      const jsonString = await extractTextFromImage(
        preprocessedBase64,
        preprocessedMimeType,
        geminiPrompt,
        modelConfig,
      );

      // --- 후처리 헬퍼들 ---
      const INVALID_SITE_NAMES = ['한국산업기술시험원', '한국산업기술시험원장', '산업기술시험원장'];

      // (인), (서명), 직인 같은 표시 공통 제거
      const stripApprovalMarks = (value: string): string => {
        if (!value) return '';
        return value
          .replace(/\(\s*인\s*\)/g, '')
          .replace(/\(\s*서명\s*\)/g, '')
          .replace(/직인/g, '')
          .trim();
      };

      const sanitizeSiteName = (name: string): string => {
        if (!name) return '';
        const cleaned = stripApprovalMarks(name).trim();
        if (!cleaned) return '';
        if (INVALID_SITE_NAMES.some((bad) => cleaned.includes(bad))) {
          return '';
        }
        return cleaned;
      };

      const cleanPersonName = (name: string): string => {
        if (!name) return '';
        let result = stripApprovalMarks(name);
        // 끝에 남은 괄호 표기 하나 정도는 잘라버린다. 예: "홍길동 (팀장)"
        result = result.replace(/\([^)]*\)\s*$/g, '').trim();
        return result;
      };

      const normalizeMobile = (phone: string): string => {
        if (!phone) return '';
        const digits = phone.replace(/\D/g, '');
        if (!digits) return '';
        const prefix = digits.slice(0, 3);
        const mobilePrefixes = ['010', '011', '016', '017', '018', '019'];
        if (!mobilePrefixes.includes(prefix)) {
          // 휴대폰 번호가 아니면 버린다
          return '';
        }
        if (digits.length === 10) {
          // 0111234567 → 011-123-4567
          return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
        }
        if (digits.length === 11) {
          // 01012345678 → 010-1234-5678
          return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
        }
        // 길이가 이상하면 버림
        return '';
      };
      // -----------------------

      const rawOcrResult = JSON.parse(jsonString.trim());

      const ocrResult = {
        ...rawOcrResult,
        site_name: sanitizeSiteName(rawOcrResult.site_name),
        representative_name: cleanPersonName(rawOcrResult.representative_name),
        applicant_name: cleanPersonName(rawOcrResult.applicant_name),
        applicant_phone: normalizeMobile(rawOcrResult.applicant_phone),
      };

      const newApp = {
        ...ocrResult,
        // queue_slot은 어차피 서버에서 사용할 순번 기준으로 덮어쓴다
        queue_slot: provisionalSlot,
        user_name: userName,
      };

      const { error: insertError } = await supabase.from('applications').insert(newApp);

      if (insertError) {
        if (
          insertError.code === '23505' ||
          (insertError.message && insertError.message.includes('duplicate key'))
        ) {
          console.warn(
            `[OCR Save] Insert failed due to duplicate receipt_no '${ocrResult.receipt_no}'. Attempting to update instead.`,
          );

          const { data: existingData, error: fetchError } = await supabase
            .from('applications')
            .select('id, queue_slot')
            .eq('receipt_no', ocrResult.receipt_no)
            .single();

          if (fetchError || !existingData) {
            throw new Error(
              `중복된 항목 '${ocrResult.receipt_no}'을(를) 업데이트하는데 실패했습니다: 기존 데이터를 찾을 수 없습니다.`,
            );
          }

          const dataToUpdate = {
            ...ocrResult,
            queue_slot: existingData.queue_slot,
            user_name: userName,
          };

          const { error: updateError } = await supabase
            .from('applications')
            .update(dataToUpdate)
            .eq('id', existingData.id);

          if (updateError) {
            throw new Error(
              `중복된 항목 '${ocrResult.receipt_no}' 업데이트 실패: ${updateError.message}`,
            );
          }

          setSuccessMessage(
            `'${ocrResult.receipt_no}' 데이터가 성공적으로 업데이트되었습니다 (중복 감지).`,
          );
        } else {
          throw insertError;
        }
      } else {
        setSuccessMessage(`'${ocrResult.receipt_no}' 데이터가 성공적으로 저장되었습니다.`);
      }

      loadApplications();
      setImage(null);
    } catch (err: any) {
      setError('작업 실패: ' + (err.message || '알 수 없는 오류가 발생했습니다.'));
    } finally {
      localStorage.setItem('apiMode', originalApiMode);
      setIsProcessing(false);
    }
  };

  const handleEditInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setEditedData((prev) => ({ ...prev, [name]: value }));
  };

  const handleStartAdding = () => {
    setEditingId(null);
    setIsAddingNew(true);
    setNewApplicationData({
      receipt_no: '',
      site_name: '',
      representative_name: '',
      applicant_name: '',
      applicant_phone: '',
      applicant_email: '',
      p1_check: false,
      p2_check: false,
      p3_check: false,
      p4_check: false,
      p5_check: false,
      p6_check: false,
      p7_check: false,
    });
  };

  const handleCancelAdding = () => {
    setIsAddingNew(false);
    setNewApplicationData({});
  };

  const handleNewDataChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setNewApplicationData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleSaveNewApplication = async () => {
    if (!supabase) {
      setError('데이터베이스에 연결할 수 없습니다.');
      return;
    }
    if (!newApplicationData.receipt_no || !newApplicationData.site_name) {
      setError('접수번호와 현장명은 필수 항목입니다.');
      return;
    }
    clearMessages();
    setIsProcessing(true);

    try {
      const dataToInsert: any = {
        ...newApplicationData,
        user_name: userName,
        queue_slot: newApplicationData.queue_slot
          ? Number(newApplicationData.queue_slot)
          : null,
      };
      delete dataToInsert.id;

      const { error: insertError } = await supabase
        .from('applications')
        .insert(dataToInsert);

      if (insertError) {
        if (
          insertError.code === '23505' ||
          (insertError.message && insertError.message.includes('duplicate key'))
        ) {
          console.warn(
            `[Save New] Insert failed due to duplicate receipt_no '${dataToInsert.receipt_no}'. Attempting to update.`,
          );

          const { receipt_no, ...updateData } = dataToInsert;

          const { error: updateError } = await supabase
            .from('applications')
            .update(updateData)
            .eq('receipt_no', receipt_no);

          if (updateError) {
            throw new Error(
              `항목 '${receipt_no}'이(가) 이미 존재하여 업데이트를 시도했으나 실패했습니다: ${updateError.message}`,
            );
          }
          setSuccessMessage(`'${receipt_no}' 항목이 이미 존재하여 내용이 업데이트되었습니다.`);
        } else {
          throw insertError;
        }
      } else {
        setSuccessMessage(`'${dataToInsert.receipt_no}'이(가) 성공적으로 추가되었습니다.`);
      }

      setIsAddingNew(false);
      setNewApplicationData({});
      loadApplications();
    } catch (err: any) {
      setError('작업 실패: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // --- 삭제/수정 핸들러들 추가 ---
  const handleDeleteApplication = async (idToDelete: number) => {
    if (!supabase) {
      setError('데이터베이스에 연결할 수 없습니다.');
      return;
    }
    const appToDelete = applications.find((app) => app.id === idToDelete);
    if (!appToDelete) {
      setError('삭제할 항목을 찾을 수 없습니다.');
      return;
    }

    clearMessages();
    try {
      const { error: deleteError } = await supabase
        .from('applications')
        .delete()
        .eq('id', idToDelete);

      if (deleteError) throw deleteError;

      const deletedSlot = appToDelete.queue_slot;
      if (deletedSlot !== null) {
        const appsToUpdate = applications
          .filter(
            (app) => app.queue_slot !== null && app.queue_slot > deletedSlot,
          )
          .map((app) => ({
            ...app,
            queue_slot: app.queue_slot! - 1,
          }));

        if (appsToUpdate.length > 0) {
          const { error: updateError } = await supabase
            .from('applications')
            .upsert(appsToUpdate);
          if (updateError) {
            console.error('Failed to re-sequence queue slots:', updateError);
          }
        }
      }

      setSuccessMessage(`'${appToDelete.receipt_no}' 데이터가 삭제되었습니다.`);
      loadApplications();
    } catch (err: any) {
      console.error('[handleDeleteApplication] error:', err);
      setError(
        '삭제 실패: ' + (err.message || '알 수 없는 오류가 발생했습니다.'),
      );
    }
  };

  const handleEdit = (app: Application) => {
    setEditingId(app.id);
    setEditedData(app);
    setIsAddingNew(false);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditedData({});
  };

  const handleSaveEdit = async (id: number) => {
    if (!supabase) {
      setError('데이터베이스에 연결할 수 없습니다.');
      return;
    }

    const { id: appId, created_at, user_name, ...dataToUpdate } =
      editedData as Application;

    const finalData = {
      ...dataToUpdate,
      queue_slot: dataToUpdate.queue_slot
        ? Number(dataToUpdate.queue_slot)
        : null,
    };

    const { error } = await supabase
      .from('applications')
      .update(finalData)
      .eq('id', id);

    if (error) {
      setError('업데이트 실패: ' + error.message);
    } else {
      loadApplications();
      setEditingId(null);
      setEditedData({});
    }
  };
  // ---------------------------

  const handleCheckChange = async (
    appId: number,
    checkField: keyof Application,
    isChecked: boolean,
  ) => {
    if (!supabase) return;

    const originalApplications = applications;
    setApplications((prev) =>
      prev.map((app) =>
        app.id === appId ? { ...app, [checkField]: isChecked } : app,
      ),
    );

    const { error } = await supabase
      .from('applications')
      .update({ [checkField]: isChecked })
      .eq('id', appId);

    if (error) {
      setApplications(originalApplications);

      if (error.message.includes('column') && error.message.includes('does not exist')) {
        setError(
          `'${String(
            checkField,
          )}' 상태를 저장할 수 없습니다. 데이터베이스에 해당 열이 존재하지 않습니다. Supabase 스튜디오에서 'applications' 테이블에 '${String(
            checkField,
          )}' (boolean 타입) 열을 추가해주세요.`,
        );
      } else {
        setError(`'${String(checkField)}' 상태 업데이트 실패: ${error.message}`);
      }
    } else {
      clearMessages();
    }
  };

  const handleSendKakao = async (app: Application) => {
    if (!userContact) {
      setError('담당자 연락처 정보가 없습니다.');
      return;
    }
    if (!app.applicant_phone) {
      setError('신청인 휴대폰 번호가 없습니다.');
      return;
    }

    const message = `<시험·검사 배정 완료>
*현장: ${app.site_name}
*시험·검사 담당자: ${userName}
*연락처: ${userContact}

문의 사항은 이 메시지로 편하게 회신해 주세요. 시험·검사일에 뵙겠습니다.`;

    setKakaoSendingId(app.id);
    clearMessages();

    try {
      await sendKakaoTalkMessage(message, app.applicant_phone);

      const { error: updateError } = await supabase
        .from('applications')
        .update({ p5_check: true })
        .eq('id', app.id);

      if (updateError) throw updateError;

      setApplications((prev) =>
        prev.map((a) => (a.id === app.id ? { ...a, p5_check: true } : a)),
      );
      setSuccessMessage(`'${app.receipt_no}'으로 카카오톡 메시지를 전송했습니다.`);
    } catch (err: any) {
      setError('카카오톡 전송 실패: ' + err.message);
    } finally {
      setKakaoSendingId(null);
    }
  };

  const handleEmailSentSuccess = async (appId: number) => {
    if (!supabase) return;
    const { error } = await supabase
      .from('applications')
      .update({ p7_check: true })
      .eq('id', appId);
    if (error) {
      setError(`P7 체크 업데이트 실패: ${error.message}`);
    } else {
      setApplications((prev) =>
        prev.map((a) => (a.id === appId ? { ...a, p7_check: true } : a)),
      );
      setSuccessMessage('이메일 전송 후 상태가 업데이트되었습니다.');
    }
  };

  const CHECK_COLUMNS: { key: keyof Application; label: string }[] = [
    { key: 'p1_check', label: 'P1' },
    { key: 'p2_check', label: 'P2' },
    { key: 'p3_check', label: 'P3' },
    { key: 'p4_check', label: 'P4' },
    { key: 'p5_check', label: 'P5' },
    { key: 'p6_check', label: 'P6' },
    { key: 'p7_check', label: 'P7' },
  ];

  const editInputClass =
    'w-full bg-white text-slate-900 border-slate-400 rounded-md p-1 text-sm focus:ring-2 focus:ring-sky-500 focus:outline-none';

  if (!supabase) {
    return (
      <div className="pt-4 px-2 space-y-4">
        <p className="text-red-400 text-sm p-2 bg-red-900/30 rounded-md">
          데이터베이스에 연결할 수 없습니다. Supabase 환경 변수(URL, ANON_KEY)가
          올바르게 설정되었는지 확인해주세요.
        </p>
      </div>
    );
  }

  const totalColumns = 7 + CHECK_COLUMNS.length + 1;

  return (
    <div className="pt-4 px-2 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-3">
          {isCameraOpen ? (
            <CameraView onCapture={handleCameraCapture} onClose={handleCloseCamera} />
          ) : (
            <ImageInput
              onImagesSet={handleImagesSet}
              onOpenCamera={handleOpenCamera}
              isLoading={isProcessing}
              selectedImageCount={image ? 1 : 0}
            />
          )}
          {!isCameraOpen && image && (
            <div className="mt-2">
              <p className="text-xs text-sky-400 truncate mb-2">
                선택된 파일: {image.file.name}
              </p>
              <img
                src={`data:${image.mimeType};base64,${image.base64}`}
                alt="신청서 미리보기"
                className="max-h-48 w-auto rounded-md border border-slate-600 object-contain"
              />
            </div>
          )}
        </div>
        <div className="flex flex-col justify-end space-y-3">
          <div className="flex justify-between items-center w-full px-1">
            <span className="text-slate-300 font-semibold text-sm">
              분석 모드: {ocrApiMode === 'gemini' ? '외부 AI' : '내부 AI'}
            </span>
            <button
              type="button"
              onClick={() =>
                setOcrApiMode((prev) => (prev === 'gemini' ? 'vllm' : 'gemini'))
              }
              className="px-3 py-1.5 text-xs font-bold text-white rounded-lg shadow-md transition-colors bg-green-500 hover:bg-green-600"
              disabled={isProcessing}
            >
              {ocrApiMode === 'gemini' ? '→ 내부 AI' : '→ 외부 AI'}
            </button>
          </div>
          <ActionButton
            onClick={handleAnalyzeAndSave}
            fullWidth
            disabled={isProcessing || !image}
            icon={isProcessing ? <Spinner size="sm" /> : undefined}
          >
            {isProcessing ? '처리 중...' : '분석 및 저장'}
          </ActionButton>
        </div>
      </div>

      {error && (
        <p className="text-red-400 text-sm p-2 bg-red-900/30 rounded-md">
          {error}
        </p>
      )}
      {successMessage && (
        <p className="text-green-400 text-sm p-2 bg-green-900/30 rounded-md">
          {successMessage}
        </p>
      )}

      <div className="pt-4 border-t border-slate-700">
        <div className="flex justify_between items-center mb-2">
          <h4 className="text-lg font-semibold text-slate-100">저장된 목록</h4>
          <div className="flex items-center gap-2">
            <ActionButton
              onClick={handleStartAdding}
              disabled={isLoadingApplications || isAddingNew || editingId !== null}
              variant="secondary"
              className="!p-2"
              aria-label="새 항목 추가"
            >
              <PlusIcon className="w-5 h-5" />
            </ActionButton>
            <ActionButton
              onClick={() => loadApplications()}
              disabled={isLoadingApplications || isAddingNew}
              variant="secondary"
              className="!p-2"
              aria-label="목록 새로고침"
            >
              {isLoadingApplications ? <Spinner size="sm" /> : <RefreshIcon />}
            </ActionButton>
          </div>
        </div>
        <div className="max-h-96 overflow-auto bg-slate-800 rounded-lg border border-slate-700">
          <table className="min-w-full divide-y divide-slate-600 text-sm">
            <thead className="bg-slate-700/50 sticky top-0 z-10">
              <tr>
                {['No.', '접수번호', '현장', '대표자', '신청인', '휴대폰', '이메일'].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-xs font-medium text-slate-300 uppercase tracking-wider text-left sticky top-0 bg-slate-700/50 first:text-center"
                    >
                      {h}
                    </th>
                  ),
                )}
                {CHECK_COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    className="px-3 py-2 text-xs font-medium text-slate-300 uppercase tracking-wider text-center sticky top-0 bg-slate-700/50"
                  >
                    {c.label}
                  </th>
                ))}
                <th className="px-3 py-2 text-center text-xs font-medium text-slate-300 uppercase tracking-wider sticky top-0 bg-slate-700/50">
                  관리
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {isAddingNew && (
                <tr className="bg-green-900/30">
                  <td className="p-1">
                    <input
                      name="queue_slot"
                      type="number"
                      value={newApplicationData.queue_slot ?? ''}
                      onChange={handleNewDataChange}
                      className={`w-16 text-center ${editInputClass}`}
                    />
                  </td>
                  <td className="p-1">
                    <input
                      name="receipt_no"
                      value={newApplicationData.receipt_no ?? ''}
                      onChange={handleNewDataChange}
                      className={editInputClass}
                      required
                    />
                  </td>
                  <td className="p-1">
                    <input
                      name="site_name"
                      value={newApplicationData.site_name ?? ''}
                      onChange={handleNewDataChange}
                      className={editInputClass}
                      required
                    />
                  </td>
                  <td className="p-1">
                    <input
                      name="representative_name"
                      value={newApplicationData.representative_name ?? ''}
                      onChange={handleNewDataChange}
                      className={editInputClass}
                    />
                  </td>
                  <td className="p-1">
                    <input
                      name="applicant_name"
                      value={newApplicationData.applicant_name ?? ''}
                      onChange={handleNewDataChange}
                      className={editInputClass}
                    />
                  </td>
                  <td className="p-1">
                    <input
                      name="applicant_phone"
                      value={newApplicationData.applicant_phone ?? ''}
                      onChange={handleNewDataChange}
                      className={editInputClass}
                    />
                  </td>
                  <td className="p-1">
                    <input
                      name="applicant_email"
                      value={newApplicationData.applicant_email ?? ''}
                      onChange={handleNewDataChange}
                      className={editInputClass}
                    />
                  </td>
                  {CHECK_COLUMNS.map((c) => (
                    <td key={c.key} className="p-1 text-center">
                      <input
                        type="checkbox"
                        name={c.key}
                        checked={!!newApplicationData[c.key]}
                        onChange={handleNewDataChange}
                        className="h-4 w-4 rounded"
                      />
                    </td>
                  ))}
                  <td className="p-1 whitespace-nowrap text-center">
                    <button
                      onClick={handleSaveNewApplication}
                      disabled={isProcessing}
                      className="p-1.5 text-green-400 hover:text-white rounded-full transition-colors hover:bg-green-600"
                      aria-label="저장"
                    >
                      <SaveIcon className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleCancelAdding}
                      disabled={isProcessing}
                      className="p-1.5 text-slate-400 hover:text-white rounded-full transition-colors hover:bg-slate-600"
                      aria-label="취소"
                    >
                      <CancelIcon className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              )}
              {isLoadingApplications ? (
                <tr>
                  <td colSpan={totalColumns} className="text-center p-4 text-slate-400">
                    로딩 중...
                  </td>
                </tr>
              ) : applications.length === 0 && !isAddingNew ? (
                <tr>
                  <td colSpan={totalColumns} className="text-center p-4 text-slate-400">
                    저장된 데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                applications.map((app) =>
                  editingId === app.id ? (
                    <tr key={app.id} className="bg-sky-900/30">
                      <td className="p-1">
                        <input
                          name="queue_slot"
                          type="number"
                          value={editedData.queue_slot ?? ''}
                          onChange={handleEditInputChange}
                          className={`w-16 text-center ${editInputClass}`}
                        />
                      </td>
                      <td className="p-1">
                        <input
                          name="receipt_no"
                          value={editedData.receipt_no ?? ''}
                          onChange={handleEditInputChange}
                          className={editInputClass}
                        />
                      </td>
                      <td className="p-1">
                        <input
                          name="site_name"
                          value={editedData.site_name ?? ''}
                          onChange={handleEditInputChange}
                          className={editInputClass}
                        />
                      </td>
                      <td className="p-1">
                        <input
                          name="representative_name"
                          value={editedData.representative_name ?? ''}
                          onChange={handleEditInputChange}
                          className={editInputClass}
                        />
                      </td>
                      <td className="p-1">
                        <input
                          name="applicant_name"
                          value={editedData.applicant_name ?? ''}
                          onChange={handleEditInputChange}
                          className={editInputClass}
                        />
                      </td>
                      <td className="p-1">
                        <input
                          name="applicant_phone"
                          value={editedData.applicant_phone ?? ''}
                          onChange={handleEditInputChange}
                          className={editInputClass}
                        />
                      </td>
                      <td className="p-1">
                        <input
                          name="applicant_email"
                          value={editedData.applicant_email ?? ''}
                          onChange={handleEditInputChange}
                          className={editInputClass}
                        />
                      </td>
                      {CHECK_COLUMNS.map((c) => (
                        <td key={c.key} className="p-1 text-center">
                          <input
                            type="checkbox"
                            name={c.key}
                            checked={!!editedData[c.key]}
                            onChange={(e) =>
                              setEditedData((prev) => ({
                                ...prev,
                                [c.key]: e.target.checked,
                              }))
                            }
                            className="h-4 w-4 rounded"
                          />
                        </td>
                      ))}
                      <td className="p-1 whitespace-nowrap text-center">
                        <button
                          onClick={() => handleSaveEdit(app.id)}
                          className="p-1.5 text-green-400 hover:text-white rounded-full transition-colors hover:bg-green-600"
                          aria-label="저장"
                        >
                          <SaveIcon className="w-4 h-4" />
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          className="p-1.5 text-slate-400 hover:text-white rounded-full transition-colors hover:bg-slate-600"
                          aria-label="취소"
                        >
                          <CancelIcon className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr
                      key={app.id}
                      className="hover:bg-slate-700/30 cursor-pointer"
                      onClick={() => onApplicationSelect(app)}
                    >
                      <td className="px-3 py-2 whitespace-nowrap text-center font-bold text-sky-400">
                        {app.queue_slot}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-200 font-mono">
                        {app.receipt_no}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-300">
                        {app.site_name}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-300">
                        {app.representative_name}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-300">
                        {app.applicant_name}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-300">
                        <div className="flex items-center gap-2">
                          <span>{app.applicant_phone}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSendKakao(app);
                            }}
                            disabled={kakaoSendingId === app.id}
                            className="p-1 text-yellow-400 hover:text-yellow-300 rounded-full transition-colors hover:bg-yellow-600/30 disabled:opacity-50"
                            aria-label={`'${app.applicant_name}'에게 카카오톡 보내기`}
                          >
                            {kakaoSendingId === app.id ? (
                              <Spinner size="sm" />
                            ) : (
                              <SendIcon className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-300">
                        <div className="flex items-center gap-2">
                          <span className="truncate">{app.applicant_email}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEmailModalApp(app);
                            }}
                            className="p-1 text-cyan-400 hover:text-cyan-300 rounded-full transition-colors hover:bg-cyan-600/30 disabled:opacity-50 flex-shrink-0"
                            aria-label={`'${app.applicant_name}'에게 이메일 보내기`}
                          >
                            <EmailIcon className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                      {CHECK_COLUMNS.map((c) => (
                        <td key={c.key} className="px-3 py-2 whitespace-nowrap text-center">
                          <input
                            type="checkbox"
                            checked={!!app[c.key]}
                            onChange={(e) => {
                              e.stopPropagation();
                              handleCheckChange(app.id, c.key, e.target.checked);
                            }}
                            className="h-4 w-4 rounded border-slate-500 bg-slate-700 text-sky-600 focus:ring-sky-500"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                      ))}
                      <td className="px-3 py-2 whitespace-nowrap text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEdit(app);
                          }}
                          className="p-1.5 text-sky-400 hover:text-white rounded-full transition-colors hover:bg-sky-600"
                          aria-label={`'${app.receipt_no}' 수정`}
                        >
                          <EditIcon className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteApplication(app.id);
                          }}
                          className="p-1.5 text-slate-400 hover:text-red-400 rounded-full transition-colors hover:bg-slate-700"
                          aria-label={`'${app.receipt_no}' 삭제`}
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ),
                )
              )}
            </tbody>
          </table>
        </div>
      </div>
      {emailModalApp && (
        <EmailModal
          isOpen={!!emailModalApp}
          onClose={() => setEmailModalApp(null)}
          application={emailModalApp}
          userName={userName}
          onSendSuccess={handleEmailSentSuccess}
        />
      )}
    </div>
  );
};

export default ApplicationOcrSection;
