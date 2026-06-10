
import React from 'react';
import { ActionButton } from './ActionButton';

interface ImagePreviewProps {
  imageBase64: string;
  fileName: string;
  mimeType: string;
  receiptNumber?: string;
  item?: string;
  comment?: string;
  showOverlay?: boolean;
  totalSelectedImages?: number;
  currentImageIndex?: number;
  onDelete?: () => void;
  siteName?: string; // JPG 오버레이용
  // FIX: Add gpsAddress prop to accept GPS coordinates/address string.
  gpsAddress?: string;
  /** 라이트 테마 여부: true이면 스탬프를 밝은 배경으로 표시 */
  isLightTheme?: boolean;
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
  siteName,
  gpsAddress,
  isLightTheme = false,
}) => {
  if (!imageBase64) return null;

  const src = `data:${mimeType};base64,${imageBase64}`;
  
  // 현장명만 표시 (주소는 포함하지 않음)
  const locationText = siteName?.trim() || '';

  // ── 스탬프 테마 분기 ──
  // 다크테마: 기존 검은 반투명 배경 + 흰 글씨
  // 라이트테마: 밝은 반투명 배경 + 진한 글씨 + 코멘트는 녹색
  const stampStyle: React.CSSProperties = isLightTheme
    ? {
        backgroundColor: 'rgba(255, 255, 255, 0.92)',
        backdropFilter: 'blur(4px)',
        border: '1px solid rgba(203, 213, 225, 0.8)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }
    : {
        backgroundColor: 'rgba(0, 0, 0, 0.88)',
        backdropFilter: 'blur(4px)',
      };

  const labelStyle: React.CSSProperties = isLightTheme
    ? { color: '#0369a1', fontWeight: 700 }   // sky-700
    : { color: '#7dd3fc', fontWeight: 700 };   // sky-300

  const valueStyle: React.CSSProperties = isLightTheme
    ? { color: '#1e293b' }   // slate-800
    : { color: '#f1f5f9' };  // slate-100

  const commentLabelStyle: React.CSSProperties = isLightTheme
    ? { color: '#166534', fontWeight: 700 }   // green-800
    : { color: '#fde047', fontWeight: 700 };  // yellow-300

  const commentValueStyle: React.CSSProperties = isLightTheme
    ? { color: '#14532d' }   // green-900 (진한 녹색)
    : { color: '#fef08a' };  // yellow-200

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
        {/* 고정 높이(h-96)+object-contain: 사진마다/로드시 높이가 변해 스크롤이 튀는 것 방지 */}
        <img
          src={src}
          alt={fileName || '미리보기'}
          className="w-full h-96 rounded-md object-contain"
        />
        {showOverlay && (
          <div
            className="absolute top-2 right-2 text-xs p-2 rounded-md shadow-lg leading-5"
            style={stampStyle}
          >
            {receiptNumber && (
              <p>
                <strong style={labelStyle}>접수번호:</strong>{' '}
                <span style={valueStyle}>{receiptNumber}</span>
              </p>
            )}
            {locationText && (
              <p>
                <strong style={labelStyle}>현장:</strong>{' '}
                <span style={valueStyle}>{locationText}</span>
              </p>
            )}
            {item && (
              <p>
                <strong style={labelStyle}>항목:</strong>{' '}
                <span style={valueStyle}>{item}</span>
              </p>
            )}
            {comment && (
              <p>
                <strong style={commentLabelStyle}>코멘트:</strong>{' '}
                <span style={commentValueStyle}>{comment}</span>
              </p>
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
