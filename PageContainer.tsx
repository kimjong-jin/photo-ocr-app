import React, { useState, useCallback, useMemo, useEffect } from 'react';
import MapView from './components/MapView';
import PhotoLogPage from './PhotoLogPage';
import type { PhotoLogJob } from './shared/types';
import DrinkingWaterPage, { type DrinkingWaterJob } from './DrinkingWaterPage';
import FieldCountPage from './FieldCountPage';
import StructuralCheckPage, { type StructuralJob } from './StructuralCheckPage';
import { KakaoTalkPage } from './KakaoTalkPage';
import CsvGraphPage, { type CsvGraphJob } from './CsvGraphPage';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { ActionButton } from './components/ActionButton';
import { UserRole } from './components/UserNameInput';
import AdminPanel from './components/admin/AdminPanel';
import { callSaveTempApi, callLoadTempApi, SaveDataPayload, LoadedData, SavedValueEntry } from './services/apiService';
import { Spinner } from './components/Spinner';
import {
  MAIN_STRUCTURAL_ITEMS,
  MainStructuralItemKey,
  STRUCTURAL_ITEM_GROUPS,
  CHECKLIST_DEFINITIONS,
  CertificateDetails,
  StructuralCheckSubItemData,
  PREFERRED_MEASUREMENT_METHODS
} from './shared/StructuralChecklists';
import { ANALYSIS_ITEM_GROUPS, DRINKING_WATER_IDENTIFIERS } from './shared/constants';
import { getKakaoAddress } from './services/kakaoService';


type Page = 'photoLog' | 'drinkingWater' | 'fieldCount' | 'structuralCheck' | 'kakaoTalk' | 'csvGraph';

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

const GpsIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 01-9-9 9 9 0 019-9 9 9 0 019 9 9 9 0 01-9 9z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m8-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707" />
  </svg>
);

const ChevronDownIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
  </svg>
);

