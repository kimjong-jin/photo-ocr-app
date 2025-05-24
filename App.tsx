
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Header } from './components/Header';
import { ImageInput, ImageInfo } from './components/ImageInput';
import { CameraView } from './components/CameraView';
import { ImagePreview } from './components/ImagePreview';
import { OcrControls } from './components/OcrControls';
import { OcrResultDisplay } from './components/OcrResultDisplay';
import { Footer } from './components/Footer';
import { AnalysisContextForm } from './components/AdditionalInfoInput';
import { RangeDifferenceDisplay, RangeResults as DisplayRangeResults, RangeStat } from './components/RangeDifferenceDisplay';
import { extractTextFromImage } from './services/geminiService';
import { generateStampedImage, dataURLtoBlob } from './services/imageStampingService';
import JSZip from 'jszip';

interface ExtractedEntry {
  time: string;
  value: string;
}

type AppRangeResults = DisplayRangeResults;

const App: React.FC = () => {
  const [selectedImages, setSelectedImages] = useState<ImageInfo[]>([]);
  const [currentImageIndex, setCurrentImageIndex] = useState<number>(-1); // Re-introduced
  const [aggregatedOcrText, setAggregatedOcrText] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isDownloadingStamped, setIsDownloadingStamped] = useState<boolean>(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState<boolean>(false);

  const [receiptNumber, setReceiptNumber] = useState<string>('');
  const [siteLocation, setSiteLocation] = useState<string>('');
  const [inspectionStartDate, setInspectionStartDate] = useState<string>(new Date().toISOString().split('T')[0]);

  const [areContextFieldsValid, setAreContextFieldsValid] = useState<boolean>(false);
  const [rangeDifferenceResults, setRangeDifferenceResults] = useState<AppRangeResults | null>(null);

  useEffect(() => {
    setAreContextFieldsValid(receiptNumber.trim() !== '' && siteLocation.trim() !== '');
  }, [receiptNumber, siteLocation]);

  useEffect(() => {
    if (!aggregatedOcrText) {
      setRangeDifferenceResults(null);
      return;
    }

    try {
      const parsedOcrData = JSON.parse(aggregatedOcrText) as ExtractedEntry[];
      if (!Array.isArray(parsedOcrData) || parsedOcrData.length === 0) {
        setRangeDifferenceResults(null);
        return;
      }

      const allNumericValues: number[] = [];
      parsedOcrData.forEach(entry => {
        // Robust parsing of numeric value, handling potential units
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

      if (span === 0) { // All values are the same or effectively no range
        setRangeDifferenceResults({ low: null, medium: null, high: null });
        return;
      }

      const boundary1 = overallMin + span / 3;
      const boundary2 = overallMin + (2 * span) / 3;

      const lowValues: number[] = [];
      const mediumValues: number[] = [];
      const highValues: number[] = [];

      allNumericValues.forEach(numericValue => {
        if (numericValue <= boundary1) {
          lowValues.push(numericValue);
        } else if (numericValue > boundary1 && numericValue <= boundary2) {
          mediumValues.push(numericValue);
        } else { 
          highValues.push(numericValue);
        }
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
  }, [aggregatedOcrText]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetImageState = useCallback(() => {
    setSelectedImages([]);
    setCurrentImageIndex(-1); // Reset index
    setAggregatedOcrText(null);
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
      setCurrentImageIndex(0); // Set to first image
      setProcessingError(null);
      setAggregatedOcrText(null); 
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
    setCurrentImageIndex(0); // Set to the captured image
    setAggregatedOcrText(null); 
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
  ): string => {
    let prompt = `Analyze the provided image from a measurement device.
Context:`;
    if (receiptNum) {
        prompt += `\n- Receipt Number: ${receiptNum} (This is critical context for identifying the relevant data. Do not repeat this in the output unless it's part of the image's data.)`;
    }
    if (siteLoc) {
        prompt += `\n- Site/Location: ${siteLoc} (This is critical context for identifying the relevant data. Do not repeat this in the output unless it's part of the image's data.)`;
    }
    if (!receiptNum && !siteLoc) {
        prompt += `\n- No specific receipt number or site location provided. Analyze generally.`;
    }

    prompt += `

Task:
From the image, identify any data table or list.
Extract all "Time" (시각) and "Value" (값) pairs.
The output MUST be a valid JSON array of objects. Each object represents a single measurement.

Example JSON Output Format:
[
  { "time": "2025/04/23 05:00", "value": "46.2 mg/L" },
  { "time": "2025/04/23 06:00", "value": "44.9 mg/L" }
]

Specific Instructions for JSON Output and Data Extraction:
1.  The entire response MUST be a single, valid JSON array. Do NOT include any non-JSON text, introductory phrases, explanations, or markdown fences like \`\`\`json. The output will be directly parsed.
2.  JSON objects within the array must be separated by commas.
3.  Focus ONLY on the data displayed on the device's screen.
4.  "Time" (시각): Prepend any common date (e.g., "2025/04/23") found on the screen to each time entry (e.g., "2025/04/23 05:00"). Standardize time format to YYYY/MM/DD HH:MM or YYYY-MM-DD HH:MM:SS.
5.  "Value" (값): Crucially, combine numerical readings WITH THEIR UNITS (e.g., "mg/L", "ABS", "°C" from a "단위" column or near the value) into this single "value" field (e.g., "46.2 mg/L", "0.140 ABS"). Be consistent. If no unit is clearly associated, use the number.
6.  Exclude camera-generated timestamps (usually at image borders).
7.  Exclude UI button text (e.g., "BACK", "인쇄", "L1", "측정값 X/Y", "Data", "종료") unless they are part of the actual data values themselves.
8.  If no relevant time/value data is found, or the table is empty, return an empty JSON array: [].
9.  Do not include any "reactors_input" or "reactors_output" or similar internal processing markers or non-JSON text between JSON objects.
`;
    return prompt;
  };

  const handleExtractText = useCallback(async () => {
    if (selectedImages.length === 0) {
      setProcessingError("Please select or capture images first.");
      return;
    }
    if (!areContextFieldsValid) {
      setProcessingError("Please fill in the required fields: Receipt Number and Site.");
      return;
    }

    setIsLoading(true);
    setProcessingError(null);
    setAggregatedOcrText(null);
    setRangeDifferenceResults(null); 

    const allExtractedEntries: ExtractedEntry[] = [];
    let batchHadError = false;
    let criticalErrorOccurred = null;

    try {

      // Process ALL selected images for text extraction
      for (let i = 0; i < selectedImages.length; i++) {
        const currentImage = selectedImages[i];
        try {
          const currentPrompt = generatePromptForProAnalysis(receiptNumber, siteLocation);
          const modelConfig = { responseMimeType: "application/json" };
          const resultText = await extractTextFromImage(currentImage.base64, currentImage.mimeType, currentPrompt, modelConfig);
          
          let jsonStr = resultText.trim();
          const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
          const match = jsonStr.match(fenceRegex);
          if (match && match[2]) {
            jsonStr = match[2].trim();
          }
          jsonStr = jsonStr.replace(/}\s*reactors_input\s*{/g, '}, {');
          jsonStr = jsonStr.replace(/}\s*reactors_output\s*{/g, '}, {');

          if (jsonStr !== "") {
            const jsonDataFromImage = JSON.parse(jsonStr) as ExtractedEntry[];
            if (Array.isArray(jsonDataFromImage)) {
              jsonDataFromImage.forEach(entry => {
                if (entry && typeof entry.time === 'string' && typeof entry.value === 'string') {
                  allExtractedEntries.push(entry);
                } else {
                  console.warn("Skipping invalid entry from image:", currentImage.file.name, entry);
                }
              });
            } else {
              console.warn(`Image ${currentImage.file.name} did not return a JSON array. Raw response:\n${jsonStr}`);
              batchHadError = true;
            }
          } else {
            console.warn(`Image ${currentImage.file.name} returned an empty response from AI.`);
          }
        } catch (imgErr: any) {
          console.error(`Error processing image ${currentImage.file.name}:`, imgErr);
          batchHadError = true; 
          if (imgErr.message.includes("API_KEY") || imgErr.message.includes("API Key") || imgErr.message.includes("Quota exceeded") || imgErr.message.includes("Invalid Gemini API Key")) {
             criticalErrorOccurred = imgErr.message + " Batch processing halted.";
             break; 
          }
        }
      }

      if (criticalErrorOccurred) {
        setProcessingError(criticalErrorOccurred);
      } else if (allExtractedEntries.length > 0) {
        const uniqueEntriesMap = new Map<string, ExtractedEntry>();
        allExtractedEntries.forEach(entry => {
          if (!uniqueEntriesMap.has(entry.time)) { // Simple time-based deduplication
            uniqueEntriesMap.set(entry.time, entry);
          }
        });
        const deduplicatedData = Array.from(uniqueEntriesMap.values());
        setAggregatedOcrText(JSON.stringify(deduplicatedData, null, 2));
        if(batchHadError) {
            setProcessingError("Some images could not be processed or returned no data. Results shown are from successfully processed images.");
        }
      } else {
        setAggregatedOcrText(batchHadError ? "No data extracted. One or more images could not be processed." : "No data found in any of the selected images.");
      }

    } catch (e: any) { 
      console.error("Batch OCR Error:", e);
      if (!processingError && !criticalErrorOccurred) { 
         setProcessingError(e.message || "Failed to extract data from batch. Check console.");
      }
    } finally {
      setIsLoading(false);
    }
  }, [selectedImages, receiptNumber, siteLocation, areContextFieldsValid]);

  const handleDownloadStampedImages = useCallback(async () => {
    if (selectedImages.length === 0) {
      setProcessingError("No images selected to download.");
      return;
    }
    if (!areContextFieldsValid) {
      setProcessingError("Please fill in Receipt Number and Site to stamp images.");
      return;
    }

    setIsDownloadingStamped(true);
    setProcessingError(null);

    try {
      const stampedImagesData: { name: string, dataUrl: string }[] = [];
      // Process ALL selected images for stamping
      for (const imageInfo of selectedImages) {
        const stampedDataUrl = await generateStampedImage(
          imageInfo.base64,
          imageInfo.mimeType,
          receiptNumber,
          siteLocation,
          inspectionStartDate
        );
        const originalFileName = imageInfo.file.name;
        const extension = originalFileName.substring(originalFileName.lastIndexOf('.'));
        const baseName = originalFileName.substring(0, originalFileName.lastIndexOf('.'));
        stampedImagesData.push({ name: `${baseName}_stamped${extension}`, dataUrl: stampedDataUrl });
      }

      if (stampedImagesData.length === 0) {
        setProcessingError("No images were successfully stamped.");
        setIsDownloadingStamped(false);
        return;
      }

      if (stampedImagesData.length > 1) {
        const zip = new JSZip();
        for (const stampedImage of stampedImagesData) {
          const blob = dataURLtoBlob(stampedImage.dataUrl);
          zip.file(stampedImage.name, blob);
        }
        const zipBlob = await zip.generateAsync({ type: "blob" });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(zipBlob);
        link.download = `stamped_images_${new Date().toISOString().split('T')[0]}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
      } else { 
        const stampedImage = stampedImagesData[0];
        const link = document.createElement('a');
        link.href = stampedImage.dataUrl;
        link.download = stampedImage.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (e: any) {
      console.error("Error during stamped image download:", e);
      setProcessingError(e.message || "Failed to download stamped images.");
    } finally {
      setIsDownloadingStamped(false);
    }
  }, [selectedImages, receiptNumber, siteLocation, inspectionStartDate, areContextFieldsValid]);

  const handleClear = useCallback(() => {
    resetImageState();
  }, [resetImageState]);

  const isExtractionDisabled = selectedImages.length === 0 || isLoading || isCameraOpen || !areContextFieldsValid || isDownloadingStamped;
  const isClearDisabled = selectedImages.length === 0 || isLoading || isDownloadingStamped;
  const isDownloadStampedDisabled = selectedImages.length === 0 || !areContextFieldsValid || isLoading || isDownloadingStamped;
  
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
          disabled={isLoading || isCameraOpen || isDownloadingStamped}
        />

        {isCameraOpen ? (
          <CameraView onCapture={handleCameraCapture} onClose={handleCloseCamera} />
        ) : (
          <>
            <ImageInput
              onImagesSet={handleImagesSet}
              onOpenCamera={handleOpenCamera}
              isLoading={isLoading || isDownloadingStamped}
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
                showOverlay={areContextFieldsValid && representativeImageData !== null}
                totalSelectedImages={selectedImages.length}
                currentImageIndex={currentImageIndex} // Pass currentImageIndex
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
          // Navigation props
          onPreviousImage={handlePreviousImage}
          onNextImage={handleNextImage}
          isPreviousDisabled={currentImageIndex <= 0}
          isNextDisabled={currentImageIndex >= selectedImages.length - 1 || selectedImages.length === 0}
          currentImageIndex={currentImageIndex}
          totalImages={selectedImages.length}
        />
        
        <OcrResultDisplay
          ocrText={aggregatedOcrText}
          error={processingError} 
          isLoading={isLoading} 
          receiptNumber={receiptNumber}
          siteLocation={siteLocation}
          contextProvided={areContextFieldsValid}
          hasImage={selectedImages.length > 0}
        />
        
        <RangeDifferenceDisplay results={rangeDifferenceResults} />

      </main>
      <Footer />
    </div>
  );
};

export default App;
