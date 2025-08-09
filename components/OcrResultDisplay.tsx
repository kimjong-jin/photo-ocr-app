import React, { useState, useCallback } from 'react';
import { Spinner } from './Spinner';
import { ExtractedEntry } from '../PhotoLogPage';
import { ActionButton } from './ActionButton'; 

interface OcrResultDisplayProps {
  ocrData: ExtractedEntry[] | null; 
  error: string | null;   
  isLoading: boolean;
  contextProvided: boolean; 
  hasImage: boolean; 
  selectedItem: string;
  onEntryIdentifierChange: (entryId: string, identifierValue: string | undefined) => void;
  onEntryIdentifierTPChange: (entryId: string, identifierValue: string | undefined) => void;
  onEntryTimeChange: (entryId: string, newTime: string) => void;    
  onEntryPrimaryValueChange: (entryId: string, newValue: string) => void;
  onEntryValueTPChange: (entryId: string, newValue: string) => void;
  onEntryValueBlur?: (entryId: string, valueType: 'primary' | 'tp') => void;
  onAddEntry: () => void; 
  onReorderRows: (sourceRowStr: string, targetRowStr?: string) => void;
  availableIdentifiers: string[]; 
  tnIdentifiers: string[]; 
  tpIdentifiers: string[]; 
  rawJsonForCopy?: string | null; 
  ktlJsonToPreview?: string | null;
  draftJsonToPreview?: string | null;
  isManualEntryMode?: boolean;
  decimalPlaces?: number;
}

// Helper Icons
const InfoIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
  </svg>
);

const TableIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125z" />
  </svg>
);

const PlusIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
  </svg>
);

const ShuffleIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
  </svg>
);

