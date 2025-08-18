import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import PhotoLogPage, { type PhotoLogJob } from './PhotoLogPage';
import DrinkingWaterPage, { type DrinkingWaterJob } from './DrinkingWaterPage';
import FieldCountPage from './FieldCountPage';
import StructuralCheckPage, { type StructuralJob } from './StructuralCheckPage';
import { KakaoTalkPage } from './KakaoTalkPage';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { ActionButton } from './components/ActionButton';
import { UserRole } from './components/UserNameInput';
import AdminPanel from './components/admin/AdminPanel';
import { callSaveTempApi, callLoadTempApi, SaveDataPayload, LoadedData, SavedValueEntry } from './services/apiService';
import { Spinner } from './components/Spinner';
import { MAIN_STRUCTURAL_ITEMS, MainStructuralItemKey, STRUCTURAL_ITEM_GROUPS, CHECKLIST_DEFINITIONS, CertificateDetails, POST_INSPECTION_DATE_OPTIONS, MEASUREMENT_METHOD_OPTIONS, StructuralCheckSubItemData, PREFERRED_MEASUREMENT_METHODS } from './shared/structuralChecklists';
import { ANALYSIS_ITEM_GROUPS, DRINKING_WATER_IDENTIFIERS } from './shared/constants';


type Page = 'photoLog' | 'drinkingWater' | 'fieldCount' | 'structuralCheck' | 'kakaoTalk';

interface PageContainerProps {
  userName: string;
  userRole: UserRole;
  userContact: string;
  onLogout: () => void;
}

const LogoutIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props} className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m-3-3l-3 3m0 0l3 3m-3-3h12.75" />
  </svg>
);

const SaveIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
  </svg>
);

const LoadIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
  </svg>
);

const DeleteIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12.56 0c1.153 0 2.24.03 3.22.077m3.22-.077L10.88 5.79m2.558 0c-.29.042-.58.083-.87.124" />
    </svg>
);

