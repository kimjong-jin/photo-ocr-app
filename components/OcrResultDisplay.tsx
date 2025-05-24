
import React from 'react';
import { Spinner } from './Spinner';

interface OcrResultDisplayProps {
  ocrText: string | null; 
  error: string | null;   
  isLoading: boolean;
  receiptNumber?: string; 
  siteLocation?: string; 
  contextProvided?: boolean; 
  hasImage?: boolean; 
}

export const OcrResultDisplay: React.FC<OcrResultDisplayProps> = ({ 
    ocrText, 
    error, 
    isLoading,
    contextProvided, 
    hasImage
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

  if (ocrText) {
    return (
      <div className="mt-6">
        <h3 className="text-lg font-medium text-slate-300 mb-2">Aggregated & Deduplicated Information:</h3> 
        <div 
          className="p-4 bg-slate-700 text-slate-100 rounded-lg shadow min-h-[10rem] whitespace-pre-wrap break-words overflow-auto max-h-96"
          aria-label="Aggregated and deduplicated extracted text from all images" 
        >
          {ocrText}
        </div>
      </div>
    );
  }

  
  let placeholderMessage = "";
  if (!contextProvided) {
    placeholderMessage = "Please fill in Receipt Number and Site, then upload image(s) or use your camera.";
  } else if (!hasImage) {
    placeholderMessage = `Context provided. Now, upload image(s) or use your camera, then click "Extract Text".`;
  } else { 
    placeholderMessage = `Ready to extract data from all selected images. Click "Extract Text".`;
  }


  return (
    <div className="mt-6 p-6 bg-slate-700/30 rounded-lg shadow text-center min-h-[10rem] flex flex-col items-center justify-center">
        <p className="text-slate-400">
            {placeholderMessage}
        </p>
        {contextProvided && hasImage && ( 
             <p className="text-xs text-slate-500 mt-2">
                The AI will attempt to find time/value data from all selected images, based on the provided context. Results will be combined and deduplicated.
            </p>
        )}
    </div>
  );
};
