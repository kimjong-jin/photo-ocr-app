
import React from 'react';

interface ImagePreviewProps {
  imageBase64: string;
  fileName: string;
  mimeType: string;
  receiptNumber?: string;
  siteLocation?: string;
  // inspectionStartDate?: string; // Removed
  item?: string; 
  showOverlay?: boolean;
  totalSelectedImages?: number;
  currentImageIndex?: number;
}

export const ImagePreview: React.FC<ImagePreviewProps> = ({ 
  imageBase64, 
  fileName, 
  mimeType,
  receiptNumber,
  siteLocation,
  // inspectionStartDate, // Removed
  item, 
  showOverlay,
  totalSelectedImages,
  currentImageIndex,
}) => {
  if (!imageBase64) return null;

  const src = `data:${mimeType};base64,${imageBase64}`;

  return (
    <div className="mt-6">
      <h3 className="text-lg font-medium text-slate-300 mb-2">이미지 미리보기:</h3>
      <div className="relative bg-slate-700 p-3 rounded-lg shadow">
        <img 
          src={src} 
          alt={fileName || '미리보기'} 
          className="max-w-full max-h-96 mx-auto rounded-md object-contain" 
        />
        {showOverlay && (
          <div className="absolute top-2 right-2 bg-black/70 text-white text-xs p-2 rounded-md shadow-lg">
           {receiptNumber && <p><strong>접수번호:</strong> {receiptNumber}</p>}
           {siteLocation && <p><strong>현장:</strong> {siteLocation}</p>}
           {item && <p><strong>항목:</strong> {item}</p>} 
           {/* {inspectionStartDate && <p><strong>검사시작일:</strong> {inspectionStartDate}</p>} Removed */}
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
                이미지 {currentImageIndex + 1} / {totalSelectedImages}
            </p>
            )}
            {typeof totalSelectedImages === 'number' && totalSelectedImages > 1 && (typeof currentImageIndex !== 'number' || currentImageIndex === -1) && (
                <p className="text-xs text-sky-400">{totalSelectedImages}개 이미지 선택됨</p>
            )}
        </div>
      </div>
    </div>
  );
};
