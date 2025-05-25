
import React from 'react';

interface ImagePreviewProps {
  imageBase64: string;
  fileName: string;
  mimeType: string;
  receiptNumber?: string;
  siteLocation?: string;
  inspectionStartDate?: string;
  showOverlay?: boolean;
  totalSelectedImages?: number;
  currentImageIndex?: number; // Re-introduced
}

export const ImagePreview: React.FC<ImagePreviewProps> = ({ 
  imageBase64, 
  fileName, 
  mimeType,
  receiptNumber,
  siteLocation,
  inspectionStartDate,
  showOverlay,
  totalSelectedImages,
  currentImageIndex, // Re-introduced
}) => {
  if (!imageBase64) return null;

  const src = `data:${mimeType};base64,${imageBase64}`;

  return (
    <div className="mt-6">
      <h3 className="text-lg font-medium text-slate-300 mb-2">Image Preview:</h3>
      <div className="relative bg-slate-700 p-3 rounded-lg shadow">
        <img 
          src={src} 
          alt={fileName || 'Preview'} 
          className="max-w-full max-h-96 mx-auto rounded-md object-contain" 
        />
        {showOverlay && (
          <div className="absolute top-2 right-2 bg-black/70 text-white text-xs p-2 rounded-md shadow-lg">
           {receiptNumber && <p><strong>접수번호:</strong> {receiptNumber}</p>}
           {siteLocation && <p><strong>현장:</strong> {siteLocation}</p>}
           {inspectionStartDate && <p><strong>검사시작일:</strong> {inspectionStartDate}</p>}
          </div>

        )}
        <div className="text-center mt-2">
            {fileName && (
            <p className="text-xs text-slate-400 truncate">
                {fileName}
            </p>
            )}
            {typeof totalSelectedImages === 'number' && totalSelectedImages > 1 && typeof currentImageIndex === 'number' && currentImageIndex !== -1 && (
            <p className="text-xs text-sky-400">
                Image {currentImageIndex + 1} of {totalSelectedImages}
            </p>
            )}
            {typeof totalSelectedImages === 'number' && totalSelectedImages > 1 && (typeof currentImageIndex !== 'number' || currentImageIndex === -1) && (
                 // Fallback if currentImageIndex isn't properly set yet but we know there are multiple images
                <p className="text-xs text-sky-400">{totalSelectedImages} images selected</p>
            )}
        </div>
      </div>
    </div>
  );
};
