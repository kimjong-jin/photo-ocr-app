// FieldCountPage.tsx
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { PageContainer } from '../PageContainer';
import { CameraView, PhotoData } from '../CameraView';
import { OcrResultDisplay } from './OcrResultDisplay';
import { OcrControls } from './OcrControls';
import { ActionButton } from '../forms/kakaotalk/ActionButton';
import { FaPlus, FaCheck, FaTimes } from 'react-icons/fa';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';
import { ExtractedEntry } from '../PhotoLogPage';
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from '../../contexts/AuthContext';
import { callSaveTempApi, callLoadTempApi } from '../../services/apiService';
import { callClaydoxApi } from '../../services/claydoxApiService';
import { getOcrResult, getOcrResultWithUserDefinedPatterns, processImagesForStamping } from '../../services/geminiService';
import { autoAssignIdentifiers as autoAssignService } from '../../services/identifierAutomationService';
import { callImageStampingApi } from '../../services/imageStampingService';

type KtlApiCallStatus = 'idle' | 'success' | 'error';

// Helper function to handle reordering logic
const reorderArray = (
  array: ExtractedEntry[],
  sourceIndex: number,
  targetIndex: number
): ExtractedEntry[] => {
  const newArray = [...array];
  const [removed] = newArray.splice(sourceIndex, 1);
  newArray.splice(targetIndex, 0, removed);
  return newArray;
};

// Helper function to reorder multiple rows
const reorderMultipleRows = (
  array: ExtractedEntry[],
  sourceRange: { start: number; end: number },
  targetIndex: number
): ExtractedEntry[] => {
  if (sourceRange.start < 0 || sourceRange.end >= array.length || targetIndex < 0 || targetIndex > array.length || sourceRange.start > sourceRange.end) {
    return array;
  }

  const newArray = [...array];
  const elementsToMove = newArray.splice(sourceRange.start, sourceRange.end - sourceRange.start + 1);

  if (targetIndex > sourceRange.end) {
    targetIndex -= elementsToMove.length;
  }
  
  newArray.splice(targetIndex, 0, ...elementsToMove);

  return newArray;
};

