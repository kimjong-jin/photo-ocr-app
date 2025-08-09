import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Header } from './components/Header';
import { ImageInput, ImageInfo } from './components/ImageInput';
import { CameraView } from './components/CameraView';
import { ImagePreview } from './components/ImagePreview';
import { OcrControls } from './components/OcrControls';
import { OcrResultDisplay } from './components/OcrResultDisplay';
import AnalysisContextForm from './components/AdditionalInfoInput';
import { extractTextFromImage } from './services/geminiService';
import { generateStampedImage, dataURLtoBlob, generateCompositeImage } from './services/imageStampingService';
import { sendToClaydoxApi, ClaydoxPayload, generateKtlJsonForPreview } from './services/claydoxApiService';
import { ANALYSIS_ITEM_GROUPS } from './shared/constants';
import JSZip from 'jszip';
import KtlPreflightModal, { KtlPreflightData } from './components/KtlPreflightModal';
import { ThumbnailGallery } from './components/ThumbnailGallery';
import { Type } from '@google/genai';

export interface ExtractedEntry {
  id: string;
  time: string;
  value: string; // Primary value or TN value
  valueTP?: string; // TP value
  identifier?: string; // Primary identifier or TN identifier
  identifierTP?: string; // TP identifier
}

type KtlApiCallStatus = 'idle' | 'success' | 'error';

interface RawEntrySingle {
  time: string;
  value: string;
}
interface RawEntryTnTp {
  time: string;
  value_tn?: string;
  value_tp?: string;
}
type RawEntryUnion = RawEntrySingle | RawEntryTnTp;

