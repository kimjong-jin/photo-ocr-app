
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Header } from './components/Header';
import { ImageInput, ImageInfo } from './components/ImageInput';
import { CameraView } from './components/CameraView';
import { ImagePreview } from './components/ImagePreview';
import { OcrControls } from './components/OcrControls';
import { OcrResultDisplay } from './components/OcrResultDisplay';
// Footer will be handled by PageContainer or AppWrapper, so removing from here for now.
// import { Footer } from './components/Footer'; 
import AnalysisContextForm from './components/AdditionalInfoInput';
import { RangeDifferenceDisplay, RangeResults as DisplayRangeResults, RangeStat } from './components/RangeDifferenceDisplay';
import { extractTextFromImage } from './services/geminiService';
import { generateStampedImage, dataURLtoBlob, generateCompositeImage } from './services/imageStampingService';
import { sendToClaydoxApi, ClaydoxPayload, generateKtlJsonForPreview } from './services/claydoxApiService';
import JSZip from 'jszip';
// UserNameInput is now handled by AppWrapper, so removing direct usage here.
// import UserNameInput from './components/UserNameInput'; 
import { autoAssignIdentifiersFromReceiptNumber } from './services/identifierAutomationService';
import { IDENTIFIER_OPTIONS, TN_IDENTIFIERS, TP_IDENTIFIERS } from './shared/constants';
import KtlPreflightModal, { KtlPreflightData } from './components/KtlPreflightModal';
import { ThumbnailGallery } from './components/ThumbnailGallery';

export interface ExtractedEntry {
  id: string;
  time: string;
  value: string; // Primary value (e.g., TOC value, or TN value if selectedItem is TN/TP)
  valueTP?: string; // TP value, only used if selectedItem is TN/TP
  identifier?: string; // Primary identifier (e.g., for TOC, or TN identifier if selectedItem is TN/TP)
  identifierTP?: string; // TP identifier, only used if selectedItem is TN/TP
  isRuleMatched?: boolean;
}

interface ConcentrationBoundaries {
  overallMin: number;
  overallMax: number;
  span: number;
  boundary1: number; // Upper limit for "low"
  boundary2: number; // Upper limit for "medium" (values > boundary2 are "high")
}

type AppRangeResults = DisplayRangeResults;
type KtlApiCallStatus = 'idle' | 'success' | 'error';

// Types for raw API response parsing
interface RawEntryBase {
  time: string;
}
interface RawEntryTnTp extends RawEntryBase {
  value_tn?: string;
  value_tp?: string;
}
interface RawEntrySingle extends RawEntryBase {
  value: string;
}
type RawEntryUnion = RawEntryTnTp | RawEntrySingle;


const getNumericValueFromString = (valueStr: string): number | null => {
  const numericValueString = String(valueStr).match(/^-?\d+(\.\d+)?/)?.[0];
  if (!numericValueString) return null;
  const numericValue = parseFloat(numericValueString);
  return isNaN(numericValue) ? null : numericValue;
};

const getConcentrationCategory = (valueStr: string, boundaries: ConcentrationBoundaries | null): 'low' | 'medium' | 'high' | 'unknown' => {
  const fullValueStr = String(valueStr).trim();
  const numericValueString = fullValueStr.match(/^-?\d+(\.\d+)?/)?.[0];
  const textPart = numericValueString ? fullValueStr.substring(numericValueString.length).trim() : fullValueStr;

  if (textPart.includes("고")) return 'high';
  if (textPart.includes("중")) return 'medium';
  if (textPart.includes("저")) return 'low';

  if (!boundaries) return 'unknown';
  const numericValue = getNumericValueFromString(valueStr); 
  if (numericValue === null) return 'unknown';

  if (numericValue <= boundaries.boundary1) return 'low';
  if (numericValue <= boundaries.boundary2) return 'medium';
  return 'high';
};

const calculateConcentrationBoundariesInternal = (
  data: ExtractedEntry[] | null
): ConcentrationBoundaries | null => {
  if (!data || data.length === 0) {
    return null;
  }

  const allNumericValuesForBoundaryCalc: number[] = [];
  data.forEach(entry => {
    const numericValue = getNumericValueFromString(entry.value);
    if (numericValue !== null) {
      allNumericValuesForBoundaryCalc.push(numericValue);
    }
  });

  const uniqueNumericValues = Array.from(new Set(allNumericValuesForBoundaryCalc)).sort((a, b) => a - b);

  if (uniqueNumericValues.length === 0) {
    return null;
  }

  const overallMin = uniqueNumericValues[0];
  const overallMax = uniqueNumericValues[uniqueNumericValues.length - 1];
  const span = overallMax - overallMin;
  let b1: number;
  let b2: number;

  if (uniqueNumericValues.length < 2) {
    b1 = overallMin;
    b2 = overallMax;
  } else if (uniqueNumericValues.length === 2) {
    b1 = uniqueNumericValues[0];
    b2 = uniqueNumericValues[0];
  } else if (uniqueNumericValues.length === 3) {
    b1 = uniqueNumericValues[0];
    b2 = uniqueNumericValues[1];
  } else { // N > 3
    if (span > 0) {
      b1 = overallMin + span / 3;
      b2 = overallMin + (2 * span) / 3;

      if (b1 >= b2) {
        const N_unique = uniqueNumericValues.length;
        let idx1 = Math.max(0, Math.floor(N_unique / 3) - 1);
        let idx2 = Math.max(idx1 + 1, Math.floor(2 * N_unique / 3) - 1);
        idx2 = Math.min(N_unique - 2, idx2);
        idx1 = Math.min(idx1, Math.max(0, idx2 - 1));

        if (idx1 >= 0 && idx1 < idx2 && idx2 < N_unique && uniqueNumericValues[idx1] < uniqueNumericValues[idx2]) {
          b1 = uniqueNumericValues[idx1];
          b2 = uniqueNumericValues[idx2];
        } else {
          b1 = overallMin;
          b2 = (overallMin + overallMax) / 2;
        }
      }
    } else {
      b1 = overallMin;
      b2 = overallMax;
    }
  }

  if (b1 > b2 && overallMax > overallMin) {
    [b1, b2] = [b2, b1];
  }

  if (uniqueNumericValues.length !== 2) {
    if (b1 === b2 && uniqueNumericValues.length > 1 && overallMin < overallMax) {
      if (b2 < overallMax) {
        const nextValIndex = uniqueNumericValues.findIndex(val => val > b2);
        if (nextValIndex !== -1) {
          b2 = uniqueNumericValues[nextValIndex];
        }
        if (b1 === b2 && b1 > overallMin) {
          let prevValIndex = -1;
          for (let i = uniqueNumericValues.length - 1; i >= 0; i--) {
            if (uniqueNumericValues[i] < b1) {
              prevValIndex = i;
              break;
            }
          }
          if (prevValIndex !== -1) {
            b1 = uniqueNumericValues[prevValIndex];
          }
        }
      }
    }
  }

  if (uniqueNumericValues.length === 2) {
    b1 = uniqueNumericValues[0];
    b2 = uniqueNumericValues[0];
  } else if (b1 >= b2 && uniqueNumericValues.length > 2) {
    b1 = overallMin;
    b2 = (overallMin + overallMax) / 2;
    if (b1 >= b2 && overallMin < overallMax) b2 = overallMax;
  }

  return { overallMin, overallMax, span, boundary1: b1, boundary2: b2 };
};


const attemptDirectAssignment = (
    targetIndex: number,
    newId: string,
    assignments: (string | undefined)[], 
    isRuleBasedAssignment: boolean,      
    ruleFlags: boolean[],                
    consumedByIndexCurrentPass: boolean[] 
  ): boolean => {
    if (!IDENTIFIER_OPTIONS.includes(newId)) {
        return false;
    }
    if (newId.startsWith("현장") && isRuleBasedAssignment) {
        return false;
    }

    const conflictIndex = assignments.findIndex((id, idx) => id === newId && idx !== targetIndex);
    const currentIdAtTarget = assignments[targetIndex];

    if (isRuleBasedAssignment) {
        if (consumedByIndexCurrentPass[targetIndex] && currentIdAtTarget !== newId && currentIdAtTarget !== undefined) {
            return false;
        }
        if (conflictIndex !== -1 && ruleFlags[conflictIndex]) {
            return false;
        }
        if (currentIdAtTarget !== undefined) { 
            if (currentIdAtTarget === newId) { 
                ruleFlags[targetIndex] = true; 
                consumedByIndexCurrentPass[targetIndex] = true; 
                return true;
            }
            if (ruleFlags[targetIndex]) {
                return false;
            }
        }
        if (conflictIndex !== -1 && !ruleFlags[conflictIndex]) {
            assignments[conflictIndex] = undefined;
            ruleFlags[conflictIndex] = false;
        }
        assignments[targetIndex] = newId;
        ruleFlags[targetIndex] = true;
        consumedByIndexCurrentPass[targetIndex] = true;
        return true;
    } else {
        if (currentIdAtTarget !== undefined) {
            return false; 
        }
        const idAlreadyUsedIndex = assignments.findIndex(id => id === newId);
        if (idAlreadyUsedIndex !== -1) {
            return false;
        }
        assignments[targetIndex] = newId;
        ruleFlags[targetIndex] = false; 
        return true;
    }
};


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
        } else {
            if (mimeType === 'image/jpeg') ext = 'jpg';
            else if (mimeType === 'image/png') ext = 'png';
            else if (mimeType === 'image/webp') ext = 'webp';
            else if (mimeType === 'image/gif') ext = 'gif';
        }
    } else { 
        if (mimeType === 'image/jpeg') ext = 'jpg';
        else if (mimeType === 'image/png') ext = 'png';
        else if (mimeType === 'image/webp') ext = 'webp';
        else if (mimeType === 'image/gif') ext = 'gif';
    }
    return ext.toLowerCase();
};