const PageContainer: React.FC<PageContainerProps> = ({ userName, userRole, userContact, onLogout }) => {
  const [activePage, setActivePage] = useState<Page>('photoLog');
  const [receiptNumberCommon, setReceiptNumberCommon] = useState('');
  const [receiptNumberDetail, setReceiptNumberDetail] = useState('');
  const [siteLocation, setSiteLocation] = useState('');
  
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [draftMessage, setDraftMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  
  const [newItemKey, setNewItemKey] = useState<string>('');
  
  const [photoLogJobs, setPhotoLogJobs] = useState<PhotoLogJob[]>([]);
  const [activePhotoLogJobId, setActivePhotoLogJobId] = useState<string | null>(null);

  const [fieldCountJobs, setFieldCountJobs] = useState<PhotoLogJob[]>([]);
  const [activeFieldCountJobId, setActiveFieldCountJobId] = useState<string | null>(null);

  const [drinkingWaterJobs, setDrinkingWaterJobs] = useState<DrinkingWaterJob[]>([]);
  const [activeDrinkingWaterJobId, setActiveDrinkingWaterJobId] = useState<string | null>(null);
  
  const [structuralCheckJobs, setStructuralCheckJobs] = useState<StructuralJob[]>([]);
  const [activeStructuralCheckJobId, setActiveStructuralCheckJobId] = useState<string | null>(null);

  const handleDeletePhotoLogJob = useCallback((jobIdToDelete: string) => {
    setPhotoLogJobs(prev => prev.filter(j => j.id !== jobIdToDelete));
    setActivePhotoLogJobId(prev => (prev === jobIdToDelete ? null : prev));
  }, []);

  const handleDeleteFieldCountJob = useCallback((jobIdToDelete: string) => {
    setFieldCountJobs(prev => prev.filter(j => j.id !== jobIdToDelete));
    setActiveFieldCountJobId(prev => (prev === jobIdToDelete ? null : prev));
  }, []);

  const handleDeleteDrinkingWaterJob = useCallback((jobIdToDelete: string) => {
    setDrinkingWaterJobs(prev => prev.filter(j => j.id !== jobIdToDelete));
    setActiveDrinkingWaterJobId(prev => (prev === jobIdToDelete ? null : prev));
  }, []);
  
  const handleDeleteStructuralCheckJob = useCallback((jobIdToDelete: string) => {
    setStructuralCheckJobs(prev => prev.filter(j => j.id !== jobIdToDelete));
    setActiveStructuralCheckJobId(prev => (prev === jobIdToDelete ? null : prev));
  }, []);

  const receiptNumber = useMemo(() => {
    const common = receiptNumberCommon.trim();
    const detail = receiptNumberDetail.trim();
    if (!common && !detail) return '';
    if (!common) return detail;
    if (!detail) return common;
    return `${common}-${detail}`;
  }, [receiptNumberCommon, receiptNumberDetail]);
  
  const activeJobForReceiptSync = useMemo(() => {
    switch (activePage) {
        case 'photoLog': return photoLogJobs.find(j => j.id === activePhotoLogJobId);
        case 'fieldCount': return fieldCountJobs.find(j => j.id === activeFieldCountJobId);
        case 'drinkingWater': return drinkingWaterJobs.find(j => j.id === activeDrinkingWaterJobId);
        case 'structuralCheck': return structuralCheckJobs.find(j => j.id === activeStructuralCheckJobId);
        default: return null;
    }
  }, [activePage, activePhotoLogJobId, photoLogJobs, activeFieldCountJobId, fieldCountJobs, activeDrinkingWaterJobId, drinkingWaterJobs, activeStructuralCheckJobId, structuralCheckJobs]);

  useEffect(() => {
      if (activeJobForReceiptSync?.receiptNumber) {
          const fullReceipt = activeJobForReceiptSync.receiptNumber;
          const lastDashIndex = fullReceipt.lastIndexOf('-');
          if (lastDashIndex !== -1 && lastDashIndex < fullReceipt.length - 1) {
              const common = fullReceipt.substring(0, lastDashIndex);
              const detail = fullReceipt.substring(lastDashIndex + 1);
              setReceiptNumberCommon(common);
              setReceiptNumberDetail(detail);
          } else {
              setReceiptNumberCommon(fullReceipt);
              setReceiptNumberDetail('');
          }
      }
  }, [activeJobForReceiptSync]);

  const clearDraftMessage = () => {
    if (draftMessage) {
      setTimeout(() => setDraftMessage(null), 4000);
    }
  };

  const getReceiptNumberForSaveLoad = useCallback(() => {
    let receiptForOperation: string | null = receiptNumber;
    if (activePage === 'photoLog' && activePhotoLogJobId) {
        receiptForOperation = photoLogJobs.find(j => j.id === activePhotoLogJobId)?.receiptNumber || receiptNumber;
    } else if (activePage === 'fieldCount' && activeFieldCountJobId) {
        receiptForOperation = fieldCountJobs.find(j => j.id === activeFieldCountJobId)?.receiptNumber || receiptNumber;
    } else if (activePage === 'drinkingWater' && activeDrinkingWaterJobId) {
        receiptForOperation = drinkingWaterJobs.find(j => j.id === activeDrinkingWaterJobId)?.receiptNumber || receiptNumber;
    } else if (activePage === 'structuralCheck' && activeStructuralCheckJobId) {
        receiptForOperation = structuralCheckJobs.find(j => j.id === activeStructuralCheckJobId)?.receiptNumber || receiptNumber;
    }
    return receiptForOperation;
  }, [activePage, receiptNumber, photoLogJobs, activePhotoLogJobId, fieldCountJobs, activeFieldCountJobId, drinkingWaterJobs, activeDrinkingWaterJobId, structuralCheckJobs, activeStructuralCheckJobId]);
  
  const handleSaveDraft = useCallback(async () => {
    const receiptToSave = getReceiptNumberForSaveLoad();
    if (!receiptToSave || !receiptToSave.trim()) {
      setDraftMessage({ type: 'error', text: '저장하려면 접수번호를 입력하세요.' });
      clearDraftMessage();
      return;
    }

    setIsSaving(true);
    setDraftMessage(null);

    try {
        const jobsToSaveP1 = photoLogJobs.filter(j => j.receiptNumber === receiptToSave);
        const jobsToSaveP2 = fieldCountJobs.filter(j => j.receiptNumber === receiptToSave);
        const jobsToSaveP3 = drinkingWaterJobs.filter(j => j.receiptNumber === receiptToSave);
        const jobsToSaveP4 = structuralCheckJobs.filter(j => j.receiptNumber === receiptToSave);
        
        const allItems = new Set<string>();
        const apiPayload: SaveDataPayload['values'] = {};
        
        const p1p2Jobs = [...jobsToSaveP1, ...jobsToSaveP2];
        p1p2Jobs.forEach(job => {
            if (job.selectedItem === 'TN/TP') {
                allItems.add('TN');
                allItems.add('TP');
            } else {
                allItems.add(job.selectedItem);
            }

            if (job.selectedItem === "TN/TP") {
                const tnData: Record<string, SavedValueEntry> = {};
                const tpData: Record<string, SavedValueEntry> = {};
                (job.processedOcrData || []).forEach(entry => {
                    if (entry.identifier && entry.value.trim()) tnData[entry.identifier] = { val: entry.value, time: entry.time };
                    if (entry.identifierTP && entry.valueTP?.trim()) tpData[entry.identifierTP] = { val: entry.valueTP, time: entry.time };
                });
                if (Object.keys(tnData).length > 0) apiPayload['TN'] = { ...(apiPayload['TN'] || {}), ...tnData };
                if (Object.keys(tpData).length > 0) apiPayload['TP'] = { ...(apiPayload['TP'] || {}), ...tpData };
            } else {
                const itemData: Record<string, SavedValueEntry> = {};
                (job.processedOcrData || []).forEach(entry => {
                    if (entry.identifier && entry.value.trim()) itemData[entry.identifier] = { val: entry.value, time: entry.time };
                });
                if (Object.keys(itemData).length > 0) apiPayload[job.selectedItem] = { ...(apiPayload[job.selectedItem] || {}), ...itemData };
            }
        });

        jobsToSaveP3.forEach(job => {
            const itemsToProcess = job.selectedItem === 'TU/CL' ? ['TU', 'Cl'] : [job.selectedItem];
            itemsToProcess.forEach(item => allItems.add(item));
            
            itemsToProcess.forEach(subItem => {
                if (!apiPayload[subItem]) apiPayload[subItem] = {};
                (job.processedOcrData || []).forEach(entry => {
                    if (!entry.identifier || entry.identifier.includes('시작') || entry.identifier.includes('완료')) return;
                    let valueSource = (subItem === 'TU') ? entry.value : (job.selectedItem === 'TU/CL' ? entry.valueTP : entry.value);
                    if (entry.identifier && valueSource && valueSource.trim()) {
                        apiPayload[subItem]![entry.identifier] = { val: valueSource.trim(), time: entry.time };
                    }
                });
            });
        });
        
        jobsToSaveP4.forEach(job => {
            allItems.add(job.mainItemKey);
            const timestamp = new Date().toISOString();
            apiPayload[job.mainItemKey] = {
                '_checklistData': { val: JSON.stringify(job.checklistData), time: timestamp },
                '_postInspectionDate': { val: job.postInspectionDate, time: timestamp },
            };
        });

      if (allItems.size === 0) {
        setDraftMessage({ type: 'error', text: '저장할 데이터가 없습니다.' });
        setIsSaving(false);
        clearDraftMessage();
        return;
      }
      
      await callSaveTempApi({
        receipt_no: receiptToSave,
        site: siteLocation,
        item: Array.from(allItems),
        user_name: userName,
        values: apiPayload,
      });

      setDraftMessage({ type: 'success', text: `'${receiptToSave}'으로 저장되었습니다.`});
      clearDraftMessage();
    } catch (error: any) {
      setDraftMessage({ type: 'error', text: `저장 실패: ${error.message}`});
      clearDraftMessage();
    } finally {
      setIsSaving(false);
    }
  }, [getReceiptNumberForSaveLoad, userName, photoLogJobs, fieldCountJobs, drinkingWaterJobs, structuralCheckJobs, siteLocation]);

  const createDrinkingWaterJob = (itemName: string, data: LoadedData): DrinkingWaterJob => {
    const { receipt_no, site, values } = data;
    const siteParts = (site || '').split(' / ');
    const reconstructedOcrData = DRINKING_WATER_IDENTIFIERS.map(identifier => {
        const entry: DrinkingWaterJob['processedOcrData'][0] = { id: self.crypto.randomUUID(), time: '', value: '', identifier };
        if (itemName === 'TU/CL') entry.valueTP = '';
        const tuData = values.TU || {}; const clData = values.Cl || {};
        let pVal, sVal, tVal;
        if (itemName === 'TU') { pVal = tuData[identifier]?.val; tVal = tuData[identifier]?.time; } 
        else if (itemName === 'Cl') { pVal = clData[identifier]?.val; tVal = clData[identifier]?.time; } 
        else if (itemName === 'TU/CL') { pVal = tuData[identifier]?.val; sVal = clData[identifier]?.val; tVal = tuData[identifier]?.time || clData[identifier]?.time; }
        entry.value = pVal || '';
        if (entry.valueTP !== undefined) entry.valueTP = sVal || '';
        entry.time = tVal || '';
        return entry;
    });
    return {
        id: self.crypto.randomUUID(),
        receiptNumber: receipt_no,
        selectedItem: itemName,
        details: siteParts.slice(1).join(' / '),
        processedOcrData: reconstructedOcrData,
        decimalPlaces: 2,
        photos: [],
        submissionStatus: 'idle',
        submissionMessage: undefined,
        ...(itemName === 'TU/CL' && { decimalPlacesCl: 2 })
    };
  };

  const handleLoadDraft = useCallback(async () => {
    const receiptToLoad = receiptNumber; 
    if (!receiptToLoad || !receiptToLoad.trim()) {
        setDraftMessage({ type: 'error', text: '불러오려면 접수번호를 입력하세요.' });
        clearDraftMessage();
        return;
    }
    
    setIsLoading(true);
    setDraftMessage(null);

    try {
        const data = await callLoadTempApi(receiptToLoad);
        const { receipt_no, site, item: loadedItems, values } = data;
        
        const receiptParts = receipt_no.split('-');
        const detail = receiptParts.pop() || '';
        const common = receiptParts.join('-');
        setReceiptNumberCommon(common);
        setReceiptNumberDetail(detail);
        setSiteLocation(site);

        const p1p2GroupLabels = ['수질', '현장 계수'];
        const p1p2ItemsRaw = loadedItems.filter(i => ANALYSIS_ITEM_GROUPS.find(g => p1p2GroupLabels.includes(g.label))?.items.includes(i));
        const p1p2ItemsSet = new Set(p1p2ItemsRaw);
        const p1p2ItemsForJobCreation: string[] = [];
        
        if (p1p2ItemsSet.has('TN') && p1p2ItemsSet.has('TP')) {
            p1p2ItemsForJobCreation.push('TN/TP');
            p1p2ItemsSet.delete('TN');
            p1p2ItemsSet.delete('TP');
        }
        
        p1p2ItemsSet.forEach(item => p1p2ItemsForJobCreation.push(item));

        const createP1P2Job = (itemName: string): PhotoLogJob => {
             const reconstructedOcrData: PhotoLogJob['processedOcrData'] = [];
            if (itemName === "TN/TP") {
                const tnData = values.TN || {};
                const tpData = values.TP || {};
                const timeToEntryMap: Record<string, Partial<PhotoLogJob['processedOcrData'][0]>> = {};
                
                Object.entries(tnData).forEach(([id, data]) => {
                    const key = data.time || id;
                    if (!timeToEntryMap[key]) timeToEntryMap[key] = { id: self.crypto.randomUUID(), time: data.time };
                    timeToEntryMap[key].value = data.val;
                    timeToEntryMap[key].identifier = id;
                });
                Object.entries(tpData).forEach(([id, data]) => {
                    const key = data.time || id;
                    if (!timeToEntryMap[key]) timeToEntryMap[key] = { id: self.crypto.randomUUID(), time: data.time };
                    timeToEntryMap[key].valueTP = data.val;
                    timeToEntryMap[key].identifierTP = id;
                });
                Object.values(timeToEntryMap).sort((a,b) => (a.time || '').localeCompare(b.time || '')).forEach(partialEntry => {
                    reconstructedOcrData.push({
                        id: partialEntry.id!, time: partialEntry.time || '', value: partialEntry.value || '',
                        valueTP: partialEntry.valueTP, identifier: partialEntry.identifier, identifierTP: partialEntry.identifierTP,
                    });
                });
            } else {
                 const itemData = values[itemName] || {};
                 Object.entries(itemData).sort(([,a],[,b]) => (a.time || '').localeCompare(b.time || '')).forEach(([id, entryData]) => {
                    if (entryData) {
                        reconstructedOcrData.push({ id: self.crypto.randomUUID(), time: entryData.time, value: entryData.val, identifier: id });
                    }
                });
            }
            return { id: self.crypto.randomUUID(), receiptNumber: receipt_no, siteLocation: site, selectedItem: itemName, photos: [], photoComments: {}, processedOcrData: reconstructedOcrData, rangeDifferenceResults: null, concentrationBoundaries: null, decimalPlaces: 0, details: '', decimalPlacesCl: undefined, ktlJsonPreview: null, draftJsonPreview: null, submissionStatus: 'idle', submissionMessage: undefined };
        };
        const newP1Jobs = p1p2ItemsForJobCreation.map(createP1P2Job);
        const newP2Jobs = p1p2ItemsForJobCreation.map(createP1P2Job);
        setPhotoLogJobs(prev => [...prev.filter(j => j.receiptNumber !== receipt_no), ...newP1Jobs]);
        setFieldCountJobs(prev => [...prev.filter(j => j.receiptNumber !== receipt_no), ...newP2Jobs]);
        if (activePage === 'photoLog') setActivePhotoLogJobId(newP1Jobs[0]?.id || null);
        if (activePage === 'fieldCount') setActiveFieldCountJobId(newP2Jobs[0]?.id || null);

        const hasTu = loadedItems.includes('TU');
        const hasCl = loadedItems.includes('Cl');
        const hasTuClCombined = loadedItems.includes('TU/CL'); // Handle old data
        let newP3Jobs: DrinkingWaterJob[] = [];

        if ((hasTu && hasCl) || hasTuClCombined) {
            newP3Jobs.push(createDrinkingWaterJob('TU/CL', data));
        } else {
            if (hasTu) newP3Jobs.push(createDrinkingWaterJob('TU', data));
            if (hasCl) newP3Jobs.push(createDrinkingWaterJob('Cl', data));
        }
        setDrinkingWaterJobs(prev => [...prev.filter(j => j.receiptNumber !== receipt_no), ...newP3Jobs]);
        if (activePage === 'drinkingWater') setActiveDrinkingWaterJobId(newP3Jobs[0]?.id || null);

        const p4Items = loadedItems.filter(i => MAIN_STRUCTURAL_ITEMS.some(si => si.key === i));
        const newP4Jobs = p4Items.map(itemName => {
            const itemData = values[itemName as MainStructuralItemKey];
            if (!itemData || !itemData['_checklistData']) return null;
            return { 
                id: self.crypto.randomUUID(), 
                receiptNumber: receipt_no, 
                mainItemKey: itemName as MainStructuralItemKey, 
                checklistData: JSON.parse(itemData['_checklistData'].val), 
                postInspectionDate: itemData['_postInspectionDate']?.val || '선택 안됨', 
                postInspectionDateConfirmedAt: null, 
                photos: [], 
                photoComments: {},
                submissionStatus: 'idle',
                submissionMessage: undefined,
            };
        }).filter(Boolean) as StructuralJob[];
        setStructuralCheckJobs(prev => [...prev.filter(j => j.receiptNumber !== receipt_no), ...newP4Jobs]);
        if (activePage === 'structuralCheck') setActiveStructuralCheckJobId(newP4Jobs[0]?.id || null);

        setDraftMessage({ type: 'success', text: `'${receipt_no}' 데이터를 모든 관련 페이지에 불러왔습니다.`});
        clearDraftMessage();
    } catch (error: any) {
        setDraftMessage({ type: 'error', text: `불러오기 실패: ${error.message}`});
        clearDraftMessage();
    } finally {
      setIsLoading(false);
    }
  }, [receiptNumber, activePage]);

  const handleAddTask = useCallback(() => {
    if (!newItemKey || !receiptNumber) {
      alert("항목과 접수번호를 모두 입력해주세요.");
      return;
    }

    if (activePage === 'photoLog' || activePage === 'fieldCount') {
        const newJob: PhotoLogJob = { id: self.crypto.randomUUID(), receiptNumber, siteLocation, selectedItem: newItemKey, photos: [], photoComments: {}, processedOcrData: null, rangeDifferenceResults: null, concentrationBoundaries: null, decimalPlaces: 0, details: '', ktlJsonPreview: null, draftJsonPreview: null, submissionStatus: 'idle', submissionMessage: undefined };
        if (activePage === 'photoLog') {
            setPhotoLogJobs(prev => [...prev, newJob]);
            setActivePhotoLogJobId(newJob.id);
        } else {
            setFieldCountJobs(prev => [...prev, newJob]);
            setActiveFieldCountJobId(newJob.id);
        }
    } else if (activePage === 'drinkingWater') {
        const initialData = DRINKING_WATER_IDENTIFIERS.map(id => ({ id: self.crypto.randomUUID(), time: '', value: '', identifier: id, isRuleMatched: false, ...(newItemKey === 'TU/CL' && { valueTP: '' }) }));
        const newJob: DrinkingWaterJob = {
            id: self.crypto.randomUUID(),
            receiptNumber,
            selectedItem: newItemKey,
            details: '',
            processedOcrData: initialData,
            decimalPlaces: 2,
            photos: [],
            submissionStatus: 'idle',
            submissionMessage: undefined,
            ...(newItemKey === 'TU/CL' && { decimalPlacesCl: 2 })
        };
        setDrinkingWaterJobs(prev => [...prev, newJob]);
        setActiveDrinkingWaterJobId(newJob.id);
    } else if (activePage === 'structuralCheck') {
        const key = newItemKey as MainStructuralItemKey;
        const newChecklist = Object.fromEntries(CHECKLIST_DEFINITIONS[key].map(itemName => {
            let defaultNotes = '';
            if (itemName === "정도검사 증명서") {
                defaultNotes = JSON.stringify({ presence: 'not_selected' } as CertificateDetails);
            }
            if (itemName === "측정방법확인") {
                const preferredMethod = PREFERRED_MEASUREMENT_METHODS[key];
                if (preferredMethod) {
                    defaultNotes = preferredMethod;
                }
            }
            return [itemName, { status: '선택 안됨', notes: defaultNotes, confirmedAt: null, specialNotes: '' } as StructuralCheckSubItemData];
        }));
        if (key === 'PH') newChecklist["측정범위확인"].notes = "pH 0-14";
        if (key === 'TU') newChecklist["측정범위확인"].notes = "0-10 NTU";
        if (key === 'Cl') newChecklist["측정범위확인"].notes = "0-2 mg/L";
        
        const isFixedDateItem = key === 'PH' || key === 'TU' || key === 'Cl';

        const newJob: StructuralJob = { 
            id: self.crypto.randomUUID(), 
            receiptNumber, 
            mainItemKey: key, 
            checklistData: newChecklist, 
            postInspectionDate: isFixedDateItem ? '2년 후' : '선택 안됨', 
            postInspectionDateConfirmedAt: null, 
            photos: [], 
            photoComments: {},
            submissionStatus: 'idle',
            submissionMessage: undefined,
        };
        setStructuralCheckJobs(prev => [...prev, newJob]);
        setActiveStructuralCheckJobId(newJob.id);
    }

    const currentDetailNum = parseInt(receiptNumberDetail, 10);
    if (!isNaN(currentDetailNum) && receiptNumberDetail.length > 0) {
      setReceiptNumberDetail(String(currentDetailNum + 1).padStart(receiptNumberDetail.length, '0'));
    }
    setNewItemKey('');
  }, [newItemKey, receiptNumber, receiptNumberDetail, activePage, siteLocation]);

  const itemOptionsForNewTask = useMemo(() => {
    if (activePage === 'photoLog') return ANALYSIS_ITEM_GROUPS.find(g => g.label === '수질')?.items || [];
    if (activePage === 'fieldCount') return ANALYSIS_ITEM_GROUPS.find(g => g.label === '현장 계수')?.items || [];
    if (activePage === 'drinkingWater') return ANALYSIS_ITEM_GROUPS.find(g => g.label === '먹는물')?.items || [];
    if (activePage === 'structuralCheck') return STRUCTURAL_ITEM_GROUPS;
    return [];
  }, [activePage]);

  const navButtonBaseStyle = "px-3 py-2 rounded-md font-medium transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-sky-500 text-xs sm:text-sm flex-grow sm:flex-grow-0";
  const activeNavButtonStyle = "bg-sky-500 text-white";
  const inactiveNavButtonStyle = "bg-slate-700 hover:bg-slate-600 text-slate-300";

  const renderActivePage = () => {
    switch(activePage) {
      case 'photoLog':
        return <PhotoLogPage userName={userName} jobs={photoLogJobs} setJobs={setPhotoLogJobs} activeJobId={activePhotoLogJobId} setActiveJobId={setActivePhotoLogJobId} siteLocation={siteLocation} onDeleteJob={handleDeletePhotoLogJob} />;
      case 'fieldCount':
        return <FieldCountPage userName={userName} jobs={fieldCountJobs} setJobs={setFieldCountJobs} activeJobId={activeFieldCountJobId} setActiveJobId={setActiveFieldCountJobId} siteLocation={siteLocation} onDeleteJob={handleDeleteFieldCountJob} />;
      case 'drinkingWater':
        return <DrinkingWaterPage userName={userName} jobs={drinkingWaterJobs} setJobs={setDrinkingWaterJobs} activeJobId={activeDrinkingWaterJobId} setActiveJobId={setActiveDrinkingWaterJobId} siteLocation={siteLocation} onDeleteJob={handleDeleteDrinkingWaterJob} />;
      case 'structuralCheck':
        return <StructuralCheckPage userName={userName} jobs={structuralCheckJobs} setJobs={setStructuralCheckJobs} activeJobId={activeStructuralCheckJobId} setActiveJobId={setActiveStructuralCheckJobId} siteLocation={siteLocation} onDeleteJob={handleDeleteStructuralCheckJob} />;
      case 'kakaoTalk':
        return <KakaoTalkPage userName={userName} userContact={userContact} />;
      default:
        return null;
    }
  };
  
  const showTaskManagement = ['photoLog', 'fieldCount', 'drinkingWater', 'structuralCheck'].includes(activePage);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-slate-100 flex flex-col items-center p-4 sm:p-8 font-[Inter]">
      <Header />

      <div className="w-full max-w-3xl mb-4 flex flex-col sm:flex-row justify-between items-center bg-slate-800/50 p-3 rounded-lg shadow">
        <div className="text-sm text-sky-300 mb-2 sm:mb-0">
          환영합니다, <span className="font-semibold">{userName}</span>님!
        </div>
        <ActionButton onClick={onLogout} variant="secondary" className="bg-red-600 hover:bg-red-700 focus:ring-red-500 text-white text-xs px-3 py-1.5 h-auto" icon={<LogoutIcon />}>
          로그아웃
        </ActionButton>
      </div>
      
      {activePage !== 'kakaoTalk' && (
       <div className="w-full max-w-3xl mb-6 p-4 bg-slate-700/40 rounded-lg border border-slate-600/50 shadow-sm space-y-4">
        <h3 className="text-lg font-semibold text-slate-100">공통 정보 및 작업 관리</h3>
        <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-x-3 gap-y-4 items-end">
                <div className="sm:col-span-3">
                    <label htmlFor="global-receipt-common" className="block text-sm font-medium text-slate-300 mb-1">접수번호 (공통) <span className="text-amber-400 font-bold">*</span></label>
                    <input type="text" id="global-receipt-common" value={receiptNumberCommon} onChange={(e) => setReceiptNumberCommon(e.target.value)} className="block w-full p-2.5 bg-slate-800 border border-amber-500 rounded-md shadow-sm text-amber-200 text-sm placeholder-slate-400 focus:ring-2 focus:ring-amber-400 focus:border-amber-400" placeholder="예: 25-000000-01" />
                </div>
                <div className="sm:col-span-1">
                    <label htmlFor="global-receipt-detail" className="block text-sm font-medium text-slate-300 mb-1">(세부) <span className="text-amber-400 font-bold">*</span></label>
                    <input type="text" id="global-receipt-detail" value={receiptNumberDetail} onChange={(e) => setReceiptNumberDetail(e.target.value)} className="block w-full p-2.5 bg-slate-800 border border-amber-500 rounded-md shadow-sm text-amber-200 text-sm placeholder-slate-400 focus:ring-2 focus:ring-amber-400 focus:border-amber-400" placeholder="예: 1" />
                </div>
                <div className="sm:col-span-3">
                    <label htmlFor="global-site-location" className="block text-sm font-medium text-slate-300 mb-1">현장 위치 (공통) <span className="text-red-400">*</span></label>
                    <input type="text" id="global-site-location" value={siteLocation} onChange={(e) => setSiteLocation(e.target.value)} className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md shadow-sm text-slate-100 text-sm" placeholder="예: OO처리장" />
                </div>

                {showTaskManagement && (
                    <>
                    <div className="sm:col-span-5">
                        <label htmlFor="new-task-item" className="block text-sm font-medium text-slate-300 mb-1">항목</label>
                        <select id="new-task-item" value={newItemKey} onChange={(e) => setNewItemKey(e.target.value)} className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md shadow-sm text-slate-100 text-sm h-[42px]">
                            <option value="" disabled>선택...</option>
                            {Array.isArray(itemOptionsForNewTask) && itemOptionsForNewTask.length > 0 && typeof itemOptionsForNewTask[0] === 'object' && itemOptionsForNewTask[0] !== null && 'label' in itemOptionsForNewTask[0]
                                ? (itemOptionsForNewTask as {label: string, items: {key: string, name: string}[]}[])
                                    .map(group => (
                                        <optgroup key={group.label} label={group.label}>
                                            {group.items.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}
                                        </optgroup>
                                    ))
                                : (itemOptionsForNewTask as string[]).map(item => <option key={item} value={item}>{item}</option>)
                            }
                        </select>
                    </div>
                    <div className="sm:col-span-12">
                        <ActionButton onClick={handleAddTask} fullWidth>
                            추가
                        </ActionButton>
                    </div>
                    </>
                )}
            </div>
        </div>
        
        <div className="pt-4 border-t border-slate-600 space-y-3">
            <h4 className="text-md font-semibold text-slate-200">데이터 관리</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <ActionButton onClick={handleSaveDraft} variant="secondary" icon={isSaving ? <Spinner size="sm" /> : <SaveIcon />} disabled={isSaving || isLoading}>
                    {isSaving ? '저장 중...' : '임시 저장'}
                </ActionButton>
                <ActionButton onClick={handleLoadDraft} variant="secondary" icon={isLoading ? <Spinner size="sm" /> : <LoadIcon />} disabled={isSaving || isLoading}>
                    {isLoading ? '로딩 중...' : '불러오기'}
                </ActionButton>
            </div>
            {draftMessage && (
                <p className={`text-xs text-center ${draftMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`} role="status">
                    {draftMessage.type === 'success' ? '✅' : '❌'} {draftMessage.text}
                </p>
            )}
            <p className="text-xs text-slate-500 text-center">
                임시 저장은 현재 활성 작업의 접수번호와 동일한 모든 작업을 함께 저장/불러오기 합니다.
            </p>
        </div>
       </div>
      )}

      <nav className="w-full max-w-4xl mb-6 flex justify-center space-x-1 sm:space-x-2 p-2 bg-slate-800 rounded-lg shadow-md">
        <button onClick={() => setActivePage('photoLog')} className={`${navButtonBaseStyle} ${activePage === 'photoLog' ? activeNavButtonStyle : inactiveNavButtonStyle}`} aria-pressed={activePage === 'photoLog'}>수질 분석 (P1)</button>
        <button onClick={() => setActivePage('fieldCount')} className={`${navButtonBaseStyle} ${activePage === 'fieldCount' ? activeNavButtonStyle : inactiveNavButtonStyle}`} aria-pressed={activePage === 'fieldCount'}>현장 계수 (P2)</button>
        <button onClick={() => setActivePage('drinkingWater')} className={`${navButtonBaseStyle} ${activePage === 'drinkingWater' ? activeNavButtonStyle : inactiveNavButtonStyle}`} aria-pressed={activePage === 'drinkingWater'}>먹는물 분석 (P3)</button>
        <button onClick={() => setActivePage('structuralCheck')} className={`${navButtonBaseStyle} ${activePage === 'structuralCheck' ? activeNavButtonStyle : inactiveNavButtonStyle}`} aria-pressed={activePage === 'structuralCheck'}>구조 확인 (P4)</button>
        <button onClick={() => setActivePage('kakaoTalk')} className={`${navButtonBaseStyle} ${activePage === 'kakaoTalk' ? activeNavButtonStyle : inactiveNavButtonStyle}`} aria-pressed={activePage === 'kakaoTalk'}>카톡 전송 (P5)</button>
      </nav>
      
      {renderActivePage()}
      
      {userRole === 'admin' && <AdminPanel adminUserName={userName} />}

      <Footer />
    </div>
  );
};

export default PageContainer;
