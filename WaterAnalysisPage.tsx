
import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { ActionButton } from './components/ActionButton';
import { Spinner } from './components/Spinner';

// --- Interfaces for Type Safety ---

interface FileWithContent {
  name: string;
  content: ArrayBuffer;
}

// Interface for data rows from the Excel file
interface WaterAnalysisRow {
  [key: string]: string | number | undefined;
}

// Interface for the final JSON payload sent to KTL
interface KtlWaterAnalysisPayload {
  LABVIEW_RECEIPTNO: string;
  LABVIEW_GUBN: string;
  LABVIEW_DESC: string; // This will be a stringified object
  UPDATE_USER: string;
  LABVIEW_ITEM: string; // This will be a stringified object
}

interface WaterAnalysisPageProps {
  userName: string;
}

const KTL_API_TIMEOUT = 90000; // 90 seconds

const getTestNameAbbreviation = (testName: string | undefined): string => {
  if (!testName) return '항목없음';
  const name = testName.toUpperCase().trim();
  if (name.includes('TOC') || name.includes('총유기탄소')) return 'TOC';
  if (name.includes('TN') || name.includes('총질소')) return 'TN';
  if (name.includes('TP') || name.includes('총인')) return 'TP';
  if (name.includes('COD') || name.includes('화학적산소요구량')) return 'COD';
  if (name.includes('SS') || name.includes('부유물질')) return 'SS';
  return testName.replace(/[^a-zA-Z0-9]/g, ''); // Sanitize fallback
};

// --- Components ---

const FileInputRow: React.FC<{
  label: string;
  fileType: string;
  filePath: string;
  onSelect: () => void;
  disabled: boolean;
}> = ({ label, fileType, filePath, onSelect, disabled }) => (
  <div className="grid grid-cols-1 sm:grid-cols-6 gap-2 items-center">
    <label className="text-sm font-medium text-slate-300 sm:col-span-1">{label}:</label>
    <input
      type="text"
      readOnly
      value={filePath}
      placeholder={`No ${fileType} selected`}
      className="sm:col-span-4 p-2 bg-slate-600 border border-slate-500 rounded-md text-sm text-slate-300 placeholder-slate-400"
    />
    <ActionButton onClick={onSelect} variant="secondary" fullWidth disabled={disabled}>
      Select...
    </ActionButton>
  </div>
);

// --- Main Page Component ---