const PageContainer: React.FC<PageContainerProps> = ({ userName, userRole, userContact, onLogout }) => {
  const [activePage, setActivePage] = useState<Page>('photoLog');
  const [receiptNumberCommon, setReceiptNumberCommon] = useState('');
  const [receiptNumberDetail, setReceiptNumberDetail] = useState('');
  const [siteName, setSiteName] = useState('');

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

  const [csvGraphJobs, setCsvGraphJobs] = useState<CsvGraphJob[]>([]);
  const [activeCsvGraphJobId, setActiveCsvGraphJobId] = useState<string | null>(null);

  const [currentGpsAddress, setCurrentGpsAddress] = useState('');
  const [isFetchingAddress, setIsFetchingAddress] = useState(false);

  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  const [openSections, setOpenSections] = useState<string[]>(['addTask']);

  const finalSiteLocation = useMemo(() => {
    const site = siteName.trim();
    const gps = currentGpsAddress.trim();
    const isValidGps = gps && !gps.includes("오류") && !gps.includes("찾는 중") && !gps.includes("지원하지 않습니다");

    if (site && isValidGps) {
      return `${site} (${gps})`;
    }
    if (isValidGps) {
      return gps;
    }
    return site;
  }, [siteName, currentGpsAddress]);

  const toggleSection = (sectionName: string) => {
    setOpenSections(prevOpenSections => {
      const isOpen = prevOpenSections.includes(sectionName);
      if (isOpen) {
        return prevOpenSections.filter(s => s !== sectionName);
      } else {
        return [...prevOpenSections, sectionName];
      }
    });
  };

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

  const handleDeleteCsvGraphJob = useCallback((jobIdToDelete: string) => {
    setCsvGraphJobs(prev => prev.filter(j => j.id !== jobIdToDelete));
    setActiveCsvGraphJobId(prev => (prev === jobIdToDelete ? null : prev));
  }, []);

  const receiptNumber = useMemo(() => {
    const common = receiptNumberCommon.trim();
    const detail = receiptNumberDetail.trim();
    if (!common && !detail) return '';
    if (!common) return detail;
    if (!detail) return common;
    return `${common}-${detail}`;
  }, [receiptNumberCommon, receiptNumberDetail]);

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
    } else if (activePage === 'csvGraph' && activeCsvGraphJobId) {
        receiptForOperation = csvGraphJobs.find(j => j.id === activeCsvGraphJobId)?.receiptNumber || receiptNumber;
    }
    return receiptForOperation;
  }, [activePage, receiptNumber, photoLogJobs, activePhotoLogJobId, fieldCountJobs, activeFieldCountJobId, drinkingWaterJobs, activeDrinkingWaterJobId, structuralCheckJobs, activeStructuralCheckJobId, csvGraphJobs, activeCsvGraphJobId]);
  
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
        const jobsToSaveP6 = csvGraphJobs.filter(j => j.receiptNumber === receiptToSave);
        
        const allItems = new Set<string>();
        const apiPayload: SaveDataPayload['values'] = {};
        
        const globalMetadata = {
            site: siteName,
            gps_address: currentGpsAddress.trim() || undefined,
        };
        apiPayload['_global_metadata'] = {
            data: {
                val: JSON.stringify(globalMetadata),
                time: new Date().toISOString(),
            }
        };
        allItems.add('_global_metadata');
        
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
            allItems.add(job.selectedItem);
            itemsToProcess.forEach(item => allItems.add(item));
            
            const p3Metadata = {
                details: job.details,
                decimalPlaces: job.decimalPlaces,
                decimalPlacesCl: job.decimalPlacesCl,
            };

            if (!apiPayload[job.selectedItem]) {
                apiPayload[job.selectedItem] = {};
            }
            apiPayload[job.selectedItem]['_p3_metadata'] = { val: JSON.stringify(p3Metadata), time: new Date().toISOString() };
            
            itemsToProcess.forEach(subItem => {
                if (!apiPayload[subItem]) apiPayload[subItem] = {};
                (job.processedOcrData || []).forEach(entry => {
                    if (!entry.identifier || entry.identifier.includes('시작') || entry.identifier.includes('완료')) return;
                    
                    let valueSource;
                    if (job.selectedItem === 'TU/CL') {
                        valueSource = (subItem === 'TU') ? entry.value : entry.valueTP;
                    } else {
                        valueSource = entry.value;
                    }

                    if (entry.identifier && valueSource && valueSource.trim()) {
                        let key = entry.identifier;
                        if(subItem === 'Cl' && key === '응답시간_Cl') key = '응답시간';

                        apiPayload[subItem]![key] = { val: valueSource.trim(), time: entry.time };
                    }
                });
            });
        });
        
        jobsToSaveP4.forEach(job => {
            allItems.add(job.mainItemKey);
            const timestamp = new Date().toISOString();
            
            const currentItemData = apiPayload[job.mainItemKey] || {};
            apiPayload[job.mainItemKey] = {
                ...currentItemData,
                '_checklistData': { val: JSON.stringify(job.checklistData), time: timestamp },
                '_postInspectionDate': { val: job.postInspectionDate, time: timestamp }
            };
        });

        jobsToSaveP6.forEach(job => {
            const key = `_csv_${job.id}`;
            allItems.add(key);
            const dataToSave = {
                fileName: job.fileName,
                channelAnalysis: job.channelAnalysis,
                selectedChannelId: job.selectedChannelId,
                timeRangeInMs: job.timeRangeInMs,
                viewEndTimestamp: job.viewEndTimestamp,
            };
            apiPayload[key] = {
                '_data': { val: JSON.stringify(dataToSave), time: new Date().toISOString() }
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
        site: siteName,
        gps_address: currentGpsAddress.trim() || undefined,
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
  }, [getReceiptNumberForSaveLoad, userName, photoLogJobs, fieldCountJobs, drinkingWaterJobs, structuralCheckJobs, csvGraphJobs, siteName, currentGpsAddress]);

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
        const loadedData = await callLoadTempApi(receiptToLoad);
        const { receipt_no, site, item: loadedItems, values, gps_address } = loadedData;

        const receiptParts = receipt_no.split('-');
        const detail = receiptParts.pop() || '';
        const common = receiptParts.join('-');
        setReceiptNumberCommon(common);
        setReceiptNumberDetail(detail);

        let loadedSite = site;
        let loadedGpsAddress = gps_address || "";

        const globalMetadataRecord = values?._global_metadata;
        const globalMetadataEntry = globalMetadataRecord?.['data'];
        if (globalMetadataEntry?.val) {
            try {
                const parsedMeta = JSON.parse(globalMetadataEntry.val);
                if (typeof parsedMeta.site === 'string') {
                    loadedSite = parsedMeta.site;
                }
                if (typeof parsedMeta.gps_address === 'string') {
                    loadedGpsAddress = parsedMeta.gps_address;
                }
            } catch (e) {
                console.warn("[LOAD] Global metadata parsing failed:", e);
            }
        }
        setSiteName(loadedSite);
        setCurrentGpsAddress(loadedGpsAddress);

        const p1Items = ANALYSIS_ITEM_GROUPS.find(g => g.label === '수질')?.items || [];
        const p2Items = ANALYSIS_ITEM_GROUPS.find(g => g.label === '현장 계수')?.items || [];
        const p3Items = ANALYSIS_ITEM_GROUPS.find(g => g.label === '먹는물')?.items || [];
        const p4Items = MAIN_STRUCTURAL_ITEMS.map(i => i.key);

        const available = {
            photoLog: new Set<string>(),
            fieldCount: new Set<string>(),
            drinkingWater: new Set<string>(),
            structuralCheck: new Set<string>(),
        };

        if (loadedData.values.TN && loadedData.values.TP) {
            if (p1Items.includes('TN/TP')) available.photoLog.add('TN/TP');
            if (p2Items.includes('TN/TP')) available.fieldCount.add('TN/TP');
        }
        
        loadedItems.forEach(item => {
            if (p1Items.includes(item)) available.photoLog.add(item);
            if (p2Items.includes(item)) available.fieldCount.add(item);
            if (p3Items.includes(item)) available.drinkingWater.add(item);
            if (p4Items.includes(item as any)) available.structuralCheck.add(item);
        });
    
        if(loadedData.values.TU && loadedData.values.Cl && p3Items.includes('TU/CL')) {
            available.drinkingWater.add('TU/CL');
            available.drinkingWater.delete('TU');
            available.drinkingWater.delete('Cl');
        }

        const allSelections = {
            photoLog: Array.from(available.photoLog),
            fieldCount: Array.from(available.fieldCount),
            drinkingWater: Array.from(available.drinkingWater),
            structuralCheck: Array.from(available.structuralCheck),
        };
        
        const createP1P2Job = (itemName: string): PhotoLogJob => {
            const reconstructedOcrData: PhotoLogJob['processedOcrData'] = [];
            if (itemName === "TN/TP") {
                const tnData = values.TN || {};
                const tpData = values.TP || {};
                const timeToEntryMap: Record<string, Partial<PhotoLogJob['processedOcrData'][0]>> = {};
                
                Object.entries(tnData).forEach(([id, data]) => {
                    if (id === '_checklistData' || id === '_postInspectionDate') return;
                    const key = (data as any).time || id;
                    if (!timeToEntryMap[key]) timeToEntryMap[key] = { id: self.crypto.randomUUID(), time: (data as any).time };
                    (timeToEntryMap[key] as any).value = (data as any).val;
                    (timeToEntryMap[key] as any).identifier = id;
                });
                Object.entries(tpData).forEach(([id, data]) => {
                    if (id === '_checklistData' || id === '_postInspectionDate') return;
                    const key = (data as any).time || id;
                    if (!timeToEntryMap[key]) timeToEntryMap[key] = { id: self.crypto.randomUUID(), time: (data as any).time };
                    (timeToEntryMap[key] as any).valueTP = (data as any).val;
                    (timeToEntryMap[key] as any).identifierTP = id;
                });
                Object.values(timeToEntryMap).sort((a,b) => (a.time || '').localeCompare(b.time || '')).forEach(partialEntry => {
                    reconstructedOcrData.push({
                        id: partialEntry.id!, time: partialEntry.time || '', value: (partialEntry as any).value || '',
                        valueTP: (partialEntry as any).valueTP, identifier: (partialEntry as any).identifier, identifierTP: (partialEntry as any).identifierTP,
                    });
                });
            } else {
                const itemData: Record<string, SavedValueEntry> = (values as any)[itemName] || {};
                Object.entries(itemData).sort(([,a],[,b]) => {
                    const timeA = a?.time || '';
                    const timeB = b?.time || '';
                    return timeA.localeCompare(timeB);
                }).forEach(([id, entryData]) => {
                    if (id === '_checklistData' || id === '_postInspectionDate') return;
                    if (entryData) {
                        reconstructedOcrData.push({ id: self.crypto.randomUUID(), time: String(entryData.time), value: String(entryData.val), identifier: id });
                    }
                });
            }
            return { id: self.crypto.randomUUID(), receiptNumber: receipt_no, siteLocation: site, selectedItem: itemName, photos: [], photoComments: {}, processedOcrData: reconstructedOcrData, rangeDifferenceResults: null, concentrationBoundaries: null, decimalPlaces: 0, details: '', decimalPlacesCl: undefined, ktlJsonPreview: null, draftJsonPreview: null, submissionStatus: 'idle', submissionMessage: undefined };
        };

        const createDrinkingWaterJob = (itemName: string, data: LoadedData): DrinkingWaterJob => {
            const { receipt_no: local_receipt_no, site: local_site, values: local_values } = data;
            
            let details = '';
            let decimalPlaces = 2;
            let decimalPlacesCl: number | undefined = undefined;

            const metadataEntry = local_values[itemName]?._p3_metadata;
            if (metadataEntry?.val) {
                try {
                    const parsedMeta = JSON.parse(metadataEntry.val);
                    details = parsedMeta.details || '';
                    decimalPlaces = parsedMeta.decimalPlaces ?? 2;
                    if (itemName === 'TU/CL') {
                        decimalPlacesCl = parsedMeta.decimalPlacesCl ?? 2;
                    }
                } catch (e) {
                    console.warn(`[LOAD] P3 메타데이터 파싱 실패 (항목: ${itemName}):`, e);
                }
            }

            const reconstructedOcrData = DRINKING_WATER_IDENTIFIERS.map(identifier => {
                const entry: DrinkingWaterJob['processedOcrData'][0] = { id: self.crypto.randomUUID(), time: '', value: '', identifier };
                if (itemName === 'TU/CL') entry.valueTP = '';
                const tuData = local_values.TU || {}; const clData = local_values.Cl || {};
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
                receiptNumber: local_receipt_no,
                selectedItem: itemName,
                details: details,
                processedOcrData: reconstructedOcrData,
                decimalPlaces: decimalPlaces,
                photos: [],
                submissionStatus: 'idle',
                submissionMessage: undefined,
                ...(itemName === 'TU/CL' && { decimalPlacesCl: decimalPlacesCl })
            };
        };

        const newP1Jobs = allSelections.photoLog.map(createP1P2Job);
        if (newP1Jobs.length > 0) {
            setPhotoLogJobs(prev => [...prev.filter(j => j.receiptNumber !== receipt_no), ...newP1Jobs]);
            if (activePage === 'photoLog') setActivePhotoLogJobId(newP1Jobs[0]?.id || null);
        }
        
        const newP2Jobs = allSelections.fieldCount.map(createP1P2Job);
        if (newP2Jobs.length > 0) {
            setFieldCountJobs(prev => [...prev.filter(j => j.receiptNumber !== receipt_no), ...newP2Jobs]);
            if (activePage === 'fieldCount') setActiveFieldCountJobId(newP2Jobs[0]?.id || null);
        }
    
        const newP3Jobs: DrinkingWaterJob[] = allSelections.drinkingWater.map(item => createDrinkingWaterJob(item, loadedData));
        if (newP3Jobs.length > 0) {
            setDrinkingWaterJobs(prev => [...prev.filter(j => j.receiptNumber !== receipt_no), ...newP3Jobs]);
            if (activePage === 'drinkingWater') setActiveDrinkingWaterJobId(newP3Jobs[0]?.id || null);
        }
    
        const newP4Jobs = allSelections.structuralCheck.map(itemName => {
            const itemData = (values as any)[itemName as MainStructuralItemKey];
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
            } as StructuralJob;
        }).filter(Boolean) as StructuralJob[];
    
        if (newP4Jobs.length > 0) {
            setStructuralCheckJobs(prev => [...prev.filter(j => j.receiptNumber !== receipt_no), ...newP4Jobs]);
            if (activePage === 'structuralCheck') setActiveStructuralCheckJobId(newP4Jobs[0]?.id || null);
        }

        setDraftMessage({ type: 'success', text: `'${receipt_no}' 데이터를 모두 불러왔습니다.`});
        clearDraftMessage();

    } catch (error: any) {
        setDraftMessage({ type: 'error', text: `불러오기 실패: ${error.message}` });
        clearDraftMessage();
    } finally {
        setIsLoading(false);
    }
  }, [receiptNumber, activePage]);

  const handleAddTask = useCallback(() => {
    if (!receiptNumber) {
        alert("접수번호를 입력해주세요.");
        return;
    }
    if (activePage !== 'csvGraph' && !newItemKey) {
        alert("항목을 선택해주세요.");
        return;
    }

    if (activePage === 'photoLog' || activePage === 'fieldCount') {
        const newJob: PhotoLogJob = { id: self.crypto.randomUUID(), receiptNumber, siteLocation: finalSiteLocation, selectedItem: newItemKey, photos: [], photoComments: {}, processedOcrData: null, rangeDifferenceResults: null, concentrationBoundaries: null, decimalPlaces: 0, details: '', ktlJsonPreview: null, draftJsonPreview: null, submissionStatus: 'idle', submissionMessage: undefined };
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
    } else if (activePage === 'csvGraph') {
        const newJob: CsvGraphJob = {
            id: self.crypto.randomUUID(),
            receiptNumber,
            fileName: null,
            parsedData: null,
            channelAnalysis: {},
            selectedChannelId: null,
            timeRangeInMs: 'all',
            viewEndTimestamp: null,
            submissionStatus: 'idle',
        };
        setCsvGraphJobs(prev => [...prev, newJob]);
        setActiveCsvGraphJobId(newJob.id);
    }

    const currentDetailNum = parseInt(receiptNumberDetail, 10);
    if (!isNaN(currentDetailNum) && receiptNumberDetail.length > 0) {
      setReceiptNumberDetail(String(currentDetailNum + 1).padStart(receiptNumberDetail.length, '0'));
    }
    setNewItemKey('');
  }, [newItemKey, receiptNumber, receiptNumberDetail, activePage, finalSiteLocation]);

  const handleFetchGpsAddress = useCallback(() => {
    setIsFetchingAddress(true);
    setCurrentGpsAddress("주소 찾는 중...");

    if (!navigator.geolocation) {
      setCurrentGpsAddress("이 브라우저에서는 GPS를 지원하지 않습니다.");
      setIsFetchingAddress(false);
      return;
    }

    const onSuccess = async (position: GeolocationPosition) => {
      const { latitude, longitude } = position.coords;
      setCoords({ lat: latitude, lng: longitude });

      try {
        const addr = await getKakaoAddress(latitude, longitude);
        setCurrentGpsAddress(addr);
      } catch (err: any) {
        console.error("GPS 주소 오류:", err);
        setCurrentGpsAddress(`주소 탐색 중 오류 발생: ${err.message}`);
      } finally {
        setIsFetchingAddress(false);
      }
    };

    const onError = (error: GeolocationPositionError) => {
      console.error(
        "Geolocation error:",
        `Code: ${error.code}, Message: ${error.message}`
      );
      setCurrentGpsAddress(
        error.code === error.PERMISSION_DENIED
          ? "GPS 위치 권한이 거부되었습니다."
          : "GPS 위치를 가져올 수 없습니다."
      );
      setIsFetchingAddress(false);
    };

    navigator.geolocation.getCurrentPosition(onSuccess, onError, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    });
  }, []);

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

  const siteNameOnly = useMemo(() => siteName.trim(), [siteName]);

  const renderActivePage = () => {
    switch(activePage) {
      case 'photoLog':
        return <PhotoLogPage userName={userName} jobs={photoLogJobs} setJobs={setPhotoLogJobs} activeJobId={activePhotoLogJobId} setActiveJobId={setActivePhotoLogJobId} siteName={siteNameOnly} siteLocation={finalSiteLocation} onDeleteJob={handleDeletePhotoLogJob} />;
      case 'fieldCount':
        return <FieldCountPage userName={userName} jobs={fieldCountJobs} setJobs={setFieldCountJobs} activeJobId={activeFieldCountJobId} setActiveJobId={setActiveFieldCountJobId} siteName={siteNameOnly} siteLocation={finalSiteLocation} onDeleteJob={handleDeleteFieldCountJob} />;
      case 'drinkingWater':
        return <DrinkingWaterPage userName={userName} jobs={drinkingWaterJobs} setJobs={setDrinkingWaterJobs} activeJobId={activeDrinkingWaterJobId} setActiveJobId={setActiveDrinkingWaterJobId} siteName={siteNameOnly} siteLocation={finalSiteLocation} onDeleteJob={handleDeleteDrinkingWaterJob} />;
      case 'structuralCheck':
        return <StructuralCheckPage 
                  userName={userName} 
                  jobs={structuralCheckJobs} 
                  setJobs={setStructuralCheckJobs} 
                  activeJobId={activeStructuralCheckJobId} 
                  setActiveJobId={setActiveStructuralCheckJobId} 
                  siteName={siteNameOnly} 
                  onDeleteJob={handleDeleteStructuralCheckJob}
                  currentGpsAddress={currentGpsAddress}
                />;
      case 'kakaoTalk':
        return <KakaoTalkPage userName={userName} userContact={userContact} />;
      case 'csvGraph':
        return <CsvGraphPage userName={userName} jobs={csvGraphJobs} setJobs={setCsvGraphJobs} activeJobId={activeCsvGraphJobId} setActiveJobId={setActiveCsvGraphJobId} siteLocation={finalSiteLocation} onDeleteJob={handleDeleteCsvGraphJob} />;
      default:
        return null;
    }
  };

  const showTaskManagement = ['photoLog', 'fieldCount', 'drinkingWater', 'structuralCheck', 'csvGraph'].includes(activePage);
  const isCsvPage = activePage === 'csvGraph';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-slate-100 flex flex-col items-center p-4 sm:p-8 font-[Inter]">
      <Header />

      <div className="w-full max-w-3xl mb-4 flex flex-col sm:flex-row justify-between items-center bg-slate-800/50 p-3 rounded-lg shadow">
        <div className="text-sm text-sky-300 mb-2 sm:mb-0">
          환영합니다, <span className="font-semibold">{userName}</span>님!
        </div>
        <ActionButton
          onClick={onLogout}
          variant="secondary"
          className="bg-red-600 hover:bg-red-700 focus:ring-red-500 text-white text-xs px-3 py-1.5 h-auto"
          icon={<LogoutIcon />}
        >
          로그아웃
        </ActionButton>
      </div>

      {activePage !== 'kakaoTalk' && (
        <div className="w-full max-w-3xl mb-6 p-4 bg-slate-800/60 rounded-lg border border-slate-700 shadow-sm space-y-2">
          {/* 공통 정보 및 작업 추가 */}
          <div>
            <button
              onClick={() => toggleSection('addTask')}
              className="w-full flex justify-between items-center text-left p-3 bg-slate-700 hover:bg-slate-600 rounded-lg transition-all"
              aria-expanded={openSections.includes('addTask')}
            >
              <h3 className="text-lg font-semibold text-slate-100">공통 정보 및 작업 추가</h3>
              <ChevronDownIcon
                className={`w-5 h-5 text-slate-400 transition-transform ${
                  openSections.includes('addTask') ? 'rotate-180' : ''
                }`}
              />
            </button>

            <div
              className={`overflow-hidden transition-all duration-300 ease-in-out ${
                openSections.includes('addTask') ? 'max-h-[1000px] opacity-100' : 'max-h-0 opacity-0'
              }`}
            >
              <div className="pt-4 px-2 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-x-3 gap-y-4 items-end">
                  <div className={isCsvPage ? 'sm:col-span-4' : 'sm:col-span-3'}>
                    <label
                      htmlFor="global-receipt-common"
                      className="block text-sm font-medium text-slate-300 mb-1"
                    >
                      접수번호 (공통) <span className="text-amber-400 font-bold">*</span>
                    </label>
                    <input
                      type="text"
                      id="global-receipt-common"
                      value={receiptNumberCommon}
                      onChange={(e) => setReceiptNumberCommon(e.target.value)}
                      className="block w-full p-2.5 bg-slate-800 border border-amber-500 rounded-md shadow-sm text-amber-200 text-sm placeholder-slate-400 focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
                      placeholder="예: 25-000000-01"
                    />
                  </div>

                  <div className={isCsvPage ? 'sm:col-span-2' : 'sm:col-span-1'}>
                    <label
                      htmlFor="global-receipt-detail"
                      className="block text-sm font-medium text-slate-300 mb-1"
                    >
                      (세부) <span className="text-amber-400 font-bold">*</span>
                    </label>
                    <input
                      type="text"
                      id="global-receipt-detail"
                      value={receiptNumberDetail}
                      onChange={(e) => setReceiptNumberDetail(e.target.value)}
                      className="block w-full p-2.5 bg-slate-800 border border-amber-500 rounded-md shadow-sm text-amber-200 text-sm placeholder-slate-400 focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
                      placeholder="예: 1"
                    />
                  </div>

                  <div className={isCsvPage ? 'sm:col-span-6' : 'sm:col-span-8'}>
                    <label
                      htmlFor="global-site-location"
                      className="block text-sm font-medium text-slate-300 mb-1"
                    >
                      현장 위치 (공통)
                    </label>
                    <input
                      type="text"
                      id="global-site-location"
                      value={siteName}
                      onChange={(e) => setSiteName(e.target.value)}
                      className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md shadow-sm text-slate-100 text-sm"
                      placeholder="예: OO처리장"
                    />
                  </div>

                  {activePage === 'structuralCheck' && (
                    <div className="sm:col-span-12 pt-4 border-t border-slate-700/50">
                      <h4 className="text-md font-semibold text-slate-200 mb-2">위치 도우미 (GPS 주소)</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-x-3 gap-y-2 items-center">
                        <div className="sm:col-span-8">
                          <label htmlFor="current-gps-address" className="sr-only">
                            현재 주소 (GPS)
                          </label>
                          <input
                            type="text"
                            id="current-gps-address"
                            value={currentGpsAddress}
                            onChange={(e) => setCurrentGpsAddress(e.target.value)}
                            className="block w-full p-2.5 bg-slate-800 border border-slate-600 rounded-md shadow-sm text-slate-300 text-sm placeholder-slate-400"
                            placeholder="GPS 주소 또는 직접 입력"
                          />
                        </div>
                        <div className="sm:col-span-4">
                          <ActionButton
                            onClick={handleFetchGpsAddress}
                            disabled={isFetchingAddress}
                            fullWidth
                            icon={isFetchingAddress ? <Spinner size="sm" /> : <GpsIcon />}
                          >
                            GPS로 주소 찾기
                          </ActionButton>
                        </div>
                      </div>
                      {coords && (
                        <div className="mt-4 h-[300px] rounded-lg overflow-hidden border border-slate-600">
                        <MapView
                            latitude={coords.lat}
                            longitude={coords.lng}
                            onAddressSelect={(addr, lat, lng) => {
                              setCurrentGpsAddress(addr);
                              setCoords({ lat, lng });
                            }}
                          />
                          </div>
                        )}
                    </div>
                  )}

                  {!isCsvPage && showTaskManagement && (
                    <div className="sm:col-span-12">
                      <label
                        htmlFor="new-task-item"
                        className="block text-sm font-medium text-slate-300 mb-1"
                      >
                        항목
                      </label>
                      <select
                        id="new-task-item"
                        value={newItemKey}
                        onChange={(e) => setNewItemKey(e.target.value)}
                        className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md shadow-sm text-slate-100 text-sm h-[42px]"
                      >
                        <option value="" disabled>
                          선택...
                        </option>
                        {Array.isArray(itemOptionsForNewTask) &&
                        itemOptionsForNewTask.length > 0 &&
                        typeof itemOptionsForNewTask[0] === 'object' &&
                        itemOptionsForNewTask[0] !== null &&
                        'label' in (itemOptionsForNewTask[0] as any)
                          ? (
                              itemOptionsForNewTask as {
                                label: string;
                                items: { key: string; name: string }[];
                              }[]
                            ).map((group) => (
                              <optgroup key={group.label} label={group.label}>
                                {group.items.map((item) => (
                                  <option key={item.key} value={item.key}>
                                    {item.name}
                                  </option>
                                ))}
                              </optgroup>
                            ))
                          : (itemOptionsForNewTask as string[]).map((item) => (
                              <option key={item} value={item}>
                                {item}
                              </option>
                            ))}
                      </select>
                    </div>
                  )}

                  {showTaskManagement && (
                    <div className="sm:col-span-12">
                      <ActionButton onClick={handleAddTask} fullWidth>
                        {isCsvPage ? '새 분석 작업 추가' : '추가'}
                      </ActionButton>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 데이터 관리 */}
          <div>
            <button
              onClick={() => toggleSection('data')}
              className="w-full flex justify-between items-center text-left p-3 bg-slate-700 hover:bg-slate-600 rounded-lg transition-all"
              aria-expanded={openSections.includes('data')}
            >
              <h3 className="text-lg font-semibold text-slate-100">데이터 관리</h3>
              <ChevronDownIcon
                className={`w-5 h-5 text-slate-400 transition-transform ${
                  openSections.includes('data') ? 'rotate-180' : ''
                }`}
              />
            </button>

            <div
              className={`overflow-hidden transition-all duration-300 ease-in-out ${
                openSections.includes('data') ? 'max-h-[1000px] opacity-100' : 'max-h-0 opacity-0'
              }`}
            >
              <div className="pt-4 px-2 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <ActionButton
                    onClick={handleSaveDraft}
                    variant="secondary"
                    icon={isSaving ? <Spinner size="sm" /> : <SaveIcon />}
                    disabled={isSaving || isLoading}
                  >
                    {isSaving ? '저장 중...' : '임시 저장'}
                  </ActionButton>
                  <ActionButton
                    onClick={handleLoadDraft}
                    variant="secondary"
                    icon={isLoading ? <Spinner size="sm" /> : <LoadIcon />}
                    disabled={isSaving || isLoading}
                  >
                    {isLoading ? '로딩 중...' : '불러오기'}
                  </ActionButton>
                </div>

                {draftMessage && (
                  <p
                    className={`text-xs text-center ${
                      draftMessage.type === 'success' ? 'text-green-400' : 'text-red-400'
                    }`}
                    role="status"
                  >
                    {draftMessage.type === 'success' ? '✅' : '❌'} {draftMessage.text}
                  </p>
                )}

                <p className="text-xs text-slate-500 text-center">
                  임시 저장은 현재 활성 작업의 접수번호와 동일한 모든 작업을 함께 저장/불러오기 합니다.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 네비게이션 */}
      <nav className="w-full max-w-5xl mb-6 flex justify-center space-x-1 sm:space-x-2 p-2 bg-slate-800 rounded-lg shadow-md">
        <button
          onClick={() => setActivePage('photoLog')}
          className={`${navButtonBaseStyle} ${activePage === 'photoLog' ? activeNavButtonStyle : inactiveNavButtonStyle}`}
          aria-pressed={activePage === 'photoLog'}
        >
          수질 분석 (P1)
        </button>
        <button
          onClick={() => setActivePage('fieldCount')}
          className={`${navButtonBaseStyle} ${activePage === 'fieldCount' ? activeNavButtonStyle : inactiveNavButtonStyle}`}
          aria-pressed={activePage === 'fieldCount'}
        >
          현장 계수 (P2)
        </button>
        <button
          onClick={() => setActivePage('drinkingWater')}
          className={`${navButtonBaseStyle} ${activePage === 'drinkingWater' ? activeNavButtonStyle : inactiveNavButtonStyle}`}
          aria-pressed={activePage === 'drinkingWater'}
        >
          먹는물 분석 (P3)
        </button>
        <button
          onClick={() => setActivePage('structuralCheck')}
          className={`${navButtonBaseStyle} ${activePage === 'structuralCheck' ? activeNavButtonStyle : inactiveNavButtonStyle}`}
          aria-pressed={activePage === 'structuralCheck'}
        >
          구조 확인 (P4)
        </button>
        <button
          onClick={() => setActivePage('kakaoTalk')}
          className={`${navButtonBaseStyle} ${activePage === 'kakaoTalk' ? activeNavButtonStyle : inactiveNavButtonStyle}`}
          aria-pressed={activePage === 'kakaoTalk'}
        >
          카톡 전송 (P5)
        </button>
        <button
          onClick={() => setActivePage('csvGraph')}
          className={`${navButtonBaseStyle} ${activePage === 'csvGraph' ? activeNavButtonStyle : inactiveNavButtonStyle}`}
          aria-pressed={activePage === 'csvGraph'}
        >
          CSV 그래프 (P6)
        </button>
      </nav>

      {renderActivePage()}
      
      {userRole === 'admin' && <AdminPanel adminUserName={userName} />}

      <Footer />
    </div>
  );
};

export default PageContainer;
