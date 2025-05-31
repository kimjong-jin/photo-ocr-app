
import React, { useState, useCallback } from 'react';
import { Spinner } from './Spinner';
import { ExtractedEntry } from '../App'; 
import { ActionButton } from './ActionButton'; 

interface OcrResultDisplayProps {
  ocrData: ExtractedEntry[] | null; 
  error: string | null;   
  isLoading: boolean;
  contextProvided: boolean; 
  hasImage: boolean; 
  selectedItem: string; // To determine which columns to show
  onEntryIdentifierChange: (entryId: string, identifierValue: string | undefined) => void; // For primary/TN
  onEntryIdentifierTPChange: (entryId: string, identifierValue: string | undefined) => void; // For TP
  onEntryTimeChange: (entryId: string, newTime: string) => void;    
  onEntryPrimaryValueChange: (entryId: string, newValue: string) => void; // For primary/TN
  onEntryValueTPChange: (entryId: string, newValue: string) => void;   // For TP
  onAddEntry: () => void; 
  onReorderRows: (sourceRowStr: string, targetRowStr?: string) => void; // New prop for reordering by input
  availableIdentifiers: string[]; 
  tnIdentifiers: string[]; 
  tpIdentifiers: string[]; 
  rawJsonForCopy?: string | null; 
  ktlJsonToPreview?: string | null; 
}

// Helper Icons
const InfoIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
  </svg>
);

const TableIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125z" />
  </svg>
);

const PlusIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
  </svg>
);

const ShuffleIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
  </svg>
);


const getDisplayValue = (originalValue: string | undefined): string => {
  if (originalValue === undefined) return '';
  return String(originalValue);
};

