import React, { useState, useEffect, useCallback } from 'react';
import { ChecklistStatus, MainStructuralItemKey, OTHER_DIRECT_INPUT_OPTION, CertificateDetails, CertificatePresenceStatus, ANALYSIS_IMPOSSIBLE_OPTION, MAIN_STRUCTURAL_ITEMS, EMISSION_STANDARD_ITEM_NAME, RESPONSE_TIME_ITEM_NAME } from '../../shared/structuralChecklists';
import { ActionButton } from '../ActionButton';
import { Spinner } from '../Spinner';

interface ChecklistItemRowProps {
  mainItemKey: MainStructuralItemKey;
  itemName: string;
  itemIndex: number; // Overall index in the checklist array for the mainItemKey
  status: ChecklistStatus;
  onStatusChange: (newStatus: ChecklistStatus) => void;
  notes?: string; 
  onNotesChange: (newNotes: string) => void;
  specialNotes?: string; 
  onSpecialNotesChange?: (newSpecialNotes: string) => void; 
  disabled?: boolean;
  confirmedAt: string | null;
  itemOptions?: string[]; 
  onAnalyzeDetail?: (itemNameForAnalysis: "측정방법확인" | "측정범위확인" | "표시사항확인" | "운용프로그램확인" | "정도검사 증명서") => void;
  isAnalyzingDetail?: boolean;
  detailAnalysisError?: string | null;
  jobPhotosExist?: boolean;
  comparisonNote?: string | null; 
}

const AiIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L1.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.25 12L17 14.188l-1.25.813a4.5 4.5 0 01-3.09-3.09L11.25 9l1.25-2.846a4.5 4.5 0 013.09-3.09L17 2.25l1.25.813a4.5 4.5 0 013.09 3.09L22.75 9l-1.25 2.846a4.5 4.5 0 01-3.09 3.09L18.25 12z" />
  </svg>
);