const sequenceRelatedIdentifiers = new Set([
  "Z1", "Z2", "S1", "S2", "Z3", "Z4", "S3", "S4", "Z5", "S5", "M", "응답시간"
]);

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
    onEntryValueBlur,
    onAddEntry,
    onReorderRows,
    availableIdentifiers,
    tnIdentifiers,
    tpIdentifiers,
    rawJsonForCopy,
    ktlJsonToPreview,
    draftJsonToPreview,
    isManualEntryMode = false
}) => {
  const [rowToMoveInput, setRowToMoveInput] = useState('');
  const [newPositionInput, setNewPositionInput] = useState('');

  const handleReorderClick = useCallback(() => {
    if (!rowToMoveInput.trim()) {
      alert("'이동할 행 No.'를 입력해주세요.");
      return;
    }
    onReorderRows(rowToMoveInput, newPositionInput);
  }, [rowToMoveInput, newPositionInput, onReorderRows]);

  const isTnTpMode = selectedItem === "TN/TP";
  const isTuClMode = selectedItem === "TU/CL";
  const showTwoValueColumns = isTnTpMode || isTuClMode;
  const baseInputClassSmall = "w-full bg-slate-700 p-2 border border-slate-600 rounded-md text-sm focus:ring-sky-500 focus:border-sky-500 placeholder-slate-400 text-slate-200";

  const renderResponseTimeMultiInputCell = (
    entry: ExtractedEntry, 
    valueSource: 'primary' | 'tp',
    onValueChange: (entryId: string, newValue: string) => void
  ) => {
    const rawValue = valueSource === 'primary' ? entry.value : entry.valueTP;
    let values = ['','',''];
    try {
        const parsed = JSON.parse(rawValue || '[]');
        if (Array.isArray(parsed)) {
            values = [String(parsed[0] || ''), String(parsed[1] || ''), String(parsed[2] || '')];
        }
    } catch(e) {}

    const handleInputChange = (index: number, inputValue: string) => {
        const newValues = [...values];
        newValues[index] = inputValue;
        const hasValue = newValues.some(v => v.trim() !== '');
        onValueChange(entry.id, hasValue ? JSON.stringify(newValues) : '');
    }

    const inputClasses = "w-full h-8 bg-slate-900/70 border border-slate-700 rounded-md px-1.5 text-xs text-slate-200 text-center placeholder-slate-500";
    return (
        <div className="flex items-center gap-1.5">
            <input type="text" value={values[0]} onChange={(e) => handleInputChange(0, e.target.value)} onBlur={() => onEntryValueBlur?.(entry.id, valueSource)} className={inputClasses} placeholder="초"/>
            <input type="text" value={values[1]} onChange={(e) => handleInputChange(1, e.target.value)} onBlur={() => onEntryValueBlur?.(entry.id, valueSource)} className={inputClasses} placeholder="분"/>
            <input type="text" value={values[2]} onChange={(e) => handleInputChange(2, e.target.value)} onBlur={() => onEntryValueBlur?.(entry.id, valueSource)} className={inputClasses} placeholder="길이"/>
        </div>
    );
  };


  if (isLoading) {
    return (
      <div className="mt-6 p-6 bg-slate-700/50 rounded-lg shadow flex flex-col items-center justify-center min-h-[10rem]">
        <Spinner size="lg" />
        <p className="text-slate-300 mt-3">{isManualEntryMode ? "데이터 로딩 중..." : "선택된 모든 이미지를 처리 중입니다..."}</p>
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
          분석을 시작하려면 먼저 위의 필수 입력 정보를 모두 채워주세요.
        </p>
      </div>
    );
  }
  
  if (!hasImage && !isManualEntryMode) { 
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
  
  const renderTable = () => {
    if (ocrData === null) return null;

    return (
      <>
        <div className="flex justify-between items-center">
            <h3 className="text-xl font-semibold text-sky-400 flex items-center">
                <TableIcon className="w-6 h-6 mr-2"/> {isManualEntryMode ? "데이터 입력" : "추출된 데이터"}
            </h3>
            {rawJsonForCopy && (
                <ActionButton 
                    onClick={() => copyToClipboard(rawJsonForCopy, "JSON 데이터")}
                    variant="secondary"
                    disabled={!rawJsonForCopy || ocrData.length === 0}
                    aria-label="추출된 원시 JSON 데이터 클립보드에 복사"
                >
                    JSON 복사
                </ActionButton>
            )}
        </div>

        {!isManualEntryMode && ocrData.length > 0 && (
          <div className="p-3 bg-slate-700/30 rounded-md border border-slate-600/50 space-y-3">
            <h4 className="text-md font-semibold text-slate-200 mb-1">행 순서 변경</h4>
            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
              <div className="flex-1">
                <label htmlFor="row-to-move" className="block text-xs font-medium text-slate-300 mb-0.5">
                  이동할 행 No.:
                </label>
                <input
                  type="text"
                  id="row-to-move"
                  value={rowToMoveInput}
                  onChange={(e) => setRowToMoveInput(e.target.value)}
                  placeholder="예: 5 또는 1-3"
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
                {isManualEntryMode ? "데이터가 없습니다. 아래 '행 추가' 버튼을 사용하거나 '불러오기'를 통해 데이터를 가져오세요." : "추출된 데이터가 없습니다. 이미지를 다시 확인하거나, 아래 '행 추가' 버튼을 사용하여 수동으로 데이터를 입력할 수 있습니다."}
                </p>
                 {rawJsonForCopy && rawJsonForCopy !== "[]" && !isManualEntryMode && ( 
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
            <div className={`overflow-x-auto rounded-lg shadow-md border border-slate-700 ${isManualEntryMode ? 'bg-slate-900/50 p-2' : 'bg-slate-800 p-1'}`}>
            <table className="min-w-full divide-y divide-slate-700 table-fixed text-xs">
                {isManualEntryMode ? (
                    <colgroup>
                        <col className="w-7" /> {/* No. */}
                        <col className="w-14" /> {/* Time */}
                        <col /> {/* Value 1 (auto) */}
                        {showTwoValueColumns && <col />} {/* Value 2 (auto) */}
                        <col className="w-9" /> {/* Identifier */}
                    </colgroup>
                ) : (
                    <colgroup>
                        <col className="w-12" /> {/* No. */}
                        <col className="w-40" /> {/* Time */}
                        <col /> {/* Value 1 */}
                        {showTwoValueColumns && <col />} {/* Value 2 */}
                        <col className="w-32" /> {/* Identifier 1 */}
                        {isTnTpMode && <col className="w-32" />} {/* Identifier 2 for TP */}
                    </colgroup>
                )}
                <thead className={`${isManualEntryMode ? '' : 'bg-slate-700/50'}`}>
                <tr>
                    <th scope="col" className={`text-center text-xs font-medium text-slate-300 uppercase tracking-wider ${isManualEntryMode ? 'px-1 py-3' : 'px-2 py-3'}`}>No.</th>
                    <th scope="col" className={`text-center text-xs font-medium text-slate-300 uppercase tracking-wider ${isManualEntryMode ? 'px-2 py-3' : 'px-3 py-3'}`}>
                        {isManualEntryMode ? '저장 시간' : '수치 입력 시간'}
                    </th>
                    {showTwoValueColumns ? (
                    <>
                        <th scope="col" className={`text-center text-xs font-medium text-slate-300 uppercase tracking-wider ${isManualEntryMode ? 'px-1' : 'px-8'} py-3`}>{isTnTpMode ? 'TN 값' : 'TU 값'}</th>
                        <th scope="col" className={`text-center text-xs font-medium text-slate-300 uppercase tracking-wider ${isManualEntryMode ? 'px-1' : 'px-8'} py-3`}>{isTnTpMode ? 'TP 값' : 'Cl 값'}</th>
                    </>
                    ) : (
                        <th scope="col" className={`text-center text-xs font-medium text-slate-300 uppercase tracking-wider ${isManualEntryMode ? 'px-1' : 'px-8'} py-3`}>값</th>
                    )}
                    <th scope="col" className={`text-center text-xs font-medium text-slate-300 uppercase tracking-wider ${isManualEntryMode ? 'px-1 py-3' : 'px-3 py-3'}`}>{isManualEntryMode ? '구분' : (isTnTpMode ? 'TN 식별자' : '식별자')}</th>
                    {isTnTpMode && !isManualEntryMode && (
                        <th scope="col" className="px-3 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider">TP 식별자</th>
                    )}
                </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                {ocrData.map((entry, index) => {
                    const baseInputClass = "w-full bg-slate-700 p-2 border border-slate-600 rounded-md text-sm focus:ring-sky-500 focus:border-sky-500";
                    const identifierSelectClass = (ident?: string) => `${baseInputClass} ${ident ? 'text-red-400 font-bold' : 'text-slate-200'}`;
                    
                    const dividerIdentifiers = new Set(['Z 2시간 시작 - 종료', '드리프트 완료', '반복성 완료']);
                    const isDividerRow = isManualEntryMode && entry.identifier && dividerIdentifiers.has(entry.identifier);
                    const isSequenceRow = isManualEntryMode && !!entry.identifier && sequenceRelatedIdentifiers.has(entry.identifier);
                    
                    const isResponseTimeRow = isManualEntryMode && entry.identifier === '응답시간';

                    if (isDividerRow) {
                        const colSpan = 1 + (showTwoValueColumns ? 2 : 1) + 1; // Time + Value(s) + Identifier
                        return (
                            <tr key={entry.id}>
                                <td className="whitespace-nowrap text-center px-1 py-2 text-sm text-slate-400">{index + 1}</td>
                                <td colSpan={colSpan} className="py-3 px-2">
                                    <div className="flex items-center text-slate-500">
                                        <div className="flex-grow border-t border-slate-600"></div>
                                        <span className="px-4 text-xs font-semibold tracking-wider whitespace-nowrap">
                                            {entry.identifier}
                                        </span>
                                        <div className="flex-grow border-t border-slate-600"></div>
                                    </div>
                                </td>
                            </tr>
                        );
                    }
                    
                    let normalizedTime = entry.time.replace(/\//g, '-');
                    if (normalizedTime.includes(' ') && !normalizedTime.includes('T')) {
                        normalizedTime = normalizedTime.replace(' ', 'T');
                    }
                    const timeParts = normalizedTime.split('T');
                    const rawDatePart = timeParts[0] || '';
                    const datePart = (rawDatePart.length === 10 && (rawDatePart.startsWith('20') || rawDatePart.startsWith('19'))) ? rawDatePart.substring(2) : rawDatePart;
                    const timePart = timeParts[1]?.substring(0, 5) || '';

                    return (
                    <tr key={entry.id} className={`${isSequenceRow && isManualEntryMode ? 'bg-slate-800' : 'hover:bg-slate-700/30'} transition-colors duration-100`}>
                        <td className={`whitespace-nowrap text-center px-1 py-2 text-sm text-slate-400`}>{index + 1}</td>
                        <td className={`whitespace-nowrap px-0 py-1.5`}>
                            {isManualEntryMode ? (
                                <div className="w-full h-9 flex flex-col justify-center items-center text-xs text-slate-200 text-center">
                                    <span>{datePart}</span>
                                    <span>{timePart}</span>
                                </div>
                            ) : (
                                <input 
                                    type="text" 
                                    value={entry.time} 
                                    onChange={(e) => onEntryTimeChange(entry.id, e.target.value)} 
                                    className="w-full h-9 bg-slate-800/80 border border-slate-700 rounded-md px-2 text-sm text-slate-200 text-center placeholder-slate-500"
                                    aria-label="수치 입력 시간"
                                    disabled={isDividerRow}
                                />
                            )}
                        </td>
                        
                        {isResponseTimeRow && isManualEntryMode ? (
                             showTwoValueColumns ? (
                                <>
                                    <td className={`whitespace-nowrap px-0 py-1.5`}>
                                        {renderResponseTimeMultiInputCell(entry, 'primary', onEntryPrimaryValueChange)}
                                    </td>
                                    <td className={`whitespace-nowrap px-0 py-1.5`}>
                                        {renderResponseTimeMultiInputCell(entry, 'tp', onEntryValueTPChange)}
                                    </td>
                                </>
                            ) : (
                                <td colSpan={1} className={`whitespace-nowrap px-0 py-1.5`}>
                                    {renderResponseTimeMultiInputCell(entry, 'primary', onEntryPrimaryValueChange)}
                                </td>
                            )
                        ) : (
                            <>
                                <td className={`whitespace-nowrap px-0 py-1.5`}>
                                    <input type="text" value={getDisplayValue(entry.value)} onChange={(e) => onEntryPrimaryValueChange(entry.id, e.target.value)} onBlur={() => onEntryValueBlur?.(entry.id, 'primary')} className="w-full h-9 bg-slate-800/80 border border-slate-700 rounded-md px-2 text-sm text-slate-200 text-center placeholder-slate-500" aria-label={`${showTwoValueColumns ? (isTnTpMode ? 'TN 값' : 'TU 값') : '값'} 입력 필드 ${index + 1}`} disabled={isDividerRow}/>
                                </td>
                                {showTwoValueColumns && (
                                    <td className={`whitespace-nowrap px-0 py-1.5`}>
                                        <input type="text" value={getDisplayValue(entry.valueTP)} onChange={(e) => onEntryValueTPChange(entry.id, e.target.value)} onBlur={() => onEntryValueBlur?.(entry.id, 'tp')} className="w-full h-9 bg-slate-800/80 border border-slate-700 rounded-md px-2 text-sm text-slate-200 text-center placeholder-slate-500" aria-label={`${isTnTpMode ? 'TP 값' : 'Cl 값'} 입력 필드 ${index + 1}`} disabled={isDividerRow}/>
                                    </td>
                                )}
                            </>
                        )}


                        {!isManualEntryMode ? (
                           <>
                            <td className={`whitespace-nowrap text-sm px-2 py-1.5`}> 
                                <select value={entry.identifier || ''} onChange={(e) => onEntryIdentifierChange(entry.id, e.target.value)} className={identifierSelectClass(entry.identifier)} aria-label={`${isTnTpMode ? 'TN' : ''} 식별자 선택 ${index + 1}`}>
                                    <option value="" className="text-slate-400">지정 안함</option>
                                    {(isTnTpMode ? tnIdentifiers : availableIdentifiers).map(opt => <option key={opt} value={opt} className={entry.identifier === opt ? 'text-red-400 font-bold' : 'text-slate-200'}>{opt}</option>)}
                                </select>
                            </td>
                            {isTnTpMode && (
                                <td className={`whitespace-nowrap text-sm px-2 py-1.5`}>
                                    <select value={entry.identifierTP || ''} onChange={(e) => onEntryIdentifierTPChange(entry.id, e.target.value)} className={identifierSelectClass(entry.identifierTP)} aria-label={`TP 식별자 선택 ${index + 1}`}>
                                        <option value="" className="text-slate-400">지정 안함</option>
                                        {tpIdentifiers.map(opt => <option key={opt} value={opt} className={entry.identifierTP === opt ? 'text-red-400 font-bold' : 'text-slate-200'}>{opt}</option>)}
                                    </select>
                                </td>
                            )}
                           </>
                        ) : (
                           <td className={`whitespace-nowrap text-sm text-center px-1 py-1.5 leading-tight`}>
                                <span className={isSequenceRow ? 'text-red-400 font-semibold' : 'text-slate-300'}>
                                    {entry.identifier === '응답시간' ? <><span className="block">응답</span><span className="block">시간</span></> : entry.identifier}
                                </span>
                           </td>
                        )}
                    </tr>
                )})}
                </tbody>
            </table>
            </div>
        )}
        {!isManualEntryMode && (
            <div className="mt-4 flex justify-end">
                <ActionButton onClick={onAddEntry} variant="primary" icon={<PlusIcon />} aria-label="추출된 데이터 테이블에 새 행 추가" disabled={isLoading}>
                    행 추가
                </ActionButton>
            </div>
        )}
      </>
    );
  }

  if (ocrData === null) {
    return (
      <div className="mt-6 p-6 bg-slate-700/50 rounded-lg shadow text-center">
        <p className="text-slate-400">
          {isManualEntryMode ? "위 '새 작업 추가'를 통해 작업을 시작하세요." : "위의 '텍스트 추출' 버튼을 눌러 이미지 분석을 시작하세요."}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      {renderTable()}
    </div>
  );
};