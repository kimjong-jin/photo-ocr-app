
import React, { useState, useRef, useEffect, useCallback } from 'react';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { useAuth } from '../hooks/useAuth';
import { ActionButton } from '../components/ActionButton';
import { FileWithContent, KtlWaterAnalysisPayload } from '../types';
import { uploadZipFile, sendWaterAnalysisData } from '../services/ktlApiService';

interface WaterAnalysisRow {
  [key: string]: string | number | undefined;
}

interface WaterAnalysisPageProps {
  isOnline: boolean;
}

const getTestNameAbbreviation = (testName: string | undefined): string => {
  if (!testName) return '항목없음';
  const name = testName.toUpperCase().trim();
  if (name.includes('TOC') || name.includes('총유기탄소')) return 'TOC';
  if (name.includes('TN')  || name.includes('총질소'))     return 'TN';
  if (name.includes('TP')  || name.includes('총인'))       return 'TP';
  if (name.includes('COD') || name.includes('화학적산소요구량')) return 'COD';
  if (name.includes('SS')  || name.includes('부유물질'))   return 'SS';
  return testName.replace(/[^a-zA-Z0-9]/g, '');
};

const FileInputRow: React.FC<{
  label: string;
  onSelect: () => void;
  disabled: boolean;
  selectedFiles: FileWithContent[] | FileWithContent | null;
}> = ({ label, onSelect, disabled, selectedFiles }) => {
  const isSelected = !!(selectedFiles && (!Array.isArray(selectedFiles) || selectedFiles.length > 0));

  let fileInfo: React.ReactNode;
  if (isSelected) {
    const files = Array.isArray(selectedFiles) ? selectedFiles : [selectedFiles];
    fileInfo = <span className="font-medium truncate">{files.length === 1 ? files[0].name : `${files.length}개 파일 선택됨`}</span>;
  } else {
    fileInfo = <span className="text-slate-400">파일이 선택되지 않았습니다.</span>;
  }

  const baseClasses = "sm:col-span-4 border p-2.5 rounded-lg text-sm flex items-center overflow-hidden h-auto min-h-[2.5rem] transition-colors duration-150";
  const fileInfoContainerClasses = `${baseClasses} ${isSelected ? 'bg-sky-600 border-sky-500 text-white' : 'bg-slate-700 border-slate-500'}`;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-6 gap-3 items-center">
      <label className="text-sm font-medium text-slate-300 sm:col-span-1 sm:text-left">{label}</label>
      <div className={fileInfoContainerClasses}>{fileInfo}</div>
      <div className="sm:col-span-1">
        <ActionButton onClick={onSelect} variant="secondary" fullWidth disabled={disabled}>선택</ActionButton>
      </div>
    </div>
  );
};