export const ChecklistItemRow: React.FC<ChecklistItemRowProps> = ({
  mainItemKey,
  itemName,
  itemIndex,
  status,
  onStatusChange,
  notes,
  onNotesChange,
  specialNotes,
  onSpecialNotesChange,
  disabled = false,
  confirmedAt,
  itemOptions,
  onAnalyzeDetail,
  isAnalyzingDetail,
  detailAnalysisError,
  jobPhotosExist,
  comparisonNote,
}) => {
  const statusOptions: ChecklistStatus[] = ['선택 안됨', '적합', '부적합'];

  const isSpecialTocItem = mainItemKey === 'TOC' && (itemName === EMISSION_STANDARD_ITEM_NAME || itemName === RESPONSE_TIME_ITEM_NAME);
  const usesOptionDropdownUi = (itemName === "측정방법확인" || itemName === "측정범위확인") && itemOptions && itemOptions.length > 0;
  const isCertificateItem = itemName === "정도검사 증명서";
  const isMarkingCheckItem = itemName === "표시사항확인";
  const isDeviceNumberItem = itemName === "기기번호 확인";

  const hasAiAnalysisButton = !isSpecialTocItem && onAnalyzeDetail &&
    (usesOptionDropdownUi || isMarkingCheckItem || itemName === "운용프로그램확인" || isCertificateItem);
  
  const isNotApplicableVersionItem = (mainItemKey === 'TU' || mainItemKey === 'Cl') && itemName === "운용프로그램확인";

  const [selectedAnalyzableItemOption, setSelectedAnalyzableItemOption] = useState<string>('');
  const [directInputValue, setDirectInputValue] = useState<string>('');

  const initialCertDetailsState: CertificateDetails = {
    presence: 'not_selected',
    productName: '',
    manufacturer: '',
    serialNumber: '',
    typeApprovalNumber: '',
    inspectionDate: '',
    validity: '',
    previousReceiptNumber: '',
    specialNotes: ''
  };

  const [certDetails, setCertDetails] = useState<CertificateDetails>(initialCertDetailsState);
  const [parsedMarkingCheckJson, setParsedMarkingCheckJson] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    if (isSpecialTocItem || isDeviceNumberItem) {
        // No complex state to manage, notes are handled directly by input
        setParsedMarkingCheckJson(null);
        setCertDetails(initialCertDetailsState);
        setSelectedAnalyzableItemOption('');
        setDirectInputValue('');
    } else if (isCertificateItem) {
      try {
        if (notes && notes.trim().startsWith("{")) {
          const parsedNotes = JSON.parse(notes) as CertificateDetails;
          setCertDetails({
            presence: parsedNotes.presence || 'not_selected',
            productName: parsedNotes.productName || '',
            manufacturer: parsedNotes.manufacturer || '',
            serialNumber: parsedNotes.serialNumber || '',
            typeApprovalNumber: parsedNotes.typeApprovalNumber || '',
            inspectionDate: parsedNotes.inspectionDate || '',
            validity: parsedNotes.validity || '',
            previousReceiptNumber: parsedNotes.previousReceiptNumber || '',
            specialNotes: parsedNotes.specialNotes || '',
          });
        } else {
          setCertDetails(initialCertDetailsState);
        }
      } catch (e) {
        setCertDetails(initialCertDetailsState);
      }
      setParsedMarkingCheckJson(null);
    } else if (isMarkingCheckItem) {
      if (notes && notes.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(notes);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            const stringifiedParsed: Record<string, string> = {};
            for (const key in parsed) {
                if (Object.prototype.hasOwnProperty.call(parsed, key)) {
                    stringifiedParsed[key] = String(parsed[key]);
                }
            }
            setParsedMarkingCheckJson(stringifiedParsed);
          } else {
            setParsedMarkingCheckJson(null);
          }
        } catch (e) {
          setParsedMarkingCheckJson(null);
        }
      } else {
        setParsedMarkingCheckJson(null);
      }
      setCertDetails(initialCertDetailsState);
    } else if (usesOptionDropdownUi) {
      if (notes?.startsWith(OTHER_DIRECT_INPUT_OPTION)) {
        setSelectedAnalyzableItemOption(OTHER_DIRECT_INPUT_OPTION);
        const valuePart = notes.substring(OTHER_DIRECT_INPUT_OPTION.length).trim();
        if (valuePart.startsWith('(') && valuePart.endsWith(')')) {
          setDirectInputValue(valuePart.substring(1, valuePart.length - 1).trim());
        } else {
          setDirectInputValue('');
        }
      } else if (notes && itemOptions?.includes(notes)) {
        setSelectedAnalyzableItemOption(notes);
        setDirectInputValue('');
      } else {
        if (itemOptions?.includes(ANALYSIS_IMPOSSIBLE_OPTION) && (!notes || notes.trim() === '')) {
            setSelectedAnalyzableItemOption(ANALYSIS_IMPOSSIBLE_OPTION);
        } else {
            setSelectedAnalyzableItemOption(notes || '');
        }
        setDirectInputValue('');
      }
      setParsedMarkingCheckJson(null);
      setCertDetails(initialCertDetailsState);
    } else { 
      setSelectedAnalyzableItemOption('');
      setDirectInputValue('');
      setParsedMarkingCheckJson(null);
      setCertDetails(initialCertDetailsState);
    }
  }, [notes, usesOptionDropdownUi, itemOptions, isCertificateItem, isMarkingCheckItem, isSpecialTocItem, isDeviceNumberItem]);


  const handleAnalyzableItemOptionChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newSelectedOption = event.target.value;
    setSelectedAnalyzableItemOption(newSelectedOption);
    if (newSelectedOption === OTHER_DIRECT_INPUT_OPTION) {
      onNotesChange(directInputValue.trim() ? `${OTHER_DIRECT_INPUT_OPTION} (${directInputValue.trim()})` : OTHER_DIRECT_INPUT_OPTION);
    } else {
      setDirectInputValue('');
      onNotesChange(newSelectedOption);
    }
  };

  const handleDirectInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.value;
    setDirectInputValue(newValue);
    if (selectedAnalyzableItemOption === OTHER_DIRECT_INPUT_OPTION) {
      onNotesChange(newValue.trim() ? `${OTHER_DIRECT_INPUT_OPTION} (${newValue.trim()})` : OTHER_DIRECT_INPUT_OPTION);
    }
  };

  const handleCertificateDetailChange = useCallback((field: keyof CertificateDetails, value: string) => {
    setCertDetails(prevDetails => {
      const newDetails = { ...prevDetails, [field]: value };
      if (field === 'presence' && value !== 'present') {
        newDetails.productName = '';
        newDetails.manufacturer = '';
        newDetails.serialNumber = '';
        newDetails.typeApprovalNumber = '';
        newDetails.inspectionDate = '';
        newDetails.validity = '';
        newDetails.previousReceiptNumber = '';
        newDetails.specialNotes = ''; 
      }
      onNotesChange(JSON.stringify(newDetails));
      return newDetails;
    });
  }, [onNotesChange]);


  const handleMarkingCheckDetailChange = useCallback((key: string, value: string) => {
    setParsedMarkingCheckJson(prevJson => {
      if (!prevJson) return null; 
      const newJson = { ...prevJson, [key]: value };
      onNotesChange(JSON.stringify(newJson));
      return newJson;
    });
  }, [onNotesChange]);

  const getAnalysisTypeDisplayString = () => {
    if (itemName === "측정방법확인") return "방법";
    if (itemName === "측정범위확인") return "범위";
    if (itemName === "표시사항확인") return "표시사항";
    if (itemName === "운용프로그램확인") {
        if (mainItemKey === 'TU' || mainItemKey === 'Cl') {
            return "버전 (해당 없음)";
        }
        return "버전";
    }
    if (itemName === "정도검사 증명서") return "증명서 정보";
    return "항목";
  };
  
  const certificatePresenceOptions: { label: string, value: CertificatePresenceStatus }[] = [
    { label: "상태 선택...", value: 'not_selected'},
    { label: "있음", value: 'present'},
    { label: "최초정도검사", value: 'initial_new'},
    { label: "분실 후 재발행", value: 'reissued_lost'},
  ];
  
  const showGenericTextarea = !isDeviceNumberItem && !isSpecialTocItem && !usesOptionDropdownUi && !isCertificateItem && !isMarkingCheckItem && !isNotApplicableVersionItem;

  const getDisplayItemNumber = () => {
    if (isSpecialTocItem) return null; // No number for special TOC items
    const tocSpecialItemCount = mainItemKey === 'TOC' ? 2 : 0;
    return itemIndex - tocSpecialItemCount + 1;
  };
  const displayItemNumber = getDisplayItemNumber();

  return (
    <div className="py-3 px-2 border-b border-slate-700 last:border-b-0 hover:bg-slate-700/20 transition-colors">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
        <div className="md:col-span-1 flex flex-col">
          <div className="flex items-baseline">
            {displayItemNumber !== null && (
                <span className="text-sm font-medium text-slate-300 mr-2">{displayItemNumber}.</span>
            )}
            <label htmlFor={`status-${itemName.replace(/\s+/g, '-')}`} className={`text-sm text-slate-200 break-words ${isSpecialTocItem ? 'font-semibold' : ''}`}>
              {itemName}
              {(isCertificateItem || isMarkingCheckItem) && (
                <span className="text-xs text-purple-400 ml-1.5 whitespace-nowrap">(AI 분석 참고)</span>
              )}
            </label>
          </div>
          {!isSpecialTocItem && !isDeviceNumberItem && confirmedAt && (
            <div className="md:ml-[calc(theme(spacing.2)_+_1em)] text-xs">
                <span className="text-slate-400 mt-0.5 whitespace-nowrap block sm:inline">
                (확인: {confirmedAt})
                </span>
            </div>
           )}
        </div>

        {isDeviceNumberItem ? (
           <div className="md:col-span-1">
            <input
              type="text"
              value={notes || ''}
              onChange={(e) => onNotesChange(e.target.value)}
              placeholder="지시부, 센서부 번호"
              className="w-full text-sm bg-slate-700 border border-slate-600 rounded-md p-2 focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-400 disabled:opacity-70"
              disabled={disabled}
              aria-label="기기번호 입력"
            />
          </div>
        ) : isSpecialTocItem ? (
          <div className="md:col-span-1">
             <input
              type="text"
              value={notes || ''}
              onChange={(e) => onNotesChange(e.target.value)}
              placeholder={`예: ${itemName === EMISSION_STANDARD_ITEM_NAME ? "20" : "6"}`}
              className="w-full text-sm bg-slate-700 border border-slate-600 rounded-md p-2 focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-400 disabled:opacity-70"
              disabled={disabled || isAnalyzingDetail}
              aria-label={`${itemName} 값 입력`}
            />
          </div>
        ) : (
          <div className="md:col-span-1">
            <div className="flex flex-wrap gap-2 items-center justify-end">
              {statusOptions.map(opt => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => onStatusChange(opt)}
                  disabled={disabled}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                    status === opt
                      ? (opt === '적합' ? 'bg-green-500 text-white ring-2 ring-green-300' :
                        opt === '부적합' ? 'bg-red-500 text-white ring-2 ring-red-300' :
                        'bg-slate-500 text-white ring-2 ring-slate-300')
                      : 'bg-slate-600 hover:bg-slate-500 text-slate-300 disabled:bg-slate-700 disabled:text-slate-500'
                  }`}
                  aria-pressed={status === opt}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {!isSpecialTocItem && !isDeviceNumberItem && (
        <div className="mt-2.5 md:ml-[calc(theme(spacing.2)_+_1em)] space-y-2">
            {usesOptionDropdownUi && (
            <>
                <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
                <select
                    value={selectedAnalyzableItemOption}
                    onChange={handleAnalyzableItemOptionChange}
                    className="w-full sm:flex-grow text-xs bg-slate-700 border border-slate-600 rounded-md p-1.5 focus:ring-sky-500 focus:border-sky-500 text-slate-200 placeholder-slate-400 disabled:opacity-70"
                    disabled={disabled || isAnalyzingDetail}
                    aria-label={`${itemName} 세부 ${getAnalysisTypeDisplayString()} 선택`}
                >
                    <option value="">{getAnalysisTypeDisplayString()} 선택...</option>
                    {itemOptions?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
                </div>
                {selectedAnalyzableItemOption === OTHER_DIRECT_INPUT_OPTION && (
                <input
                    type="text"
                    value={directInputValue}
                    onChange={handleDirectInputChange}
                    placeholder="직접 입력 값..."
                    className="w-full text-xs bg-slate-600 border border-slate-500 rounded-md p-1.5 focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-400 disabled:opacity-70"
                    disabled={disabled || isAnalyzingDetail}
                    aria-label="기타 항목 직접 입력"
                />
                )}
            </>
            )}

            {isCertificateItem && (
            <div className="space-y-2">
                <select
                value={certDetails.presence}
                onChange={(e) => handleCertificateDetailChange('presence', e.target.value)}
                className="w-full text-xs bg-slate-700 border border-slate-600 rounded-md p-1.5 focus:ring-sky-500 focus:border-sky-500 text-slate-200 disabled:opacity-70"
                disabled={disabled || isAnalyzingDetail}
                aria-label="정도검사 증명서 상태 선택"
                >
                {certificatePresenceOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
                {certDetails.presence === 'present' && (
                <>
                    <div className="mt-1 p-2 bg-slate-600/50 rounded-md border border-slate-500/50 space-y-2">
                    <h5 className="text-xs font-semibold text-slate-300 mb-1">판별된 증명서 (편집 가능):</h5>
                    
                    <div className="grid grid-cols-4 items-center gap-x-2">
                        <label htmlFor={`cert-productName-${itemIndex}`} className="text-xs text-slate-400 col-span-1">품명 (모델명):</label>
                        <input
                        id={`cert-productName-${itemIndex}`}
                        type="text"
                        value={certDetails.productName || ''}
                        onChange={(e) => handleCertificateDetailChange('productName', e.target.value)}
                        placeholder="예: WTMS-CODcr"
                        className="col-span-3 w-full text-xs bg-slate-700 border border-slate-600 rounded-md p-1.5 focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-400 disabled:opacity-70"
                        disabled={disabled || isAnalyzingDetail}
                        aria-label="정도검사 증명서 품명"
                        />
                    </div>

                    <div className="grid grid-cols-4 items-center gap-x-2">
                        <label htmlFor={`cert-manufacturer-${itemIndex}`} className="text-xs text-slate-400 col-span-1">제작사:</label>
                        <input
                        id={`cert-manufacturer-${itemIndex}`}
                        type="text"
                        value={certDetails.manufacturer || ''}
                        onChange={(e) => handleCertificateDetailChange('manufacturer', e.target.value)}
                        placeholder="예: KORBI"
                        className="col-span-3 w-full text-xs bg-slate-700 border border-slate-600 rounded-md p-1.5 focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-400 disabled:opacity-70"
                        disabled={disabled || isAnalyzingDetail}
                        aria-label="정도검사 증명서 제작사"
                        />
                    </div>
                    
                    <div className="grid grid-cols-4 items-center gap-x-2">
                        <label htmlFor={`cert-serialNumber-${itemIndex}`} className="text-xs text-slate-400 col-span-1">제작번호:</label>
                        <input
                        id={`cert-serialNumber-${itemIndex}`}
                        type="text"
                        value={certDetails.serialNumber || ''}
                        onChange={(e) => handleCertificateDetailChange('serialNumber', e.target.value)}
                        placeholder="예: KHG2O017"
                        className="col-span-3 w-full text-xs bg-slate-700 border border-slate-600 rounded-md p-1.5 focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-400 disabled:opacity-70"
                        disabled={disabled || isAnalyzingDetail}
                        aria-label="정도검사 증명서 제작번호"
                        />
                    </div>
                    
                    <div className="grid grid-cols-4 items-center gap-x-2">
                        <label htmlFor={`cert-typeApprovalNumber-${itemIndex}`} className="text-xs text-slate-400 col-span-1">형식승인번호:</label>
                        <input
                        id={`cert-typeApprovalNumber-${itemIndex}`}
                        type="text"
                        value={certDetails.typeApprovalNumber || ''}
                        onChange={(e) => handleCertificateDetailChange('typeApprovalNumber', e.target.value)}
                        placeholder="예: WTMS-CODmn-2022-2"
                        className="col-span-3 w-full text-xs bg-slate-700 border border-slate-600 rounded-md p-1.5 focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-400 disabled:opacity-70"
                        disabled={disabled || isAnalyzingDetail}
                        aria-label="정도검사 증명서 형식승인번호"
                        />
                    </div>

                    <div className="grid grid-cols-4 items-center gap-x-2">
                        <label htmlFor={`cert-inspectionDate-${itemIndex}`} className="text-xs text-slate-400 col-span-1">검사일자:</label>
                        <input
                        id={`cert-inspectionDate-${itemIndex}`}
                        type="text"
                        value={certDetails.inspectionDate || ''}
                        onChange={(e) => handleCertificateDetailChange('inspectionDate', e.target.value)}
                        placeholder="예: 2024-01-15"
                        className="col-span-3 w-full text-xs bg-slate-700 border border-slate-600 rounded-md p-1.5 focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-400 disabled:opacity-70"
                        disabled={disabled || isAnalyzingDetail}
                        aria-label="정도검사 증명서 검사일자"
                        />
                    </div>

                    <div className="grid grid-cols-4 items-center gap-x-2">
                        <label htmlFor={`cert-validity-${itemIndex}`} className="text-xs text-slate-400 col-span-1">유효기간:</label>
                        <input
                        id={`cert-validity-${itemIndex}`}
                        type="text"
                        value={certDetails.validity || ''}
                        onChange={(e) => handleCertificateDetailChange('validity', e.target.value)}
                        placeholder="예: 2025-07-18"
                        className="col-span-3 w-full text-xs bg-slate-700 border border-slate-600 rounded-md p-1.5 focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-400 disabled:opacity-70"
                        disabled={disabled || isAnalyzingDetail}
                        aria-label="정도검사 증명서 유효기간"
                        />
                    </div>

                    <div className="grid grid-cols-4 items-center gap-x-2">
                        <label htmlFor={`cert-previousReceiptNumber-${itemIndex}`} className="text-xs text-slate-400 col-span-1">직전 접수번호:</label>
                        <input
                        id={`cert-previousReceiptNumber-${itemIndex}`}
                        type="text"
                        value={certDetails.previousReceiptNumber || ''}
                        onChange={(e) => handleCertificateDetailChange('previousReceiptNumber', e.target.value)}
                        placeholder="예: 24-000000-01-1"
                        className="col-span-3 w-full text-xs bg-slate-700 border border-slate-600 rounded-md p-1.5 focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-400 disabled:opacity-70"
                        disabled={disabled || isAnalyzingDetail}
                        aria-label="정도검사 증명서 직전 접수번호"
                        />
                    </div>
                    </div>
                    
                    <div className="mt-2">
                    <label htmlFor={`cert-specialNotes-${itemIndex}`} className="text-xs text-slate-400 mb-0.5 block">특이사항 (선택):</label>
                    <textarea
                        id={`cert-specialNotes-${itemIndex}`}
                        value={certDetails.specialNotes || ''}
                        onChange={(e) => handleCertificateDetailChange('specialNotes', e.target.value)}
                        placeholder="증명서 관련 특이사항 입력"
                        rows={2}
                        className="w-full text-xs bg-slate-700 border border-slate-600 rounded-md p-1.5 focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-400 disabled:opacity-70"
                        disabled={disabled || isAnalyzingDetail}
                        aria-label="정도검사 증명서 특이사항"
                    />
                    </div>
                </>
                )}
                {comparisonNote && (
                <div className={`mt-2 p-2 rounded-md text-xs whitespace-pre-wrap ${comparisonNote.startsWith('(주의)') ? 'bg-amber-700/30 border border-amber-500/50 text-amber-300' : 'bg-sky-700/30 border border-sky-500/50 text-sky-300'}`}>
                    {comparisonNote}
                </div>
                )}
            </div>
            )}

            {isMarkingCheckItem && (
            <>
                {parsedMarkingCheckJson && (
                <div className="mt-1 p-2 bg-slate-600/50 rounded-md border border-slate-500/50 space-y-2">
                    <h5 className="text-xs font-semibold text-slate-300 mb-1">판별된 표시사항 (편집 가능):</h5>
                    {Object.entries(parsedMarkingCheckJson).map(([key, value]) => (
                    <div key={key} className="grid grid-cols-4 items-center gap-x-2">
                        <label htmlFor={`marking-${itemIndex}-${key.replace(/\s+/g, '-')}`} className="text-xs text-slate-400 col-span-1">{key}:</label>
                        <input
                        id={`marking-${itemIndex}-${key.replace(/\s+/g, '-')}`}
                        type="text"
                        value={value}
                        onChange={(e) => handleMarkingCheckDetailChange(key, e.target.value)}
                        className="col-span-3 w-full text-xs bg-slate-700 border border-slate-600 rounded-md p-1.5 focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-400 disabled:opacity-70"
                        disabled={disabled || isAnalyzingDetail}
                        aria-label={`표시사항 ${key}`}
                        />
                    </div>
                    ))}
                </div>
                )}
                {onSpecialNotesChange && (
                <div className="mt-2"> 
                    <label htmlFor={`marking-specialNotes-${itemIndex}`} className="text-xs text-slate-400 mb-0.5 block">특이사항 (선택):</label>
                    <textarea
                    id={`marking-specialNotes-${itemIndex}`}
                    value={specialNotes || ''}
                    onChange={(e) => onSpecialNotesChange(e.target.value)}
                    placeholder="표시사항 관련 특이사항 입력"
                    rows={2}
                    className="w-full text-xs bg-slate-700 border border-slate-600 rounded-md p-1.5 focus:ring-sky-500 focus:border-sky-500 text-slate-200 placeholder-slate-400 disabled:opacity-70"
                    disabled={disabled || isAnalyzingDetail}
                    aria-label={`${itemName} 특이사항`}
                    />
                </div>
                )}
            </>
            )}
            
            {hasAiAnalysisButton && (
            <div className={(usesOptionDropdownUi || isCertificateItem || isMarkingCheckItem || itemName === "운용프로그램확인") ? "flex justify-end pt-1" : ""}>
                <div
                  className={`text-xs py-1 px-2.5 h-fit whitespace-nowrap ${isNotApplicableVersionItem ? 'bg-slate-600' : 'bg-purple-600'} text-white flex items-center justify-center space-x-2 rounded-md cursor-default`}
                  title={isNotApplicableVersionItem ? "이 항목은 AI 분석이 필요하지 않습니다." : "상단의 '빠른 분석' 섹션에서 판별 기능이 제공됩니다."}
                >
                  <AiIcon />
                  <span>{getAnalysisTypeDisplayString()}</span>
                </div>
            </div>
            )}

            {detailAnalysisError && (
            <p className="text-xs text-red-400 mt-1">{detailAnalysisError}</p>
            )}
            
            {showGenericTextarea && onNotesChange && (
            <textarea
                value={notes || ''}
                onChange={(e) => onNotesChange(e.target.value)}
                placeholder={itemName === "운용프로그램확인" ? "판별된 버전 정보 또는 특이사항" : "특이사항 (선택)"}
                rows={1}
                className="w-full text-xs bg-slate-700 border border-slate-600 rounded-md p-1.5 focus:ring-sky-500 focus:border-sky-500 text-slate-200 placeholder-slate-400 disabled:opacity-70"
                disabled={disabled}
                aria-label={`${itemName} 특이사항`}
            />
            )}
        </div>
      )}
    </div>
  );
};