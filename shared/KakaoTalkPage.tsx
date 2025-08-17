import React, { useState, useCallback, useMemo } from 'react';
import { ActionButton } from '../components/ActionButton';
import { Spinner } from '../components/Spinner';
import { sendKakaoTalkMessage } from '../services/claydoxApiService';

interface KakaoTalkPageProps {
  userName: string;
}

const INSPECTOR_PHONE_NUMBERS: Record<string, string> = {
  "김종진": "010-8412-8602",
  "권민경": "010-8898-8272",
  "김성대": "010-5325-9074",
  "김수철": "010-9980-0529",
  "정슬기": "010-9911-3837",
  "강준": "010-4192-2600",
  "정진욱": "010-4480-3262",
};
const INSPECTOR_NAMES = ["미정", ...Object.keys(INSPECTOR_PHONE_NUMBERS)];


interface InstitutionEntry {
  id: string;
  scheduledDateRange: string;
  inspectorName: string;
  phoneNumber: string;
  status: 'idle' | 'sending' | 'success' | 'error';
  responseMessage?: string;
}

const SendIcon: React.FC = () => ( 
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
  </svg>
);

const ClearIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12.56 0c1.153 0 2.24.03 3.22.077m3.22-.077L10.88 5.79m2.558 0c-.29.042-.58.083-.87.124" />
  </svg>
);

const InfoIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-slate-400">
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
    </svg>
);
  
const PlusIcon: React.FC = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
  </svg>
);

const TrashIcon: React.FC = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12.56 0c1.153 0 2.24.03 3.22.077m3.22-.077L10.88 5.79m2.558 0c-.29.042-.58.083-.87.124" />
  </svg>
);

const LinkHelpModal: React.FC<{ isOpen: boolean; onClose: () => void; }> = ({ isOpen, onClose }) => {
    if (!isOpen) return null;

    return (
      <div 
        className="fixed inset-0 bg-slate-900 bg-opacity-75 backdrop-blur-sm flex items-center justify-center p-4 z-50"
        aria-labelledby="link-help-modal-title"
        role="dialog"
        aria-modal="true"
      >
        <div className="bg-slate-800 p-6 rounded-xl shadow-2xl w-full max-w-lg">
          <h3 id="link-help-modal-title" className="text-xl font-bold text-sky-400 mb-4">파일 공유 링크 만드는 방법</h3>
          <div className="space-y-4 text-slate-300 text-sm">
            <p>이 앱은 파일을 직접 저장(호스팅)할 수 없습니다. 파일을 공유하려면, 아래와 같은 외부 클라우드 서비스를 이용해주세요.</p>
            <ol className="list-decimal list-inside space-y-3 bg-slate-700/50 p-4 rounded-md">
              <li>
                <strong>클라우드 서비스에 파일 업로드:</strong>
                <p className="pl-2 text-xs text-slate-400">구글 드라이브, 드롭박스 등 클라우드 저장소에 한글(HWP) 파일을 업로드합니다.</p>
              </li>
              <li>
                <strong>'공유' 및 접근 권한 설정:</strong>
                <p className="pl-2 text-xs text-slate-400">업로드한 파일에서 '공유' 옵션을 찾고, 접근 권한을 '제한됨'에서 <strong>'링크가 있는 모든 사용자'</strong>로 변경해야 합니다.</p>
              </li>
              <li>
                <strong>공개용 링크 복사:</strong>
                <p className="pl-2 text-xs text-slate-400">생성된 공개용 링크를 복사합니다.</p>
              </li>
              <li>
                <strong>앱에 링크 붙여넣기:</strong>
                <p className="pl-2 text-xs text-slate-400">복사한 링크를 '파일 링크' 입력란에 붙여넣습니다.</p>
              </li>
            </ol>
          </div>
          <div className="mt-6 text-right">
            <ActionButton onClick={onClose} variant="secondary">닫기</ActionButton>
          </div>
        </div>
      </div>
    );
};