const WaterAnalysisPage: React.FC<WaterAnalysisPageProps> = ({ userName }) => {
  const [excelFile, setExcelFile] = useState<FileWithContent | null>(null);
  const [pdfFiles, setPdfFiles] = useState<FileWithContent[]>([]);
  const [imageFiles, setImageFiles] = useState<FileWithContent[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [totalRows, setTotalRows] = useState(0);
  const [jsonPreview, setJsonPreview] = useState<string | null>(null);

  const excelInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const imagesInputRef = useRef<HTMLInputElement>(null);
  const logAreaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (logAreaRef.current) {
      logAreaRef.current.scrollTop = logAreaRef.current.scrollHeight;
    }
  }, [logs]);

  const log = (message: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };
  
  const handleFileSelect = (ref: React.RefObject<HTMLInputElement>) => {
    ref.current?.click();
  };

  const handleExcelFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const content = await file.arrayBuffer();
        setExcelFile({ name: file.name, content });
      } catch (err) {
        alert("엑셀 파일을 읽는 중 오류가 발생했습니다. 다시 시도해주세요.");
        console.error("Error reading Excel file:", err);
        setExcelFile(null);
      }
    } else {
      setExcelFile(null);
    }
    if (e.target) e.target.value = '';
  };

  const handlePdfFilesChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      try {
        const filesWithContent = await Promise.all(
          Array.from(files).map(async file => ({ name: file.name, content: await file.arrayBuffer() }))
        );
        setPdfFiles(filesWithContent);
      } catch (err) {
        alert("PDF 파일을 읽는 중 오류가 발생했습니다. 다시 시도해주세요.");
        console.error("Error reading PDF files:", err);
        setPdfFiles([]);
      }
    } else {
      setPdfFiles([]);
    }
    if (e.target) e.target.value = '';
  };

  const handleImageFilesChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      try {
        const filesWithContent = await Promise.all(
          Array.from(files).map(async file => ({ name: file.name, content: await file.arrayBuffer() }))
        );
        setImageFiles(filesWithContent);
      } catch (err) {
        alert("이미지 파일을 읽는 중 오류가 발생했습니다. 다시 시도해주세요.");
        console.error("Error reading Image files:", err);
        setImageFiles([]);
      }
    } else {
      setImageFiles([]);
    }
    if (e.target) e.target.value = '';
  };

  const findValueInRow = (row: WaterAnalysisRow, keys: string[]): string | undefined => {
    if (!row) return undefined;
    const rowKeys = Object.keys(row);
    for (const key of keys) {
        const foundKey = rowKeys.find(rk => rk.toLowerCase().trim() === key.toLowerCase());
        if (foundKey && row[foundKey] !== null && row[foundKey] !== undefined) {
            return String(row[foundKey]);
        }
    }
    return undefined;
  };

  const processAndSend = async () => {
    if (!excelFile) {
      alert("엑셀 파일을 선택해주세요.");
      return;
    }

    setIsProcessing(true);
    setLogs([]);
    setProgress(0);
    setTotalRows(0);
    setJsonPreview(null);
    log("처리를 시작합니다...");

    try {
      const data = excelFile.content;
      const workbook = XLSX.read(data);
      const sheetName = "to claydox";
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet) {
        throw new Error(`시트 "${sheetName}"를 찾을 수 없습니다.`);
      }
      
      const rowsAsArrays: (string | number | null)[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
      const nonEmptyRows = rowsAsArrays.filter(r => r && r.some(c => c !== null && String(c).trim() !== ''));

      if (nonEmptyRows.length === 0) {
        log("시트가 비어있습니다.");
        setIsProcessing(false);
        return;
      }
      
      let headers: string[] | null = null;
      let dataStartIndex = 0;
      const headerKeywords = ['접수번호', 'receipt', '시험명', 'test', 'item', '현장', 'site'];
      const receiptNumberRegex = /^\d{2}-\d{6}-\d{2}-\d+/;
      
      for (let i = 0; i < Math.min(10, nonEmptyRows.length); i++) {
        const row = nonEmptyRows[i].map(cell => String(cell || '').toLowerCase().trim());
        const matchCount = headerKeywords.filter(keyword => row.some(cell => cell.includes(keyword))).length;
        
        if (matchCount >= 2) {
          headers = nonEmptyRows[i].map(cell => String(cell || '').trim());
          dataStartIndex = i + 1;
          log(`헤더 행을 ${i + 1}번째 줄에서 찾았습니다.`);
          break;
        }
      }

      if (!headers) {
        let patternRowIndex = -1;
        for (let i = 0; i < Math.min(10, nonEmptyRows.length); i++) {
          if (nonEmptyRows[i].some(cell => typeof cell === 'string' && receiptNumberRegex.test(cell.trim()))) {
            patternRowIndex = i;
            break;
          }
        }

        if (patternRowIndex !== -1) {
          log("헤더를 찾지 못했으나, 데이터 패턴을 감지했습니다. 고정된 열 레이아웃으로 처리합니다.");
          headers = [ 'No', '분야', '시험명', '현장', '접수번호', 'Analysis1', 'Analysis2', 'Analysis3', 'Analysis4', '시험자', '비고1', '비고2' ];
          dataStartIndex = patternRowIndex;
        }
      }

      if (!headers) {
        log("헤더 행 또는 데이터 패턴을 찾을 수 없습니다. 비어있지 않은 첫 행을 헤더로 간주합니다.");
        headers = nonEmptyRows[0].map(cell => String(cell || '').trim());
        dataStartIndex = 1;
      }
      
      const dataRows = nonEmptyRows.slice(dataStartIndex);
      const jsonData: WaterAnalysisRow[] = dataRows.map(rowArray => {
          const rowObject: WaterAnalysisRow = {};
          headers!.forEach((header, index) => {
              if (header && index < rowArray.length) {
                  rowObject[header] = rowArray[index] === null ? undefined : rowArray[index];
              }
          });
          return rowObject;
      });
      
      const validRows = jsonData.filter(row => {
        const receiptNumber = findValueInRow(row, ['LABVIEW_RECEIPTNO', '접수번호', 'Receipt No']);
        if (!receiptNumber) return false;

        const trimmedReceipt = String(receiptNumber).trim();
        const parts = trimmedReceipt.split('-');
        
        const isValidFormat = 
            parts.length === 4 &&
            /^\d{2}$/.test(parts[0]) &&
            /^\d{6}$/.test(parts[1]) &&
            /^\d{2}$/.test(parts[2]) &&
            /^\d+$/.test(parts[3]);

        if (!isValidFormat) {
          log(`잘못된 접수번호 형식의 행을 건너뜁니다: "${trimmedReceipt}"`);
        }
        
        return isValidFormat;
      });
      
      if(validRows.length === 0) {
        log("유효한 접수번호를 가진 데이터 행이 없습니다.");
        setIsProcessing(false);
        return;
      }

      log("접수번호를 기준으로 데이터 그룹화 중...");
      const groups: Record<string, WaterAnalysisRow[]> = {};
      validRows.forEach(row => {
          const receiptNumber = findValueInRow(row, ['LABVIEW_RECEIPTNO', '접수번호', 'Receipt No'])!;
          if (!groups[receiptNumber]) {
              groups[receiptNumber] = [];
          }
          groups[receiptNumber].push(row);
      });
      log(`${Object.keys(groups).length}개의 고유 접수번호 그룹을 찾았습니다.`);
      
      setTotalRows(Object.keys(groups).length);
      await new Promise(r => setTimeout(r, 0)); // UI update for totalRows

      let groupIndex = 0;
      for (const receiptNumber in groups) {
        groupIndex++;
        const rowsInGroup = groups[receiptNumber];
        log(`--- 그룹 ${groupIndex}/${Object.keys(groups).length} 처리 시작: 접수번호 ${receiptNumber} (${rowsInGroup.length}개 항목) ---`);

        try {
            const hasTp = rowsInGroup.some(row => {
                const testName = findValueInRow(row, ['시험명', 'Test Name', 'Item']) || '';
                return testName === "총인" || testName.toUpperCase() === 'TP';
            });
            log(hasTp ? "TP 항목이 그룹에 포함되어 있습니다." : "TP 항목이 그룹에 없습니다.");

            const zipFileName = `${receiptNumber}${hasTp ? 'P' : ''}.zip`;
            log(`ZIP 파일 생성 중: ${zipFileName}...`);
            
            const zip = new JSZip();
            zip.file(excelFile.name, excelFile.content);
            pdfFiles.forEach(f => zip.file(f.name, f.content));
            imageFiles.forEach(f => zip.file(f.name, f.content));
            const zipBlob = await zip.generateAsync({ type: "blob" });
            
            log(`${zipFileName} 업로드 중...`);
            const formData = new FormData();
            formData.append("files", zipBlob, zipFileName);
            await axios.post("https://mobile.ktl.re.kr/labview/api/uploadfiles", formData, {
              headers: { "Content-Type": "multipart/form-data" },
              timeout: KTL_API_TIMEOUT,
            });
            log(`ZIP 파일 업로드 완료: ${zipFileName}`);

            const mergedLabviewItem: any = { 시험자: userName, 첨부파일명: zipFileName };
            const testNamesInGroup = new Set<string>();
            const testNameAbbrsInGroup = new Set<string>();
            let siteLocation = '';
            let nonTpDataApplied = false;

            for (const row of rowsInGroup) {
              const testName = findValueInRow(row, ['시험명', 'Test Name', 'Item']) || 'N/A';
              testNamesInGroup.add(testName);
              testNameAbbrsInGroup.add(getTestNameAbbreviation(testName));

              if (!siteLocation) {
                siteLocation = findValueInRow(row, ['현장', 'Site', 'Site Location']) || '';
              }
              if(siteLocation){
                mergedLabviewItem['현장'] = siteLocation;
              }

              const isTP = testName === "총인" || testName?.toUpperCase() === 'TP';
              
              const val1 = findValueInRow(row, ['Analysis1', '값1', 'Value1']) || "";
              const val2 = findValueInRow(row, ['Analysis2', '값2', 'Value2']) || "";
              const val3 = findValueInRow(row, ['Analysis3', '값3', 'Value3']) || "";
              const val4 = findValueInRow(row, ['Analysis4', '값4', 'Value4']) || "";

              if (isTP) {
                mergedLabviewItem.Analysis1P = val1;
                mergedLabviewItem.Analysis2P = val2;
                mergedLabviewItem.Analysis3P = val3;
                mergedLabviewItem.Analysis4P = val4;
              } else {
                if (!nonTpDataApplied) {
                  mergedLabviewItem.Analysis1 = val1;
                  mergedLabviewItem.Analysis2 = val2;
                  mergedLabviewItem.Analysis3 = val3;
                  mergedLabviewItem.Analysis4 = val4;
                  nonTpDataApplied = true;
                }
              }
            }
            
            const abbreviations = Array.from(testNameAbbrsInGroup).sort().join(',');
            const labviewGubn = `수분석_${abbreviations}`;
            const labviewDescComment = `(항목: ${Array.from(testNamesInGroup).sort().join(', ')}, 현장: ${siteLocation})`;
            
            const payload: KtlWaterAnalysisPayload = {
                LABVIEW_RECEIPTNO: receiptNumber,
                LABVIEW_GUBN: labviewGubn,
                LABVIEW_DESC: JSON.stringify({ comment: labviewDescComment }),
                UPDATE_USER: userName,
                LABVIEW_ITEM: JSON.stringify(mergedLabviewItem),
            };

            setJsonPreview(JSON.stringify(payload, null, 2));
            await new Promise(r => setTimeout(r, 50));
            
            log(`병합된 JSON 전송 중: ${receiptNumber}...`);
            await axios.post("https://mobile.ktl.re.kr/labview/api/env", payload, {
              headers: { "Content-Type": "application/json", "Accept": "application/json" },
              timeout: KTL_API_TIMEOUT,
            });
            log(`JSON 전송 완료: ${receiptNumber}`);

        } catch (groupError: any) {
            const errorMessage = groupError.response?.data ? JSON.stringify(groupError.response.data) : groupError.message;
            log(`오류 발생 (접수번호 ${receiptNumber}): ${errorMessage}`);
        } finally {
            setProgress(prev => prev + 1);
            await new Promise(r => setTimeout(r, 50));
        }
      }

      log("--- 모든 작업 완료. ---");

    } catch (error: any) {
      const errorMessage = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      log(`치명적 오류 발생: ${errorMessage}`);
      alert(`치명적 오류 발생: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };


  return (
    <div className="w-full max-w-4xl bg-slate-800 shadow-2xl rounded-xl p-6 sm:p-8 space-y-6">
      <h2 className="text-2xl font-bold text-sky-400 border-b border-slate-700 pb-3">
        수분석 전송 (Page 4)
      </h2>
      <p className="text-slate-300">
        수분석 결과 엑셀 파일(필수)과 관련 PDF, 사진(선택)들을 선택한 후, '처리 및 전송' 버튼을 눌러 작업을 시작하세요.
      </p>

      {/* Hidden File Inputs */}
      <input type="file" ref={excelInputRef} accept=".xlsx, .xls" className="hidden" onChange={handleExcelFileChange} />
      <input type="file" ref={pdfInputRef} accept=".pdf" multiple className="hidden" onChange={handlePdfFilesChange} />
      <input type="file" ref={imagesInputRef} accept="image/jpeg, image/png" multiple className="hidden" onChange={handleImageFilesChange} />

      {/* UI */}
      <div className="space-y-4 p-4 bg-slate-700/30 rounded-lg border border-slate-600/50">
        <h3 className="text-lg font-semibold text-slate-100">입력 파일 선택</h3>
        <FileInputRow label="Excel 파일" fileType="Excel" filePath={excelFile?.name || ''} onSelect={() => handleFileSelect(excelInputRef)} disabled={isProcessing} />
        <FileInputRow label="PDF 문서" fileType="PDFs" filePath={pdfFiles.length > 0 ? `${pdfFiles.length} files selected` : ''} onSelect={() => handleFileSelect(pdfInputRef)} disabled={isProcessing} />
        <FileInputRow label="사진" fileType="Images" filePath={imageFiles.length > 0 ? `${imageFiles.length} files selected` : ''} onSelect={() => handleFileSelect(imagesInputRef)} disabled={isProcessing} />
      </div>

      <ActionButton onClick={processAndSend} disabled={isProcessing || !excelFile} fullWidth>
        {isProcessing ? <Spinner size="sm" /> : null}
        {isProcessing ? '처리 중...' : '처리 및 전송 시작'}
      </ActionButton>
      
      <details className="text-left bg-slate-700/30 p-3 rounded-md border border-slate-600/50">
        <summary className="cursor-pointer text-sm font-medium text-sky-400 hover:text-sky-300">
            현재 처리 중인 JSON 데이터 미리보기
        </summary>
        {jsonPreview ? (
            <pre className="mt-2 text-xs text-slate-300 bg-slate-900 p-3 rounded-md overflow-x-auto max-h-60 border border-slate-700">
                {jsonPreview}
            </pre>
        ) : (
            <p className="mt-2 text-xs text-slate-400">
                처리가 시작되면 여기에 현재 그룹의 JSON 데이터가 표시됩니다.
            </p>
        )}
      </details>

      <div className="space-y-2">
        <label htmlFor="progress-bar" className="text-sm font-medium text-slate-300">
            진행률: {progress} / {totalRows}
        </label>
        <div id="progress-bar" className="w-full bg-slate-600 rounded-full h-2.5">
          <div className="bg-sky-500 h-2.5 rounded-full transition-all duration-300" style={{ width: `${totalRows > 0 ? (progress / totalRows) * 100 : 0}%` }}></div>
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="log-area" className="text-sm font-medium text-slate-300">처리 로그</label>
        <textarea
          id="log-area"
          ref={logAreaRef}
          readOnly
          value={logs.join('\n')}
          className="w-full h-60 bg-slate-900 text-xs text-slate-300 font-mono p-3 rounded-md border border-slate-600 focus:ring-sky-500 focus:border-sky-500"
          placeholder="처리 과정이 여기에 표시됩니다..."
        />
      </div>
    </div>
  );
};

export default WaterAnalysisPage;
