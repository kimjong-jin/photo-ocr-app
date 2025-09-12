import React from 'react';
import { ImageInfo } from './ImageInput';
import type { AnalysisType } from '../structuralCheckPage'; // Use type import

interface GalleryImage extends ImageInfo {
  uid?: string;
}

interface ThumbnailGalleryProps {
  images: GalleryImage[];
  currentIndex: number;
  onSelectImage: (index: number) => void;
  onDeleteImage: (index: number) => void;
  disabled?: boolean;
  analysisStatusForPhotos?: Record<number, Set<AnalysisType>>;
}

const DeleteIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const CheckmarkIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className="w-3 h-3 text-white">
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
);

export const ThumbnailGallery: React.FC<ThumbnailGalleryProps> = ({
  images,
  currentIndex,
  onSelectImage,
  onDeleteImage,
  disabled = false,
  analysisStatusForPhotos,
}) => {
  if (!images || images.length <= 1) {
    return null;
  }

  return (
    <div className="mt-4">
      <h3 className="text-md font-medium text-slate-300 mb-2">선택된 사진 ({images.length}개):</h3>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 bg-slate-700/50 p-2 rounded-lg">
        {images.map((image, index) => {
          const hasBeenAnalyzed = !!(analysisStatusForPhotos?.[index] && analysisStatusForPhotos[index].size > 0);

          // ✅ 안정적인 key: uid 우선, 없으면 (name-size-lastModified)
          const stableKey =
            image.uid ??
            `${image.file.name}-${image.file.size}-${image.file.lastModified}`;

          return (
            <div key={stableKey} className="relative group">
              <button
                type="button"
                onClick={() => onSelectImage(index)}
                className={`w-full aspect-square block rounded-md overflow-hidden focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-sky-500 transition-all
                            ${currentIndex === index ? 'ring-2 ring-sky-400' : 'ring-1 ring-slate-600 hover:ring-sky-500'}`}
                disabled={disabled}
                aria-label={`사진 ${index + 1} 보기`}
              >
                <img
                  src={`data:${image.mimeType};base64,${image.base64}`}
                  alt={image.file.name}
                  className="w-full h-full object-cover"
                />
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteImage(index);
                }}
                className="absolute top-1 right-1 bg-red-600/80 hover:bg-red-500 text-white rounded-full p-1 transition-opacity opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={disabled}
                aria-label={`사진 ${index + 1} 삭제`}
              >
                <DeleteIcon />
              </button>

              {hasBeenAnalyzed && (
                <div
                  className="absolute bottom-1 left-1 bg-green-500 rounded-full p-0.5 shadow-lg pointer-events-none"
                  title="이 사진은 판별에 사용되었습니다."
                >
                  <CheckmarkIcon />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