const generateIdentifierSequence = (
    ocrData: ExtractedEntry[] | null,
    currentSelectedItem: string
  ): string => {
    if (!ocrData) return "";
    let sequence = "";
    const excludedBases = ["현장"]; // Base identifiers to exclude (e.g., "현장1" -> "현장")
  
    const processSingleIdentifier = (idVal: string | undefined): string | null => {
      if (!idVal) return null;
      let base = idVal.replace(/[0-9]/g, ''); // Remove numbers: "M1" -> "M", "S2P" -> "SP", "현장1" -> "현장"
      if (base.endsWith('P')) {
        base = base.slice(0, -1); // Remove P: "SP" -> "S", "현장P" -> "현장"
      }
      if (excludedBases.includes(base)) return null;
      return base.length > 0 ? base : null;
    };
  
    for (const entry of ocrData) {
      if (currentSelectedItem === "TN/TP") {
        const tnPart = processSingleIdentifier(entry.identifier);
        if (tnPart) sequence += tnPart;
        const tpPart = processSingleIdentifier(entry.identifierTP);
        if (tpPart) sequence += tpPart;
      } else {
        const part = processSingleIdentifier(entry.identifier);
        if (part) sequence += part;
      }
    }
    return sequence;
  };

// Helper function to count decimal places in a string representation of a number
const countDecimalPlaces = (valueStr: string | undefined): number => {
  if (typeof valueStr !== 'string' || valueStr.trim() === '') {
    return 0;
  }
  // Extract only the numeric part, including the decimal, before counting
  const numericStrMatch = String(valueStr).match(/^-?\d+(\.\d+)?/);
  if (!numericStrMatch || !numericStrMatch[0]) {
    return 0;
  }
  const numericStr = numericStrMatch[0];
  const decimalPart = numericStr.split('.')[1];
  return decimalPart ? decimalPart.length : 0;
};

// Helper function to get the maximum decimal places from OCR data
const calculateMaxDecimalPlaces = (
  ocrData: ExtractedEntry[] | null,
  selectedItem: string
): number => {
  if (!ocrData || ocrData.length === 0) {
    return 0;
  }

  let maxPlaces = 0;

  ocrData.forEach(entry => {
    const placesValue = countDecimalPlaces(entry.value);
    if (placesValue > maxPlaces) {
      maxPlaces = placesValue;
    }

    if (selectedItem === "TN/TP" && entry.valueTP) {
      const placesValueTP = countDecimalPlaces(entry.valueTP);
      if (placesValueTP > maxPlaces) {
        maxPlaces = placesValueTP;
      }
    }
  });
  return maxPlaces;
};


interface PhotoLogPageProps {
  userName: string;
}

