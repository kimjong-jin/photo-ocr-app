import React from 'react';
import { ActionButton } from './ActionButton';
import { Spinner } from './Spinner'; 

interface OcrControlsProps {
  onExtract: () => void;
  onClear: () => void;
  isExtractDisabled: boolean;
  isClearDisabled: boolean;
  onPreviousImage?: () => void;
  onNextImage?: () => void;
  isPreviousDisabled?: boolean;
  isNextDisabled?: boolean;
  currentImageIndex?: number;
  totalImages?: number; 
  onDownloadStampedImages?: () => void;
  isDownloadStampedDisabled?: boolean;
  isDownloadingStamped?: boolean;
  // Props for Claydox API placeholder
  onSendToClaydox?: () => void;
  isClaydoxDisabled?: boolean;
  isSendingToClaydox?: boolean;
}

const SparklesIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L1.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.25 12L17 14.188l-1.25.813a4.5 4.5 0 01-3.09-3.09L11.25 9l1.25-2.846a4.5 4.5 0 013.09-3.09L17 2.25l1.25.813a4.5 4.5 0 013.09 3.09L22.75 9l-1.25 2.846a4.5 4.5 0 01-3.09 3.09L18.25 12z" />
  </svg>
);

const ClearIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12.56 0c1.153 0 2.24.03 3.22.077m3.22-.077L10.88 5.79m2.558 0c-.29.042-.58.083-.87.124" />
  </svg>
);

const ChevronLeftIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
  </svg>
);

const ChevronRightIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
  </svg>
);

const DownloadIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
  </svg>
);

const SendIcon: React.FC = () => ( // Icon for Claydox button
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
  </svg>
);


export const OcrControls: React.FC<OcrControlsProps> = ({ 
  onExtract, 
  onClear, 
  isExtractDisabled, 
  isClearDisabled,
  onPreviousImage,
  onNextImage,
  isPreviousDisabled,
  isNextDisabled,
  currentImageIndex,
  totalImages,
  onDownloadStampedImages,
  isDownloadStampedDisabled,
  isDownloadingStamped,
  onSendToClaydox,      // New prop
  isClaydoxDisabled,    // New prop
  isSendingToClaydox    // New prop
}) => {
  const showNavigation = typeof totalImages === 'number' && totalImages > 1 && typeof currentImageIndex === 'number' && currentImageIndex !== -1;

  return (
    <div className="space-y-4 pt-2">
      {showNavigation && onPreviousImage && onNextImage && (
        <div className="flex items-center justify-between">
          <ActionButton 
            onClick={onPreviousImage} 
            disabled={isPreviousDisabled}
            icon={<ChevronLeftIcon />}
            variant="secondary"
            aria-label="Previous image"
          >
            Previous
          </ActionButton>
          <span className="text-sm text-slate-400">
            Image {currentImageIndex! + 1} of {totalImages}
          </span>
          <ActionButton 
            onClick={onNextImage} 
            disabled={isNextDisabled}
            icon={<ChevronRightIcon />}
            variant="secondary"
            aria-label="Next image"
          >
            Next
          </ActionButton>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ActionButton 
          onClick={onExtract} 
          disabled={isExtractDisabled}
          icon={<SparklesIcon />}
          fullWidth
          aria-label="Extract data from all selected images based on inputs"
        >
          Extract Text
        </ActionButton>
        {onDownloadStampedImages && (
          <ActionButton
            onClick={onDownloadStampedImages}
            disabled={isDownloadStampedDisabled}
            icon={isDownloadingStamped ? <Spinner size="sm" /> : <DownloadIcon />}
            fullWidth
            variant="secondary"
            aria-label="Download images with context stamped on them"
          >
            {isDownloadingStamped ? 'Downloading...' : 'Download Stamped'}
          </ActionButton>
        )}
      </div>
      {/* Claydox API Placeholder Button */}
      {onSendToClaydox && (
         <ActionButton
            onClick={onSendToClaydox}
            disabled={isClaydoxDisabled}
            icon={isSendingToClaydox ? <Spinner size="sm" /> : <SendIcon />}
            fullWidth
            variant="secondary" // Or another appropriate variant
            className="bg-teal-600 hover:bg-teal-500 focus:ring-teal-500" // Example custom styling
            aria-label="Send data to Claydox API (Placeholder)"
        >
            {isSendingToClaydox ? 'Sending...' : 'Send to Claydox (Placeholder)'}
        </ActionButton>
      )}
      <ActionButton 
        onClick={onClear} 
        disabled={isClearDisabled} 
        variant="danger"
        icon={<ClearIcon />}
        fullWidth
        aria-label="Clear all selected images and extracted data. Context inputs will remain."
      >
        Clear All
      </ActionButton>
    </div>
  );
};
