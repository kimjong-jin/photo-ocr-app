import React, { useState, useCallback, useMemo } from 'react';
import { ActionButton } from '../components/ActionButton';
import { useAuth } from '../hooks/useAuth';
import { PlusIcon, TrashIcon, InfoIcon, SendIcon, ClearIcon } from '../components/icons';
import { sendKakaoTalkMessage } from '../services/ktlApiService';
import { InstitutionEntry } from '../types';
import InputField from '../components/forms/InputField';
import Section from '../components/forms/Section';
import LinkHelpModal from '../components/kakaotalk/LinkHelpModal';
import StatusIndicator from '../components/kakaotalk/StatusIndicator';


const INSPECTOR_PHONE_NUMBERS: Record<string, string> = {
  "김종진": "010-8412-8602", "권민경": "010-8898-8272", "김성대": "010-5325-9074",
  "김수철": "010-9980-0529", "정슬기": "010-9911-3837", "강준": "010-4192-2600",
  "정진욱": "010-4480-3262",
};
const INSPECTOR_NAMES = ["미정", ...Object.keys(INSPECTOR_PHONE_NUMBERS)];


interface KakaoTalkPageProps {
  isOnline: boolean;
}

const KakaoTalkPage: React.FC<KakaoTalkPageProps> = ({ isOnline }) => {
    const { user } = useAuth();
    const [year, setYear] = useState<string>(new Date().getFullYear().toString());
    const [testName, setTestName] = useState<string>('정도검사');
    const [fieldName, setFieldName] = useState<string>('수질');
    
    const [list, setList] = useState<InstitutionEntry[]>([]);
    const [fileLink, setFileLink] = useState('https://drive.google.com/drive/folders/1SawD1SPqaWj5M5pfbUH5UJhYVfpS9Ki4?usp=sharing');
    const [isScheduled, setIsScheduled] = useState(false);
    const [scheduleTime, setScheduleTime] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [apiResponse, setApiResponse] = useState<{ type: 'success' | 'error', message: string } | null>(null);
    const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
    
    const handleAddInstitution = useCallback(() => {
        const newEntry: InstitutionEntry = {
            id: self.crypto.randomUUID(), scheduledDateRange: '', inspectorName: INSPECTOR_NAMES[0], phoneNumber: '', status: 'idle',
        };
        setList(prev => [...prev, newEntry]);
        setApiResponse(null);
    }, []);

    const handleUpdateInstitution = (id: string, field: keyof Omit<InstitutionEntry, 'id' | 'status' | 'responseMessage'>, value: string) => {
        setList(prev => prev.map(item => item.id === id ? { ...item, [field]: value, status: 'idle' } : item));
        setApiResponse(null);
    };

    const handleRemoveInstitution = (id: string) => {
      setList(p => p.filter(i => i.id !== id));
      setApiResponse(null);
    };
    
    const handleClear = useCallback(() => {
        setYear(new Date().getFullYear().toString()); setTestName('정도검사'); setFieldName('수질'); setList([]);
        setFileLink('https://drive.google.com/drive/folders/1SawD1SPqaWj5M5pfbUH5UJhYVfpS9Ki4?usp=sharing');
        setIsScheduled(false); setScheduleTime(''); setApiResponse(null);
    }, []);

    const generateMessage = useCallback((entry: Partial<InstitutionEntry>, link: string): string => {
        const scheduledDate = entry.scheduledDateRange?.trim() || '{검사예정일(현장명)}';
        const inspector = entry.inspectorName?.trim() || '미정';
        const finalYear = year.trim() || new Date().getFullYear();
        const finalFieldName = fieldName.trim() || '{분야명}';
        const finalTestName = testName.trim() || '정도검사';

        let inspectorLine = `- 담당검사자 : ${inspector}`;
        if (INSPECTOR_PHONE_NUMBERS[inspector]) {
            inspectorLine += ` (${INSPECTOR_PHONE_NUMBERS[inspector]})`;
        }

        const linkSection = link.trim()
            ? `\n\n▶[신청서 링크] ◀\n${link.trim()}`
            : '';

        return `안녕하세요. 한국산업기술시험원 입니다.

${finalYear}년도 ${finalFieldName} ${finalTestName} 일정을 아래와 같이 안내드리오니, 신청서 접수 요청드립니다.

- 검사예정일(현장명) : ${scheduledDate}
${inspectorLine}

▶제출 서류◀
① 정도검사신청서 (+정보제공동의서)
② 사업자등록증

▶신청서 접수◀
- 메일주소 : tmfrl22@ktl.re.kr (슬기22)
- 전화문의 : 정슬기 (055-791-3650)${linkSection}`;
    }, [year, fieldName, testName]);

    const composedMessagePreview = useMemo(() => {
        const firstValidEntry = list.find(item => item.scheduledDateRange && item.phoneNumber) || list[0] || {};
        return generateMessage(firstValidEntry, fileLink);
    }, [generateMessage, list, fileLink]);

    const handleBatchSend = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isOnline) { setApiResponse({ type: 'error', message: '오프라인 상태에서는 메시지를 전송할 수 없습니다.' }); return; }
        if (user?.role === "guest") { setApiResponse({ type: 'error', message: '게스트 사용자는 메시지를 전송할 수 없습니다.' }); return; }
        const validList = list.filter(item => item.scheduledDateRange.trim() && item.inspectorName.trim() && item.phoneNumber.trim());
        if (validList.length === 0) { setApiResponse({ type: 'error', message: '전송할 대상 목록의 모든 정보를 올바르게 입력해주세요.' }); return; }
        if (isScheduled && !scheduleTime) { setApiResponse({ type: 'error', message: '예약 전송 시간을 선택해주세요.' }); return; }

        setIsSending(true); setApiResponse({ type: 'success', message: `일괄 전송을 시작합니다... (${validList.length}건)`});
        setList(prev => prev.map(item => validList.find(v => v.id === item.id) ? {...item, status: 'sending'} : item));

        let successCount = 0;
        for (const entry of validList) {
            const messageBody = generateMessage(entry, fileLink);
            try {
                await sendKakaoTalkMessage(messageBody, entry.phoneNumber.trim(), isScheduled ? scheduleTime : undefined);
                setList(prev => prev.map(item => item.id === entry.id ? { ...item, status: 'success', responseMessage: '성공' } : item));
                successCount++;
            } catch (error: any) {
                setList(prev => prev.map(item => item.id === entry.id ? { ...item, status: 'error', responseMessage: error.message } : item));
            }
        }
        setIsSending(false);
        setApiResponse({ type: 'success', message: `일괄 전송 완료. (성공: ${successCount} / ${validList.length})` });
    };

    const getMinScheduleTime = () => new Date(Date.now() + 60000).toISOString().slice(0, 16);
    const validListToSend = list.filter(item => item.scheduledDateRange.trim() && item.inspectorName.trim() && item.phoneNumber.trim());
    const isSubmitDisabled = isSending || validListToSend.length === 0 || (isScheduled && !scheduleTime);
    
    return (
        <div className="w-full max-w-4xl bg-slate-800 shadow-2xl rounded-xl p-6 sm:p-8 space-y-6">
            <h2 className="text-2xl font-bold text-sky-400 border-b border-slate-700 pb-3">카카오톡 메시지 전송</h2>
            <form onSubmit={handleBatchSend} className="space-y-6">
                <Section title="메시지 템플릿 입력">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <InputField label="년도" id="kakao-year" value={year} onChange={e => setYear(e.target.value)} required disabled={isSending} placeholder="예: 2025" />
                        <InputField label="검사명" id="kakao-test-name" value={testName} onChange={e => setTestName(e.target.value)} required disabled={isSending} placeholder="예: 정도검사" />
                    </div>
                    <InputField label="분야명" id="kakao-field-name" value={fieldName} onChange={e => setFieldName(e.target.value)} required disabled={isSending} placeholder="예: 수질분야" />
                </Section>

                <Section title="전송 대상 목록">
                    <div className="w-full rounded-lg border border-slate-700">
                        {/* Desktop Header */}
                        <div className="hidden sm:grid grid-cols-12 p-3 bg-slate-700/50 font-semibold text-slate-200 text-sm">
                            <div className="col-span-4">검사예정일(현장명) *</div>
                            <div className="col-span-3">담당검사자 *</div>
                            <div className="col-span-4">수신자 번호 *</div>
                            <div className="col-span-1 text-center">삭제</div>
                        </div>
                        {/* List */}
                        <div className="divide-y divide-slate-700">
                            {list.length === 0 ? (
                                <p className="text-center text-slate-500 py-6">
                                    '항목 추가' 버튼을 눌러 전송할 기관을 추가해주세요.
                                </p>
                            ) : list.map((item) => (
                                <div key={item.id} className="p-3 grid grid-cols-2 sm:grid-cols-12 gap-x-4 gap-y-2 items-start">
                                    {/* Mobile labels (visible on small screens) */}
                                    <label htmlFor={`date-range-${item.id}`} className="sm:hidden text-xs text-slate-400">검사예정일(현장명)*</label>
                                    <div className="col-span-2 sm:col-span-4">
                                      <input id={`date-range-${item.id}`} type="text" value={item.scheduledDateRange} onChange={e => handleUpdateInstitution(item.id, 'scheduledDateRange', e.target.value)} className="form-input p-2 text-sm" disabled={isSending} placeholder="예: 25.01.01(현장)"/>
                                    </div>
                                    
                                    <label htmlFor={`inspector-${item.id}`} className="sm:hidden text-xs text-slate-400">담당검사자*</label>
                                    <div className="col-span-2 sm:col-span-3">
                                      <select id={`inspector-${item.id}`} value={item.inspectorName} onChange={e => handleUpdateInstitution(item.id, 'inspectorName', e.target.value)} className="form-input p-2 text-sm appearance-none" disabled={isSending}>
                                          {INSPECTOR_NAMES.map(name => <option key={name} value={name}>{name}</option>)}
                                      </select>
                                    </div>
                                    
                                    <label htmlFor={`phone-${item.id}`} className="sm:hidden text-xs text-slate-400">수신자 번호*</label>
                                    <div className="col-span-2 sm:col-span-4">
                                      <input id={`phone-${item.id}`} type="text" value={item.phoneNumber} onChange={e => handleUpdateInstitution(item.id, 'phoneNumber', e.target.value)} className="form-input p-2 text-sm" disabled={isSending} placeholder="010-1234-5678"/>
                                      <StatusIndicator status={item.status} message={item.responseMessage} />
                                    </div>
                                    
                                    <div className="col-span-2 sm:col-span-1 flex justify-end items-center">
                                      <button type="button" onClick={() => handleRemoveInstitution(item.id)} className="p-1.5 text-slate-400 hover:text-red-400 rounded-full hover:bg-slate-700 transition-colors" aria-label="삭제" disabled={isSending}>
                                        <TrashIcon className="w-5 h-5" />
                                      </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="text-right mt-3">
                      <ActionButton type="button" onClick={handleAddInstitution} variant="secondary" className="text-sm py-1.5 px-4" icon={<PlusIcon className="w-4 h-4" />} disabled={isSending}>항목 추가</ActionButton>
                    </div>
                </Section>
                
                <Section title="메시지 미리보기">
                    <div className="p-4 rounded-lg bg-gradient-to-b from-[#b2c7d9] to-[#a7bed8]">
                        <div className="flex justify-start">
                            <div className="relative max-w-sm">
                                <div className="bg-[#FEE500] text-black p-3 rounded-lg shadow-md" style={{ borderRadius: '12px 12px 12px 0' }}>
                                    <p className="whitespace-pre-wrap text-sm leading-relaxed break-words">{composedMessagePreview}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                    <p className="mt-2 text-xs text-slate-500 text-center">미리보기는 유효한 첫 번째 항목을 기준으로 표시됩니다. 각 수신자는 자신의 정보에 맞는 메시지를 받게 됩니다.</p>
                </Section>

                <Section title="파일 링크 (선택)" titleAction={<button type="button" onClick={() => setIsHelpModalOpen(true)} className="p-1 rounded-full hover:bg-slate-600"><InfoIcon className="w-5 h-5 text-slate-400" /></button>}>
                    <InputField id="file-link" type="url" value={fileLink} onChange={e => setFileLink(e.target.value)} disabled={isSending} placeholder="https://example.com/shared-link"/>
                    <p className="mt-1 text-xs text-slate-500">한글(HWP) 등 파일을 첨부하려면 클라우드에 업로드 후 공유 링크를 여기에 붙여넣으세요.</p>
                </Section>

                <Section title="전송 옵션">
                    <div className="flex items-center">
                        <input id="schedule-check" type="checkbox" checked={isScheduled} onChange={e => setIsScheduled(e.target.checked)} className="h-4 w-4 rounded border-slate-500 bg-slate-700 text-sky-600 focus:ring-sky-500" disabled={isSending} />
                        <label htmlFor="schedule-check" className="ml-2 text-sm font-medium text-slate-200">예약 전송</label>
                    </div>
                    {isScheduled && <InputField type="datetime-local" value={scheduleTime} min={getMinScheduleTime()} onChange={e => setScheduleTime(e.target.value)} className="mt-2" disabled={isSending} required />}
                </Section>

                {apiResponse && <div className={`p-3 text-sm rounded-md ${apiResponse.type === 'success' ? 'bg-green-800/30 text-green-300' : 'bg-red-800/30 text-red-300'}`} role="alert">{apiResponse.message}</div>}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                    <ActionButton type="button" onClick={handleClear} variant="secondary" className="py-2.5" icon={<ClearIcon className="w-5 h-5" />} disabled={isSending} fullWidth>내용 지우기</ActionButton>
                    <ActionButton 
                        type="submit" 
                        variant="primary" 
                        className="py-2.5" 
                        isLoading={isSending} 
                        icon={<SendIcon className="w-5 h-5" />} 
                        disabled={isSubmitDisabled || !isOnline}
                        title={!isOnline ? "오프라인 상태에서는 전송할 수 없습니다." : ""}
                        fullWidth
                    >
                        {`일괄 전송 (${validListToSend.length}건)`}
                    </ActionButton>
                </div>
            </form>
            <LinkHelpModal isOpen={isHelpModalOpen} onClose={() => setIsHelpModalOpen(false)} />
        </div>
    );
};

export default KakaoTalkPage;