const PhotoLogPage: React.FC<PhotoLogPageProps> = ({ userName }) => {
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
  // const [inspectionStartDate, setInspectionStartDate] = useState<string>(''); // Removed
  const [selectedItem, setSelectedItem] = useState<string>('');
  const [areContextFieldsValid, setAreContextFieldsValid] = useState<boolean>(false);
  const [rangeDifferenceResults, setRangeDifferenceResults] = useState<AppRangeResults | null>(null);
  const [concentrationBoundaries, setConcentrationBoundaries] = useState<ConcentrationBoundaries | null>(null);
  const [isSendingToClaydox, setIsSendingToClaydox] = useState<boolean>(false);
  const [ktlApiCallStatus, setKtlApiCallStatus] = useState<KtlApiCallStatus>('idle');
  const [isKtlPreflightModalOpen, setKtlPreflightModalOpen] = useState<boolean>(false);
  const [ktlPreflightData, setKtlPreflightData] = useState<KtlPreflightData | null>(null);
  const [maxDecimalPlacesDisplay, setMaxDecimalPlacesDisplay] = useState<number>(0);


  const hypotheticalKtlFileNamesForPreview = useMemo(() => {
    if (!selectedImages || selectedImages.length === 0 || !receiptNumber || !siteLocation || !selectedItem) return [];
    const sanitizedSite = sanitizeFilenameComponent(siteLocation);
    const sanitizedItemName = sanitizeFilenameComponent(selectedItem === "TN/TP" ? "TN_TP" : selectedItem);
    const baseName = `${receiptNumber}_${sanitizedSite}_${sanitizedItemName}`;
    return [
        `${baseName}_composite.jpg`,
        `${baseName}_Compression.zip`
    ];
  }, [selectedImages.length, receiptNumber, siteLocation, selectedItem]);

  const ktlJsonPreview = useMemo(() => {
    if (!areContextFieldsValid || !processedOcrData || !userName) return null;
    const allUniquePrimaryIdentifiersFromOCR = Array.from(new Set(processedOcrData.filter(e => e.identifier).map(e => e.identifier!)));
    const identifierSequence = generateIdentifierSequence(processedOcrData, selectedItem);
     
    const payload: ClaydoxPayload = {
      receiptNumber,
      siteLocation,
      item: selectedItem,
      ocrData: processedOcrData,
      updateUser: userName,
      uniqueIdentifiersForNaming: allUniquePrimaryIdentifiersFromOCR,
      identifierSequence: identifierSequence,
      // maxDecimalPlaces: maxDecimalPlacesDisplay, // Pass directly to generateKtlJsonForPreview
    };
    return generateKtlJsonForPreview(payload, selectedItem, hypotheticalKtlFileNamesForPreview, maxDecimalPlacesDisplay);
  }, [receiptNumber, siteLocation, selectedItem, processedOcrData, areContextFieldsValid, userName, hypotheticalKtlFileNamesForPreview, maxDecimalPlacesDisplay]);


  useEffect(() => {
    setAreContextFieldsValid(
      receiptNumber.trim() !== '' &&
      siteLocation.trim() !== '' &&
      selectedItem.trim() !== ''
    );
  }, [receiptNumber, siteLocation, selectedItem]);

  useEffect(() => {
    const calculatedBoundaries = calculateConcentrationBoundariesInternal(processedOcrData);
    setConcentrationBoundaries(calculatedBoundaries);

    if (!processedOcrData || processedOcrData.length === 0) {
      setRangeDifferenceResults(null);
      setMaxDecimalPlacesDisplay(0); // Reset decimal places if no data
      return;
    }
    
    // Calculate and set max decimal places
    const newMaxDecimalPlaces = calculateMaxDecimalPlaces(processedOcrData, selectedItem);
    setMaxDecimalPlacesDisplay(newMaxDecimalPlaces);


    const identifiers = processedOcrData.map(entry => entry.identifier);
    const hasM1 = identifiers.includes("M1");
    const hasM2 = identifiers.includes("M2");
    const hasM3 = identifiers.includes("M3");
    const hasZ5 = identifiers.includes("Z5");
    const hasS5 = identifiers.includes("S5");
    const hasZ6 = identifiers.includes("Z6");
    const hasS6 = identifiers.includes("S6");
    const hasZ7 = identifiers.includes("Z7");
    const hasS7 = identifiers.includes("S7");

    const conditionM1M2M3 = hasM1 && hasM2 && hasM3;
    const conditionZ5S5 = hasZ5 && hasS5;
    const conditionZ6S6Z7S7 = hasZ6 && hasS6 && hasZ7 && hasS7;

    const shouldShowAnalysis = conditionM1M2M3 || conditionZ5S5 || conditionZ6S6Z7S7;

    if (!shouldShowAnalysis) {
      setRangeDifferenceResults(null);
      return;
    }
    
    if (!calculatedBoundaries) {
      setRangeDifferenceResults({ low: null, medium: null, high: null });
      return;
    }

    try {
      const lowValues: number[] = [];
      const mediumValues: number[] = [];
      const highValues: number[] = [];

      processedOcrData.forEach(entry => {
        const category = getConcentrationCategory(entry.value, calculatedBoundaries);
        const numericVal = getNumericValueFromString(entry.value);
        if (numericVal === null) return;

        if (category === 'low') lowValues.push(numericVal);
        else if (category === 'medium') mediumValues.push(numericVal);
        else if (category === 'high') highValues.push(numericVal);
      });
      
      const calculateRangeDetails = (values: number[]): RangeStat | null => {
        if (values.length === 0) return null;
        const min = Math.min(...values);
        const max = Math.max(...values);
        const diff = max - min;
        return { min, max, diff };
      };

      setRangeDifferenceResults({
        low: calculateRangeDetails(lowValues),
        medium: calculateRangeDetails(mediumValues),
        high: calculateRangeDetails(highValues)
      });
    } catch (e) {
      console.error("[Effect] Error processing data for range analysis:", e);
      setRangeDifferenceResults(null);
    }
  }, [processedOcrData, selectedItem]);


  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetImageState = useCallback(() => {
    setSelectedImages([]);
    setCurrentImageIndex(-1);
    setProcessedOcrData(null);
    setAggregatedOcrTextForDisplay(null);
    setProcessingError(null);
    setIsCameraOpen(false);
    setRangeDifferenceResults(null);
    setConcentrationBoundaries(null); 
    setKtlApiCallStatus('idle');
    setKtlPreflightModalOpen(false); 
    setKtlPreflightData(null);
    setMaxDecimalPlacesDisplay(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleImagesSet = useCallback((newlySelectedImages: ImageInfo[]) => {
    if (newlySelectedImages.length === 0 && selectedImages.length > 0) {
        // This case can happen if a user cancels the file dialog after having images.
        // We don't want to clear their existing selection in this case.
        return;
    }
    // Always clear derived data when selection changes
    setProcessedOcrData(null);
    setAggregatedOcrTextForDisplay(null);
    setProcessingError(null);
    setRangeDifferenceResults(null);
    setKtlApiCallStatus('idle');

    if (selectedImages.length === 0) { // SET operation
      setSelectedImages(newlySelectedImages);
      setCurrentImageIndex(newlySelectedImages.length > 0 ? 0 : -1);
    } else { // ADD operation
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
      // Don't change current image index when adding
    }
  }, [selectedImages.length]);


  const handleOpenCamera = useCallback(() => {
    setIsCameraOpen(true);
    setProcessingError(null);
  }, []);

  const handleCameraCapture = useCallback((file: File, b64: string, captureMimeType: string) => {
    const capturedImageInfo: ImageInfo = { file, base64: b64, mimeType: captureMimeType };
    
    // Clear derived data as selection is changing
    setProcessedOcrData(null);
    setAggregatedOcrTextForDisplay(null);
    setProcessingError(null);
    setRangeDifferenceResults(null);
    setKtlApiCallStatus('idle');

    let newIndex;
    if (selectedImages.length === 0) { // SET
      setSelectedImages([capturedImageInfo]);
      newIndex = 0;
    } else { // ADD
      newIndex = selectedImages.length; // Will be the index of the newly added item
      setSelectedImages(prev => [...prev, capturedImageInfo]);
    }

    setCurrentImageIndex(newIndex);
    setIsCameraOpen(false);
  }, [selectedImages.length]);

  const handleCloseCamera = useCallback(() => {
    setIsCameraOpen(false);
  }, []);

  const handleDeleteImage = useCallback((indexToDelete: number) => {
    if (indexToDelete < 0 || indexToDelete >= selectedImages.length) return;

    setProcessedOcrData(null);
    setAggregatedOcrTextForDisplay(null);
    setProcessingError(null);
    setRangeDifferenceResults(null);
    setKtlApiCallStatus('idle');

    const newImages = selectedImages.filter((_, index) => index !== indexToDelete);
    
    setSelectedImages(newImages);

    if (newImages.length === 0) {
        setCurrentImageIndex(-1);
    } else if (currentImageIndex >= newImages.length) {
        // If the last image was deleted, show the new last image
        setCurrentImageIndex(newImages.length - 1);
    } else if (currentImageIndex > indexToDelete) {
        // If an image *before* the current one was deleted, the current index needs to be decremented.
        setCurrentImageIndex(prev => prev - 1);
    }
    // If the current image was deleted (or one after it), the index is still valid or points to the new item at that position.
  }, [currentImageIndex, selectedImages]);

  const generatePromptForProAnalysis = (
    receiptNum: string,
    siteLoc: string,
    item: string
  ): string => {
    let prompt = `제공된 측정 장비의 이미지를 분석해주세요.
컨텍스트:`;
    if (receiptNum) prompt += `\n- 접수번호: ${receiptNum}`;
    if (siteLoc) prompt += `\n- 현장/위치: ${siteLoc}`;
    
    if (item === "TN/TP") {
      prompt += `\n- 항목/파라미터: TN 및 TP. 이미지에서 TN 및 TP 각각의 시간 및 값 쌍을 추출해주세요.`;
      prompt += `\n  "value_tn" (TN 값) 및 "value_tp" (TP 값) 필드를 사용하세요.`;
      prompt += `\n  각 값 필드에는 이미지에서 추출한 **순수한 숫자 값만** 포함해주세요. 예를 들어, 이미지에 "N 5.388 mgN/L 저"라고 표시되어 있다면 "value_tn"에는 "5.388"만 와야 합니다.`;
      prompt += `\n  항목 지시자(예: "N ", "P "), 단위(예: "mgN/L"), 텍스트 주석(예: "[M_]", "(A)", "저", "고 S") 등은 **모두 제외**해야 합니다.`;
      prompt += `\n\nJSON 출력 형식 예시 (항목: TN/TP):
[
  { "time": "2025/04/23 05:00", "value_tn": "46.2", "value_tp": "1.2" },
  { "time": "2025/04/23 06:00", "value_tn": "5.388", "value_tp": "0.1" },
  { "time": "2025/05/21 09:38", "value_tn": "89.629" }
]`;
    } else {
      prompt += `\n- 항목/파라미터: ${item}. 이 항목의 측정값을 이미지에서 추출해주세요.`;
      prompt += `\n  "value" 필드에는 각 측정 항목의 **순수한 숫자 값만** 포함해야 합니다. 예를 들어, 이미지에 "N 89.629 mgN/L [M_]"라고 표시되어 있다면 "value"에는 "89.629"만 와야 합니다.`;
      prompt += `\n  항목 지시자(예: "N ", "TOC "), 단위(예: "mgN/L", "mg/L"), 상태 또는 주석(예: "[M_]", "(A)") 등은 **모두 제외**해야 합니다.`;
      prompt += `\n\nJSON 출력 형식 예시 (항목: ${item}):`;
      if (item === "TN") {
        prompt += `
[
  { "time": "2025/05/21 09:38", "value": "89.629" },
  { "time": "2025/05/21 10:25", "value": "44.978" },
  { "time": "2025/05/21 12:46", "value": "6.488" }
]`;
      } else if (item === "TP") {
        prompt += `
[
  { "time": "YYYY/MM/DD HH:MM", "value": "X.XXX" }
]`;
      } else { 
        prompt += `
[
  { "time": "YYYY/MM/DD HH:MM", "value": "X.XXX" },
  { "time": "YYYY/MM/DD HH:MM", "value": "Y.YYY" }
]`;
      }
    }

    if (!receiptNum && !siteLoc && !item) prompt += `\n- 특정 접수번호, 현장 위치 또는 항목이 제공되지 않았습니다. 일반적으로 시간/값 쌍을 분석합니다.`;
    prompt += `

작업:
이미지에서 데이터 테이블이나 목록을 식별해주세요.
장치 화면에 보이는 모든 "Time"(시각) 및 관련 값 쌍을 추출해주세요.

JSON 출력 및 데이터 추출을 위한 특정 지침:
1.  전체 응답은 **반드시** 유효한 단일 JSON 배열이어야 합니다. 응답은 대괄호 '['로 시작해서 대괄호 ']'로 끝나야 하며, 이 배열 구조 외부에는 **어떠한 다른 텍스트도 포함되어서는 안 됩니다.**
2.  JSON 데이터 자체를 제외하고는, JSON 배열 외부 또는 내부에 \`\`\`json\`\`\`와(과) 같은 마크다운 구분 기호, 소개, 설명, 주석 또는 기타 텍스트를 **절대로 포함하지 마세요.**
3.  배열 내의 각 JSON 객체는 정확한 JSON 형식이어야 합니다. 특히, 속성 값 뒤 (예: "value": "202.0" 에서 "202.0" 뒤)에는 다음 문자가 와야 합니다:
    *   쉼표(,) : 객체에 속성이 더 있는 경우
    *   닫는 중괄호(}) : 객체의 마지막 속성인 경우
    이 외의 다른 텍스트나 문자를 **절대로 추가하지 마세요.**
4.  지정된 "항목/파라미터" 관련 데이터를 우선적으로 추출하되, 장치 화면에서 식별 가능한 모든 "Time"(시각) 및 관련 값 쌍을 반드시 추출해야 합니다.
5.  **"Time"(시각) 추출 규칙:**
    - **표 전체에 대한 날짜 식별:** 먼저, 데이터 표 전체에 적용되는 주요 날짜(예: \`25/06/30\`)를 화면에서 찾으세요. 이 날짜는 종종 표의 상단이나 근처에 표시됩니다.
    - **행별 시간 구성:** 표의 각 행에 대해, 행의 시각 표시자(예: \`00\`부터 \`23\`까지의 숫자, 이는 시간(hour)을 나타냄)를 위에서 식별한 주요 날짜와 결합하여 완전한 타임스탬프를 만드세요. 분(minute)은 \`00\`으로 설정하세요. (예: 날짜가 \`25/07/01\`이고 행 표시자가 \`08\`이면, 시간은 \`2025/07/01 08:00\`이 됩니다. 2자리 연도는 현재 세기를 기준으로 \`20xx\`로 변환하세요.)
    - **최종 시간 형식:** 최종 시간은 \`YYYY/MM/DD HH:MM\` 형식으로 일관되게 포맷해주세요.
    - **개별 타임스탬프:** 만약 표 전체에 적용되는 날짜가 없고 각 행에 완전한 날짜와 시간이 이미 있다면, 그 값을 그대로 사용하세요. 시간만 표시된 경우 날짜 없이 시간만 추출하세요.
6.  값 필드 ("value", "value_tn", "value_tp"): **오직 숫자 부분만** 추출해주세요. 이미지에 "N 89.629 mgN/L [M_]"와 같이 표시되어 있다면, 해당 값 필드에는 "89.629"와 같이 순수한 숫자 문자열만 포함해야 합니다. 접두사(예: "N "), 단위(예: "mgN/L"), 텍스트 주석(예: "[M_]", "(A)", "저", "고 S") 등은 **모두 제외**해야 합니다. 만약 숫자 값을 명확히 식별할 수 없다면, 해당 값 필드를 JSON 객체에서 생략하거나 빈 문자열 ""로 설정해주세요.
7.  항목이 "TN/TP"인 경우:
    - 각 객체는 "time"을 포함해야 합니다.
    - TN 데이터가 있으면 "value_tn"을 포함해야 합니다.
    - TP 데이터가 있으면 "value_tp"를 포함해야 합니다.
    - 특정 시간 항목에 대해 TN 또는 TP 값 중 하나만 있을 수 있습니다. 해당 값만 포함합니다. (예: {"time": "...", "value_tn": "..."} 또는 {"time": "...", "value_tp": "..."})
8.  카메라에서 생성된 타임스탬프 및 UI 버튼 텍스트는 실제 데이터의 일부가 아닌 한 제외하세요.
9.  장치 화면에서 "Time" 및 관련 값 쌍을 전혀 찾을 수 없거나 이미지가 인식 가능한 데이터 표시를 포함하지 않는 경우 빈 JSON 배열([])을 반환하세요.
10. "reactors_input" 또는 "reactors_output" 또는 유사한 마커를 응답에 포함하지 마세요. JSON 응답은 순수하게 데이터 객체의 배열이어야 합니다.
`;
    return prompt;
  };

  const handleExtractText = useCallback(async () => {
    if (selectedImages.length === 0) {
      setProcessingError("먼저 이미지를 선택하거나 촬영해주세요.");
      return;
    }
    if (!areContextFieldsValid) {
        setProcessingError("모든 필수 항목(접수번호, 현장, 항목)을 입력해주세요.");
        return;
    }
    setIsLoading(true);
    setProcessingError(null);
    setProcessedOcrData(null);
    setAggregatedOcrTextForDisplay(null);
    setRangeDifferenceResults(null);
    setKtlApiCallStatus('idle');
    setMaxDecimalPlacesDisplay(0);

    const allRawExtractedEntries: RawEntryUnion[] = [];
    let batchHadError = false;
    let criticalErrorOccurred: string | null = null;
    let finalErrorToSet: string | null = null;
    let finalOcrDataToSet: ExtractedEntry[] | null = null;
    let finalAggregatedTextToSet: string | null = null;

  try {
    if (!import.meta.env.VITE_API_KEY) {
      criticalErrorOccurred = "VITE_API_KEY 환경 변수가 설정되지 않았습니다. 앱 설정을 확인해주세요.";
      throw new Error(criticalErrorOccurred);
    }

      const imageProcessingPromises = selectedImages.map(async (currentImage) => {
        let resultText: string = "";
        let jsonStr: string = "";

        try {
          const currentPrompt = generatePromptForProAnalysis(receiptNumber, siteLocation, selectedItem);
          const modelConfig = { responseMimeType: "application/json" };
          resultText = await extractTextFromImage(currentImage.base64, currentImage.mimeType, currentPrompt, modelConfig);

          jsonStr = resultText.trim();
          const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
          const match = jsonStr.match(fenceRegex);
          if (match && match[2]) {
            jsonStr = match[2].trim();
          }

          const lines = jsonStr.split('\n');
          const cleanedLines = [];
          const jsonCharsRegex = /[{}[\]":]/; 
          const looksLikeJsonValueRegex = /^\s*(".*"|-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)\s*,?\s*$/;

          for (const line of lines) {
              const trimmedLine = line.trim();
              if (jsonCharsRegex.test(trimmedLine) || looksLikeJsonValueRegex.test(trimmedLine) || trimmedLine === "" || trimmedLine === "[" || trimmedLine === "]" || trimmedLine === "{" || trimmedLine === "}") {
                  cleanedLines.push(line); 
              }
          }
          jsonStr = cleanedLines.join('\n').trim();

          if (jsonStr.startsWith('[') && jsonStr.endsWith(']')) {
              let tempStr = "";
              const jsonLines = jsonStr.substring(1, jsonStr.length -1).split('\n').map(l => l.trim()).filter(l => l !== "");
              for(let i=0; i < jsonLines.length; i++) {
                  let line = jsonLines[i];
                  if (line.endsWith(',') && i < jsonLines.length -1 && jsonLines[i+1].startsWith('}')) {
                  } else if (line.endsWith(',')) {
                  } else if (i < jsonLines.length - 1 && (jsonLines[i+1].startsWith('{') || jsonLines[i+1].startsWith('"'))) {
                     if (line.endsWith('}') || line.endsWith(']') || looksLikeJsonValueRegex.test(line.replace(/,$/,''))) { 
                        line += ',';
                     }
                  }
                  tempStr += line + '\n';
              }
              jsonStr = '[' + tempStr.trim() + ']';
          }

          const reactInputOutputClean = (s: string, keyword: string) => {
            let newStr = s.replace(new RegExp(`(\\"\\s*:\\s*\\"[^\\"]*\\"\\s*)\\s*${keyword}\\s*:\\s*\\{[\\s\\S]*?\\}`, 'g'), (match, g1) => g1);
            newStr = newStr.replace(new RegExp(`,\\s*${keyword}\\s*:\\s*\\{[\\s\\S]*?\\}\\s*(?=[,}])`, 'g'), '');
            newStr = newStr.replace(new RegExp(`${keyword}\\s*:\\s*\\{[\\s\\S]*?\\}`, 'g'), '');
            return newStr;
          }
          jsonStr = reactInputOutputClean(jsonStr, "reactors_input");
          jsonStr = reactInputOutputClean(jsonStr, "reactors_output");
          
          if (jsonStr !== "") {
            const jsonDataFromImage = JSON.parse(jsonStr) as RawEntryUnion[];
            if (Array.isArray(jsonDataFromImage)) {
              return { status: 'fulfilled', value: jsonDataFromImage, imageName: currentImage.file.name };
            }
            return { status: 'rejected', reason: `Image ${currentImage.file.name} did not return a valid JSON array.`, imageName: currentImage.file.name };
          }
          return { status: 'fulfilled', value: [], imageName: currentImage.file.name };
        } catch (imgErr: any) {
          let attemptedJsonStringOnError = "String not available (error likely before JSON processing stage).";
          if (jsonStr) attemptedJsonStringOnError = jsonStr;
          else if (resultText) attemptedJsonStringOnError = resultText;

          if (imgErr.message && (imgErr.message.includes("API_KEY") || imgErr.message.includes("API Key") || imgErr.message.includes("Quota exceeded") || imgErr.message.includes("Invalid Gemini API Key"))) {
            criticalErrorOccurred = imgErr.message + " API 키 또는 할당량을 확인하세요.";
          }

          let reasonMessage = imgErr.message || `Failed to process image ${currentImage.file.name}`;
          if (imgErr instanceof SyntaxError) {
            reasonMessage = `Failed to parse JSON response for image ${currentImage.file.name}: ${imgErr.message}. Problematic string: ${attemptedJsonStringOnError}`;
          }
          return { status: 'rejected', reason: reasonMessage, imageName: currentImage.file.name };
        }
      });

      const results = await Promise.allSettled(imageProcessingPromises);
      results.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
            const imageData = (result.value as any).value || result.value; 
            if (Array.isArray(imageData)) {
                 imageData.forEach((rawEntry: RawEntryUnion) => { 
                    if (rawEntry && typeof rawEntry.time === 'string') { 
                        let isValidEntry = false;
                        if (selectedItem === "TN/TP") {
                            const tnTpEntry = rawEntry as RawEntryTnTp;
                            isValidEntry = typeof tnTpEntry.value_tn === 'string' || typeof tnTpEntry.value_tp === 'string';
                        } else {
                            const singleValueEntry = rawEntry as RawEntrySingle;
                            isValidEntry = typeof singleValueEntry.value === 'string';
                        }
                        if (isValidEntry) allRawExtractedEntries.push(rawEntry);
                    }
                });
            }
        } else if (result.status === 'rejected') {
          batchHadError = true;
        }
      });

      if (criticalErrorOccurred) {
        finalErrorToSet = criticalErrorOccurred;
      } else if (allRawExtractedEntries.length > 0) {
        const uniqueEntriesMap = new Map<string, RawEntryUnion>();
        allRawExtractedEntries.sort((a, b) => a.time.localeCompare(b.time)); 

        allRawExtractedEntries.forEach(entry => {
          if (!uniqueEntriesMap.has(entry.time)) {
            uniqueEntriesMap.set(entry.time, entry);
          } else {
            if (selectedItem === "TN/TP") {
                const existing = uniqueEntriesMap.get(entry.time) as RawEntryTnTp;
                const current = entry as RawEntryTnTp;
                if (current.value_tn && !existing.value_tn) existing.value_tn = current.value_tn;
                if (current.value_tp && !existing.value_tp) existing.value_tp = current.value_tp;
            } 
          }
        });
        const deduplicatedRawData = Array.from(uniqueEntriesMap.values());

        finalOcrDataToSet = deduplicatedRawData.map((rawEntry: RawEntryUnion) => {
            let primaryValue = '';
            let tpValue: string | undefined = undefined;

            if (selectedItem === "TN/TP") {
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
                identifierTP: undefined,
                isRuleMatched: false
            };
        });

        if (finalOcrDataToSet && finalOcrDataToSet.length > 0) {
          finalOcrDataToSet.sort((a, b) => a.time.localeCompare(b.time));
        }
        
        finalAggregatedTextToSet = JSON.stringify(finalOcrDataToSet.map(e => {
            if (selectedItem === "TN/TP") {
                return { time: e.time, value_tn: e.value, value_tp: e.valueTP };
            }
            return { time: e.time, value: e.value };
        }), null, 2);

        if (batchHadError) {
            finalErrorToSet = "일부 이미지를 처리할 수 없거나 데이터를 반환하지 않았습니다. 성공적으로 처리된 이미지의 결과가 표시됩니다.";
        }
      } else {
        if (batchHadError) {
          finalErrorToSet = `데이터가 추출되지 않았습니다. 하나 이상의 이미지를 처리할 수 없습니다.`;
        } else {
            finalAggregatedTextToSet = `선택한 이미지에서 '시간' 및 '값' 데이터를 찾을 수 없거나 데이터 형식이 인식되지 않았습니다.`;
            finalOcrDataToSet = [];
        }
      }
    } catch (e: any) {
      if (!criticalErrorOccurred) finalErrorToSet = e.message || "데이터 추출에 실패했습니다. 콘솔을 확인하세요.";
    } finally {
      setProcessingError(finalErrorToSet);
      setProcessedOcrData(finalOcrDataToSet);
      setAggregatedOcrTextForDisplay(finalAggregatedTextToSet);
      setIsLoading(false);
    }
  }, [selectedImages, receiptNumber, siteLocation, selectedItem, areContextFieldsValid]);


  const updateAggregatedDisplayFromProcessedData = useCallback((updatedData: ExtractedEntry[] | null) => {
    if (updatedData) {
        setAggregatedOcrTextForDisplay(JSON.stringify(updatedData.map(e => {
            if (selectedItem === "TN/TP") {
                return { time: e.time, value_tn: e.value, value_tp: e.valueTP };
            }
            return { time: e.time, value: e.value };
        }), null, 2));
    } else {
      setAggregatedOcrTextForDisplay(null);
    }
  }, [selectedItem]);

  const handleEntryIdentifierChange = useCallback((entryId: string, newIdentifierValue: string | undefined) => {
    setProcessedOcrData(prevData => {
      if (!prevData) return null;
      const updatedData = prevData.map(entry =>
        entry.id === entryId
          ? { ...entry, identifier: newIdentifierValue === '' ? undefined : newIdentifierValue, isRuleMatched: false }
          : entry
      );
      setKtlApiCallStatus('idle');
      return updatedData;
    });
  }, []);

  const handleEntryIdentifierTPChange = useCallback((entryId: string, newIdentifierValue: string | undefined) => {
    setProcessedOcrData(prevData => {
      if (!prevData) return null;
      const updatedData = prevData.map(entry =>
        entry.id === entryId
          ? { ...entry, identifierTP: newIdentifierValue === '' ? undefined : newIdentifierValue }
          : entry
      );
      setKtlApiCallStatus('idle');
      return updatedData;
    });
  }, []);

  const handleEntryTimeChange = useCallback((entryId: string, newTime: string) => {
    setProcessedOcrData(prevData => {
      if (!prevData) return null;
      const updatedData = prevData.map(entry =>
        entry.id === entryId ? { ...entry, time: newTime } : entry
      );
      updateAggregatedDisplayFromProcessedData(updatedData);
      setKtlApiCallStatus('idle');
      return updatedData;
    });
  }, [selectedItem, updateAggregatedDisplayFromProcessedData]); 

  const handleEntryPrimaryValueChange = useCallback((entryId: string, newValue: string) => {
    setProcessedOcrData(prevData => {
      if (!prevData) return null;
      const updatedData = prevData.map(entry =>
        entry.id === entryId ? { ...entry, value: newValue } : entry
      );
      updateAggregatedDisplayFromProcessedData(updatedData);
      setKtlApiCallStatus('idle');
      return updatedData;
    });
  }, [selectedItem, updateAggregatedDisplayFromProcessedData]); 

  const handleEntryValueTPChange = useCallback((entryId: string, newValue: string) => {
    setProcessedOcrData(prevData => {
      if (!prevData) return null;
      const updatedData = prevData.map(entry =>
        entry.id === entryId ? { ...entry, valueTP: newValue } : entry
      );
      updateAggregatedDisplayFromProcessedData(updatedData);
      setKtlApiCallStatus('idle');
      return updatedData;
    });
  }, [selectedItem, updateAggregatedDisplayFromProcessedData]); 


  const handleReorderRowsByInput = useCallback((sourceRowStr: string, targetRowStr?: string) => {
    setProcessedOcrData(prevData => {
      if (!prevData || prevData.length === 0) {
        alert("순서를 변경할 데이터가 없습니다.");
        return null;
      }

      const parts = sourceRowStr.trim().split('-');
      let sourceStartIdx0Based: number;
      let sourceEndIdx0Based: number; 
      let numRowsToMove: number;

      if (parts.length === 1) {
        const sourceIndex1Based = parseInt(parts[0], 10);
        if (isNaN(sourceIndex1Based) || sourceIndex1Based < 1 || sourceIndex1Based > prevData.length) {
          alert(`'이동할 행 No.'에 유효한 번호 (1부터 ${prevData.length}까지)를 입력하세요.`);
          return prevData;
        }
        sourceStartIdx0Based = sourceIndex1Based - 1;
        sourceEndIdx0Based = sourceIndex1Based - 1;
        numRowsToMove = 1;
      } else if (parts.length === 2) { 
        const startNum1Based = parseInt(parts[0], 10);
        const endNum1Based = parseInt(parts[1], 10);

        if (isNaN(startNum1Based) || isNaN(endNum1Based) ||
            startNum1Based < 1 || startNum1Based > prevData.length ||
            endNum1Based < 1 || endNum1Based > prevData.length ||
            startNum1Based >= endNum1Based) { 
          alert(`'이동할 행 No.'에 유효한 범위 (예: 1-3, 시작 번호 < 끝 번호, 각 번호는 1부터 ${prevData.length}까지)를 입력하세요.`);
          return prevData;
        }
        sourceStartIdx0Based = startNum1Based - 1;
        sourceEndIdx0Based = endNum1Based - 1;
        numRowsToMove = sourceEndIdx0Based - sourceStartIdx0Based + 1;
      } else {
        alert("'이동할 행 No.' 형식이 올바르지 않습니다. 단일 숫자 또는 '시작번호-끝번호' 형식 (예: 5 또는 1-3)을 사용하세요.");
        return prevData;
      }
      
      const newData = [...prevData];
      const itemsToMove = newData.splice(sourceStartIdx0Based, numRowsToMove);

      if (itemsToMove.length === 0) return prevData; 
      
      if (targetRowStr === undefined || targetRowStr.trim() === '') {
        newData.push(...itemsToMove);
      } else {
        const targetPosition1Based = parseInt(targetRowStr, 10);
        const maxTargetPosition = newData.length + 1; 

        if (isNaN(targetPosition1Based) || targetPosition1Based < 1 || targetPosition1Based > maxTargetPosition ) {
          alert(`'새 위치 No.'에 유효한 번호 (1부터 ${maxTargetPosition}까지)를 입력하거나, 비워두면 맨 뒤로 이동합니다.`);
          return prevData;
        }

        if (targetPosition1Based === maxTargetPosition) {
            newData.push(...itemsToMove);
        } else {
            const insertionIndex0Based = targetPosition1Based - 1;
            newData.splice(insertionIndex0Based, 0, ...itemsToMove);
        }
      }
      updateAggregatedDisplayFromProcessedData(newData);
      setKtlApiCallStatus('idle');
      return newData;
    });
  }, [updateAggregatedDisplayFromProcessedData]);


  const handleAddEntry = useCallback(() => {
    setProcessedOcrData(prevData => {
      const newEntry: ExtractedEntry = {
        id: self.crypto.randomUUID(),
        time: '',
        value: '',
        valueTP: selectedItem === "TN/TP" ? '' : undefined,
        identifier: undefined,
        identifierTP: undefined,
        isRuleMatched: false,
      };
      const updatedData = prevData ? [...prevData, newEntry] : [newEntry];
      updateAggregatedDisplayFromProcessedData(updatedData);
      setKtlApiCallStatus('idle');
      return updatedData;
    });
  }, [selectedItem, updateAggregatedDisplayFromProcessedData]);


  const handleAutoAssignIdentifiers = useCallback(() => {
    if (!receiptNumber.trim() || !processedOcrData || processedOcrData.length === 0) {
        alert("자동 식별자 할당을 위해서는 접수번호가 입력되어야 하고, 추출된 데이터가 있어야 합니다.");
        return;
    }
    
    const currentLocalBoundaries = calculateConcentrationBoundariesInternal(processedOcrData);
    if (!currentLocalBoundaries) {
        alert("농도 경계값이 계산되지 않았습니다 (데이터 부족 또는 형식 오류). 농도 기반 규칙은 정확하지 않을 수 있습니다.");
    }

    let newAssignments = processedOcrData.map(entry => entry.identifier);
    let newRuleMatchedFlags = processedOcrData.map(entry => entry.isRuleMatched || false);
    const data = processedOcrData; 
    const n = data.length;
    const consumedByIndexCurrentPass = new Array(n).fill(false);
    
    const getCat = (index: number) => getConcentrationCategory(data[index].value, currentLocalBoundaries);

    let z1s2BlockAssigned = false; 
    let z5s7FullBlockAssigned = false;

      for (let i = 0; i <= n - 6; i++) {
        if (!consumedByIndexCurrentPass[i] && getCat(i) === 'low' &&
            !consumedByIndexCurrentPass[i+1] && getCat(i+1) === 'high' &&
            !consumedByIndexCurrentPass[i+2] && getCat(i+2) === 'low' &&
            !consumedByIndexCurrentPass[i+3] && getCat(i+3) === 'high' &&
            !consumedByIndexCurrentPass[i+4] && getCat(i+4) === 'low' &&
            !consumedByIndexCurrentPass[i+5] && getCat(i+5) === 'high') {
            const v_i = getNumericValueFromString(data[i].value);
            const v_i1 = getNumericValueFromString(data[i+1].value);
            const v_i2 = getNumericValueFromString(data[i+2].value);
            const v_i3 = getNumericValueFromString(data[i+3].value);
            const v_i4 = getNumericValueFromString(data[i+4].value);
            const v_i5 = getNumericValueFromString(data[i+5].value);

            if (v_i !== null && v_i1 !== null && v_i2 !== null && v_i3 !== null && v_i4 !== null && v_i5 !== null &&
                v_i1 > v_i && v_i3 > v_i2 && v_i5 > v_i4) { 
                
                const tempAssignments = [...newAssignments]; 
                const tempRuleFlags = [...newRuleMatchedFlags];
                const tempConsumed = [...consumedByIndexCurrentPass];

                if (attemptDirectAssignment(i, "Z5", tempAssignments, true, tempRuleFlags, tempConsumed) &&
                    attemptDirectAssignment(i+1, "S5", tempAssignments, true, tempRuleFlags, tempConsumed) &&
                    attemptDirectAssignment(i+2, "Z6", tempAssignments, true, tempRuleFlags, tempConsumed) &&
                    attemptDirectAssignment(i+3, "S6", tempAssignments, true, tempRuleFlags, tempConsumed) &&
                    attemptDirectAssignment(i+4, "Z7", tempAssignments, true, tempRuleFlags, tempConsumed) &&
                    attemptDirectAssignment(i+5, "S7", tempAssignments, true, tempRuleFlags, tempConsumed)) {
                    
                    newAssignments = tempAssignments; 
                    newRuleMatchedFlags = tempRuleFlags;
                    consumedByIndexCurrentPass.splice(0, tempConsumed.length, ...tempConsumed); 
                    z5s7FullBlockAssigned = true;
                    break; 
                }
            }
        }
      }
    
      for (let i = 0; i <= n - 4; i++) {
        if (!consumedByIndexCurrentPass[i] && getCat(i) === 'low' &&
            !consumedByIndexCurrentPass[i+1] && getCat(i+1) === 'low' &&
            !consumedByIndexCurrentPass[i+2] && getCat(i+2) === 'high' &&
            !consumedByIndexCurrentPass[i+3] && getCat(i+3) === 'high') {

            const v_i = getNumericValueFromString(data[i].value);
            const v_i1 = getNumericValueFromString(data[i+1].value);
            const v_i2 = getNumericValueFromString(data[i+2].value);
            const v_i3 = getNumericValueFromString(data[i+3].value);

            if (v_i !== null && v_i1 !== null && v_i2 !== null && v_i3 !== null &&
                Math.min(v_i2, v_i3) > Math.max(v_i, v_i1) ) {

                const tempAssignments = [...newAssignments];
                const tempRuleFlags = [...newRuleMatchedFlags];
                const tempConsumed = [...consumedByIndexCurrentPass];

                if (attemptDirectAssignment(i, "Z1", tempAssignments, true, tempRuleFlags, tempConsumed) &&
                    attemptDirectAssignment(i+1, "Z2", tempAssignments, true, tempRuleFlags, tempConsumed) &&
                    attemptDirectAssignment(i+2, "S1", tempAssignments, true, tempRuleFlags, tempConsumed) &&
                    attemptDirectAssignment(i+3, "S2", tempAssignments, true, tempRuleFlags, tempConsumed)) {
                    newAssignments = tempAssignments;
                    newRuleMatchedFlags = tempRuleFlags;
                    consumedByIndexCurrentPass.splice(0, tempConsumed.length, ...tempConsumed);
                    z1s2BlockAssigned = true; 
                    break;
                }
            }
        }
      }
    
      for (let i = n - 3; i >= 0; i--) { 
        if (!consumedByIndexCurrentPass[i] && getCat(i) === 'medium' &&
            !consumedByIndexCurrentPass[i+1] && getCat(i+1) === 'medium' &&
            !consumedByIndexCurrentPass[i+2] && getCat(i+2) === 'medium') {

          const tempAssignments = [...newAssignments];
          const tempRuleFlags = [...newRuleMatchedFlags];
          const tempConsumed = [...consumedByIndexCurrentPass];

          if (attemptDirectAssignment(i, "M1", tempAssignments, true, tempRuleFlags, tempConsumed) &&
              attemptDirectAssignment(i+1, "M2", tempAssignments, true, tempRuleFlags, tempConsumed) &&
              attemptDirectAssignment(i+2, "M3", tempAssignments, true, tempRuleFlags, tempConsumed)) {
            newAssignments = tempAssignments;
            newRuleMatchedFlags = tempRuleFlags;
            consumedByIndexCurrentPass.splice(0, tempConsumed.length, ...tempConsumed);
            break;
          }
        }
      }
        
      for (let i = 0; i <= n - 4; i++) {
        if (!consumedByIndexCurrentPass[i] && getCat(i) === 'low' &&
            !consumedByIndexCurrentPass[i+1] && getCat(i+1) === 'low' &&
            !consumedByIndexCurrentPass[i+2] && getCat(i+2) === 'high' &&
            !consumedByIndexCurrentPass[i+3] && getCat(i+3) === 'high') {

            const v_i = getNumericValueFromString(data[i].value);
            const v_i1 = getNumericValueFromString(data[i+1].value);
            const v_i2 = getNumericValueFromString(data[i+2].value);
            const v_i3 = getNumericValueFromString(data[i+3].value);

            if (v_i !== null && v_i1 !== null && v_i2 !== null && v_i3 !== null &&
                Math.min(v_i2, v_i3) > Math.max(v_i, v_i1) ) {
            
                const tempAssignments = [...newAssignments];
                const tempRuleFlags = [...newRuleMatchedFlags];
                const tempConsumed = [...consumedByIndexCurrentPass];

                if (attemptDirectAssignment(i, "Z3", tempAssignments, true, tempRuleFlags, tempConsumed) &&
                    attemptDirectAssignment(i+1, "Z4", tempAssignments, true, tempRuleFlags, tempConsumed) &&
                    attemptDirectAssignment(i+2, "S3", tempAssignments, true, tempRuleFlags, tempConsumed) &&
                    attemptDirectAssignment(i+3, "S4", tempAssignments, true, tempRuleFlags, tempConsumed)) {
                    newAssignments = tempAssignments;
                    newRuleMatchedFlags = tempRuleFlags;
                    consumedByIndexCurrentPass.splice(0, tempConsumed.length, ...tempConsumed);
                    break;
                }
            }
        }
      }
    
    if (!z5s7FullBlockAssigned) { 
        for (let i = 0; i <= n - 2; i++) {
            if (!consumedByIndexCurrentPass[i] && getCat(i) === 'low' &&
                !consumedByIndexCurrentPass[i+1] && getCat(i+1) === 'high') {
                
                const v_i = getNumericValueFromString(data[i].value);
                const v_i1 = getNumericValueFromString(data[i+1].value);

                if (v_i !== null && v_i1 !== null && v_i1 > v_i) { 
                    const tempAssignments = [...newAssignments];
                    const tempRuleFlags = [...newRuleMatchedFlags];
                    const tempConsumed = [...consumedByIndexCurrentPass];

                    if (attemptDirectAssignment(i, "Z5", tempAssignments, true, tempRuleFlags, tempConsumed) &&
                        attemptDirectAssignment(i+1, "S5", tempAssignments, true, tempRuleFlags, tempConsumed)) {
                        
                        newAssignments = tempAssignments;
                        newRuleMatchedFlags = tempRuleFlags;
                        consumedByIndexCurrentPass.splice(0, tempConsumed.length, ...tempConsumed);
                        break; 
                    }
                }
            }
        }
    }

    const patternBasedIdentifiers = autoAssignIdentifiersFromReceiptNumber(receiptNumber);
    let currentPatternIndex = 0; 
    
    for (let dataSlotIndex = 0; dataSlotIndex < n; dataSlotIndex++) {
        if (newAssignments[dataSlotIndex] === undefined && !consumedByIndexCurrentPass[dataSlotIndex]) {
            let filledThisDataSlot = false;
            let tempPatternSearchIndex = currentPatternIndex;
            
            while(tempPatternSearchIndex < patternBasedIdentifiers.length && !filledThisDataSlot) {
                const suggestedId = patternBasedIdentifiers[tempPatternSearchIndex];
                const isValidForCurrentStream = selectedItem === "TN/TP" ? TN_IDENTIFIERS.includes(suggestedId || '') : IDENTIFIER_OPTIONS.includes(suggestedId || '');

                if (suggestedId && isValidForCurrentStream) {
                    if (attemptDirectAssignment(dataSlotIndex, suggestedId, newAssignments, false, newRuleMatchedFlags, consumedByIndexCurrentPass)) {
                        currentPatternIndex = tempPatternSearchIndex + 1; 
                        filledThisDataSlot = true; 
                    } else {
                        tempPatternSearchIndex++;
                    }
                } else {
                    tempPatternSearchIndex++;
                }
            }
             if (!filledThisDataSlot && currentPatternIndex <= tempPatternSearchIndex) { 
                 currentPatternIndex = tempPatternSearchIndex; 
            }
        }
    }

    setProcessedOcrData(prevData => {
      if (!prevData) return null;
      const updatedData = prevData.map((entry, idx) => ({
        ...entry,
        identifier: newAssignments[idx], 
        isRuleMatched: newRuleMatchedFlags[idx]
      }));
      updateAggregatedDisplayFromProcessedData(updatedData); 
      setKtlApiCallStatus('idle');
      return updatedData;
    });

  }, [receiptNumber, processedOcrData, updateAggregatedDisplayFromProcessedData, selectedItem]);


  const handleDownloadStampedImages = useCallback(async () => {
    if (selectedImages.length === 0) {
      setProcessingError("다운로드할 이미지가 선택되지 않았습니다.");
      return;
    }
    if (!areContextFieldsValid) {
      setProcessingError("이미지에 스탬프를 찍으려면 접수번호, 현장, 항목을 입력하고 선택해주세요.");
      return;
    }
    setIsDownloadingStamped(true);
    setProcessingError(null);
    setKtlApiCallStatus('idle');
    try {
      const stampedImagesData: { name: string, dataUrl: string }[] = [];
      const sanitizedSiteLocation = sanitizeFilenameComponent(siteLocation);
      const sanitizedItem = sanitizeFilenameComponent(selectedItem === "TN/TP" ? "TN_TP" : selectedItem);

      for (let i = 0; i < selectedImages.length; i++) {
        const imageInfo = selectedImages[i];
        const stampedDataUrl = await generateStampedImage(
          imageInfo.base64, imageInfo.mimeType, receiptNumber, siteLocation,
          '', // Pass empty string for inspectionDate
          selectedItem
        );
        const originalFileName = imageInfo.file.name;
        const extension = getFileExtension(originalFileName, imageInfo.mimeType);
        const rawFileName = `${receiptNumber}_${sanitizedSiteLocation}_${sanitizedItem}_${i + 1}.${extension}`;
        stampedImagesData.push({ name: rawFileName, dataUrl: stampedDataUrl });
      }

      if (stampedImagesData.length === 0) {
        setProcessingError("성공적으로 스탬프된 이미지가 없습니다.");
        setIsDownloadingStamped(false);
        return;
      }

      const zip = new JSZip();
      for (const stampedImage of stampedImagesData) {
        const blob = dataURLtoBlob(stampedImage.dataUrl);
        zip.file(stampedImage.name, blob);
      }
      
      const rawZipFileNameBase = `${receiptNumber.replace(/-/g, '_')}_${sanitizedSiteLocation}_${sanitizedItem}`;
      const zipFileName = `${rawZipFileNameBase}_images.zip`; 

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(zipBlob);
      link.download = zipFileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);

    } catch (e: any) {
      setProcessingError(e.message || "스탬프 이미지 다운로드에 실패했습니다.");
    } finally {
      setIsDownloadingStamped(false);
    }
  }, [selectedImages, receiptNumber, siteLocation, selectedItem, areContextFieldsValid]); // inspectionStartDate removed

  const handleInitiateSendToKtl = useCallback(() => {
    if (userName === "게스트") {
      alert("게스트 사용자는 KTL로 전송할 수 없습니다.");
      return;
    }
    if (!processedOcrData || processedOcrData.length === 0) {
        alert("전송할 처리된 OCR 데이터가 없습니다.");
        return;
    }
     if (selectedImages.length === 0) {
        alert("전송할 이미지가 없습니다. 이미지를 선택하거나 촬영해주세요.");
        return;
    }
    const hasIdentifiers = processedOcrData.some(entry => 
        selectedItem === "TN/TP" ? (entry.identifier || entry.identifierTP) : entry.identifier
    );
    if (!hasIdentifiers) {
        alert("식별자가 할당된 OCR 항목이 없습니다. 전송하기 전에 식별자를 할당해주세요.");
        return;
    }
    if (!areContextFieldsValid) {
        alert("먼저 접수번호, 현장, 항목을 입력해주세요.");
        return;
    }
    if (!userName) {
        alert("사용자 이름이 설정되지 않았습니다. 앱을 다시 시작하여 이름을 입력해주세요.");
        return;
    }
    
    if (!ktlJsonPreview) { 
        alert("KTL JSON 미리보기를 생성할 수 없습니다. 데이터를 확인해주세요.");
        return;
    }

    setKtlPreflightData({
        jsonPayload: ktlJsonPreview, 
        fileNames: hypotheticalKtlFileNamesForPreview,
        context: {
            receiptNumber,
            siteLocation,
            selectedItem,
            userName,
            // inspectionStartDate: inspectionStartDate || undefined, // Removed
        }
    });
    setKtlPreflightModalOpen(true);
  }, [
    processedOcrData, 
    selectedImages.length,
    areContextFieldsValid, 
    userName, 
    ktlJsonPreview, 
    hypotheticalKtlFileNamesForPreview, 
    receiptNumber,
    siteLocation,
    selectedItem,
    // inspectionStartDate // Removed
  ]);

  const handleSendToClaydoxConfirmed = useCallback(async () => {
    setKtlPreflightModalOpen(false); 
    if (userName === "게스트") {
      setProcessingError("게스트 사용자는 KTL로 전송할 수 없습니다.");
      setKtlApiCallStatus('error');
      return;
    }
    if (!processedOcrData || !areContextFieldsValid || !userName || selectedImages.length === 0) {
      setProcessingError("KTL 전송을 위한 필수 데이터 또는 이미지가 누락되었습니다.");
      setKtlApiCallStatus('error');
      return;
    }

    setIsSendingToClaydox(true);
    setProcessingError(null);
    setKtlApiCallStatus('idle');

    const allUniquePrimaryIdentifiersFromOCR = Array.from(new Set(processedOcrData.filter(e => e.identifier).map(e => e.identifier!)));
    const identifierSequence = generateIdentifierSequence(processedOcrData, selectedItem);
    
    const payload: ClaydoxPayload = {
      receiptNumber,
      siteLocation,
      item: selectedItem,
      ocrData: processedOcrData,
      updateUser: userName,
      uniqueIdentifiersForNaming: allUniquePrimaryIdentifiersFromOCR,
      identifierSequence: identifierSequence,
      maxDecimalPlaces: maxDecimalPlacesDisplay, // Include maxDecimalPlaces
    };

    try {
      const imageInfosForComposite = selectedImages.map(img => ({ base64: img.base64, mimeType: img.mimeType }));
      const compositeDataUrl = await generateCompositeImage(
        imageInfosForComposite,
        { receiptNumber, siteLocation, item: selectedItem }, // inspectionStartDate removed from StampDetails for Page 1
        'image/jpeg' 
      );
      
      const compositeBlob = dataURLtoBlob(compositeDataUrl);

      const sanitizedSite = sanitizeFilenameComponent(siteLocation); 
      const sanitizedItemName = sanitizeFilenameComponent(selectedItem === "TN/TP" ? "TN_TP" : selectedItem); 
      const baseName = `${receiptNumber}_${sanitizedSite}_${sanitizedItemName}`;
      
      const compositeKtlFileName = `${baseName}_composite.jpg`;
      const compositeFile = new File([compositeBlob], compositeKtlFileName, { type: 'image/jpeg' });
      
      const zip = new JSZip();
      zip.file(compositeKtlFileName, compositeBlob);
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const zipKtlFileName = `${baseName}_Compression.zip`;
      const zipFile = new File([zipBlob], zipKtlFileName, { type: 'application/zip' });
      
      const filesToUpload: File[] = [compositeFile, zipFile];
      const actualKtlFileNames: string[] = [compositeKtlFileName, zipKtlFileName];
      
      const response = await sendToClaydoxApi(payload, filesToUpload, selectedItem, actualKtlFileNames); 
      alert(`KTL API 응답: ${response.message || JSON.stringify(response)}`);
      setProcessingError(null);
      setKtlApiCallStatus('success');
    } catch (error: any) {
      let errorMessage = error.message || 'KTL API 호출 중 알 수 없는 오류 발생.';
      if (typeof errorMessage === 'string' && errorMessage.toLowerCase().includes('network error')) {
        errorMessage += "\n\n(네트워크 연결, KTL 서버 CORS, 또는 서버/방화벽 문제일 수 있습니다.)";
      }
      setProcessingError(`KTL 전송 실패: ${errorMessage}`);
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
    userName,
    maxDecimalPlacesDisplay // Add dependency
  ]);

  const handleClear = useCallback(() => {
    resetImageState();
  }, [resetImageState]);

  const isExtractionDisabled = selectedImages.length === 0 || !areContextFieldsValid || isLoading || isCameraOpen || isDownloadingStamped || isSendingToClaydox;
  const isClearDisabled = selectedImages.length === 0 || isLoading || isDownloadingStamped || isSendingToClaydox;
  const isDownloadStampedDisabled = selectedImages.length === 0 || !areContextFieldsValid || isLoading || isDownloadingStamped || isSendingToClaydox;
  
  const claydoxDisabledCondition = () => {
    if (userName === "게스트") return true;
    if (!processedOcrData || !areContextFieldsValid || isLoading || isDownloadingStamped || isSendingToClaydox || !userName || selectedImages.length === 0) return true;
    const hasIdentifiers = processedOcrData.some(entry => 
        selectedItem === "TN/TP" ? (entry.identifier || entry.identifierTP) : entry.identifier
    );
    if (!hasIdentifiers && processedOcrData.length > 0) return true; 
    if (processedOcrData.length === 0 && selectedImages.length > 0) return true; 
    return false;
  };
  const isClaydoxDisabled = claydoxDisabledCondition();
  
  const isAutoAssignDisabled = !receiptNumber.trim() || !processedOcrData || processedOcrData.length === 0 || isLoading || isDownloadingStamped || isSendingToClaydox;

  const representativeImageData = currentImageIndex !== -1 && selectedImages[currentImageIndex]
                                ? selectedImages[currentImageIndex]
                                : null;

  return (
    <div className="w-full max-w-3xl bg-slate-800 shadow-2xl rounded-xl p-6 sm:p-8 space-y-6">
        <AnalysisContextForm
          receiptNumber={receiptNumber}
          onReceiptNumberChange={(val) => { setReceiptNumber(val); setKtlApiCallStatus('idle'); }}
          siteLocation={siteLocation}
          onSiteLocationChange={(val) => { setSiteLocation(val); setKtlApiCallStatus('idle'); }}
          // inspectionStartDate={inspectionStartDate} // Removed
          // onInspectionStartDateChange={(val) => { setInspectionStartDate(val); setKtlApiCallStatus('idle'); }} // Removed
          selectedItem={selectedItem}
          onSelectedItemChange={(val) => { 
            setSelectedItem(val); 
            setProcessedOcrData(null); 
            setAggregatedOcrTextForDisplay(null);
            setRangeDifferenceResults(null);
            setConcentrationBoundaries(null);
            setKtlApiCallStatus('idle'); 
            setMaxDecimalPlacesDisplay(0);
          }}
          disabled={isLoading || isCameraOpen || isDownloadingStamped || isSendingToClaydox}
        />
        {isCameraOpen ? (
          <CameraView onCapture={handleCameraCapture} onClose={handleCloseCamera} />
        ) : (
          <>
            <ImageInput
              onImagesSet={handleImagesSet}
              onOpenCamera={handleOpenCamera}
              isLoading={isLoading || isDownloadingStamped || isSendingToClaydox}
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
                // inspectionStartDate={inspectionStartDate} // Removed
                item={selectedItem}
                showOverlay={
                  (receiptNumber.trim() !== '' || siteLocation.trim() !== '' /*|| inspectionStartDate.trim() !== ''*/ || selectedItem.trim() !== '') && // inspectionStartDate removed from condition
                  representativeImageData !== null
                }
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
                disabled={isLoading || isDownloadingStamped || isSendingToClaydox}
            />
          </>
        )}
        <OcrControls
          onExtract={handleExtractText}
          onClear={handleClear}
          isExtractDisabled={isExtractionDisabled}
          isClearDisabled={isClearDisabled}
          onDownloadStampedImages={handleDownloadStampedImages}
          isDownloadStampedDisabled={isDownloadStampedDisabled}
          isDownloadingStamped={isDownloadingStamped}
          onInitiateSendToKtl={handleInitiateSendToKtl} 
          isClaydoxDisabled={isClaydoxDisabled}
          isSendingToClaydox={isSendingToClaydox}
          ktlApiCallStatus={ktlApiCallStatus}
          onAutoAssignIdentifiers={handleAutoAssignIdentifiers}
          isAutoAssignDisabled={isAutoAssignDisabled}
        />
        <OcrResultDisplay
          ocrData={processedOcrData}
          error={processingError}
          isLoading={isLoading}
          contextProvided={areContextFieldsValid}
          hasImage={selectedImages.length > 0}
          selectedItem={selectedItem} 
          onEntryIdentifierChange={handleEntryIdentifierChange} 
          onEntryIdentifierTPChange={handleEntryIdentifierTPChange} 
          onEntryTimeChange={handleEntryTimeChange}
          onEntryPrimaryValueChange={handleEntryPrimaryValueChange} 
          onEntryValueTPChange={handleEntryValueTPChange} 
          onAddEntry={handleAddEntry}
          onReorderRows={handleReorderRowsByInput}
          availableIdentifiers={IDENTIFIER_OPTIONS} 
          tnIdentifiers={TN_IDENTIFIERS}
          tpIdentifiers={TP_IDENTIFIERS}
          rawJsonForCopy={aggregatedOcrTextForDisplay}
          ktlJsonToPreview={ktlJsonPreview}
        />
        <RangeDifferenceDisplay results={rangeDifferenceResults} />
        {processedOcrData && processedOcrData.length > 0 && (
          <div className="mt-6 p-4 bg-slate-700/40 rounded-lg border border-slate-600/50 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-100 mb-2">
              데이터 형식 정보 (Data Format Information)
            </h3>
            <div className="text-sm text-slate-300">
              소수점 이하 최대 자릿수: <span className="font-medium text-sky-400">{maxDecimalPlacesDisplay}</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              현재 표시된 추출 데이터에서 가장 많은 소수점 자릿수를 나타냅니다.
            </p>
          </div>
        )}

      {isKtlPreflightModalOpen && ktlPreflightData && (
        <KtlPreflightModal
          isOpen={isKtlPreflightModalOpen}
          onClose={() => setKtlPreflightModalOpen(false)}
          onConfirm={handleSendToClaydoxConfirmed}
          preflightData={ktlPreflightData}
        />
      )}
    </div>
  );
};

export default PhotoLogPage;