export const FieldCountPage: React.FC = () => {
  const { currentUser } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocrData, setOcrData] = useState<ExtractedEntry[] | null>(null);
  const [photoData, setPhotoData] = useState<PhotoData[]>([]);
  const [contextProvided, setContextProvided] = useState(false);
  const [isDownloadingStamped, setIsDownloadingStamped] = useState(false);
  const [isSendingToClaydox, setIsSendingToClaydox] = useState(false);
  const [ktlApiCallStatus, setKtlApiCallStatus] = useState<KtlApiCallStatus>('idle');
  const [selectedItem, setSelectedItem] = useState("");
  const [receiptNumber, setReceiptNumber] = useState("");
  const [siteName, setSiteName] = useState("");
  const [userName, setUserName] = useState(currentUser?.displayName || "");
  const [isManualEntryMode, setIsManualEntryMode] = useState(false);
  const [rawJsonForCopy, setRawJsonForCopy] = useState<string | null>(null);

  // API URLs
  const OCR_API_URL = import.meta.env.VITE_GEMINI_OCR_API_URL;
  const KTL_API_URL = import.meta.env.VITE_KTL_API_URL;

  const availableIdentifiers = useMemo(() => {
    if (selectedItem === "TU/CL") return ["TU", "Cl"];
    return ["Z1", "Z2", "S1", "S2", "Z3", "Z4", "S3", "S4", "Z5", "S5", "M", "응답시간"];
  }, [selectedItem]);

  const tnIdentifiers = useMemo(() => ["Z1", "Z2", "S1", "S2", "Z3", "Z4", "S3", "S4", "Z5", "S5", "M", "응답시간"], []);
  const tpIdentifiers = useMemo(() => ["응답시간"], []);
  
  const formRef = useRef<HTMLFormElement>(null);
  
  const allInputsFilled = useMemo(() => {
    return selectedItem && receiptNumber && siteName && userName;
  }, [selectedItem, receiptNumber, siteName, userName]);

  useEffect(() => {
    setContextProvided(allInputsFilled);
  }, [allInputsFilled]);

  const processSingleImage = useCallback(async (base64Image: string) => {
    const payload = {
      base64Image,
      item: selectedItem,
      receipt_no: receiptNumber,
    };
    return getOcrResult(payload, OCR_API_URL);
  }, [OCR_API_URL, selectedItem, receiptNumber]);

  const handleExtractText = useCallback(async () => {
    setError(null);
    setOcrData(null);
    setRawJsonForCopy(null);
    setIsLoading(true);

    if (!photoData || photoData.length === 0) {
      setError("분석할 이미지가 없습니다. 이미지를 추가해주세요.");
      setIsLoading(false);
      return;
    }

    try {
      const promises = photoData.map(photo => processSingleImage(photo.dataUrl));
      const results = await Promise.allSettled(promises);
      
      const allOcrData: ExtractedEntry[] = [];
      const rawResponses: any[] = [];
      let hasRejected = false;

      results.forEach(result => {
        if (result.status === 'fulfilled') {
          if (result.value) {
            allOcrData.push(...result.value.data);
            rawResponses.push(result.value.rawResponse);
          }
        } else {
          hasRejected = true;
        }
      });
      
      if (hasRejected) {
        setError("일부 이미지를 처리하지 못했습니다. 다시 시도하거나, 이미지를 확인해주세요.");
      }

      if (allOcrData.length === 0) {
        setError("이미지에서 유효한 데이터를 추출하지 못했습니다. 이미지를 다시 확인해주세요.");
      }
      
      setOcrData(allOcrData);
      setRawJsonForCopy(JSON.stringify(rawResponses, null, 2));

    } catch (err: any) {
      setError("OCR 분석 중 알 수 없는 오류가 발생했습니다: " + err.message);
    } finally {
      setIsLoading(false);
    }
  }, [photoData, processSingleImage]);

  const handleClear = useCallback(() => {
    setOcrData(null);
    setPhotoData([]);
    setError(null);
    setRawJsonForCopy(null);
    setKtlApiCallStatus('idle');
  }, []);

  const handleAddEntry = useCallback(() => {
    setOcrData(prev => {
      const newEntry: ExtractedEntry = {
        id: uuidv4(),
        time: '',
        value: '',
        valueTP: '',
        identifier: '',
        identifierTP: '',
        isManual: true,
      };
      if (!prev) return [newEntry];
      return [...prev, newEntry];
    });
  }, []);

  const handleAutoAssignIdentifiers = useCallback(() => {
    if (ocrData) {
      const updatedData = autoAssignService(ocrData, {
        receiptNumber,
        selectedItem
      });
      setOcrData(updatedData);
    }
  }, [ocrData, receiptNumber, selectedItem]);

  const handleReorderRows = useCallback((sourceRowStr: string, targetRowStr?: string) => {
    if (!ocrData) return;

    try {
      const sourceRows = sourceRowStr.includes('-') ?
        sourceRowStr.split('-').map(s => parseInt(s.trim(), 10) - 1) :
        [parseInt(sourceRowStr.trim(), 10) - 1];

      const targetRow = targetRowStr ? parseInt(targetRowStr.trim(), 10) - 1 : ocrData.length;

      if (sourceRows.some(index => isNaN(index) || index < 0 || index >= ocrData.length) || isNaN(targetRow) || targetRow < 0 || targetRow > ocrData.length) {
        throw new Error("유효하지 않은 행 번호입니다. 올바른 숫자를 입력해주세요.");
      }

      let updatedOcrData: ExtractedEntry[] = [];
      if (sourceRows.length > 1) {
        const sourceRange = { start: Math.min(...sourceRows), end: Math.max(...sourceRows) };
        updatedOcrData = reorderMultipleRows(ocrData, sourceRange, targetRow);
      } else {
        updatedOcrData = reorderArray(ocrData, sourceRows[0], targetRow);
      }
      
      setOcrData(updatedOcrData);

    } catch (err: any) {
      alert(`행 순서 변경 실패: ${err.message}`);
    }
  }, [ocrData]);


  const handleEntryIdentifierChange = useCallback((id: string, newIdentifier: string | undefined) => {
    setOcrData(prev => prev ? prev.map(entry => entry.id === id ? { ...entry, identifier: newIdentifier || '' } : entry) : null);
  }, []);

  const handleEntryIdentifierTPChange = useCallback((id: string, newIdentifier: string | undefined) => {
    setOcrData(prev => prev ? prev.map(entry => entry.id === id ? { ...entry, identifierTP: newIdentifier || '' } : entry) : null);
  }, []);

  const handleEntryTimeChange = useCallback((id: string, newTime: string) => {
    setOcrData(prev => prev ? prev.map(entry => entry.id === id ? { ...entry, time: newTime } : entry) : null);
  }, []);

  const handleEntryPrimaryValueChange = useCallback((id: string, newValue: string) => {
    setOcrData(prev => prev ? prev.map(entry => entry.id === id ? { ...entry, value: newValue } : entry) : null);
  }, []);

  const handleEntryValueTPChange = useCallback((id: string, newValue: string) => {
    setOcrData(prev => prev ? prev.map(entry => entry.id === id ? { ...entry, valueTP: newValue } : entry) : null);
  }, []);

  const onDownloadStampedImages = useCallback(async () => {
    if (!photoData || photoData.length === 0 || !ocrData) return;

    setIsDownloadingStamped(true);
    setError(null);

    try {
      const stampedImagePayloads = processImagesForStamping(photoData, ocrData, {
        receiptNumber,
        siteName,
        userName,
        selectedItem
      });
      
      const zip = new JSZip();
      
      for (const payload of stampedImagePayloads) {
        const stampedImageBase64 = await callImageStampingApi(payload);
        const blob = await fetch(`data:image/jpeg;base64,${stampedImageBase64}`).then(res => res.blob());
        const filename = `${payload.receipt_no}_${payload.item}_${payload.image_id}.jpg`;
        zip.file(filename, blob);
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      saveAs(zipBlob, `${receiptNumber}_${siteName}_스탬프_이미지.zip`);
    } catch (err: any) {
      setError("스탬프 이미지 다운로드 중 오류가 발생했습니다: " + err.message);
      console.error(err);
    } finally {
      setIsDownloadingStamped(false);
    }
  }, [photoData, ocrData, receiptNumber, siteName, userName, selectedItem]);

  const onInitiateSendToKtl = useCallback(async () => {
    if (!ocrData || ocrData.length === 0) {
      alert("KTL로 전송할 데이터가 없습니다.");
      return;
    }

    if (!isManualEntryMode && (!photoData || photoData.length === 0)) {
      alert("이미지가 첨부되지 않았습니다.");
      return;
    }

    setIsSendingToClaydox(true);
    setKtlApiCallStatus('idle');

    try {
      await callClaydoxApi({
        receipt_no: receiptNumber,
        site_name: siteName,
        user_name: userName,
        ocrData: ocrData,
        photoData: photoData,
        selectedItem: selectedItem,
      });
      setKtlApiCallStatus('success');
      alert('데이터가 KTL로 성공적으로 전송되었습니다.');
    } catch (error: any) {
      console.error("KTL 전송 실패:", error);
      setKtlApiCallStatus('error');
      alert(`KTL 전송 실패: ${error.message}`);
    } finally {
      setIsSendingToClaydox(false);
    }
  }, [ocrData, photoData, receiptNumber, siteName, userName, selectedItem, isManualEntryMode]);

  const draftJsonToPreview = useMemo(() => {
    if (!ocrData) return null;
    const dataForSave = {
      receipt_no: receiptNumber,
      site: siteName,
      item: [selectedItem],
      user_name: userName,
      values: ocrData.reduce((acc, entry) => {
        if (entry.identifier || entry.identifierTP) {
          if (entry.identifier && entry.value !== undefined) {
            acc[entry.identifier] = { val: entry.value, time: entry.time || "" };
          }
          if (entry.identifierTP && entry.valueTP !== undefined) {
            acc[entry.identifierTP] = { val: entry.valueTP, time: entry.time || "" };
          }
        }
        return acc;
      }, {} as Record<string, { val: string; time: string }>),
    };
    return JSON.stringify(dataForSave, null, 2);
  }, [ocrData, receiptNumber, siteName, selectedItem, userName]);

  const ktlJsonToPreview = useMemo(() => {
    if (!ocrData) return null;
    const payload = {
      receipt_no: receiptNumber,
      site_name: siteName,
      user_name: userName,
      items: ocrData.map((entry, index) => ({
        id: entry.id,
        primary: {
          value: entry.value,
          identifier: entry.identifier,
        },
        secondary: {
          value: entry.valueTP,
          identifier: entry.identifierTP,
        },
        time: entry.time
      }))
    };
    return JSON.stringify(payload, null, 2);
  }, [ocrData, receiptNumber, siteName, userName]);


  const onSaveTemp = useCallback(async () => {
    if (!ocrData || !draftJsonToPreview) {
      alert("저장할 데이터가 없습니다.");
      return;
    }
    if (!receiptNumber) {
      alert("저장을 위해 접수번호를 입력해주세요.");
      return;
    }
    try {
      const payload = JSON.parse(draftJsonToPreview);
      await callSaveTempApi(payload);
      alert("임시 저장 완료!");
    } catch (err: any) {
      alert(`임시 저장 실패: ${err.message}`);
    }
  }, [ocrData, draftJsonToPreview, receiptNumber]);

  const onLoadTemp = useCallback(async () => {
    if (!receiptNumber) {
      alert("데이터를 불러오려면 접수번호를 입력해주세요.");
      return;
    }
    setIsLoading(true);
    try {
      const loadedData = await callLoadTempApi(receiptNumber);
      console.log("불러온 데이터:", loadedData);
      
      // 기존 데이터 초기화 (필요하다면)
      setOcrData([]);
      setPhotoData([]);
      
      // 불러온 데이터를 OcrResultDisplay 형식에 맞게 변환
      const transformedData: ExtractedEntry[] = Object.entries(loadedData.values).flatMap(([identifier, entries]) => {
        // TU, Cl 값 처리
        if (identifier === 'TU' || identifier === 'Cl') {
          return Object.entries(entries).map(([key, value]) => ({
            id: key,
            time: value.time,
            value: value.val,
            valueTP: '',
            identifier: identifier,
            identifierTP: '',
            isManual: true, // 임시 저장된 데이터는 수동 입력으로 간주
          }));
        }
        // TN/TP 값 처리 (복수 식별자를 하나의 행으로 합치는 로직)
        else if (identifier.startsWith('TN')) {
          // 'TN/TP' 모드인 경우
          const tnValue = entries.tn_value?.val || '';
          const tnTime = entries.tn_value?.time || '';
          const tpValue = entries.tp_value?.val || '';
          const tpTime = entries.tp_value?.time || ''; // TP의 시간도 가져올 수 있다면
          return [{
            id: uuidv4(), // 새로운 ID 생성
            time: tnTime, // TN의 시간을 사용하거나 병합
            value: tnValue,
            valueTP: tpValue,
            identifier: entries.tn_value?.identifier || identifier, // TN 식별자
            identifierTP: entries.tp_value?.identifier || '', // TP 식별자
            isManual: true,
          }];
        }
        // 일반 필드
        else {
          return Object.entries(entries).map(([key, value]) => ({
            id: key,
            time: value.time,
            value: value.val,
            valueTP: '',
            identifier: identifier,
            identifierTP: '',
            isManual: true,
          }));
        }
      });
      
      setOcrData(transformedData);
      alert("데이터 로딩 성공!");
    } catch (err: any) {
      setError(err.message || "데이터 로딩 중 알 수 없는 오류가 발생했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [receiptNumber]);

  const handleToggleManualMode = useCallback(() => {
    setIsManualEntryMode(prev => !prev);
    if (!isManualEntryMode) {
      setOcrData(null);
    }
  }, [isManualEntryMode]);

  const handleSetPhotoData = useCallback((data: PhotoData[]) => {
    setPhotoData(data);
    setOcrData(null);
    setError(null);
    setRawJsonForCopy(null);
    setKtlApiCallStatus('idle');
  }, []);

  return (
    <PageContainer>
      <div className="p-4 sm:p-6 lg:p-8 space-y-8 bg-slate-900 text-slate-200 min-h-screen">
        <div className="bg-slate-800 rounded-xl shadow-lg p-5 space-y-4">
          <h2 className="text-2xl font-bold text-sky-400">현장 계수 분석</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="relative">
              <label htmlFor="receipt-number" className="block text-sm font-medium text-slate-400">접수번호</label>
              <input
                type="text"
                id="receipt-number"
                value={receiptNumber}
                onChange={(e) => setReceiptNumber(e.target.value)}
                className="mt-1 block w-full bg-slate-700 border-slate-600 rounded-md shadow-sm py-2 px-3 text-sm placeholder-slate-400 focus:ring-sky-500 focus:border-sky-500"
                placeholder="예: 24-001"
              />
            </div>
            <div>
              <label htmlFor="site-name" className="block text-sm font-medium text-slate-400">현장명</label>
              <input
                type="text"
                id="site-name"
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                className="mt-1 block w-full bg-slate-700 border-slate-600 rounded-md shadow-sm py-2 px-3 text-sm placeholder-slate-400 focus:ring-sky-500 focus:border-sky-500"
                placeholder="예: 부산1동"
              />
            </div>
            <div>
              <label htmlFor="user-name" className="block text-sm font-medium text-slate-400">분석자</label>
              <input
                type="text"
                id="user-name"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                className="mt-1 block w-full bg-slate-700 border-slate-600 rounded-md shadow-sm py-2 px-3 text-sm placeholder-slate-400 focus:ring-sky-500 focus:border-sky-500"
                placeholder="홍길동"
              />
            </div>
            <div>
              <label htmlFor="item-select" className="block text-sm font-medium text-slate-400">항목</label>
              <select
                id="item-select"
                value={selectedItem}
                onChange={(e) => setSelectedItem(e.target.value)}
                className="mt-1 block w-full bg-slate-700 border-slate-600 rounded-md shadow-sm py-2 px-3 text-sm text-slate-200 focus:ring-sky-500 focus:border-sky-500"
              >
                <option value="">선택하세요</option>
                <option value="TN/TP">TN/TP</option>
                <option value="TU/CL">탁도/잔류염소</option>
              </select>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 mt-4">
            <ActionButton
              onClick={onSaveTemp}
              variant="secondary"
              icon={<FaCheck />}
              disabled={!draftJsonToPreview || isLoading}
            >
              임시 저장
            </ActionButton>
            <ActionButton
              onClick={onLoadTemp}
              variant="secondary"
              icon={<FaTimes />}
              disabled={!receiptNumber || isLoading}
            >
              임시 불러오기
            </ActionButton>
          </div>
        </div>

        {!isManualEntryMode ? (
          <CameraView
            onCapture={setPhotoData}
            photoData={photoData}
            contextProvided={contextProvided}
          />
        ) : (
          <div className="mt-6 p-6 bg-slate-700/50 rounded-lg shadow text-center">
            <p className="text-slate-400">수동 입력 모드입니다.</p>
          </div>
        )}
        <OcrControls
          onExtract={handleExtractText}
          onClear={handleClear}
          isExtractDisabled={!contextProvided || photoData.length === 0 || isLoading}
          isClearDisabled={!photoData.length && !ocrData}
          onDownloadStampedImages={onDownloadStampedImages}
          isDownloadStampedDisabled={!contextProvided || photoData.length === 0 || !ocrData || isLoading || isDownloadingStamped}
          isDownloadingStamped={isDownloadingStamped}
          onInitiateSendToKtl={onInitiateSendToKtl}
          isClaydoxDisabled={!contextProvided || !ocrData || isLoading || isSendingToClaydox}
          isSendingToClaydox={isSendingToClaydox}
          ktlApiCallStatus={ktlApiCallStatus}
          onAutoAssignIdentifiers={handleAutoAssignIdentifiers}
          isAutoAssignDisabled={!ocrData || isLoading}
        />
        <OcrResultDisplay
          ocrData={ocrData}
          error={error}
          isLoading={isLoading}
          contextProvided={contextProvided}
          hasImage={photoData.length > 0}
          selectedItem={selectedItem}
          onEntryIdentifierChange={handleEntryIdentifierChange}
          onEntryIdentifierTPChange={handleEntryIdentifierTPChange}
          onEntryTimeChange={handleEntryTimeChange}
          onEntryPrimaryValueChange={handleEntryPrimaryValueChange}
          onEntryValueTPChange={handleEntryValueTPChange}
          onAddEntry={handleAddEntry}
          onReorderRows={handleReorderRows}
          availableIdentifiers={availableIdentifiers}
          tnIdentifiers={tnIdentifiers}
          tpIdentifiers={tpIdentifiers}
          rawJsonForCopy={rawJsonForCopy}
          draftJsonToPreview={draftJsonToPreview}
          ktlJsonToPreview={ktlJsonToPreview}
          isManualEntryMode={isManualEntryMode}
        />
      </div>
    </PageContainer>
  );
};