export const OcrResultDisplay: React.FC<OcrResultDisplayProps> = ({ 
    ocrData, 
    error, 
    isLoading,
    contextProvided, 
    hasImage,
    selectedItem,
    onEntryIdentifierChange,
    onEntryIdentifierTPChange,
    onEntryTimeChange,
    onEntryPrimaryValueChange,
    onEntryValueTPChange,
    onAddEntry,
    onReorderRows,
    availableIdentifiers,
    tnIdentifiers,
    tpIdentifiers,
    rawJsonForCopy,
    ktlJsonToPreview 
}) => {
  const [rowToMoveInput, setRowToMoveInput] = useState('');
  const [newPositionInput, setNewPositionInput] = useState('');

  const handleReorderClick = useCallback(() => {
    if (!rowToMoveInput.trim()) {
      alert("'이동할 행 No.'를 입력해주세요.");
      return;
    }
    // `newPositionInput` can be empty, `onReorderRows` in App.tsx will handle it.
    onReorderRows(rowToMoveInput, newPositionInput);
    // Optionally clear inputs after action
    // setRowToMoveInput('');
    // setNewPositionInput('');
  }, [rowToMoveInput, newPositionInput, onReorderRows]);

  if (isLoading) {
    return (
      <div className="mt-6 p-6 bg-slate-700/50 rounded-lg shadow flex flex-col items-center justify-center min-h-[10rem]">
        <Spinner size="lg" />
        <p className="text-slate-300 mt-3">선택된 모든 이미지를 처리 중입니다...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-6 p-4 bg-red-800/30 border border-red-600/50 text-red-300 rounded-lg shadow text-center" role="alert">
        <h4 className="font-semibold text-lg mb-1">오류 발생</h4>
        <p className="text-sm whitespace-pre-wrap">{error}</p>
      </div>
    );
  }

  if (!contextProvided) {
    return (
      <div className="mt-6 p-6 bg-slate-700/50 rounded-lg shadow text-center">
        <InfoIcon className="w-12 h-12 text-sky-500 mx-auto mb-3" />
        <h4 className="text-lg font-semibold text-slate-200 mb-1">정보 필요</h4>
        <p className="text-sm text-slate-400">
          분석을 시작하려면 먼저 위의 필수 입력 정보 (접수번호, 현장, 항목)를 모두 채워주세요.
        </p>
      </div>
    );
  }

  if (!hasImage) { 
    return (
      <div className="mt-6 p-6 bg-slate-700/50 rounded-lg shadow text-center">
        <InfoIcon className="w-12 h-12 text-sky-500 mx-auto mb-3" />
        <h4 className="text-lg font-semibold text-slate-200 mb-1">이미지 필요</h4>
        <p className="text-sm text-slate-400">
          분석할 이미지를 먼저 선택하거나 카메라로 촬영해주세요.
        </p>
      </div>
    );
  }
  
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

  const isTnTpMode = selectedItem === "TN/TP";
  const baseInputClassSmall = "w-full bg-slate-700 p-1.5 border border-slate-600 rounded-md text-sm focus:ring-sky-500 focus:border-sky-500 placeholder-slate-400 text-slate-200";
  
  if (ocrData !== null) {
    return (
      <div className="mt-6 space-y-4">
        <div className="flex justify-between items-center">
            <h3 className="text-xl font-semibold text-sky-400 flex items-center">
                <TableIcon className="w-6 h-6 mr-2"/> 추출된 데이터
            </h3>
            <ActionButton 
                onClick={() => copyToClipboard(rawJsonForCopy, "JSON 데이터")}
                variant="secondary"
                disabled={!rawJsonForCopy || ocrData.length === 0}
                aria-label="추출된 원시 JSON 데이터 클립보드에 복사"
            >
                JSON 복사
            </ActionButton>
        </div>

        {/* Row Reordering Controls */}
        {ocrData.length > 0 && (
          <div className="p-3 bg-slate-700/30 rounded-md border border-slate-600/50 space-y-3">
            <h4 className="text-md font-semibold text-slate-200 mb-1">행 순서 변경</h4>
            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
              <div className="flex-1">
                <label htmlFor="row-to-move" className="block text-xs font-medium text-slate-300 mb-0.5">
                  이동할 행 No.:
                </label>
                <input
                  type="text" // Changed type to text to allow ranges like "1-3"
                  id="row-to-move"
                  value={rowToMoveInput}
                  onChange={(e) => setRowToMoveInput(e.target.value)}
                  placeholder="예: 5 또는 1-3" // Updated placeholder
                  className={baseInputClassSmall}
                  aria-label="이동할 행의 현재 번호 또는 범위 (예: 5 또는 1-3)"
                />
              </div>
              <div className="flex-1">
                <label htmlFor="new-position" className="block text-xs font-medium text-slate-300 mb-0.5">
                  새 위치 No.:
                </label>
                <input
                  type="number"
                  id="new-position"
                  value={newPositionInput}
                  onChange={(e) => setNewPositionInput(e.target.value)}
                  placeholder="목표 No. (비우면 맨 뒤로)"
                  // min="1" removed - validation handled in JS
                  // max attribute removed - validation handled in JS
                  className={baseInputClassSmall}
                  aria-label="행을 이동시킬 새로운 위치 번호 (비우면 맨 뒤로)"
                />
              </div>
              <ActionButton
                onClick={handleReorderClick}
                variant="secondary"
                icon={<ShuffleIcon />}
                disabled={isLoading || !rowToMoveInput.trim() || ocrData.length < 2}
                className="sm:w-auto h-fit"
                aria-label="지정한 번호 또는 범위로 행 순서 변경"
              >
                순서 변경
              </ActionButton>
            </div>
          </div>
        )}

        {ocrData.length === 0 && !isLoading && (
             <div className="p-4 bg-slate-700/30 border border-slate-600/50 rounded-lg shadow text-center">
                <InfoIcon className="w-10 h-10 text-sky-400 mx-auto mb-2" />
                <p className="text-sm text-slate-300">
                추출된 데이터가 없습니다. 이미지를 다시 확인하거나, 아래 '행 추가' 버튼을 사용하여 수동으로 데이터를 입력할 수 있습니다.
                </p>
                 {rawJsonForCopy && rawJsonForCopy !== "[]" && ( 
                    <details className="mt-3 text-left text-xs">
                        <summary className="cursor-pointer text-slate-500 hover:text-slate-400">
                            (참고: 원본 AI 응답 보기)
                        </summary>
                        <pre className="mt-1 text-slate-400 bg-slate-800 p-2 rounded overflow-x-auto max-h-32">
                            {rawJsonForCopy}
                        </pre>
                    </details>
                )}
            </div>
        )}
        {ocrData.length > 0 && (
            <div className="overflow-x-auto bg-slate-800 p-1 rounded-lg shadow-md border border-slate-700">
            <table className="min-w-full divide-y divide-slate-700 table-fixed">
                <colgroup>
                    <col className="w-5" /> {/* No. - Further Reduced width */}
                    <col className="w-32" /> {/* Time */}
                    {isTnTpMode ? (
                        <>
                            <col className="w-28" /> {/* TN Value */}
                            <col className="w-28" /> {/* TP Value */}
                            <col className="w-20" /> {/* TN Identifier */}
                            <col className="w-20" /> {/* TP Identifier */}
                        </>
                    ) : (
                        <>
                            <col className="w-28" /> {/* Value */}
                            <col className="w-28" /> {/* Identifier */}
                        </>
                    )}
                </colgroup>
                <thead className="bg-slate-700/50">
                <tr>
                    <th scope="col" className="px-2 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider">No.</th>
                    <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider">시간</th>
                    {isTnTpMode ? (
                    <>
                        <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider">TN 값</th>
                        <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider">TP 값</th>
                        <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider">TN 식별자</th>
                        <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider">TP 식별자</th>
                    </>
                    ) : (
                    <>
                        <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider">값</th>
                        <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider">식별자</th>
                    </>
                    )}
                </tr>
                </thead>
                <tbody className="bg-slate-800 divide-y divide-slate-700">
                {ocrData.map((entry, index) => {
                    const baseInputClass = "w-full bg-slate-700 p-1.5 border border-slate-600 rounded-md text-sm focus:ring-sky-500 focus:border-sky-500";
                    const identifierSelectClass = (ident?: string) => `${baseInputClass} ${ident ? 'text-red-400 font-bold' : 'text-slate-200'}`;

                    return (
                    <tr key={entry.id} className="hover:bg-slate-700/30 transition-colors duration-100">
                    <td className="px-2 py-2.5 whitespace-nowrap text-sm text-slate-400 text-center">{index + 1}</td>
                    <td className="px-1 py-2.5 whitespace-nowrap">
                        <input
                            type="text"
                            value={entry.time}
                            onChange={(e) => onEntryTimeChange(entry.id, e.target.value)}
                            className={`${baseInputClass} text-slate-200`}
                            aria-label={`시간 입력 필드 ${index + 1}`}
                        />
                    </td>
                    {isTnTpMode ? (
                        <>
                        <td className="px-1 py-2.5 whitespace-nowrap">
                            <input // TN Value
                                type="text"
                                value={getDisplayValue(entry.value)}
                                onChange={(e) => onEntryPrimaryValueChange(entry.id, e.target.value)}
                                className={`${baseInputClass} text-slate-200`}
                                aria-label={`TN 값 입력 필드 ${index + 1}`}
                            />
                        </td>
                        <td className="px-1 py-2.5 whitespace-nowrap">
                            <input // TP Value
                                type="text"
                                value={getDisplayValue(entry.valueTP)}
                                onChange={(e) => onEntryValueTPChange(entry.id, e.target.value)}
                            className={`${baseInputClass} text-slate-200`}
                                aria-label={`TP 값 입력 필드 ${index + 1}`}
                            />
                        </td>
                        <td className="px-2 py-2.5 whitespace-nowrap text-sm"> 
                            <select // TN Identifier
                            value={entry.identifier || ''}
                            onChange={(e) => onEntryIdentifierChange(entry.id, e.target.value)}
                            className={identifierSelectClass(entry.identifier)}
                            aria-label={`TN 식별자 선택 ${index + 1}`}
                            >
                            <option value="" className="text-slate-400">지정 안함</option>
                            {tnIdentifiers.map(opt => (
                                <option key={opt} value={opt} className={entry.identifier === opt ? 'text-red-400 font-bold' : 'text-slate-200'}>
                                {opt}
                                </option>
                            ))}
                            </select>
                        </td>
                        <td className="px-2 py-2.5 whitespace-nowrap text-sm">
                            <select // TP Identifier
                            value={entry.identifierTP || ''}
                            onChange={(e) => onEntryIdentifierTPChange(entry.id, e.target.value)}
                            className={identifierSelectClass(entry.identifierTP)}
                            aria-label={`TP 식별자 선택 ${index + 1}`}
                            >
                            <option value="" className="text-slate-400">지정 안함</option>
                            {tpIdentifiers.map(opt => (
                                <option key={opt} value={opt} className={entry.identifierTP === opt ? 'text-red-400 font-bold' : 'text-slate-200'}>
                                {opt}
                                </option>
                            ))}
                            </select>
                        </td>
                        </>
                    ) : (
                        <>
                        <td className="px-1 py-2.5 whitespace-nowrap">
                            <input // General Value
                                type="text"
                                value={getDisplayValue(entry.value)}
                                onChange={(e) => onEntryPrimaryValueChange(entry.id, e.target.value)}
                                className={`${baseInputClass} text-slate-200`}
                                aria-label={`값 입력 필드 ${index + 1}`}
                            />
                        </td>
                        <td className="px-2 py-2.5 whitespace-nowrap text-sm">
                            <select // General Identifier
                            value={entry.identifier || ''}
                            onChange={(e) => onEntryIdentifierChange(entry.id, e.target.value)}
                            className={identifierSelectClass(entry.identifier)}
                            aria-label={`식별자 선택 ${index + 1}`}
                            >
                            <option value="" className="text-slate-400">지정 안함</option>
                            {availableIdentifiers.map(opt => (
                                <option key={opt} value={opt} className={entry.identifier === opt ? 'text-red-400 font-bold' : 'text-slate-200'}>
                                {opt}
                                </option>
                            ))}
                            </select>
                        </td>
                        </>
                    )}
                    </tr>
                )})}
                </tbody>
            </table>
            </div>
        )}
        <div className="mt-4 flex justify-end">
            <ActionButton
                onClick={onAddEntry}
                variant="primary"
                icon={<PlusIcon />}
                aria-label="추출된 데이터 테이블에 새 행 추가"
                disabled={isLoading}
            >
                행 추가
            </ActionButton>
        </div>

        {ktlJsonToPreview && (
            <details className="mt-4 text-left bg-slate-700/30 p-3 rounded-md border border-slate-600/50">
                <summary className="cursor-pointer text-sm font-medium text-sky-400 hover:text-sky-300">
                    KTL API 전송용 JSON 미리보기
                </summary>
                <pre className="mt-2 text-xs text-slate-300 bg-slate-800 p-3 rounded-md overflow-x-auto max-h-60">
                    {ktlJsonToPreview}
                </pre>
                 <ActionButton 
                    onClick={() => copyToClipboard(ktlJsonToPreview, "KTL JSON")}
                    variant="secondary"
                    className="text-xs mt-2"
                    disabled={!ktlJsonToPreview}
                    aria-label="KTL API JSON 데이터 클립보드에 복사"
                >
                    KTL JSON 복사
                </ActionButton>
            </details>
        )}
      </div>
    );
  }
  
  // Fallback for ocrData === null (initial state before extraction)
  return (
    <div className="mt-6 p-6 bg-slate-700/50 rounded-lg shadow text-center">
      <p className="text-slate-400">
        {rawJsonForCopy || "위의 '텍스트 추출' 버튼을 눌러 이미지 분석을 시작하세요."}
      </p>
      {ktlJsonToPreview && ( 
        <details className="mt-4 text-left bg-slate-700/30 p-3 rounded-md border border-slate-600/50">
          <summary className="cursor-pointer text-sm font-medium text-sky-400 hover:text-sky-300">
            KTL API 전송용 JSON 미리보기 (현재 입력 정보 기준)
          </summary>
          <pre className="mt-2 text-xs text-slate-300 bg-slate-800 p-3 rounded-md overflow-x-auto">
              {ktlJsonToPreview}
          </pre>
        </details>
      )}
    </div>
  );
};
