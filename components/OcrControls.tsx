import React from 'react';
import { ActionButton } from './ActionButton';
import { Spinner } from './Spinner'; 

type KtlApiCallStatus = 'idle' | 'success' | 'error';

interface OcrControlsProps {
  onExtract?: () => void;
  onClear: () => void;
  isExtractDisabled?: boolean;
  isClearDisabled: boolean;
  onDownloadStampedImages?: () => void;
  isDownloadStampedDisabled?: boolean;
  isDownloadingStamped?: boolean;
  onInitiateSendToKtl?: () => void;
  isClaydoxDisabled?: boolean;
  isSendingToClaydox?: boolean;
  ktlApiCallStatus?: KtlApiCallStatus;
  onAutoAssignIdentifiers?: () => void; 
  isAutoAssignDisabled?: boolean;
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

const DownloadIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
  </svg>
);

const SendIcon: React.FC = () => ( 
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
  </svg>
);

const AutoAwesomeIcon: React.FC = () => ( 
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L1.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.25 9.75L17 11.938l-1.25.813a4.5 4.5 0 01-3.09-3.09L11.25 6.75l1.25-2.846a4.5 4.5 0 013.09-3.09L17 0l1.25.813a4.5 4.5 0 013.09 3.09L22.75 6.75l-1.25 2.846a4.5 4.5 0 01-3.09 3.09L18.25 9.75zM12 15.75a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0v-2.25a.75.75 0 01.75-.75zM12 3.75a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V4.5a.75.75 0 01.75-.75zM5.25 12a.75.75 0 01.75-.75h2.25a.75.75 0 010 1.5H6a.75.75 0 01-.75-.75zm10.5 0a.75.75 0 01.75-.75h2.25a.75.75 0 010 1.5H16.5a.75.75 0 01-.75-.75z" />
  </svg>
);

export const OcrControls: React.FC<OcrControlsProps> = ({ 
  onExtract, 
  onClear, 
  isExtractDisabled, 
  isClearDisabled,
  onDownloadStampedImages,
  isDownloadStampedDisabled,
  isDownloadingStamped,
  onInitiateSendToKtl,
  isClaydoxDisabled,    
  isSendingToClaydox,
  ktlApiCallStatus = 'idle',
  onAutoAssignIdentifiers,    
  isAutoAssignDisabled,
}) => {

  return (
    <div className="space-y-4 pt-2">
      {onExtract && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ActionButton 
            onClick={onExtract} 
            disabled={isExtractDisabled}
            icon={<SparklesIcon />}
            fullWidth
            aria-label="입력된 정보를 바탕으로 선택된 모든 이미지에서 데이터 추출"
          >
            텍스트 추출
          </ActionButton>
          {onDownloadStampedImages && (
            <ActionButton
              onClick={onDownloadStampedImages}
              disabled={isDownloadStampedDisabled}
              icon={isDownloadingStamped ? <Spinner size="sm" /> : <DownloadIcon />}
              fullWidth
              variant="secondary"
              aria-label="입력 정보가 스탬프된 이미지 다운로드"
            >
              {isDownloadingStamped ? '다운로드 중...' : '스탬프 이미지 다운로드'}
            </ActionButton>
          )}
        </div>
      )}

      {onAutoAssignIdentifiers && ( 
        <ActionButton
          onClick={onAutoAssignIdentifiers}
          disabled={isAutoAssignDisabled}
          icon={<AutoAwesomeIcon />}
          fullWidth
          variant="secondary"
          className="bg-purple-600 hover:bg-purple-500 focus:ring-purple-500"
          aria-label="접수번호 패턴 및 값 농도에 따라 식별자 자동 할당"
        >
          자동 식별자 할당
        </ActionButton>
      )}

      {onInitiateSendToKtl && (
        <div className="space-y-1">
         <ActionButton
            onClick={onInitiateSendToKtl}
            disabled={isClaydoxDisabled}
            icon={isSendingToClaydox ? <Spinner size="sm" /> : <SendIcon />}
            fullWidth
            variant="secondary" 
            className="bg-teal-600 hover:bg-teal-500 focus:ring-teal-500" 
            aria-label="데이터 및 이미지를 KTL API로 전송 전 확인"
        >
            {isSendingToClaydox ? 'KTL로 전송 중...' : 'KTL로 전송'}
        </ActionButton>
        {!isSendingToClaydox && ktlApiCallStatus === 'success' && (
            <p className="text-xs text-center text-green-400" role="status">✅ KTL 전송 완료</p>
        )}
        {!isSendingToClaydox && ktlApiCallStatus === 'error' && (
            <p className="text-xs text-center text-red-400" role="alert">❌ KTL 전송 실패. 상세 오류는 메시지를 확인하세요.</p>
        )}
        </div>
      )}

      <ActionButton 
        onClick={onClear} 
        disabled={isClearDisabled} 
        variant="danger"
        icon={<ClearIcon />}
        fullWidth
        aria-label="선택된 모든 이미지 및 추출된 데이터 지우기. 입력 정보는 유지됩니다."
      >
        모두 지우기
      </ActionButton>
    </div>
  );
};
