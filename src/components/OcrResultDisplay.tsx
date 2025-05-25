

import React from 'react';
import { Spinner } from './Spinner';
import { ExtractedEntry } from '../App'; // Import ExtractedEntry type

interface OcrResultDisplayProps {
  ocrData: ExtractedEntry[] | null; // Changed from ocrText to structured data
  error: string | null;   
  isLoading: boolean;
  contextProvided?: boolean; 
  hasImage?: boolean; 
  selectedItem?: string;
  onIdentifierChange: (entryId: string, identifierValue: string | undefined) => void; // Callback for identifier changes
  availableIdentifiers: string[]; // List of M1, M2, etc.
  rawJsonForCopy?: string | null; // To display the raw JSON if needed for copy
}

export const OcrResultDisplay: React.FC<OcrResultDisplayProps> = ({ 
    ocrData, 
    error, 
    isLoading,
    contextProvided, 
    hasImage,
    selectedItem,
    onIdentifierChange,
    availableIdentifiers,
    rawJsonForCopy
}) => {
  if (isLoading) {
    return (
      <div className="mt-6 p-6 bg-slate-700/50 rounded-lg shadow flex flex-col items-center justify-center min-h-[10rem]">
        <Spinner size="lg" />
        <p className="text-slate-300 mt-3">Processing all selected images...</p> 
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-6 p-4 bg-red-700/30 border border-red-500 text-red-300 rounded-lg shadow">
        <h3 className="font-semibold text-lg mb-1">Error</h3>
        <p className="text-sm whitespace-pre-wrap">{error}</p>
      </div>
    );
  }

  if (ocrData && ocrData.length > 0) {
    return (
      <div className="mt-6">
        <h3 className="text-lg font-medium text-slate-300 mb-1">Aggregated & Deduplicated Information:</h3>
        {selectedItem && (
            <p className="text-sm text-sky-400 mb-2">
                Analysis for Item: <strong>{selectedItem}</strong>
            </p>
        )}
        <div 
          className="p-4 bg-slate-700 text-slate-100 rounded-lg shadow min-h-[10rem] max-h-[28rem] overflow-y-auto space-y-3" // Adjusted max-h and added space-y
          aria-label="Aggregated and deduplicated extracted text from all images with identifier assignment" 
        >
          {ocrData.map((entry) => (
            <div key={entry.id} className="p-2.5 border border-slate-600 rounded-md bg-slate-700/50 flex flex-col sm:flex-row sm:items-center sm:justify-between">
              <div className="flex-1 mb-2 sm:mb-0">
                <span className="block text-sm text-slate-300">
                  <strong>Time:</strong> {entry.time}
                </span>
                <span className="block text-sm text-slate-300">
                  <strong>Value:</strong> <span className="text-sky-300">{entry.value}</span>
                </span>
              </div>
              <div className="flex items-center space-x-2 sm:w-auto w-full">
                <label htmlFor={`identifier-${entry.id}`} className="text-xs text-slate-400 whitespace-nowrap">Assign:</label>
                <select
                  id={`identifier-${entry.id}`}
                  value={entry.identifier || ''}
                  onChange={(e) => onIdentifierChange(entry.id, e.target.value === '' ? undefined : e.target.value)}
                  className="p-1.5 bg-slate-600 border border-slate-500 rounded-md text-slate-100 text-xs focus:ring-sky-500 focus:border-sky-500 w-full sm:w-auto"
                  aria-label={`Assign identifier for time ${entry.time}`}
                >
                  <option value="">지정 안함</option>
                  {availableIdentifiers.map(idOpt => (
                    <option key={idOpt} value={idOpt}>{idOpt}</option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
        {rawJsonForCopy && (
             <details className="mt-2 text-xs">
                <summary className="cursor-pointer text-slate-400 hover:text-sky-400">Show Raw JSON for Copy</summary>
                <pre className="mt-1 p-2 bg-slate-800 border border-slate-600 rounded text-slate-300 text-[0.7rem] max-h-40 overflow-auto whitespace-pre-wrap break-words">
                    {rawJsonForCopy}
                </pre>
            </details>
        )}
      </div>
    );
  }
  
  // Placeholder messages logic adjusted slightly
  let placeholderMessage = "";
  let subMessage = "";

  if (!hasImage) {
    placeholderMessage = "Please upload image(s) or use your camera to begin.";
  } else if (hasImage && !contextProvided) {
    if (!selectedItem) {
        placeholderMessage = `Image(s) selected. Please fill in Receipt Number, Site, and select an "항목" (Item) above.`;
// Fix: Cast HTMLElement to HTMLInputElement to access 'value' property.
    } else if (selectedItem && (!(document.getElementById('receipt-number') as HTMLInputElement)?.value || !(document.getElementById('site-location') as HTMLInputElement)?.value) ) { // Quick check for receipt/site if item is selected
        placeholderMessage = `Image(s) and Item ("${selectedItem}") selected. Please also fill in Receipt Number and Site.`;
    } else { // Default for missing context if item is there but other logic for areContextFieldsValid in App.tsx handles this
        placeholderMessage = `Image(s) selected. Please fill in all required fields (Receipt No., Site, Item).`;
    }
    subMessage = `All fields (Receipt No., Site, Item) are required to enable "Extract Text".`;
  } else if (ocrData && ocrData.length === 0 && !isLoading) { // No data found after processing
    placeholderMessage = `No "Time" and "Value" data found in any of the selected images for Item "${selectedItem}", or the data format was not recognized.`;
    subMessage = `Try different images or check image quality. Ensure the device screen is clear.`;
  } else if (hasImage && contextProvided) {
    placeholderMessage = `Image(s), context, and Item ("${selectedItem}") provided. Ready to "Extract Text".`;
    subMessage = `The AI will attempt to find time/value data for item "${selectedItem}" from all selected images. Results will be combined and deduplicated.`
  } else {
    placeholderMessage = "Upload images and provide context to begin."; // General fallback
  }


  return (
    <div className="mt-6 p-6 bg-slate-700/30 rounded-lg shadow text-center min-h-[10rem] flex flex-col items-center justify-center">
        <p className="text-slate-400">
            {placeholderMessage}
        </p>
        {subMessage && ( 
             <p className="text-xs text-slate-500 mt-2">
                {subMessage}
            </p>
        )}
    </div>
  );
};