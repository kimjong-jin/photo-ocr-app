

import React from 'react';
import { ActionButton } from './ActionButton';

export interface KtlPreflightData {
  jsonPayload: string;
  fileNames: string[];
  context: {
    receiptNumber: string;
    siteLocation: string;
    selectedItem: string;
    userName: string;
    inspectionStartDate?: string;
  };
}

interface KtlPreflightModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  preflightData: KtlPreflightData | null;
}

const KtlPreflightModal: React.FC<KtlPreflightModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  preflightData,
}) => {
  if (!isOpen || !preflightData) {
    return null;
  }

  const { jsonPayload, fileNames, context } = preflightData;

  const copyToClipboard = async (text: string | null | undefined, type: string) => {
    if (!text) {
      alert(`${type} 내용이 없습니다.`);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      alert(`${type} 복사 완료!`);
    } catch (err) {
      console.error(`클립보드에 ${type} 복사 실패:`, err);
      alert(`${type} 복사에 실패했습니다. 콘솔을 확인해주세요.`);
    }
  };


  return (
    <div 
      className="fixed inset-0 bg-slate-900 bg-opacity-75 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      aria-labelledby="ktl-preflight-modal-title"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-slate-800 p-6 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <h2 id="ktl-preflight-modal-title" className="text-2xl font-bold text-sky-400 mb-4 pb-3 border-b border-slate-700">
          KTL 전송 전 최종 확인
        </h2>

        <div className="overflow-y-auto space-y-6 pr-2 flex-grow">
          {/* Context Info */}
          <section>
            <h3 className="text-lg font-semibold text-slate-200 mb-2">주요 정보</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm bg-slate-700/50 p-3 rounded-md">
              <div><strong className="text-slate-400">접수번호:</strong> <span className="text-slate-100">{context.receiptNumber}</span></div>
              <div><strong className="text-slate-400">현장:</strong> <span className="text-slate-100">{context.siteLocation}</span></div>
              <div><strong className="text-slate-400">항목:</strong> <span className="text-slate-100">{context.selectedItem}</span></div>
              <div><strong className="text-slate-400">사용자:</strong> <span className="text-slate-100">{context.userName}</span></div>
              {context.inspectionStartDate && (
                <div className="sm:col-span-2"><strong className="text-slate-400">검사시작일:</strong> <span className="text-slate-100">{context.inspectionStartDate}</span></div>
              )}
            </div>
          </section>

          {/* Files List */}
          <section>
            <h3 className="text-lg font-semibold text-slate-200 mb-2">전송될 파일 목록 ({fileNames.length}개)</h3>
            {fileNames.length > 0 ? (
              <ul className="list-disc list-inside bg-slate-700/50 p-3 rounded-md text-sm text-slate-300 max-h-40 overflow-y-auto">
                {fileNames.map((name, index) => (
                  <li key={index} className="truncate py-0.5">{name}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-400 bg-slate-700/50 p-3 rounded-md">전송될 파일이 없습니다.</p>
            )}
          </section>
          
          {/* JSON Payload */}
          <section>
            <div className="flex justify-between items-center mb-2">
                <h3 className="text-lg font-semibold text-slate-200">JSON 데이터 미리보기</h3>
                <ActionButton
                    onClick={() => copyToClipboard(jsonPayload, "KTL JSON")}
                    variant="secondary"
                    className="text-xs py-1 px-2"
                    aria-label="KTL API JSON 데이터 클립보드에 복사"
                >
                    JSON 복사
                </ActionButton>
            </div>
            <pre className="bg-slate-900 p-3 rounded-md text-xs text-slate-300 overflow-x-auto max-h-60 border border-slate-700">
              {jsonPayload}
            </pre>
          </section>
        </div>

        <div className="mt-6 pt-4 border-t border-slate-700 flex flex-col sm:flex-row justify-end space-y-3 sm:space-y-0 sm:space-x-3">
          <ActionButton 
            onClick={onClose} 
            variant="secondary" 
            className="w-full sm:w-auto"
          >
            취소
          </ActionButton>
          <ActionButton 
            onClick={onConfirm} 
            variant="primary" 
            className="w-full sm:w-auto"
          >
            최종 확인 및 전송
          </ActionButton>
        </div>
      </div>
    </div>
  );
};

export default KtlPreflightModal;
