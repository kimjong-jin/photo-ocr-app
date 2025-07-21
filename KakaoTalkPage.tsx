
import React, { useState, useCallback, useMemo } from 'react';
import { ActionButton } from './components/ActionButton';
import { Spinner } from './components/Spinner';
import { sendKakaoTalkMessage } from './services/claydoxApiService';

interface KakaoTalkPageProps {
  userName: string;
  userContact: string;
}

interface InstitutionEntry {
  id: string;
  site: string; // 현장명
  date: string; // 기간
  arrivalTime: string; // 도착예정시간
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

export const KakaoTalkPage: React.FC<KakaoTalkPageProps> = ({ userName, userContact }) => {
  const [year, setYear] = useState<string>(new Date().getFullYear().toString());
  const [testName, setTestName] = useState<string>('정도검사');
  const [editableUserContact, setEditableUserContact] = useState<string>(userContact);
  
  const [newEntrySite, setNewEntrySite] = useState<string>('');
  const [newEntryDate, setNewEntryDate] = useState<string>('');
  const [newEntryArrivalTime, setNewEntryArrivalTime] = useState<string>('오전');
  const [newEntryPhoneNumbers, setNewEntryPhoneNumbers] = useState<string>('');

  const [structuredList, setStructuredList] = useState<InstitutionEntry[]>([]);
  
  const [fileLink, setFileLink] = useState('');
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduleTime, setScheduleTime] = useState('');

