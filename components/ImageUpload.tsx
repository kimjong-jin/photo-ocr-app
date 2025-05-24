
import React, { useRef } from 'react';
import { UploadIcon } from '../constants';

interface ImageUploadProps {
  onImageSelect: (files: FileList | null) => void;
  selectedFileCount: number;
  disabled?: boolean;
}

const ImageUpload: React.FC<ImageUploadProps> = ({ onImageSelect, selectedFileCount, disabled }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      onImageSelect(event.target.files);
    } else {
      onImageSelect(null);
    }
     // Reset the input value to allow selecting the same file(s) again if needed
    if (fileInputRef.current) {
        fileInputRef.current.value = "";
    }
  };

  const handleAreaClick = () => {
    if (!disabled) {
        fileInputRef.current?.click();
    }
  };

  const getUploadMessage = () => {
    if (selectedFileCount > 0) {
      return `${selectedFileCount}개 이미지 선택됨. 변경하려면 클릭하세요.`;
    }
    return '클릭 또는 드래그하여 이미지 업로드';
  };

  return (
    <div className="w-full p-6 bg-slate-800 rounded-xl shadow-xl">
      <input
        type="file"
        accept="image/png, image/jpeg, image/webp, image/gif"
        onChange={handleFileChange}
        ref={fileInputRef}
        className="hidden"
        disabled={disabled}
        multiple // Allow multiple file selection
      />
      <div
        onClick={handleAreaClick}
        onKeyPress={(e) => e.key === 'Enter' && handleAreaClick()}
        role="button"
        tabIndex={disabled ? -1 : 0}
        className={`group w-full flex flex-col items-center justify-center px-4 py-10 border-2 border-dashed border-slate-600 rounded-lg hover:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75 transition-colors duration-150 ease-in-out ${disabled ? 'cursor-not-allowed bg-slate-700 opacity-60' : 'cursor-pointer bg-slate-700 hover:bg-slate-600'}`}
        aria-label={getUploadMessage()}
      >
        <UploadIcon className={`w-12 h-12 text-slate-400 group-hover:text-blue-400 transition-colors ${disabled ? 'text-slate-500' : ''}`} />
        <span className={`mt-2 text-sm font-medium text-slate-300 group-hover:text-slate-100 transition-colors ${disabled ? 'text-slate-500' : ''}`}>
          {getUploadMessage()}
        </span>
        <span className={`mt-1 text-xs text-slate-400 group-hover:text-slate-300 transition-colors ${disabled ? 'text-slate-500' : ''}`}>
          PNG, JPG, GIF, WEBP (Max 10MB per file)
        </span>
      </div>
    </div>
  );
};

export default ImageUpload;