const sanitizeFilenameComponent = (component: string): string => {
  if (!component) return '';
  return component.replace(/[/\\[\]:*?"<>|]/g, '_').replace(/__+/g, '_');
};

const getFileExtension = (fileName: string, mimeType: string): string => {
  let ext = 'png';
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex > 0 && dotIndex < fileName.length - 1) {
    const potentialExt = fileName.substring(dotIndex + 1);
    if (potentialExt.length > 0 && potentialExt.length <= 5 && /^[a-zA-Z0-9]+$/.test(potentialExt)) {
      ext = potentialExt;
    } else if (mimeType === 'image/jpeg') {
      ext = 'jpg';
    }
  } else if (mimeType === 'image/jpeg') {
    ext = 'jpg';
  }
  return ext.toLowerCase();
};

const generateIdentifierSequence = (ocrData: ExtractedEntry[] | null): string => {
  if (!ocrData) return '';
  let sequence = '';
  const excludedBases = ['현장'];

  const processSingleIdentifier = (idVal: string | undefined): string | null => {
    if (!idVal) return null;
    let base = idVal.replace(/[0-9]/g, '');
    if (base.endsWith('P')) base = base.slice(0, -1);
    if (excludedBases.includes(base)) return null;
    return base.length > 0 ? base : null;
  };

  for (const entry of ocrData) {
    const part = processSingleIdentifier(entry.identifier);
    if (part) sequence += part;
    const tpPart = processSingleIdentifier(entry.identifierTP);
    if (tpPart) sequence += tpPart;
  }
  return sequence;
};

const generatePromptForFieldCount = (
  receiptNum: string,
  siteLoc: string,
  item: string
): string => {
  let prompt = `제공된 측정 장비의 이미지를 분석해주세요.
컨텍스트:
- 접수번호: ${receiptNum}
- 현장/위치: ${siteLoc}
- 항목/파라미터: ${item || '현장 계수 값'}`;

  if (item === 'TN/TP') {
    prompt += `\n- 이미지에서 TN 및 TP 각각의 시간 및 값 쌍을 추출해주세요. "value_tn"과 "value_tp" 필드를 사용하세요.\n\nJSON 출력 형식 예시 (TN/TP):
[
  { "time": "2025/07/10 10:00", "value_tn": "15.3", "value_tp": "1.2" },
  { "time": "2025/07/10 11:00", "value_tn": "12.1", "value_tp": "0.9" }
]`;
  } else {
    prompt += `\n\nJSON 출력 형식 예시 (${item}):
[
  { "time": "2025/07/10 10:00", "value": "15.3" },
  { "time": "2025/07/10 11:00", "value": "12.1" }
]`;
  }

  prompt += `

중요 지침:
1. 응답은 반드시 유효한 단일 JSON 배열이어야 합니다. 배열 외부에는 어떤 텍스트도 포함하지 마세요.
2. 값 필드("value", "value_tn", "value_tp")에는 순수한 숫자 값만 포함해주세요. 단위나 텍스트 주석은 제외합니다.
3. 이미지에서 관련 데이터를 찾을 수 없으면 빈 배열([])을 반환하세요.
`;
  return prompt;
};

interface FieldCountPageProps {
  userName: string;
}

const FieldCountPage: React.FC<FieldCountPageProps> = ({ userName }) => {
  const [selectedImages, setSelectedImages] = useState<ImageInfo[]>([]);
  const [currentImageIndex, setCurrentImageIndex] = useState<number>(-1);
  const [processedOcrData, setProcessedOcrData] = useState<ExtractedEntry[] | null>(null);
  const [aggregatedOcrTextForDisplay, setAggregatedOcrTextForDisplay] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isDownloadingStamped, setIsDownloadingStamped] = useState<boolean>(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState<boolean>(false);
  const [receiptNumber, setReceiptNumber] = useState<string>('');
  const [siteLocation, setSiteLocation] = useState<string>('');
  const [selectedItem, setSelectedItem] = useState<string>('');
  const [areContextFieldsValid, setAreContextFieldsValid] = useState<boolean>(false);
  const [isSendingToClaydox, setIsSendingToClaydox] = useState<boolean>(false);
  const [ktlApiCallStatus, setKtlApiCallStatus] = useState<KtlApiCallStatus>('idle');
  const [isKtlPreflightModalOpen, setIsKtlPreflightModalOpen] = useState<boolean>(false);
  const [ktlPreflightData, setKtlPreflightData] = useState<KtlPreflightData | null>(null);

  const waterQualityItemOptions = useMemo(
    () => ANALYSIS_ITEM_GROUPS.find(g => g.label === '수질')?.items || [],
    []
  );

  const hypotheticalKtlFileNamesForPreview = useMemo(() => {
    if (!selectedImages || selectedImages.length === 0 || !receiptNumber || !selectedItem) return [];
    const sanitizedItemName = sanitizeFilenameComponent(selectedItem.replace('/', '_'));
    const baseName = `${receiptNumber}_수질_${sanitizedItemName}_현장적용계수`;
    return [`${baseName}.jpg`, `${baseName}.zip`];
  }, [selectedImages.length, receiptNumber, selectedItem]);

  const ktlJsonPreview = useMemo(() => {
    if (!areContextFieldsValid || !processedOcrData || !userName) return null;
    const allUniquePrimaryIdentifiersFromOCR = Array.from(
      new Set(processedOcrData.flatMap(e => [e.identifier, e.identifierTP]).filter(Boolean) as string[])
    );
    const identifierSequence = generateIdentifierSequence(processedOcrData);

    const payload: ClaydoxPayload = {
      receiptNumber,
      siteLocation,
      item: selectedItem,
      ocrData: processedOcrData,
      updateUser: userName,
      uniqueIdentifiersForNaming: allUniquePrimaryIdentifiersFromOCR,
      identifierSequence: identifierSequence,
      pageType: 'FieldCount'
    };
    return generateKtlJsonForPreview(payload, selectedItem, hypotheticalKtlFileNamesForPreview);
  }, [
    receiptNumber,
    siteLocation,
    selectedItem,
    processedOcrData,
    areContextFieldsValid,
    userName,
    hypotheticalKtlFileNamesForPreview
  ]);

  useEffect(() => {
    setAreContextFieldsValid(
      receiptNumber.trim() !== '' && siteLocation.trim() !== '' && selectedItem.trim() !== ''
    );
  }, [receiptNumber, siteLocation, selectedItem]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetImageState = useCallback(() => {
    setSelectedImages([]);
    setCurrentImageIndex(-1);
    setProcessedOcrData(null);
    setAggregatedOcrTextForDisplay(null);
    setProcessingError(null);
    setIsCameraOpen(false);
    setKtlApiCallStatus('idle');
    setIsKtlPreflightModalOpen(false);
    setKtlPreflightData(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleImagesSet = useCallback(
    (newlySelectedImages: ImageInfo[]) => {
      if (newlySelectedImages.length === 0 && selectedImages.length > 0) return;
      setProcessedOcrData(null);
      setAggregatedOcrTextForDisplay(null);
      setProcessingError(null);
      setKtlApiCallStatus('idle');

      if (selectedImages.length === 0) {
        setSelectedImages(newlySelectedImages);
        setCurrentImageIndex(newlySelectedImages.length > 0 ? 0 : -1);
      } else {
        setSelectedImages(prevImages => {
          const combined = [...prevImages, ...newlySelectedImages];
          const uniqueImageMap = new Map<string, ImageInfo>();
          combined.forEach(img => {
            const key = `${img.file.name}-${img.file.size}-${img.file.lastModified}`;
            if (!uniqueImageMap.has(key)) {
              uniqueImageMap.set(key, img);
            }
          });
          return Array.from(uniqueImageMap.values());
        });
      }
    },
    [selectedImages.length]
  );

  const handleOpenCamera = useCallback(() => {
    setIsCameraOpen(true);
    setProcessingError(null);
  }, []);

  const handleCameraCapture = useCallback(
    (file: File, b64: string, captureMimeType: string) => {
      const capturedImageInfo: ImageInfo = { file, base64: b64, mimeType: captureMimeType };
      setProcessedOcrData(null);
      setAggregatedOcrTextForDisplay(null);
      setProcessingError(null);
      setKtlApiCallStatus('idle');

      let newIndex;
      if (selectedImages.length === 0) {
        setSelectedImages([capturedImageInfo]);
        newIndex = 0;
      } else {
        newIndex = selectedImages.length;
        setSelectedImages(prev => [...prev, capturedImageInfo]);
      }

      setCurrentImageIndex(newIndex);
      setIsCameraOpen(false);
    },
    [selectedImages.length]
  );

  const handleCloseCamera = useCallback(() => setIsCameraOpen(false), []);

  const handleDeleteImage = useCallback(
    (indexToDelete: number) => {
      if (indexToDelete < 0 || indexToDelete >= selectedImages.length) return;
      setProcessedOcrData(null);
      setAggregatedOcrTextForDisplay(null);
      setProcessingError(null);
      setKtlApiCallStatus('idle');
      const newImages = selectedImages.filter((_, index) => index !== indexToDelete);
      setSelectedImages(newImages);

      if (newImages.length === 0) {
        setCurrentImageIndex(-1);
      } else if (currentImageIndex >= newImages.length) {
        setCurrentImageIndex(newImages.length - 1);
      } else if (currentImageIndex > indexToDelete) {
        setCurrentImageIndex(prev => prev - 1);
      }
    },
    [currentImageIndex, selectedImages]
  );

  const handleExtractText = useCallback(async () => {
    if (selectedImages.length === 0 || !areContextFieldsValid) {
      setProcessingError(
        selectedImages.length === 0 ? '먼저 이미지를 선택해주세요.' : '모든 필수 항목(접수번호, 현장, 항목)을 입력해주세요.'
      );
      return;
    }
    setIsLoading(true);
    setProcessingError(null);
    setProcessedOcrData(null);
    setAggregatedOcrTextForDisplay(null);
    setKtlApiCallStatus('idle');

    try {
      // ✅ Vite 환경변수 체크 (process.env → import.meta.env)
      if (!import.meta.env.VITE_API_KEY) throw new Error('VITE_API_KEY 환경 변수가 설정되지 않았습니다.');

      let responseSchema;
      if (selectedItem === 'TN/TP') {
        responseSchema = {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              time: { type: Type.STRING, description: '측정 시간 (YYYY/MM/DD HH:MM)' },
              value_tn: { type: Type.STRING, description: 'TN 값 (숫자만)' },
              value_tp: { type: Type.STRING, description: 'TP 값 (숫자만)' }
            },
            required: ['time']
          }
        };
      } else {
        responseSchema = {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              time: { type: Type.STRING, description: '측정 시간 (YYYY/MM/DD HH:MM)' },
              value: { type: Type.STRING, description: '측정 값 (숫자만)' }
            },
            required: ['time', 'value']
          }
        };
      }

      const imageProcessingPromises = selectedImages.map(async image => {
        let jsonStr = '';
        try {
          const prompt = generatePromptForFieldCount(receiptNumber, siteLocation, selectedItem);
          const config = {
            responseMimeType: 'application/json',
            responseSchema: responseSchema
          };
          jsonStr = await extractTextFromImage(image.base64, image.mimeType, prompt, config);
          return JSON.parse(jsonStr) as RawEntryUnion[];
        } catch (imgErr: any) {
          let reasonMessage = imgErr.message || `Failed to process image ${image.file.name}`;
          if (imgErr instanceof SyntaxError) {
            reasonMessage = `Failed to parse JSON for image ${image.file.name}: ${imgErr.message}. AI response: ${jsonStr}`;
          }
          return Promise.reject(new Error(reasonMessage));
        }
      });

      const results = await Promise.allSettled(imageProcessingPromises);
      const allRawEntries: RawEntryUnion[] = results
        .filter(res => res.status === 'fulfilled' && Array.isArray(res.value))
        .flatMap(res => (res as PromiseFulfilledResult<RawEntryUnion[]>).value);

      const uniqueEntriesMap = new Map<string, RawEntryUnion>();
      allRawEntries.forEach(entry => uniqueEntriesMap.set(entry.time, entry));

      const finalOcrData = Array.from(uniqueEntriesMap.values())
        .sort((a, b) => a.time.localeCompare(b.time))
        .map(rawEntry => {
          let primaryValue = '';
          let tpValue: string | undefined = undefined;

          if (selectedItem === 'TN/TP') {
            const tnTpEntry = rawEntry as RawEntryTnTp;
            primaryValue = tnTpEntry.value_tn || '';
            tpValue = tnTpEntry.value_tp;
          } else {
            const singleValueEntry = rawEntry as RawEntrySingle;
            primaryValue = singleValueEntry.value || '';
          }

          return {
            id: self.crypto.randomUUID(),
            time: rawEntry.time,
            value: primaryValue,
            valueTP: tpValue,
            identifier: undefined,
            identifierTP: undefined
          };
        });

      setProcessedOcrData(finalOcrData);
      setAggregatedOcrTextForDisplay(JSON.stringify(finalOcrData, null, 2));

      if (results.some(res => res.status === 'rejected')) {
        setProcessingError('일부 이미지를 처리하지 못했습니다.');
      }
    } catch (e: any) {
      setProcessingError(e.message || '데이터 추출 중 오류가 발생했습니다.');
      setProcessedOcrData([]);
    } finally {
      setIsLoading(false);
    }
  }, [selectedImages, areContextFieldsValid, receiptNumber, siteLocation, selectedItem]);

  const updateAggregatedDisplayFromProcessedData = useCallback(
    (data: ExtractedEntry[] | null) => {
      if (data) {
        const previewData = data.map(e => {
          if (selectedItem === 'TN/TP') {
            return { time: e.time, value_tn: e.value, value_tp: e.valueTP };
          }
          return { time: e.time, value: e.value };
        });
        setAggregatedOcrTextForDisplay(JSON.stringify(previewData, null, 2));
      } else {
        setAggregatedOcrTextForDisplay(null);
      }
    },
    [selectedItem]
  );

  const handleEntryChange = (id: string, field: keyof ExtractedEntry, value: string | undefined) => {
    setProcessedOcrData(prevData => {
      if (!prevData) return null;
      const updatedData = prevData.map(entry => (entry.id === id ? { ...entry, [field]: value } : entry));
      updateAggregatedDisplayFromProcessedData(updatedData);
      setKtlApiCallStatus('idle');
      return updatedData;
    });
  };

  const handleAddEntry = useCallback(() => {
    setProcessedOcrData(prev => {
      const newEntry: ExtractedEntry = {
        id: self.crypto.randomUUID(),
        time: '',
        value: '',
        valueTP: selectedItem === 'TN/TP' ? '' : undefined,
        identifier: undefined,
        identifierTP: undefined
      };
      const updated = prev ? [...prev, newEntry] : [newEntry];
      updateAggregatedDisplayFromProcessedData(updated);
      setKtlApiCallStatus('idle');
      return updated;
    });
  }, [selectedItem, updateAggregatedDisplayFromProcessedData]);

  const handleReorderRows = useCallback((sourceStr: string, targetStr?: string) => {
    alert('행 순서 변경 기능은 현재 이 페이지에서 지원되지 않습니다.');
  }, []);

  const handleDownloadStampedImages = useCallback(async () => {
    alert('스탬프 이미지 다운로드 기능은 현재 이 페이지에서 지원되지 않습니다.');
  }, []);

  const handleInitiateSendToKtl = useCallback(() => {
    if (
      userName === '게스트' ||
      !processedOcrData ||
      processedOcrData.length === 0 ||
      selectedImages.length === 0 ||
      !areContextFieldsValid ||
      !ktlJsonPreview
    ) {
      alert('KTL 전송을 위한 모든 조건(로그인, 데이터, 사진, 필수정보)이 충족되지 않았습니다.');
      return;
    }
    setKtlPreflightData({
      jsonPayload: ktlJsonPreview,
      fileNames: hypotheticalKtlFileNamesForPreview,
      context: { receiptNumber, siteLocation, selectedItem, userName }
    });
    setIsKtlPreflightModalOpen(true);
  }, [
    processedOcrData,
    selectedImages,
    areContextFieldsValid,
    userName,
    ktlJsonPreview,
    hypotheticalKtlFileNamesForPreview,
    receiptNumber,
    siteLocation,
    selectedItem
  ]);

  const handleSendToClaydoxConfirmed = useCallback(async () => {
    setIsKtlPreflightModalOpen(false);
    if (!processedOcrData || !areContextFieldsValid || !userName || selectedImages.length === 0) {
      setProcessingError('KTL 전송을 위한 필수 데이터가 누락되었습니다.');
      setKtlApiCallStatus('error');
      return;
    }
    setIsSendingToClaydox(true);
    setProcessingError(null);
    setKtlApiCallStatus('idle');

    try {
      const payload: ClaydoxPayload = {
        receiptNumber,
        siteLocation,
        item: selectedItem,
        updateUser: userName,
        ocrData: processedOcrData,
        uniqueIdentifiersForNaming: Array.from(
          new Set(processedOcrData.flatMap(e => [e.identifier, e.identifierTP]).filter(Boolean) as string[])
        ),
        identifierSequence: generateIdentifierSequence(processedOcrData),
        pageType: 'FieldCount'
      };
      const imageInfosForComposite = selectedImages.map(img => ({ base64: img.base64, mimeType: img.mimeType }));
      const baseName = `${receiptNumber}_수질_${sanitizeFilenameComponent(selectedItem.replace('/', '_'))}_현장적용계수`;

      const compositeDataUrl = await generateCompositeImage(
        imageInfosForComposite,
        { receiptNumber, siteLocation, item: selectedItem },
        'image/jpeg'
      );
      const compositeBlob = dataURLtoBlob(compositeDataUrl);
      const compositeKtlFileName = `${baseName}.jpg`;
      const compositeFile = new File([compositeBlob], compositeKtlFileName, { type: 'image/jpeg' });

      const filesToUpload: File[] = [compositeFile];
      const actualKtlFileNames: string[] = [compositeKtlFileName];

      const zip = new JSZip();
      for (let i = 0; i < selectedImages.length; i++) {
        const imageInfo = selectedImages[i];
        const stampedDataUrl = await generateStampedImage(
          imageInfo.base64,
          imageInfo.mimeType,
          receiptNumber,
          siteLocation,
          '',
          selectedItem
        );
        const stampedBlob = dataURLtoBlob(stampedDataUrl);
        const extension = getFileExtension(imageInfo.file.name, imageInfo.mimeType);
        const fileNameInZip = `${baseName}_${i + 1}.${extension}`;
        zip.file(fileNameInZip, stampedBlob);
      }

      if (Object.keys(zip.files).length > 0) {
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const zipKtlFileName = `${baseName}.zip`;
        const zipFile = new File([zipBlob], zipKtlFileName, { type: 'application/zip' });
        filesToUpload.push(zipFile);
        actualKtlFileNames.push(zipKtlFileName);
      }

      const response = await sendToClaydoxApi(payload, filesToUpload, selectedItem, actualKtlFileNames);
      alert(`KTL API 응답: ${response.message || JSON.stringify(response)}`);
      setKtlApiCallStatus('success');
    } catch (error: any) {
      setProcessingError(`KTL 전송 실패: ${error.message}`);
      setKtlApiCallStatus('error');
    } finally {
      setIsSendingToClaydox(false);
    }
  }, [
    processedOcrData,
    receiptNumber,
    siteLocation,
    selectedItem,
    areContextFieldsValid,
    selectedImages,
    userName
  ]);

  const handleClear = useCallback(() => resetImageState(), [resetImageState]);

  const fieldCountIdentifiers = useMemo(() => {
    const tn = ['현장1', '현장2'];
    const tp = ['현장1P', '현장2P'];
    return { tn, tp };
  }, []);

  const availableIdentifiersForSingleMode = useMemo(() => {
    if (selectedItem === 'TP') {
      return fieldCountIdentifiers.tp;
    }
    return fieldCountIdentifiers.tn;
  }, [selectedItem, fieldCountIdentifiers]);

  const isControlsDisabled = isLoading || isDownloadingStamped || isSendingToClaydox || isCameraOpen;
  const representativeImageData = currentImageIndex !== -1 ? selectedImages[currentImageIndex] : null;

  return (
    <div className="w-full max-w-3xl bg-slate-800 shadow-2xl rounded-xl p-6 sm:p-8 space-y-6">
      <h2 className="text-2xl font-bold text-sky-400 border-b border-slate-700 pb-3">현장 계수 (P2)</h2>
      <AnalysisContextForm
        title="필수 입력 정보"
        receiptNumber={receiptNumber}
        onReceiptNumberChange={val => {
          setReceiptNumber(val);
          setKtlApiCallStatus('idle');
        }}
        siteLocation={siteLocation}
        onSiteLocationChange={val => {
          setSiteLocation(val);
          setKtlApiCallStatus('idle');
        }}
        selectedItem={selectedItem}
        onSelectedItemChange={val => {
          setSelectedItem(val);
          setProcessedOcrData(null);
          setAggregatedOcrTextForDisplay(null);
          setKtlApiCallStatus('idle');
        }}
        itemOptions={waterQualityItemOptions}
        disabled={isControlsDisabled}
      />
      {isCameraOpen ? (
        <CameraView onCapture={handleCameraCapture} onClose={handleCloseCamera} />
      ) : (
        <>
          <ImageInput
            onImagesSet={handleImagesSet}
            onOpenCamera={handleOpenCamera}
            isLoading={isControlsDisabled}
            ref={fileInputRef}
            selectedImageCount={selectedImages.length}
          />
          {representativeImageData && (
            <ImagePreview
              imageBase64={representativeImageData.base64}
              fileName={representativeImageData.file.name}
              mimeType={representativeImageData.mimeType}
              receiptNumber={receiptNumber}
              siteLocation={siteLocation}
              item={selectedItem}
              showOverlay={areContextFieldsValid}
              totalSelectedImages={selectedImages.length}
              currentImageIndex={currentImageIndex}
              onDelete={() => handleDeleteImage(currentImageIndex)}
            />
          )}
          <ThumbnailGallery
            images={selectedImages}
            currentIndex={currentImageIndex}
            onSelectImage={setCurrentImageIndex}
            onDeleteImage={handleDeleteImage}
            disabled={isControlsDisabled}
          />
        </>
      )}
      <OcrControls
        onExtract={handleExtractText}
        onClear={handleClear}
        isExtractDisabled={isControlsDisabled || selectedImages.length === 0 || !areContextFieldsValid}
        isClearDisabled={isControlsDisabled || selectedImages.length === 0}
        onDownloadStampedImages={handleDownloadStampedImages}
        isDownloadStampedDisabled={true}
        isDownloadingStamped={isDownloadingStamped}
        onInitiateSendToKtl={handleInitiateSendToKtl}
        isClaydoxDisabled={isControlsDisabled || !processedOcrData || processedOcrData.length === 0}
        isSendingToClaydox={isSendingToClaydox}
        ktlApiCallStatus={ktlApiCallStatus}
      />
      <OcrResultDisplay
        ocrData={processedOcrData}
        error={processingError}
        isLoading={isLoading}
        contextProvided={areContextFieldsValid}
        hasImage={selectedImages.length > 0}
        selectedItem={selectedItem}
        onEntryIdentifierChange={(id, val) => handleEntryChange(id, 'identifier', val)}
        onEntryIdentifierTPChange={(id, val) => handleEntryChange(id, 'identifierTP', val)}
        onEntryTimeChange={(id, val) => handleEntryChange(id, 'time', val)}
        onEntryPrimaryValueChange={(id, val) => handleEntryChange(id, 'value', val)}
        onEntryValueTPChange={(id, val) => handleEntryChange(id, 'valueTP', val)}
        onAddEntry={handleAddEntry}
        onReorderRows={handleReorderRows}
        availableIdentifiers={availableIdentifiersForSingleMode}
        tnIdentifiers={fieldCountIdentifiers.tn}
        tpIdentifiers={fieldCountIdentifiers.tp}
        rawJsonForCopy={aggregatedOcrTextForDisplay}
        ktlJsonToPreview={ktlJsonPreview}
      />
      {isKtlPreflightModalOpen && ktlPreflightData && (
        <KtlPreflightModal
          isOpen={isKtlPreflightModalOpen}
          onClose={() => setIsKtlPreflightModalOpen(false)}
          onConfirm={handleSendToClaydoxConfirmed}
          preflightData={ktlPreflightData}
        />
      )}
    </div>
  );
};

export default FieldCountPage;