  const [isSending, setIsSending] = useState(false);
  const [apiResponse, setApiResponse] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  const handleAddInstitutions = () => {
    const site = newEntrySite.trim();
    const date = newEntryDate.trim();
    const arrivalTime = newEntryArrivalTime.trim();
    const phoneNumbersRaw = newEntryPhoneNumbers.trim();

    if (!site || !date || !arrivalTime || !phoneNumbersRaw) {
        setApiResponse({ type: 'error', message: '추가할 기관의 현장명, 기간, 도착예정시간, 수신자 번호를 모두 입력해주세요.' });
        return;
    }
    
    const phoneNumbers = phoneNumbersRaw.split(',').map(p => p.trim()).filter(p => p !== '');
    
    if (phoneNumbers.length === 0) {
        setApiResponse({ type: 'error', message: '유효한 수신자 번호를 입력해주세요.' });
        return;
    }

    const newEntries: InstitutionEntry[] = phoneNumbers.map(phone => ({
        id: self.crypto.randomUUID(),
        site,
        date,
        arrivalTime,
        phoneNumber: phone,
        status: 'idle',
        responseMessage: undefined
    }));

    setStructuredList(prev => [...prev, ...newEntries]);
    
    setNewEntrySite('');
    setNewEntryDate('');
    setNewEntryArrivalTime('오전');
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
    setEditableUserContact(userContact);
    setNewEntrySite('');
    setNewEntryDate('');
    setNewEntryArrivalTime('오전');
    setNewEntryPhoneNumbers('');
    setStructuredList([]);
    setFileLink('');
    setIsScheduled(false);
    setScheduleTime('');
    setApiResponse(null);
  }, [userContact]);

  const composedMessagePreview = useMemo(() => {
    const firstEntry = structuredList[0];
    const siteText = firstEntry?.site.trim() || '{현장명}';
    const arrivalTimeText = firstEntry?.arrivalTime.trim() || '{오전/오후}';
    const dateText = firstEntry?.date.trim() || '{기간}';

    let message = `안녕하세요. 한국산업기술시험원 입니다.
${year.trim() || '{년도}'}년도 ${siteText} ${testName.trim() || '{검사명}'} 일정을 아래와 같이 안내 드립니다.

▶도착예정시간: ${arrivalTimeText} (정확한 시간은 담당자에게 문의해 주세요)
▶일정: ${dateText}
▶담당자: ${userName}
▶연락처: ${editableUserContact.trim() || '{연락처}'}`;

    if (fileLink.trim()) {
      message += `\n▶진행순서 확인 링크: ${fileLink.trim()}`;
    }
    
    message += '\n\n자세한 사항이나 변동 사항은 담당자에게 직접 문의해 주시기 바랍니다.';
    
    return message;
  }, [year, testName, structuredList, userName, editableUserContact, fileLink]);

  const handleBatchSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (userName === "게스트") {
      setApiResponse({ type: 'error', message: '게스트 사용자는 메시지를 전송할 수 없습니다.' });
      return;
    }
    
    const hasEmptyFields = !year.trim() || !testName.trim() || !editableUserContact.trim() || structuredList.length === 0;
    const hasEmptyListContent = structuredList.some(item => !item.site.trim() || !item.date.trim() || !item.arrivalTime.trim() || !item.phoneNumber.trim());
    
    if (hasEmptyFields || hasEmptyListContent) {
      setApiResponse({ type: 'error', message: '모든 필수 항목(*)을 입력해주세요.' });
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
        let messageBody = `안녕하세요. 한국산업기술시험원 입니다.
${year.trim()}년도 ${entry.site.trim()} ${testName.trim()} 일정을 아래와 같이 안내 드립니다.

▶도착예정시간: ${entry.arrivalTime.trim()} (정확한 시간은 담당자에게 문의해 주세요)
▶일정: ${entry.date.trim()}
▶담당자: ${userName}
▶연락처: ${editableUserContact.trim()}`;

        if (fileLink.trim()) {
            messageBody += `\n▶진행순서 확인 링크: ${fileLink.trim()}`;
        }
        
        messageBody += '\n\n자세한 사항이나 변동 사항은 담당자에게 직접 문의해 주시기 바랍니다.';
        
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

  const isSubmitDisabled = isSending || !year.trim() || !testName.trim() || !editableUserContact.trim() || structuredList.length === 0 || structuredList.some(i => !i.phoneNumber.trim() || !i.site.trim() || !i.date.trim() || !i.arrivalTime.trim()) || (isScheduled && !scheduleTime);

  return (
    <div className="w-full max-w-3xl bg-slate-800 shadow-2xl rounded-xl p-6 sm:p-8 space-y-6">
      <h2 className="text-2xl font-bold text-sky-400 border-b border-slate-700 pb-3">
        카카오톡 메시지 전송 (Page 4)
      </h2>
      <form onSubmit={handleBatchSend} className="space-y-5">
        
        <div className="p-4 bg-slate-700/30 rounded-lg border border-slate-600/50 space-y-4">
            <h3 className="text-lg font-semibold text-slate-100">메시지 템플릿 입력</h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label htmlFor="kakao-year" className="block text-sm font-medium text-slate-300 mb-1">
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
                    <label htmlFor="kakao-test-name" className="block text-sm font-medium text-slate-300 mb-1">
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
                <label htmlFor="kakao-user-contact" className="block text-sm font-medium text-slate-300 mb-1">
                    담당자 연락처 (수정 가능) <span className="text-red-400">*</span>
                </label>
                <input
                    type="text"
                    id="kakao-user-contact"
                    value={editableUserContact}
                    onChange={(e) => { setEditableUserContact(e.target.value); setApiResponse(null); }}
                    required
                    disabled={isSending}
                    className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 text-slate-100 text-sm placeholder-slate-400 transition-colors"
                    placeholder="예: 010-0000-0000"
                />
            </div>
        </div>
        
        <div className="p-4 bg-slate-700/30 rounded-lg border border-slate-600/50 space-y-4">
            <h3 className="text-lg font-semibold text-slate-100">수신 기관 목록</h3>
            
            <div className="space-y-3 bg-slate-800/50 p-3 rounded-md">
                <div className="p-3 bg-slate-700/50 rounded-lg border border-slate-600/50 space-y-3">
                    <h4 className="text-md font-semibold text-slate-200">새 기관 추가</h4>
                    <div>
                        <label htmlFor="new-entry-site" className="block text-xs font-medium text-slate-400 mb-0.5">현장명 <span className="text-red-400">*</span></label>
                        <input
                            type="text"
                            id="new-entry-site"
                            value={newEntrySite}
                            onChange={(e) => setNewEntrySite(e.target.value)}
                            placeholder="예: 공공하수처리시설"
                            className="w-full text-sm bg-slate-600 border border-slate-500 rounded-md p-2 focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-400"
                            disabled={isSending}
                        />
                    </div>
                    <div>
                        <label htmlFor="new-entry-date" className="block text-xs font-medium text-slate-400 mb-0.5">기간 <span className="text-red-400">*</span></label>
                        <input
                            type="text"
                            id="new-entry-date"
                            value={newEntryDate}
                            onChange={(e) => setNewEntryDate(e.target.value)}
                            placeholder="예: 2025.01.01 ~ 01.02"
                            className="w-full text-sm bg-slate-600 border border-slate-500 rounded-md p-2 focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-400"
                            disabled={isSending}
                        />
                    </div>
                     <div>
                        <label htmlFor="new-entry-arrival-time" className="block text-xs font-medium text-slate-400 mb-0.5">도착예정시간 <span className="text-red-400">*</span></label>
                         <select
                            id="new-entry-arrival-time"
                            value={newEntryArrivalTime}
                            onChange={(e) => setNewEntryArrivalTime(e.target.value)}
                            className="w-full text-sm bg-slate-600 border border-slate-500 rounded-md p-2 focus:ring-sky-500 focus:border-sky-500 text-slate-100"
                            disabled={isSending}
                        >
                            <option value="오전">오전</option>
                            <option value="오후">오후</option>
                        </select>
                    </div>
                    <div>
                        <label htmlFor="new-entry-phones" className="block text-xs font-medium text-slate-400 mb-0.5">수신자 번호(들) <span className="text-red-400">*</span></label>
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
                    <ActionButton type="button" onClick={handleAddInstitutions} variant="secondary" fullWidth icon={<PlusIcon />} disabled={isSending || !newEntrySite.trim() || !newEntryDate.trim() || !newEntryArrivalTime.trim() || !newEntryPhoneNumbers.trim()}>
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
                    <label htmlFor={`site-${item.id}`} className="block text-xs font-medium text-slate-400 mb-0.5">현장명 (수정 가능)</label>
                    <input
                        type="text"
                        id={`site-${item.id}`}
                        value={item.site}
                        onChange={(e) => handleUpdateInstitution(item.id, 'site', e.target.value)}
                        className="w-full text-sm bg-slate-600 border border-slate-500 rounded-md p-2 focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-400"
                        disabled={isSending}
                    />
                    </div>
                    <div>
                    <label htmlFor={`date-${item.id}`} className="block text-xs font-medium text-slate-400 mb-0.5">기간 (수정 가능)</label>
                    <input
                        type="text"
                        id={`date-${item.id}`}
                        value={item.date}
                        onChange={(e) => handleUpdateInstitution(item.id, 'date', e.target.value)}
                        className="w-full text-sm bg-slate-600 border border-slate-500 rounded-md p-2 focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-400"
                        disabled={isSending}
                    />
                    </div>
                     <div>
                        <label htmlFor={`arrivaltime-${item.id}`} className="block text-xs font-medium text-slate-400 mb-0.5">도착예정시간 (수정 가능)</label>
                        <select
                            id={`arrivaltime-${item.id}`}
                            value={item.arrivalTime}
                            onChange={(e) => handleUpdateInstitution(item.id, 'arrivalTime', e.target.value)}
                            className="w-full text-sm bg-slate-600 border border-slate-500 rounded-md p-2 focus:ring-sky-500 focus:border-sky-500 text-slate-100"
                            disabled={isSending}
                        >
                            <option value="오전">오전</option>
                            <option value="오후">오후</option>
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
                        className="w-full text-sm bg-slate-600 border border-slate-500 rounded-md p-2 focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-400"
                        disabled={isSending}
                    />
                    </div>
                    <StatusIndicator status={item.status} message={item.responseMessage} />
                </div>
                ))}
            </div>
        </div>
        
        <div className="space-y-2">
            <h3 className="text-lg font-semibold text-slate-200">메시지 미리보기</h3>
            <div className="p-4 bg-slate-900 rounded-md border border-slate-700 text-sm text-slate-300 whitespace-pre-wrap">
                {composedMessagePreview}
            </div>
             <p className="mt-1 text-xs text-slate-500">
                미리보기는 목록의 첫 번째 항목을 기준으로 표시됩니다. 각 수신자는 자신의 정보에 맞는 메시지를 받게 됩니다.
            </p>
        </div>
        
        <div>
            <label htmlFor="kakao-file-link" className="block text-sm font-medium text-slate-300 mb-1">
            진행순서 확인 링크 (선택)
            </label>
          <input
            type="url"
            id="kakao-file-link"
            value={fileLink}
            onChange={(e) => { setFileLink(e.target.value); setApiResponse(null); }}
            disabled={isSending}
            className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 text-slate-100 text-sm placeholder-slate-400 transition-colors"
            placeholder="https://example.com/shared/link"
          />
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
                icon={isSending ? <Spinner size="sm" /> : <SendIcon />}
                disabled={isSubmitDisabled}
                fullWidth
            >
                {isSending ? '전송 중...' : `일괄 전송 (${structuredList.length}건)`}
            </ActionButton>
        </div>
      </form>
    </div>
  );
};

export default KakaoTalkPage;