const StatusIndicator: React.FC<{ status: InstitutionEntry['status'], message?: string }> = ({ status, message }) => {
    if (status === 'idle') return null;

    const baseClasses = "flex items-center gap-2 text-xs p-1.5 rounded mt-2";

    if (status === 'sending') {
        return <div className={`${baseClasses} bg-sky-800/50 text-sky-300`}><Spinner size="sm" /> <span>전송 중...</span></div>;
    }
    if (status === 'success') {
        return <div className={`${baseClasses} bg-green-800/50 text-green-300`}>✅ <span>{message || '성공'}</span></div>;
    }
    if (status === 'error') {
        return <div className={`${baseClasses} bg-red-800/50 text-red-300 truncate`} title={message}>❌ <span className="truncate">{message || '실패'}</span></div>;
    }
    return null;
};

const generateMessage = (
    year: string,
    fieldName: string,
    testName: string,
    entry: Partial<InstitutionEntry>,
    fileLink: string
) => {
    const scheduledDateRange = entry?.scheduledDateRange?.trim() || '{검사예정일(현장명)}';
    const inspectorName = entry?.inspectorName?.trim() || '미정';

    const finalYear = year.trim() || new Date().getFullYear();
    const finalFieldName = fieldName.trim() || '{분야명}';
    const finalTestName = testName.trim() || '정도검사';

    let inspectorLine = `- 담당검사자 : ${inspectorName}`;
    const inspectorPhone = INSPECTOR_PHONE_NUMBERS[inspectorName];
    if (inspectorPhone) {
        inspectorLine += ` (${inspectorPhone})`;
    }

    let message = `안녕하세요. 한국산업기술시험원 입니다.

${finalYear}년도 ${finalFieldName} ${finalTestName} 일정을 아래와 같이 안내드리오니, 신청서 접수 요청드립니다.

- 검사예정일(현장명) : ${scheduledDateRange}
${inspectorLine}

▶제출 서류◀
① 정도검사신청서 (+정보제공동의서)
② 사업자등록증

▶신청서 접수◀
- 메일주소 : tmfrl22@ktl.re.kr (슬기22)
- 전화문의 : 정슬기 (055-791-3650)`;
    
    if (fileLink.trim()) {
      message += `\n\n▶[신청서 링크] ◀\n${fileLink.trim()}`;
    }
    return message;
};

