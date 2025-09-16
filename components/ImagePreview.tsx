import React from 'react';
import { ActionButton } from './ActionButton';

interface ImagePreviewProps {
  imageBase64: string;
  fileName: string;
  mimeType: string;
  receiptNumber?: string;
  // siteLocation?: string; // ✅ 주소는 이제 화면에서 제거
  item?: string;
  comment?: string;
  showOverlay?: boolean;
  totalSelectedImages?: number;
  currentImageIndex?: number;
  onDelete?: () => void;
}

const DeleteIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" 
       viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" 
       className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" 
      d="M14.74 9l-.346 9m-4.788 0L9.26 9
         m9.968-3.21c.342.052.682.107 1.022.166
         m-1.022-.165L18.16 19.673a2.25 2.25 
         0 01-2.244 2.077H8.084a2.25 2.25 
         0 01-2.244-2.077L4.772 5.79
         m14.456 0a48.108 48.108 0 
         00-3.478-.397m-12.56 0c1.153 
         0 2.24.03 3.22.077m3.22-.077L10.88 
         5.79m2.558 0c-.29.042-.58.083-.87.124" />
  </svg>
);

export const ImagePreview: React.FC<ImagePreviewProps> = ({
  imageBase64,
  fileName,
  mimeType,
  receiptNumber,
  item,
  comment,
  showOverlay,
  totalSelectedImages,
  currentImageIndex,
  onDelete,
}) => {
  if (!imageBase64) return null;

  const src = `data:${mimeType};base64,${imageBase64}`;

  return (
    <div className="mt-6">
      <h3 className="text-lg font-medium text-slate-300 mb-2">이미지 미리보기:</h3>
      <div className="relative bg-slate-700 p-3 rounded-lg shadow">
        {onDelete && (
          <ActionButton
            onClick={onDelete}
            variant="danger"
            className="absolute top-2 left-2 !p-2 z-10"
            aria-label="현재 이미지 삭제"
          >
            <DeleteIcon />
          </ActionButton>
        )}
        <img
          src={src}
          alt={fileName || '미리보기'}
          className="max-w-full max-h-96 mx-auto rounded-md object-contain"
        />
        {showOverlay && (
          <div className="absolute top-2 right-2 bg-black/70 text-white text-xs p-2 rounded-md shadow-lg">
            {receiptNumber && <p><strong>접수번호:</strong> {receiptNumber}</p>}
            {/* siteLocation 제거 */}
            {item && <p><strong>항목:</strong> {item}</p>}
            {comment && (
              <p className="text-yellow-300"><strong>코멘트:</strong> {comment}</p>
            )}
          </div>
        )}
        <div className="text-center mt-2">
          {fileName && (
            <p className="text-xs text-slate-400 truncate">{fileName}</p>
          )}
          {typeof totalSelectedImages === 'number' &&
            totalSelectedImages > 1 &&
            typeof currentImageIndex === 'number' &&
            currentImageIndex !== -1 && (
              <p className="text-xs text-sky-400">
                이미지 {currentImageIndex + 1} / {totalSelectedImages}
              </p>
          )}
        </div>
      </div>
    </div>
  );
};
