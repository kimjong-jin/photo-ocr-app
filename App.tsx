
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Header } from './components/Header';
import { ImageInput, ImageInfo } from './components/ImageInput';
import { CameraView } from './components/CameraView';
import { ImagePreview } from './components/ImagePreview';
import { OcrControls } from './components/OcrControls';
import { OcrResultDisplay } from './components/OcrResultDisplay';
import { Footer } from './components/Footer';
import AnalysisContextForm from './components/AdditionalInfoInput';
import { RangeDifferenceDisplay, RangeResults as DisplayRangeResults, RangeStat } from './components/RangeDifferenceDisplay';
import { extractTextFromImage } from './services/geminiService';
import { generateStampedImage, dataURLtoBlob } from './services/imageStampingService';
import { sendToClaydoxApi, ClaydoxPayload } from './services/claydoxApiService'; 
import JSZip from 'jszip';

// Define the static list of assignable identifiers
const IDENTIFIER_OPTIONS = Array.from(new Set([ 
  "M1", "M2", "M3", "Z5", "S5", "Z1", "Z2", "S1", "S2", 
  "Z3", "Z4", "S3", "S4", "Z6", "S6", "Z7", "S7",
  "현장1", "현장2" // Added "현장1", "현장2" as static options
]));

export interface ExtractedEntry {
  id: string; 
  time: string;
  value: string;
  identifier?: string; 
}

type AppRangeResults = DisplayRangeResults;