const KakaoTalkPage: React.FC<KakaoTalkPageProps> = ({ userName }) => {
  const [year, setYear] = useState<string>(new Date().getFullYear().toString());
  const [testName, setTestName] = useState<string>('정도검사');
  const [fieldName, setFieldName] = useState('');
  
  const [newEntryScheduledDateRange, setNewEntryScheduledDateRange] = useState<string>('');
  const [newEntryInspectorName, setNewEntryInspectorName] = useState<string>(INSPECTOR_NAMES[0] || '');
  const [newEntryPhoneNumbers, setNewEntryPhoneNumbers] = useState<string>('');

  const [structuredList, setStructuredList] = useState<InstitutionEntry[]>([]);

  const [fileLink, setFileLink] = useState('https://drive.google.com/drive/folders/1SawD1SPqaWj5M5pfbUH5UJhYVfpS9Ki4?usp=sharing');
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduleTime, setScheduleTime] = useState('');

  const [isSending, setIsSending] = useState(false);
  const [apiResponse, setApiResponse] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);

  const handleAddInstitutions = () => {
    const scheduledDateRange = newEntryScheduledDateRange.trim();
    const inspectorName = newEntryInspectorName.trim();
    const phoneNumbersRaw = newEntryPhoneNumbers.trim();

    if (!scheduledDateRange || !inspectorName || !phoneNumbersRaw) {
        setApiResponse({ type: 'error', message: '추가할 기관의 검사예정일(현장명), 담당검사자, 수신자 번호를 모두 입력해주세요.' });
        return;
    }
    
    const phoneNumbers = phoneNumbersRaw.split(',').map(p => p.trim()).filter(p => p !== '');
    
    if (phoneNumbers.length === 0) {
        setApiResponse({ type: 'error', message: '유효한 수신자 번호를 입력해주세요.' });
        return;
    }

    const newEntries: InstitutionEntry[] = phoneNumbers.map(phone => ({
        id: self.crypto.randomUUID(),
        scheduledDateRange,
        inspectorName,
        phoneNumber: phone,
        status: 'idle',
        responseMessage: undefined
    }));

    setStructuredList(prev => [...prev, ...newEntries]);
    
    setNewEntryScheduledDateRange('');
    setNewEntryInspectorName(INSPECTOR_NAMES[0] || '');
    setNewEntryPhoneNumbers('');
    setApiResponse(null);
  };

  const handleUpdateInstitution = (id: string, field: keyof Omit<InstitutionEntry, 'id' | 'status' | 'responseMessage'>, value: string) => {
    setStructuredList(prev => prev.map(item => {
        if (item.id === id) {
            return { ...item, [field]: value, status: 'idle', responseMessage: undefined };
        }
        return item;
    }));
    setApiResponse(null);
  };

  const handleRemoveInstitution = (id: string) => {
    setStructuredList(prev => prev.filter(item => item.id !== id));
    setApiResponse(null);
  };

  const handleClear = useCallback(() => {
    setYear(new Date().getFullYear().toString());
    setTestName('정도검사');
    setFieldName('');
    setNewEntryScheduledDateRange('');
    setNewEntryInspectorName(INSPECTOR_NAMES[0] || '');
    setNewEntryPhoneNumbers('');
    setStructuredList([]);
    setFileLink('https://drive.google.com/drive/folders/1SawD1SPqaWj5M5pfbUH5UJhYVfpS9Ki4?usp=sharing');
    setIsScheduled(false);
    setScheduleTime('');
    setApiResponse(null);
  }, []);

  const composedMessagePreview = useMemo(() => {
    return generateMessage(year, fieldName, testName, structuredList[0], fileLink);
  }, [year, fieldName, testName, structuredList, fileLink]);

  const handleBatchSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (userName === "게스트") {
      setApiResponse({ type: 'error', message: '게스트 사용자는 메시지를 전송할 수 없습니다.' });
      return;
    }
    
    const hasEmptyFields = !year.trim() || !fieldName.trim() || !testName.trim() || structuredList.length === 0;
    const hasEmptyListContent = structuredList.some(item => !item.scheduledDateRange.trim() || !item.inspectorName.trim() || !item.phoneNumber.trim());
    
    if (hasEmptyFields || hasEmptyListContent) {
      setApiResponse({ type: 'error', message: '필수 항목(년도, 검사명, 분야명, 기관별 목록의 모든 현장/날짜/번호)을 모두 입력해주세요.' });
      return;
    }
    if (isScheduled && !scheduleTime) {
      setApiResponse({ type: 'error', message: '예약 전송 시간을 선택해주세요.' });
      return;
    }

    setIsSending(true);
    setApiResponse({ type: 'success', message: `일괄 전송을 시작합니다... (${structuredList.length}건)`});

    setStructuredList(prev => prev.map(item => ({...item, status: 'sending', responseMessage: undefined})));

    let successCount = 0;
    const totalCount = structuredList.length;

    for (const entry of structuredList) {
        const messageBody = generateMessage(year, fieldName, testName, entry, fileLink);
        
        let reservationTimeFormatted: string | undefined = undefined;
        if (isScheduled && scheduleTime) {
            try {
                const date = new Date(scheduleTime);
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                const hours = String(date.getHours()).padStart(2, '0');
                const minutes = String(date.getMinutes()).padStart(2, '0');
                reservationTimeFormatted = `${year}-${month}-${day} ${hours}:${minutes}:00`;
            } catch (error) {
                // This shouldn't happen with datetime-local, but as a safeguard
            }
        }

        try {
            await sendKakaoTalkMessage(messageBody, entry.phoneNumber.trim(), reservationTimeFormatted);
            setStructuredList(prev => prev.map(item => item.id === entry.id ? { ...item, status: 'success', responseMessage: '전송 성공' } : item));
            successCount++;
        } catch (error: any) {
            setStructuredList(prev => prev.map(item => item.id === entry.id ? { ...item, status: 'error', responseMessage: `실패: ${error.message}` } : item));
        }
    }
    
    setIsSending(false);
    setApiResponse({ type: 'success', message: `일괄 전송 완료. (성공: ${successCount} / ${totalCount})` });
  };


  const getMinScheduleTime = () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 1); // Set minimum time to 1 minute from now
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  const isSubmitDisabled = isSending || !year.trim() || !fieldName.trim() || !testName.trim() || structuredList.length === 0 || structuredList.some(i => !i.phoneNumber.trim() || !i.scheduledDateRange.trim() || !i.inspectorName.trim()) || (isScheduled && !scheduleTime);

  return (
    <div className="w-full max-w-3xl bg-slate-800 shadow-2xl rounded-xl p-6 sm:p-8 space-y-6">
      <h2 className="text-2xl font-bold text-sky-400 border-b border-slate-700 pb-3">
        카카오톡 메시지 전송
      </h2>
      <form onSubmit={handleBatchSend} className="space-y-5">
        
        <div className="p-4 bg-slate-700/30 rounded-lg border border-slate-600/50 space-y-4">
            <h3 className="text-lg font-semibold text-sky-300">메시지 템플릿 입력</h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label htmlFor="kakao-year" className="block text-sm font-medium text-slate-200 mb-1">
                        년도 <span className="text-red-400">*</span>
                    </label>
                    <input
                        type="text"
                        id="kakao-year"
                        value={year}
                        onChange={(e) => { setYear(e.target.value); setApiResponse(null); }}
                        required
                        disabled={isSending}
                        className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 text-slate-100 text-sm placeholder-slate-400 transition-colors"
                        placeholder="예: 2025"
                    />
                </div>
                <div>
                    <label htmlFor="kakao-test-name" className="block text-sm font-medium text-slate-200 mb-1">
                        검사명 <span className="text-red-400">*</span>
                    </label>
                    <input
                        type="text"
                        id="kakao-test-name"
                        value={testName}
                        onChange={(e) => { setTestName(e.target.value); setApiResponse(null); }}
                        required
                        disabled={isSending}
                        className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 text-slate-100 text-sm placeholder-slate-400 transition-colors"
                        placeholder="예: 정도검사"
                    />
                </div>
            </div>

            <div>
                <label htmlFor="kakao-field-name" className="block text-sm font-medium text-slate-200 mb-1">
                    분야명 <span className="text-red-400">*</span>
                </label>
                <input
                    type="text"
                    id="kakao-field-name"
                    value={fieldName}
                    onChange={(e) => { setFieldName(e.target.value); setApiResponse(null); }}
                    required
                    disabled={isSending}
                    className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 text-slate-100 text-sm placeholder-slate-400 transition-colors"
                    placeholder="예: 수질분야, 먹는물분야"
                />
            </div>
            
            <div>
                <label className="block text-sm font-medium text-slate-200 mb-1">
                    기관별 목록 <span className="text-red-400">*</span>
                </label>
                <div className="space-y-3 bg-slate-800/50 p-3 rounded-md">
                    <div className="p-3 bg-slate-700/50 rounded-lg border border-slate-600/50 space-y-3">
                        <h4 className="text-md font-semibold text-sky-400">새 기관 추가</h4>
                        <div>
                            <label htmlFor="new-entry-date-range" className="block text-xs font-medium text-slate-400 mb-0.5">검사예정일(현장명)</label>
                            <input
                                type="text"
                                id="new-entry-date-range"
                                value={newEntryScheduledDateRange}
                                onChange={(e) => setNewEntryScheduledDateRange(e.target.value)}
                                placeholder="예) 25.01.01 ~ 25.01.02"
                                className="w-full text-sm bg-slate-600 border border-slate-500 rounded-md p-2 focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-400"
                                disabled={isSending}
                            />
                        </div>
                        <div>
                            <label htmlFor="new-entry-inspector" className="block text-xs font-medium text-slate-400 mb-0.5">담당검사자</label>
                            <select
                                id="new-entry-inspector"
                                value={newEntryInspectorName}
                                onChange={(e) => setNewEntryInspectorName(e.target.value)}
                                className="w-full text-sm bg-slate-600 border border-slate-500 rounded-md p-2 focus:ring-sky-500 focus:border-sky-500 text-slate-100"
                                disabled={isSending}
                            >
                                {INSPECTOR_NAMES.map(name => <option key={name} value={name}>{name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="new-entry-phones" className="block text-xs font-medium text-slate-400 mb-0.5">수신자 번호(들)</label>
                            <input
                                type="text"
                                id="new-entry-phones"
                                value={newEntryPhoneNumbers}
                                onChange={(e) => setNewEntryPhoneNumbers(e.target.value)}
                                placeholder="010-1234-5678, 010-8765-4321"
                                className="w-full text-sm bg-slate-600 border border-slate-500 rounded-md p-2 focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-400"
                                disabled={isSending}
                            />
                            <p className="mt-1 text-xs text-slate-500">여러 번호는 쉼표(,)로 구분하여 입력하세요.</p>
                        </div>
                        <ActionButton type="button" onClick={handleAddInstitutions} variant="primary" fullWidth icon={<PlusIcon />} disabled={isSending || !newEntryScheduledDateRange.trim() || !newEntryInspectorName.trim() || !newEntryPhoneNumbers.trim()}>
                            목록에 추가
                        </ActionButton>
                    </div>

                    {structuredList.length === 0 && (
                        <p className="text-center text-sm text-slate-500 py-4">아직 추가된 기관이 없습니다.</p>
                    )}
                    {structuredList.map((item, index) => (
                    <div key={item.id} className="p-3 bg-slate-700 rounded-lg border border-slate-600 space-y-2 relative">
                        <button 
                        type="button" 
                        onClick={() => handleRemoveInstitution(item.id)}
                        className="absolute top-2 right-2 p-1 text-slate-400 hover:text-red-400 hover:bg-slate-600 rounded-full"
                        aria-label={`항목 ${index + 1} 삭제`}
                        >
                        <TrashIcon />
                        </button>
                        <div>
                        <label htmlFor={`date-range-${item.id}`} className="block text-xs font-medium text-slate-400 mb-0.5">검사예정일(현장명) (수정 가능)</label>
                        <input
                            type="text"
                            id={`date-range-${item.id}`}
                            value={item.scheduledDateRange}
                            onChange={(e) => handleUpdateInstitution(item.id, 'scheduledDateRange', e.target.value)}
                            placeholder="예: 25.01.01 ~ 25.01.02"
                            className="w-full text-sm bg-slate-600 border border-slate-500 rounded-md p-2 focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-400"
                            disabled={isSending}
                        />
                        </div>
                        <div>
                        <label htmlFor={`inspector-${item.id}`} className="block text-xs font-medium text-slate-400 mb-0.5">담당검사자 (수정 가능)</label>
                        <select
                            id={`inspector-${item.id}`}
                            value={item.inspectorName}
                            onChange={(e) => handleUpdateInstitution(item.id, 'inspectorName', e.target.value)}
                            className="w-full text-sm bg-slate-600 border border-slate-500 rounded-md p-2 focus:ring-sky-500 focus:border-sky-500 text-slate-100"
                            disabled={isSending}
                        >
                            {INSPECTOR_NAMES.map(name => <option key={name} value={name}>{name}</option>)}
                        </select>
                        </div>
                        <div>
                        <label htmlFor={`phone-${item.id}`} className="block text-xs font-medium text-slate-400 mb-0.5">수신자 번호 <span className="text-red-400">*</span></label>
                        <input
                            type="text"
                            id={`phone-${item.id}`}
                            required
                            value={item.phoneNumber}
                            onChange={(e) => handleUpdateInstitution(item.id, 'phoneNumber', e.target.value)}
                            placeholder="예: 010-1234-5678"
                            className="w-full text-sm bg-slate-600 border border-slate-500 rounded-md p-2 focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-400"
                            disabled={isSending}
                        />
                        </div>
                        <StatusIndicator status={item.status} message={item.responseMessage} />
                    </div>
                    ))}
                </div>
            </div>
        </div>

        <div className="space-y-2">
            <h3 className="text-lg font-semibold text-sky-300">메시지 미리보기</h3>
             <div className="p-4 rounded-lg" style={{ background: 'linear-gradient(to bottom, #b2c7d9, #a7bed8)' }}>
                <div className="flex justify-start">
                    <div className="relative max-w-sm">
                        <div className="bg-[#FEE500] text-black p-3 rounded-lg shadow-md" style={{ borderRadius: '12px 12px 12px 0' }}>
                            <p className="whitespace-pre-wrap text-sm leading-relaxed break-words">{composedMessagePreview}</p>
                        </div>
                    </div>
                </div>
            </div>
            <p className="mt-1 text-xs text-slate-500 text-center">
                미리보기는 목록의 첫 번째 항목을 기준으로 표시됩니다. 각 수신자는 자신의 정보에 맞는 메시지를 받게 됩니다.
            </p>
        </div>
        
        <div>
          <div className="flex items-center justify-between mb-1">
              <label htmlFor="kakao-file-link" className="block text-sm font-medium text-slate-200">
                파일 링크 (선택)
              </label>
              <button 
                type="button" 
                onClick={() => setIsHelpModalOpen(true)} 
                className="p-1 rounded-full hover:bg-slate-600 transition-colors" 
                aria-label="파일 링크 만드는 방법 도움말"
              >
                <InfoIcon />
              </button>
            </div>
          <input
            type="url"
            id="kakao-file-link"
            value={fileLink}
            onChange={(e) => { setFileLink(e.target.value); setApiResponse(null); }}
            disabled={isSending}
            className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 text-slate-100 text-sm placeholder-slate-400 transition-colors"
            placeholder="https://example.com/shared/file.hwp"
          />
          <p className="mt-1 text-xs text-slate-500">
            한글(HWP) 등 파일을 첨부하려면 클라우드에 업로드 후 공유 가능한 링크를 여기에 붙여넣으세요.
          </p>
        </div>

        <div className="p-3 bg-slate-700/50 rounded-md border border-slate-600/50 space-y-2">
            <div className="flex items-center">
                <input
                    id="schedule-check"
                    type="checkbox"
                    checked={isScheduled}
                    onChange={(e) => { setIsScheduled(e.target.checked); setApiResponse(null); }}
                    disabled={isSending}
                    className="h-4 w-4 rounded border-slate-500 bg-slate-700 text-sky-600 focus:ring-sky-500"
                />
                <label htmlFor="schedule-check" className="ml-2 block text-sm font-medium text-slate-200">
                    예약 전송
                </label>
            </div>
            {isScheduled && (
                <div>
                    <label htmlFor="schedule-time" className="sr-only">예약 시간</label>
                    <input
                        type="datetime-local"
                        id="schedule-time"
                        value={scheduleTime}
                        onChange={(e) => { setScheduleTime(e.target.value); setApiResponse(null); }}
                        required={isScheduled}
                        min={getMinScheduleTime()}
                        disabled={isSending}
                        className="block w-full p-2.5 bg-slate-600 border border-slate-500 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 text-slate-100 text-sm placeholder-slate-400"
                    />
                     <p className="mt-1 text-xs text-slate-500">
                        메시지를 보낼 미래의 시간을 선택하세요. (초 단위는 :00으로 자동 설정됩니다)
                    </p>
                </div>
            )}
        </div>

        {apiResponse && (
          <div
            className={`p-3 text-sm rounded-md ${
              apiResponse.type === 'success'
                ? 'bg-green-800/30 border border-green-600/50 text-green-300'
                : 'bg-red-800/30 border border-red-600/50 text-red-300'
            }`}
            role="alert"
          >
            {apiResponse.message}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <ActionButton
                type="button"
                onClick={handleClear}
                variant="secondary"
                icon={<ClearIcon />}
                disabled={isSending}
                fullWidth
            >
                내용 지우기
            </ActionButton>
            <ActionButton
                type="submit"
                variant="primary"
                icon={<SendIcon />}
                isLoading={isSending}
                disabled={isSubmitDisabled}
                fullWidth
            >
                {isSending ? '전송 중...' : `일괄 전송 (${structuredList.length}건)`}
            </ActionButton>
        </div>
      </form>
      <LinkHelpModal isOpen={isHelpModalOpen} onClose={() => setIsHelpModalOpen(false)} />
    </div>
  );
};

export default KakaoTalkPage;