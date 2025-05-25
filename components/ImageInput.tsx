import React, { useCallback, forwardRef } from 'react';
import { ActionButton } from './ActionButton';

export interface ImageInfo { 
  file: File;
  base64: string;
  mimeType: string;
}

interface ImageInputProps {
  onImagesSet: (images: ImageInfo[]) => void; 
  onOpenCamera: () => void;
  isLoading: boolean;
  selectedImageCount?: number; // New prop
}

const UploadIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
  </svg>
);

const CameraIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
  </svg>
);


export const ImageInput = forwardRef<HTMLInputElement, ImageInputProps>(({ onImagesSet, onOpenCamera, isLoading, selectedImageCount }, ref) => {
  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      const imagePromises: Promise<ImageInfo>[] = Array.from(files).map(file => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const resultString = reader.result as string;
            const parts = resultString.split(',');
            if (parts.length < 2) {
              console.error(`Invalid file format for base64 conversion: ${file.name}`);
              reject(new Error(`Invalid file format for ${file.name}`));
              return;
            }
            const base64Data = parts[1];
            resolve({
              file: file,
              base64: base64Data,
              mimeType: file.type || 'application/octet-stream'
            });
          };
          reader.onerror = (error) => {
            console.error(`Error reading file ${file.name}:`, error);
            reject(new Error(`Failed to read file ${file.name}`));
          };
          reader.readAsDataURL(file);
        });
      });

      try {
        const imageInfos = await Promise.all(imagePromises);
        onImagesSet(imageInfos);
      } catch (error) {
        console.error("Error processing one or more files:", error);
        onImagesSet([]); 
      }
    } else {
      onImagesSet([]); 
    }
  }, [onImagesSet]);

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="file-upload" className="block text-sm font-medium text-slate-300 mb-1">
          Upload Image(s)
        </label>
        <input
          id="file-upload"
          name="file-upload"
          type="file"
          ref={ref}
          multiple 
          className="block w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-sky-500 file:text-white hover:file:bg-sky-600 disabled:opacity-50"
          accept="image/png, image/jpeg, image/webp, image/gif"
          onChange={handleFileChange}
          disabled={isLoading}
        />
        <p className="mt-1 text-xs text-slate-500">PNG, JPG, GIF, WEBP (Max 10MB per file).</p>
        {selectedImageCount && selectedImageCount > 0 && (
          <p className="mt-1 text-xs text-sky-400">{selectedImageCount} image(s) selected.</p>
        )}
      </div>
      <div className="relative">
        <div className="absolute inset-0 flex items-center" aria-hidden="true">
          <div className="w-full border-t border-slate-600" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-slate-800 px-2 text-sm text-slate-400">Or</span>
        </div>
      </div>
      <ActionButton onClick={onOpenCamera} disabled={isLoading} icon={<CameraIcon />} fullWidth>
        Use Camera
      </ActionButton>
    </div>
  );
});
ImageInput.displayName = 'ImageInput';