const WaterAnalysisPage: React.FC<WaterAnalysisPageProps> = ({ isOnline }) => {
    const { user } = useAuth();
    const [excelFile, setExcelFile] = useState<FileWithContent | null>(null);
    const [pdfFiles, setPdfFiles] = useState<FileWithContent[]>([]);
    const [imageFiles, setImageFiles] = useState<FileWithContent[]>([]);
    const [logs, setLogs] = useState<string[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [fileVersion, setFileVersion] = useState<string | null>(null);
    const [progress, setProgress] = useState(0);
    const [totalGroups, setTotalGroups] = useState(0);
    const [jsonPreview, setJsonPreview] = useState<string | null>(null);

    const excelInputRef = useRef<HTMLInputElement>(null);
    const pdfInputRef = useRef<HTMLInputElement>(null);
    const imagesInputRef = useRef<HTMLInputElement>(null);
    const logAreaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (logAreaRef.current) logAreaRef.current.scrollTop = logAreaRef.current.scrollHeight;
    }, [logs]);

    const log = useCallback((message: string) => {
        setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
    }, []);

    const handleFileChange = async (
        e: React.ChangeEvent<HTMLInputElement>,
        setter: React.Dispatch<React.SetStateAction<any>>,
        fileType: string,
        isMultiple: boolean
    ) => {
        const files = e.target.files;
        if (!files || files.length === 0) {
            setter(isMultiple ? [] : null);
            log(`${fileType} 파일 선택 취소.`);
            return;
        }
        try {
            const filesWithContent = await Promise.all(
                Array.from(files).map(async file => ({ name: file.name, content: await file.arrayBuffer() }))
            );
            setter(isMultiple ? filesWithContent : filesWithContent[0]);
            log(`${fileType} ${files.length}개 파일 선택됨: ${Array.from(files).map(f => f.name).join(', ')}`);
        } catch (err) { 
            log(`오류: ${fileType} 파일 읽기 실패.`); 
            alert(`${fileType} 파일을 읽는 중 오류가 발생했습니다.`);
        } finally {
            if (e.target) e.target.value = '';
        }
    };

    const findValueInRow = (row: WaterAnalysisRow, keys: string[]): string | undefined => {
        if (!row) return undefined;
        const rowKeys = Object.keys(row);
        for (const key of keys) {
            const foundKey = rowKeys.find(rk => rk.toLowerCase().trim() === key.toLowerCase());
            if (foundKey && row[foundKey] != null) return String(row[foundKey]);
        }
        return undefined;
    };
    
    const parseExcelAndGroupData = useCallback((excelFileContent: ArrayBuffer) => {
        log("엑셀 파일 분석 중...");
        const workbook = XLSX.read(excelFileContent);
        const sheetName = "to claydox";
        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) throw new Error(`시트 "${sheetName}"를 찾을 수 없습니다.`);
        
        const rowsAsArrays: (string | number | null)[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
        const nonEmptyRows = rowsAsArrays.filter(r => r && r.some(c => c !== null && String(c).trim() !== ''));
        if (nonEmptyRows.length === 0) throw new Error("시트가 비어있습니다.");

        let headers: string[] | null = null;
        let dataStartIndex = 0;
        const headerKeywords = ['접수번호', 'receipt', '시험명', 'test', 'item', '현장', 'site'];
        const receiptNumberRegex = /^\d{2}-\d{6}-\d{2}-\d+/;

        for (let i = 0; i < Math.min(10, nonEmptyRows.length); i++) {
            const potentialHeaderRow = nonEmptyRows[i];
            if (potentialHeaderRow.some(cell => typeof cell === 'string' && receiptNumberRegex.test(cell.trim()))) continue; 

            const rowAsStrings = potentialHeaderRow.map(cell => String(cell || '').toLowerCase().trim());
            const matchCount = headerKeywords.filter(keyword => rowAsStrings.some(cell => cell.includes(keyword))).length;
            if (matchCount >= 2) {
                headers = potentialHeaderRow.map(cell => String(cell || '').trim());
                dataStartIndex = i + 1;
                log(`헤더를 ${i + 1}번째 줄에서 찾았습니다: [${headers.join(', ')}]`);
                break;
            }
        }

        if (!headers) {
            log("명시적 헤더를 찾지 못했습니다. 데이터 패턴으로 추정합니다.");
            const patternRowIndex = nonEmptyRows.findIndex(row => row.some(cell => typeof cell === 'string' && receiptNumberRegex.test(String(cell).trim())));
            if (patternRowIndex !== -1) {
                headers = [ 'No', '분야', '시험명', '현장', '접수번호', 'Analysis1', 'Analysis2', 'Analysis3', 'Analysis4', '시험자', '비고1', '비고2' ];
                dataStartIndex = patternRowIndex;
                log(`데이터 패턴을 ${patternRowIndex+1}번째 줄에서 감지. 고정 헤더를 사용합니다.`);
            } else {
                throw new Error("데이터 헤더 또는 데이터 패턴을 찾을 수 없습니다.");
            }
        }

        const dataRows = nonEmptyRows.slice(dataStartIndex);
        const jsonData: WaterAnalysisRow[] = dataRows.map(rowArray => {
            return headers!.reduce((obj, header, index) => {
                if (header && index < rowArray.length) {
                    obj[header] = rowArray[index] === null ? undefined : rowArray[index];
                }
                return obj;
            }, {} as WaterAnalysisRow);
        });

        let invalidRowCount = 0;
        const validRows = jsonData.filter(row => {
            const receiptNo = findValueInRow(row, ['LABVIEW_RECEIPTNO', '접수번호', 'Receipt No']);
            const isValid = receiptNo && receiptNumberRegex.test(String(receiptNo).trim());
            if(!isValid && receiptNo) {
              log(`잘못된 접수번호 형식의 행을 건너뜁니다: "${receiptNo}"`);
              invalidRowCount++;
            }
            return isValid;
        });
        if(invalidRowCount > 0) log(`${invalidRowCount}개의 잘못된 형식의 행을 건너뛰었습니다.`);

        if (validRows.length === 0) throw new Error("유효한 접수번호를 가진 데이터 행이 없습니다.");

        const groups = validRows.reduce((acc, row) => {
            const receiptNo = String(findValueInRow(row, ['LABVIEW_RECEIPTNO', '접수번호', 'Receipt No'])).trim();
            (acc[receiptNo] = acc[receiptNo] || []).push(row);
            return acc;
        }, {} as Record<string, WaterAnalysisRow[]>);
        
        return groups;
    }, [log]);

    const createPayloadForRowGroup = useCallback((receiptNumber: string, rowsInGroup: WaterAnalysisRow[], zipFileName: string, currentFileVersion: string | null): KtlWaterAnalysisPayload => {
        const mergedLabviewItem: any = { 첨부파일명: zipFileName };
        if (currentFileVersion) {
            mergedLabviewItem.version = currentFileVersion;
        }

        const testNames = new Set<string>();
        const testAbbrs = new Set<string>();
        let siteLocation = '', nonTpDataApplied = false, tpDataApplied = false;

        for (const row of rowsInGroup) {
            const testName = (findValueInRow(row, ['시험명', 'Test Name', 'Item']) || 'N/A').trim();
            testNames.add(testName);
            testAbbrs.add(getTestNameAbbreviation(testName));
            if (!siteLocation) {
                siteLocation = (findValueInRow(row, ['현장', 'Site', 'Site Location']) || '').trim();
            }
            
            const normalizedTestName = testName.replace(/\s/g, "");
            const isTP = normalizedTestName.toUpperCase().includes('TP') || normalizedTestName.includes('총인');
            const vals = [1,2,3,4].map(i => findValueInRow(row, [`Analysis${i}`, `값${i}`, `Value${i}`]) || "");

            if (isTP && !tpDataApplied) {
                [mergedLabviewItem.Analysis1P, mergedLabviewItem.Analysis2P, mergedLabviewItem.Analysis3P, mergedLabviewItem.Analysis4P] = vals;
                tpDataApplied = true;
            } else if (!isTP && !nonTpDataApplied) { 
                [mergedLabviewItem.Analysis1, mergedLabviewItem.Analysis2, mergedLabviewItem.Analysis3, mergedLabviewItem.Analysis4] = vals;
                nonTpDataApplied = true; 
            }
        }
        if(siteLocation) mergedLabviewItem['현장'] = siteLocation;
        
        const gubn = `분석항목_${Array.from(testAbbrs).sort().join(', ')}`;

        return {
            LABVIEW_RECEIPTNO: receiptNumber,
            LABVIEW_GUBN: gubn,
            LABVIEW_DESC: JSON.stringify({ comment: `(항목: ${Array.from(testNames).sort().join(', ') || '없음'}, 현장: ${siteLocation || '없음'})` }),
            UPDATE_USER: '수분석',
            LABVIEW_ITEM: JSON.stringify(mergedLabviewItem),
        };
    }, []);

    const processGroup = useCallback(async (receiptNumber: string, rowsInGroup: WaterAnalysisRow[], currentFileVersion: string | null) => {
        log(`--- 그룹 처리 시작: ${receiptNumber} ---`);
        try {
            const hasTp = rowsInGroup.some(row => {
                const testName = (findValueInRow(row, ['시험명', 'Test Name', 'Item']) || '').trim();
                const normalizedTestName = testName.replace(/\s/g, "");
                return normalizedTestName.toUpperCase().includes('TP') || normalizedTestName.includes('총인');
            });
            log(hasTp ? "총인(TP) 항목 포함됨." : "총인(TP) 항목 없음.");

            const zip = new JSZip();
            zip.file(excelFile!.name, excelFile!.content);
            pdfFiles.forEach(f => zip.file(f.name, f.content));
            imageFiles.forEach(f => zip.file(f.name, f.content));
            const zipFileName = `${receiptNumber}${hasTp ? 'P' : ''}.zip`;
            const zipBlob = await zip.generateAsync({ type: "blob" });
            
            await uploadZipFile(zipBlob, zipFileName);
            log(`ZIP 파일 업로드 완료: ${zipFileName}`);

            const payload = createPayloadForRowGroup(receiptNumber, rowsInGroup, zipFileName, currentFileVersion);
            setJsonPreview(JSON.stringify(payload, null, 2));
            
            await sendWaterAnalysisData(payload);
            log(`JSON 전송 완료: ${receiptNumber}`);
        } catch (groupError: any) {
            log(`오류 (${receiptNumber}): ${groupError.message}`);
            throw groupError;
        }
    }, [excelFile, pdfFiles, imageFiles, log, createPayloadForRowGroup]);
    
    const processAndSend = async () => {
        if (!excelFile) { alert("엑셀 파일을 선택해주세요."); return; }
        if (user?.role === "guest") { alert("게스트 사용자는 자료를 전송할 수 없습니다."); return; }
        if (!isOnline) { alert("오프라인 상태에서는 자료를 전송할 수 없습니다."); return; }

        setIsProcessing(true); setLogs([]); setProgress(0); setTotalGroups(0); setJsonPreview(null);
        log("처리를 시작합니다...");

        try {
            const workbook = XLSX.read(excelFile.content);
            const b3 = workbook.Sheets['전체']?.['B3'];
            const ver = b3 && b3.v ? String(b3.v).trim() : null;
            setFileVersion(ver);
            if (ver) log(`엑셀 ver(B3) = ${ver}`);

            const groups = parseExcelAndGroupData(excelFile.content);
            const groupKeys = Object.keys(groups);
            log(`${groupKeys.length}개의 고유 접수번호 그룹을 찾았습니다.`);
            setTotalGroups(groupKeys.length);

            for (const receiptNumber of groupKeys) {
                try {
                    await processGroup(receiptNumber, groups[receiptNumber], ver);
                } catch(e) {
                    log(`--- 그룹 ${receiptNumber} 처리 실패. 다음 그룹으로 넘어갑니다. ---`);
                } finally {
                    setProgress(p => p + 1);
                }
            }
            log("--- 모든 작업 완료. ---");
        } catch (error: any) {
            log(`치명적 오류: ${error.message}`);
            alert(`오류 발생: ${error.message}`);
        } finally {
            setIsProcessing(false);
        }
    };
    
    return (
      <div className="w-full max-w-4xl bg-slate-800 shadow-2xl rounded-xl p-6 sm:p-8 space-y-6">
        <h2 className="text-2xl font-bold text-sky-400 border-b border-slate-700 pb-3">수분석 자료 전송</h2>
        <p className="text-sm text-slate-300">결과 엑셀(필수)과 PDF/사진(선택)을 선택 후 '처리 및 전송' 버튼을 누르세요.</p>
        
        <div className="hidden">
            <input type="file" ref={excelInputRef} accept=".xlsx, .xls, application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => handleFileChange(e, setExcelFile, "Excel", false)} />
            <input type="file" ref={pdfInputRef} accept=".pdf" multiple onChange={(e) => handleFileChange(e, setPdfFiles, "PDF", true)} />
            <input type="file" ref={imagesInputRef} accept="image/*" multiple onChange={(e) => handleFileChange(e, setImageFiles, "이미지", true)} />
        </div>
        
        <div className="space-y-4 p-4 bg-slate-700/30 rounded-lg border border-slate-600/50">
          <h3 className="text-lg font-semibold text-sky-300">업로드할 파일 선택</h3>
          <div className="space-y-3">
              <FileInputRow label="Excel (필수)" onSelect={() => excelInputRef.current?.click()} disabled={isProcessing} selectedFiles={excelFile} />
              <FileInputRow label="PDF (선택)" onSelect={() => pdfInputRef.current?.click()} disabled={isProcessing} selectedFiles={pdfFiles} />
              <FileInputRow label="사진 (선택)" onSelect={() => imagesInputRef.current?.click()} disabled={isProcessing} selectedFiles={imageFiles} />
          </div>
        </div>

        <ActionButton
          onClick={processAndSend}
          disabled={isProcessing || !excelFile || !isOnline}
          fullWidth
          isLoading={isProcessing}
          className="py-3 text-base"
          title={!isOnline ? "오프라인 상태에서는 전송할 수 없습니다." : "클릭하여 처리 및 전송 시작"}
        >
            {isProcessing ? '처리 중...' : '처리 및 전송 시작'}
        </ActionButton>
        
        <details className="text-left bg-slate-700/30 p-3 rounded-md border border-slate-600/50">
          <summary className="cursor-pointer text-sm font-medium text-sky-400 hover:text-sky-300">
              현재 처리 중인 JSON 데이터 미리보기
          </summary>
          <pre className={`mt-2 text-xs bg-slate-900 p-3 rounded-md overflow-x-auto max-h-60 border border-slate-700 ${jsonPreview ? 'text-slate-300' : 'text-slate-500'}`}>
              {jsonPreview || '처리가 시작되면 여기에 현재 그룹의 JSON 데이터가 표시됩니다.'}
          </pre>
        </details>
        
        <div className="space-y-2">
            <label htmlFor="progress-bar" className="text-sm font-medium text-slate-300">진행률: {progress} / {totalGroups}</label>
            <div id="progress-bar" className="w-full bg-slate-600 rounded-full h-2.5">
                <div className="bg-sky-500 h-2.5 rounded-full transition-all duration-300" style={{ width: `${totalGroups > 0 ? (progress / totalGroups) * 100 : 0}%` }}></div>
            </div>
        </div>

        <div className="space-y-2">
            <label htmlFor="log-area" className="text-sm font-medium text-slate-300">처리 로그</label>
            <textarea
                id="log-area" ref={logAreaRef} readOnly value={logs.join('\n')}
                className="w-full h-60 bg-slate-900 text-xs text-slate-300 font-mono p-3 rounded-md border border-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500"
                placeholder="처리 과정이 여기에 표시됩니다..."
            />
        </div>
      </div>
    );
};

export default WaterAnalysisPage;