const App: React.FC = () => {
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
  const [inspectionStartDate, setInspectionStartDate] = useState<string>('');
  const [selectedItem, setSelectedItem] = useState<string>('');
  // Removed site1 and site2 state
  const [areContextFieldsValid, setAreContextFieldsValid] = useState<boolean>(false);
  const [rangeDifferenceResults, setRangeDifferenceResults] = useState<AppRangeResults | null>(null);
  const [isSendingToClaydox, setIsSendingToClaydox] = useState<boolean>(false);

  // Removed dynamicIdentifierOptions useMemo as it's no longer needed
  // IDENTIFIER_OPTIONS is now static

  useEffect(() => {
    setAreContextFieldsValid(
      receiptNumber.trim() !== '' &&
      siteLocation.trim() !== '' &&
      selectedItem.trim() !== ''
    );
  }, [receiptNumber, siteLocation, selectedItem]);

  useEffect(() => {
    if (!processedOcrData || processedOcrData.length === 0) {
      setRangeDifferenceResults(null);
      return;
    }
    try {
      const allNumericValues: number[] = [];
      processedOcrData.forEach(entry => {
        const match = typeof entry.value === 'string' ? entry.value.match(/(-?\d+(\.\d+)?)/) : null;
        if (match && match[0]) {
          const numericValue = parseFloat(match[0]);
          if (!isNaN(numericValue)) {
            allNumericValues.push(numericValue);
          }
        }
      });
      const uniqueNumericValues = Array.from(new Set(allNumericValues));
      if (uniqueNumericValues.length < 3) {
        setRangeDifferenceResults({ low: null, medium: null, high: null });
        return;
      }
      const overallMin = Math.min(...allNumericValues);
      const overallMax = Math.max(...allNumericValues);
      const span = overallMax - overallMin;
      if (span === 0) {
        setRangeDifferenceResults({ low: null, medium: null, high: null });
        return;
      }
      const boundary1 = overallMin + span / 3;
      const boundary2 = overallMin + (2 * span) / 3;
      const lowValues: number[] = [];
      const mediumValues: number[] = [];
      const highValues: number[] = [];
      allNumericValues.forEach(numericValue => {
        if (numericValue <= boundary1) lowValues.push(numericValue);
        else if (numericValue > boundary1 && numericValue <= boundary2) mediumValues.push(numericValue);
        else highValues.push(numericValue);
      });
      const calculateRangeDetails = (values: number[]): RangeStat | null => {
        if (values.length < 2) return null;
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
      console.error("Error processing data for automatic range analysis:", e);
      setRangeDifferenceResults(null);
    }
  }, [processedOcrData]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetImageState = useCallback(() => {
    setSelectedImages([]);
    setCurrentImageIndex(-1);
    setProcessedOcrData(null);
    setAggregatedOcrTextForDisplay(null);
    setProcessingError(null);
    setIsCameraOpen(false);
    setRangeDifferenceResults(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleImagesSet = useCallback((images: ImageInfo[]) => {
    resetImageState();
    if (images.length > 0) {
      setSelectedImages(images);
      setCurrentImageIndex(0);
      setProcessingError(null);
      setProcessedOcrData(null);
      setAggregatedOcrTextForDisplay(null);
    }
  }, [resetImageState]);

  const handleOpenCamera = useCallback(() => {
    resetImageState();
    setIsCameraOpen(true);
    setProcessingError(null);
  }, [resetImageState]);

  const handleCameraCapture = useCallback((file: File, b64: string, captureMimeType: string) => {
    const capturedImageInfo: ImageInfo = { file, base64: b64, mimeType: captureMimeType };
    setSelectedImages([capturedImageInfo]);
    setCurrentImageIndex(0);
    setProcessedOcrData(null);
    setAggregatedOcrTextForDisplay(null);
    setProcessingError(null);
    setIsCameraOpen(false);
  }, []);

  const handleCloseCamera = useCallback(() => {
    setIsCameraOpen(false);
  }, []);

  const handleNextImage = useCallback(() => {
    setCurrentImageIndex(prevIndex =>
      prevIndex < selectedImages.length - 1 ? prevIndex + 1 : prevIndex
    );
  }, [selectedImages.length]);

  const handlePreviousImage = useCallback(() => {
    setCurrentImageIndex(prevIndex => (prevIndex > 0 ? prevIndex - 1 : prevIndex));
  }, []);
  
  const generatePromptForProAnalysis = (
    receiptNum: string,
    siteLoc: string,
    item: string
  ): string => {
    const fenceJson = '```json.';
    let prompt = `Analyze the provided image from a measurement device.
Context:`;
    if (receiptNum) prompt += `\n- Receipt Number: ${receiptNum}`;
    if (siteLoc) prompt += `\n- Site/Location: ${siteLoc}`;
    if (item) prompt += `\n- Item/Parameter: ${item}. This is the primary data of interest, but also extract other Time/Value pairs if present.`;
    if (!receiptNum && !siteLoc && !item) prompt += `\n- No specific receipt number, site location, or item provided. Analyze generally for Time/Value pairs.`;
    prompt += `

Task:
From the image, identify any data table or list.
Extract ALL "Time" (시각) and "Value" (값) pairs visible on the device's screen.
The output MUST be a valid JSON array of objects. Each object represents a single measurement.

Example JSON Output Format:
[
  { "time": "2025/04/23 05:00", "value": "46.2 mg/L" },
  { "time": "2025/04/23 06:00", "value": "44.9 mg/L" }
]

Specific Instructions for JSON Output and Data Extraction:
1.  The entire response MUST be a single, valid JSON array. Do NOT include any non-JSON text, introductory phrases, explanations, or markdown fences like ${fenceJson}
2.  Prioritize data related to the specified "Item/Parameter" if provided, but ensure ALL discernible "Time" (시각) and "Value" (값) pairs from the device's screen are extracted.
3.  "Time" (시각): Prepend any common date found on the screen to each time entry. Standardize time format (YYYY/MM/DD HH:MM or YYYY-MM-DD HH:MM:SS). If only time is present, use it as is, but if a date is clearly part of the display, combine it.
4.  "Value" (값): Combine numerical readings WITH THEIR UNITS (e.g., "mg/L", "ABS", "°C") into this single "value" field. If no unit is clearly associated, use the number.
5.  Exclude camera-generated timestamps and UI button text unless part of actual data.
6.  If no "Time" and "Value" pairs are found AT ALL on the device's screen, or if the image does not contain a recognizable data display, return an empty JSON array: [].
7.  Do not include any "reactors_input" or "reactors_output" or similar markers.
`;
    return prompt;
  };

  const handleExtractText = useCallback(async () => {
    if (selectedImages.length === 0) {
      setProcessingError("Please select or capture images first.");
      return;
    }
    if (!areContextFieldsValid) {
        setProcessingError("Please fill in Receipt Number, Site, and select an Item to extract text.");
        return;
    }
    setIsLoading(true);
    setProcessingError(null);
    setProcessedOcrData(null);
    setAggregatedOcrTextForDisplay(null);
    setRangeDifferenceResults(null);
    const allRawExtractedEntries: { time: string; value: string }[] = [];
    let batchHadError = false;
    let criticalErrorOccurred: string | null = null;
    try {
      if (!process.env.API_KEY) throw new Error("API_KEY environment variable is not set.");
      const imageProcessingPromises = selectedImages.map(async (currentImage) => {
        try {
          const currentPrompt = generatePromptForProAnalysis(receiptNumber, siteLocation, selectedItem);
          const modelConfig = { responseMimeType: "application/json" };
          const resultText = await extractTextFromImage(currentImage.base64, currentImage.mimeType, currentPrompt, modelConfig);
          let jsonStr = resultText.trim();
          const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
          const match = jsonStr.match(fenceRegex);
          if (match && match[2]) jsonStr = match[2].trim();
          jsonStr = jsonStr.replace(/}\s*reactors_input\s*{/g, '}, {').replace(/}\s*reactors_output\s*{/g, '}, {');
          if (jsonStr !== "") {
            const jsonDataFromImage = JSON.parse(jsonStr) as { time: string; value: string }[];
            if (Array.isArray(jsonDataFromImage)) return { status: 'fulfilled', value: jsonDataFromImage, imageName: currentImage.file.name };
            console.warn(`Image ${currentImage.file.name} did not return a JSON array. Raw response:\n${jsonStr}`);
            return { status: 'rejected', reason: `Image ${currentImage.file.name} did not return a valid JSON array.`, imageName: currentImage.file.name };
          }
          console.warn(`Image ${currentImage.file.name} returned an empty response from AI.`);
          return { status: 'fulfilled', value: [], imageName: currentImage.file.name }; 
        } catch (imgErr: any) {
          console.error(`Error processing image ${currentImage.file.name}:`, imgErr);
          if (imgErr.message.includes("API_KEY") || imgErr.message.includes("API Key") || imgErr.message.includes("Quota exceeded") || imgErr.message.includes("Invalid Gemini API Key")) {
            criticalErrorOccurred = imgErr.message + " Check API Key or Quota.";
          }
          return { status: 'rejected', reason: imgErr.message || `Failed to process image ${currentImage.file.name}`, imageName: currentImage.file.name };
        }
      });
      const results = await Promise.allSettled(imageProcessingPromises);
      results.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
            const imageData = (result.value as any).value || result.value; 
            if (Array.isArray(imageData)) {
                 imageData.forEach(entry => {
                    if (entry && typeof entry.time === 'string' && typeof entry.value === 'string') allRawExtractedEntries.push(entry);
                    else console.warn("Skipping invalid entry from image:", (result.value as any).imageName || 'unknown image', entry);
                });
            }
        } else if (result.status === 'rejected') {
          batchHadError = true;
          console.error(`Failed to process image ${(result as any).imageName}:`, result.reason);
        }
      });
      if (criticalErrorOccurred) { 
        setProcessingError(criticalErrorOccurred);
        setProcessedOcrData(null); 
        setAggregatedOcrTextForDisplay(null);
      } else if (allRawExtractedEntries.length > 0) {
        const uniqueEntriesMap = new Map<string, { time: string; value: string }>();
        allRawExtractedEntries.sort((a, b) => a.time.localeCompare(b.time));
        allRawExtractedEntries.forEach(entry => {
          if (!uniqueEntriesMap.has(entry.time)) uniqueEntriesMap.set(entry.time, entry);
        });
        const deduplicatedRawData = Array.from(uniqueEntriesMap.values());
        const finalProcessedData = deduplicatedRawData.map(entry => ({
          id: entry.time, time: entry.time, value: entry.value, identifier: undefined 
        }));
        setProcessedOcrData(finalProcessedData);
        setAggregatedOcrTextForDisplay(JSON.stringify(deduplicatedRawData, null, 2));
        if (batchHadError) setProcessingError("Some images could not be processed or returned no data. Results shown are from successfully processed images. Check console for details.");
        else setProcessingError(null); 
      } else { 
        if (batchHadError) {
          setProcessingError(`No data extracted. One or more images could not be processed. Check console for details.`);
        } else {
            setProcessingError(null); 
            setAggregatedOcrTextForDisplay(`No "Time" and "Value" data found in any of the selected images, or the data format was not recognized.`);
            setProcessedOcrData([]);
        }
      }
    } catch (e: any) { 
      console.error("Error during text extraction setup or API key check:", e);
      if (!processingError && !criticalErrorOccurred) setProcessingError(e.message || "Failed to extract data. Check console.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedImages, receiptNumber, siteLocation, selectedItem, areContextFieldsValid, processingError]);

  const handleIdentifierChange = useCallback((entryId: string, newIdentifierValue: string | undefined) => {
    setProcessedOcrData(prevData => {
      if (!prevData) return null;
      return prevData.map(entry =>
        entry.id === entryId
          ? { ...entry, identifier: newIdentifierValue === '' ? undefined : newIdentifierValue }
          : entry
      );
    });
  }, []);

  const handleDownloadStampedImages = useCallback(async () => {
    if (selectedImages.length === 0) {
      setProcessingError("No images selected to download.");
      return;
    }
    if (!areContextFieldsValid) { 
      setProcessingError("Please fill in Receipt Number, Site, and select an Item to stamp images.");
      return;
    }
    setIsDownloadingStamped(true);
    setProcessingError(null);
    try {
      const stampedImagesData: { name: string, dataUrl: string }[] = [];
      for (let i = 0; i < selectedImages.length; i++) {
        const imageInfo = selectedImages[i];
        const stampedDataUrl = await generateStampedImage(
          imageInfo.base64, imageInfo.mimeType, receiptNumber, siteLocation, 
          inspectionStartDate, selectedItem // Removed site1, site2
        );
        const originalFileName = imageInfo.file.name;
        const extension = originalFileName.substring(originalFileName.lastIndexOf('.') + 1);
        stampedImagesData.push({ 
          name: `${receiptNumber}_${selectedItem}_${i + 1}.${extension}`, 
          dataUrl: stampedDataUrl 
        });
      }
      if (stampedImagesData.length === 0) {
        setProcessingError("No images were successfully stamped.");
        setIsDownloadingStamped(false);
        return;
      }
      const zip = new JSZip();
      for (const stampedImage of stampedImagesData) {
        const blob = dataURLtoBlob(stampedImage.dataUrl);
        zip.file(stampedImage.name, blob);
      }
      const zipFileName = `${receiptNumber}_${selectedItem}_images.zip`;
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(zipBlob);
      link.download = zipFileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch (e: any) {
      console.error("Error during stamped image download:", e);
      setProcessingError(e.message || "Failed to download stamped images.");
    } finally {
      setIsDownloadingStamped(false);
    }
  }, [selectedImages, receiptNumber, siteLocation, inspectionStartDate, selectedItem, areContextFieldsValid]);

  const handleSendToClaydox = useCallback(async () => {
    if (!processedOcrData || processedOcrData.length === 0) {
      alert("No processed OCR data with identifiers to send.");
      return;
    }
    if (!areContextFieldsValid) {
        alert("Please fill in Receipt Number, Site, and Item first.");
        return;
    }

    setIsSendingToClaydox(true);
    setProcessingError(null); 

    const payload: ClaydoxPayload = {
      receiptNumber,
      siteLocation,
      item: selectedItem,
      inspectionStartDate: inspectionStartDate || undefined,
      // Removed site1, site2
      ocrData: processedOcrData,
    };

    let imagesZipBlob: Blob | undefined = undefined;
    if (selectedImages.length > 0) { 
        try {
            const zip = new JSZip();
            for (let i = 0; i < selectedImages.length; i++) {
                const imageInfo = selectedImages[i];
                const blob = dataURLtoBlob(`data:${imageInfo.mimeType};base64,${imageInfo.base64}`);
                const originalFileName = imageInfo.file.name;
                const extension = originalFileName.substring(originalFileName.lastIndexOf('.') + 1);
                zip.file(`${receiptNumber}_${selectedItem}_original_${i + 1}.${extension}`, blob);
            }
            imagesZipBlob = await zip.generateAsync({ type: "blob" });
        } catch (zipError) {
            console.error("Error creating ZIP for Claydox:", zipError);
            setProcessingError("Failed to prepare images for sending. Please try again.");
            setIsSendingToClaydox(false);
            return;
        }
    }

    try {
      const response = await sendToClaydoxApi(payload, imagesZipBlob); 
      alert(`Claydox API Response: ${response.message || JSON.stringify(response)}`);
    } catch (error: any) {
      console.error("Failed to send data to Claydox via service:", error);
      const errorMessage = error.message || 'Unknown error during Claydox API call.';
      setProcessingError(`Failed to send to Claydox: ${errorMessage}`);
      alert(`Failed to send to Claydox: ${errorMessage}`);
    } finally {
      setIsSendingToClaydox(false);
    }
  }, [
    processedOcrData, 
    receiptNumber, 
    siteLocation, 
    selectedItem, 
    inspectionStartDate, 
    // Removed site1, site2 dependencies
    areContextFieldsValid,
    selectedImages 
  ]);


  const handleClear = useCallback(() => {
    resetImageState();
  }, [resetImageState]);

  const isExtractionDisabled = selectedImages.length === 0 || !areContextFieldsValid || isLoading || isCameraOpen || isDownloadingStamped || isSendingToClaydox;
  const isClearDisabled = selectedImages.length === 0 || isLoading || isDownloadingStamped || isSendingToClaydox;
  const isDownloadStampedDisabled = selectedImages.length === 0 || !areContextFieldsValid || isLoading || isDownloadingStamped || isSendingToClaydox;
  const isClaydoxDisabled = !processedOcrData || processedOcrData.length === 0 || !areContextFieldsValid || isLoading || isDownloadingStamped || isSendingToClaydox;
  
  const representativeImageData = currentImageIndex !== -1 && selectedImages[currentImageIndex] 
                                ? selectedImages[currentImageIndex] 
                                : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-slate-100 flex flex-col items-center p-4 sm:p-8 font-[Inter]">
      <Header />
      <main className="w-full max-w-3xl bg-slate-800 shadow-2xl rounded-xl p-6 sm:p-8 space-y-6">
        <AnalysisContextForm
          receiptNumber={receiptNumber}
          onReceiptNumberChange={setReceiptNumber}
          siteLocation={siteLocation}
          onSiteLocationChange={setSiteLocation}
          inspectionStartDate={inspectionStartDate}
          onInspectionStartDateChange={setInspectionStartDate}
          selectedItem={selectedItem}
          onSelectedItemChange={setSelectedItem}
          // Removed site1, site2 props
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
                inspectionStartDate={inspectionStartDate}
                item={selectedItem}
                // Removed site1, site2 props
                showOverlay={
                  (receiptNumber.trim() !== '' || siteLocation.trim() !== '' || inspectionStartDate.trim() !== '' || selectedItem.trim() !== '') && 
                  representativeImageData !== null
                }
                totalSelectedImages={selectedImages.length}
                currentImageIndex={currentImageIndex} 
              />
            )}
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
          onPreviousImage={handlePreviousImage}
          onNextImage={handleNextImage}
          isPreviousDisabled={currentImageIndex <= 0}
          isNextDisabled={currentImageIndex >= selectedImages.length - 1 || selectedImages.length === 0}
          currentImageIndex={currentImageIndex}
          totalImages={selectedImages.length}
          onSendToClaydox={handleSendToClaydox}
          isClaydoxDisabled={isClaydoxDisabled}
          isSendingToClaydox={isSendingToClaydox}
        />
        <OcrResultDisplay
          ocrData={processedOcrData}
          error={processingError} 
          isLoading={isLoading} 
          contextProvided={areContextFieldsValid} 
          hasImage={selectedImages.length > 0}
          selectedItem={selectedItem}
          onIdentifierChange={handleIdentifierChange}
          availableIdentifiers={IDENTIFIER_OPTIONS} // Pass static options
          rawJsonForCopy={aggregatedOcrTextForDisplay}
        />
        <RangeDifferenceDisplay results={rangeDifferenceResults} />
      </main>
      <Footer />
    </div>
  );
};

export default App;
