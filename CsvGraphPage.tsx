
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { ActionButton } from './components/ActionButton';
import { Spinner } from './components/Spinner';
import { CsvDisplay } from './components/csv/CsvDisplay';
import { parseGraphtecCsv } from './utils/parseGraphtecCsv';
import type { 
    CsvGraphJob, 
    SensorType
} from './types/csvGraph';

interface CsvGraphPageProps {
  userName: string;
  jobs: CsvGraphJob[];
  setJobs: React.Dispatch<React.SetStateAction<CsvGraphJob[]>>;
  activeJobId: string | null;
  setActiveJobId: (id: string | null) => void;
  siteLocation: string;
  onDeleteJob: (jobId: string) => void;
}

const TrashIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12.56 0c1.153 0 2.24.03 3.22.077m3.22-.077L10.88 5.79m2.558 0c-.29.042-.58.083-.87.124" />
    </svg>
);

const ONE_MINUTE_MS = 60 * 1000;
const BIG_PAN_RATIO = 0.25;

const CsvGraphPage: React.FC<CsvGraphPageProps> = ({ userName, jobs, setJobs, activeJobId, setActiveJobId, siteLocation, onDeleteJob }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [placingAiPointLabel, setPlacingAiPointLabel] = useState<string | null>(null);
  const [isFullScreenGraph, setIsFullScreenGraph] = useState(false);
  const [sequentialPlacementState, setSequentialPlacementState] = useState({ isActive: false, currentIndex: 0 });
  
  const activeJob = useMemo(() => jobs.find(job => job.id === activeJobId), [jobs, activeJobId]);

  const updateActiveJob = useCallback((updater: (job: CsvGraphJob) => CsvGraphJob) => {
    if (!activeJobId) return;
    setJobs(prevJobs => prevJobs.map(job => job.id === activeJobId ? updater(job) : job));
  }, [activeJobId, setJobs]);

  const { fullTimeRange } = useMemo(() => {
    if (!activeJob?.parsedData?.data || activeJob.parsedData.data.length < 2) {
      return { fullTimeRange: null };
    }
    const sortedData = [...activeJob.parsedData.data].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const minTimestamp = sortedData[0].timestamp.getTime();
    const maxTimestamp = sortedData[sortedData.length - 1].timestamp.getTime();
    return { fullTimeRange: { min: minTimestamp, max: maxTimestamp } };
  }, [activeJob?.parsedData]);

  useEffect(() => {
    if (fullTimeRange && activeJob && activeJob.viewEndTimestamp === null) {
        updateActiveJob(j => ({ ...j, viewEndTimestamp: fullTimeRange.max }));
    }
  }, [fullTimeRange, activeJob, updateActiveJob]);

  useEffect(() => {
    setSequentialPlacementState({ isActive: false, currentIndex: 0 });
  }, [activeJobId, activeJob?.fileName]);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeJob) {
        alert("파일을 업로드할 작업을 먼저 선택하거나 추가해주세요.");
        return;
    }
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setError(null);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = (e.target?.result as string) || '';
        const parsed = parseGraphtecCsv(content, file.name);
        updateActiveJob(job => ({
            ...job,
            fileName: file.name,
            parsedData: parsed,
            channelAnalysis: job.fileName === file.name ? job.channelAnalysis : {},
            autoMinMaxResults: null,
            selectedChannelId: job.fileName === file.name ? job.selectedChannelId : (parsed.channels[0]?.id || null),
            timeRangeInMs: job.fileName === file.name ? job.timeRangeInMs : 'all',
            viewEndTimestamp: job.fileName === file.name ? job.viewEndTimestamp : null,
            isRangeSelecting: false,
            isMaxMinMode: false,
            rangeSelection: null,
        }));
      } catch (err: any) {
        setError(err?.message || '파일 처리 중 오류가 발생했습니다.');
        updateActiveJob(j => ({...j, parsedData: null, fileName: file.name}));
      } finally {
        setIsLoading(false);
      }
    };
    reader.onerror = () => { setError('파일을 읽는 데 실패했습니다.'); setIsLoading(false); };
    reader.readAsText(file, 'UTF-8');
  }, [activeJob, updateActiveJob]);

  const handleClear = () => {
    if (!activeJob) return;
    updateActiveJob(job => ({
        ...job,
        fileName: null,
        parsedData: null,
        channelAnalysis: {},
        autoMinMaxResults: null,
        selectedChannelId: null,
        timeRangeInMs: 'all',
        viewEndTimestamp: null,
        isRangeSelecting: false,
        isMaxMinMode: false,
        rangeSelection: null,
    }));
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
  
  const { yMinMaxPerChannel } = useMemo(() => {
    if (!activeJob?.parsedData?.data || activeJob.parsedData.data.length === 0) {
      return { yMinMaxPerChannel: [] };
    }
    const minMax: ({ yMin: number; yMax: number } | null)[] = activeJob.parsedData.channels.map((_, channelIndex) => {
      const yValues = activeJob.parsedData!.data.map(d => d.values[channelIndex]).filter(v => v !== null) as number[];
      if (yValues.length === 0) return null;
      let yMin = Math.min(...yValues);
      let yMax = Math.max(...yValues);
      if (yMin === yMax) { yMin -= 1; yMax += 1; }
      const yRange = yMax - yMin;
      return { yMin: yMin - yRange * 0.1, yMax: yMax + yRange * 0.1 };
    });
    return { yMinMaxPerChannel: minMax };
  }, [activeJob?.parsedData]);
  
  const viewMemo = useMemo(() => {
    if (!activeJob?.parsedData?.data || activeJob.parsedData.data.length === 0 || activeJob.timeRangeInMs === 'all' || activeJob.viewEndTimestamp === null) {
      return { filteredData: activeJob?.parsedData?.data || [], currentWindowDisplay: "전체 기간" };
    }
    const endTime = activeJob.viewEndTimestamp;
    const startTime = endTime - activeJob.timeRangeInMs;
    const dataInWindow = activeJob.parsedData.data.filter(d => {
        const time = d.timestamp.getTime();
        return time >= startTime && time <= endTime;
    });
    const windowDisplay = `${new Date(startTime).toLocaleString()} ~ ${new Date(endTime).toLocaleString()}`;
    return { filteredData: dataInWindow, currentWindowDisplay: windowDisplay };
  }, [activeJob]);

  // ✅ Added logic to define isAtStart and isAtEnd to fix reference errors
  const { isAtStart, isAtEnd } = useMemo(() => {
    if (!fullTimeRange || !activeJob || activeJob.viewEndTimestamp === null || activeJob.timeRangeInMs === 'all' || typeof activeJob.timeRangeInMs !== 'number') {
      return { isAtStart: true, isAtEnd: true };
    }
    const startTime = activeJob.viewEndTimestamp - activeJob.timeRangeInMs;
    return {
      isAtStart: startTime <= fullTimeRange.min,
      isAtEnd: activeJob.viewEndTimestamp >= fullTimeRange.max
    };
  }, [fullTimeRange, activeJob]);
  
  const { selectedChannel, selectedChannelIndex } = useMemo(() => {
    if (!activeJob?.parsedData || !activeJob.selectedChannelId) return { selectedChannel: null, selectedChannelIndex: -1 };
    const index = activeJob.parsedData.channels.findIndex(c => c.id === activeJob.selectedChannelId);
    return { selectedChannel: index > -1 ? activeJob.parsedData.channels[index] : null, selectedChannelIndex: index };
  }, [activeJob]);


  const handleTimeRangeChange = (newTimeRange: 'all' | number) => {
    if (!fullTimeRange || !activeJob) return;
    const oldTimeRangeNum = typeof activeJob.timeRangeInMs === 'number' ? activeJob.timeRangeInMs : (fullTimeRange.max - fullTimeRange.min);
    let currentCenterTimestamp = (activeJob.timeRangeInMs === 'all' || activeJob.viewEndTimestamp === null) 
        ? (fullTimeRange.min + fullTimeRange.max) / 2 
        : activeJob.viewEndTimestamp - (oldTimeRangeNum / 2);

    if (newTimeRange === 'all') {
        updateActiveJob(j => ({...j, timeRangeInMs: 'all', viewEndTimestamp: null }));
    } else {
        const newRangeNum = newTimeRange as number;
        let newEndTimestamp = currentCenterTimestamp + (newRangeNum / 2);
        newEndTimestamp = Math.max(fullTimeRange.min + newRangeNum, Math.min(newEndTimestamp, fullTimeRange.max));
        updateActiveJob(j => ({...j, timeRangeInMs: newRangeNum, viewEndTimestamp: newEndTimestamp }));
    }
  };
  
  const handlePan = useCallback((panAmountMs: number) => {
    if (!activeJob || activeJob.timeRangeInMs === 'all' || !fullTimeRange || typeof activeJob.timeRangeInMs !== 'number') return;
    const timeRangeNumber = activeJob.timeRangeInMs;
    updateActiveJob(job => {
        if (job.viewEndTimestamp === null) return job;
        const newEnd = job.viewEndTimestamp + panAmountMs;
        return {...job, viewEndTimestamp: Math.max(fullTimeRange.min + timeRangeNumber, Math.min(newEnd, fullTimeRange.max))};
    });
  }, [activeJob, fullTimeRange, updateActiveJob]);

  const handleZoom = useCallback((zoomFactor: number, centerTimestamp: number) => {
    if (!activeJob || !fullTimeRange || typeof activeJob.timeRangeInMs !== 'number') return;
    const timeRangeNumber = activeJob.timeRangeInMs;
    const newTimeRangeInMs = Math.max(60 * 1000, Math.min(fullTimeRange.max - fullTimeRange.min, timeRangeNumber / zoomFactor));
    if (Math.abs(newTimeRangeInMs - timeRangeNumber) < 1) return;
    updateActiveJob(job => {
        if (job.viewEndTimestamp === null || typeof job.timeRangeInMs !== 'number') return job;
        const oldDistanceFromEnd = job.viewEndTimestamp - centerTimestamp;
        const newDistanceFromEnd = oldDistanceFromEnd * (newTimeRangeInMs / job.timeRangeInMs);
        let newViewEndTimestamp = Math.max(fullTimeRange.min + newTimeRangeInMs, Math.min(centerTimestamp + newDistanceFromEnd, fullTimeRange.max));
        return { ...job, timeRangeInMs: newTimeRangeInMs, viewEndTimestamp: newViewEndTimestamp };
    });
  }, [activeJob, fullTimeRange, updateActiveJob]);
  
  const handleNavigate = (newEndTimestamp: number) => {
    if (!activeJob || !fullTimeRange) return;
    const range = typeof activeJob.timeRangeInMs === 'number' ? activeJob.timeRangeInMs : (fullTimeRange.max - fullTimeRange.min);
    const clampedTimestamp = Math.max(fullTimeRange.min + range, Math.min(newEndTimestamp, fullTimeRange.max));
    updateActiveJob(j => ({...j, viewEndTimestamp: clampedTimestamp}));
  };

  const handleFinePan = (direction: number) => handlePan(direction * ONE_MINUTE_MS);

  const toggleAnalysisMode = (channelId: string) => {
    updateActiveJob(job => {
        const current = job.channelAnalysis[channelId] || { isAnalyzing: false, selection: { start: null, end: null }, results: [] };
        return { ...job, isMaxMinMode: false, isRangeSelecting: false, channelAnalysis: {...job.channelAnalysis, [channelId]: { ...current, isAnalyzing: !current.isAnalyzing, selection: { start: null, end: null } } } };
    });
  };

  const toggleMaxMinMode = () => {
    updateActiveJob(job => {
        const currentMode = !job.isMaxMinMode;
        // 기존 채널들의 선택 상태 초기화
        const newChannelAnalysis = { ...job.channelAnalysis };
        Object.keys(newChannelAnalysis).forEach(cid => {
            newChannelAnalysis[cid] = { ...newChannelAnalysis[cid], selection: { start: null, end: null } };
        });
        return { ...job, isMaxMinMode: currentMode, isRangeSelecting: false, channelAnalysis: newChannelAnalysis, rangeSelection: null };
    });
  };
  
  const handleClearAnalysis = useCallback(() => {
    if (!activeJob) return;
    updateActiveJob(job => ({ ...job, channelAnalysis: {}, autoMinMaxResults: null, isRangeSelecting: false, isMaxMinMode: false, rangeSelection: null }));
  }, [activeJob, updateActiveJob]);

  const handleCancelSelection = (channelId: string) => {
    updateActiveJob(job => {
        const current = job.channelAnalysis[channelId] || { isAnalyzing: false, selection: { start: null, end: null }, results: [] };
        return { ...job, channelAnalysis: {...job.channelAnalysis, [channelId]: { ...current, selection: { start: null, end: null } }}};
    });
  };

  const handleUndoLastResult = (channelId: string) => {
      updateActiveJob(job => {
          const current = job.channelAnalysis[channelId] || { isAnalyzing: false, selection: { start: null, end: null }, results: [] };
          if (current.results.length === 0) return job;
          return { ...job, channelAnalysis: {...job.channelAnalysis, [channelId]: { ...current, results: current.results.slice(0, -1) }}};
      });
  };

  const handleDeleteManualResult = useCallback((channelId: string, resultId: string) => {
      updateActiveJob(job => {
          const current = job.channelAnalysis[channelId];
          if (!current) return job;
          return {
              ...job,
              channelAnalysis: {
                  ...job.channelAnalysis,
                  [channelId]: { ...current, results: current.results.filter(r => r.id !== resultId) }
              }
          };
      });
  }, [updateActiveJob]);

  const handlePointSelect = useCallback((channelId: string, point: { timestamp: Date; value: number }) => {
    if (!activeJob?.parsedData) return;
    const channelIndex = activeJob.parsedData.channels.findIndex(c => c.id === channelId);
    if (channelIndex === -1) return;

    updateActiveJob(job => {
      const state = job.channelAnalysis[channelId] || { isAnalyzing: false, selection: { start: null, end: null }, results: [] };
      if (job.isMaxMinMode) {
          // ✅ 첫 번째 클릭: 시작점 지정
          if (!state.selection.start) {
              return { ...job, channelAnalysis: {...job.channelAnalysis, [channelId]: { ...state, selection: { start: point, end: null } } }};
          }
          // ✅ 두 번째 클릭: 범위 계산 및 결과 저장
          const [startTime, endTime] = [state.selection.start.timestamp, point.timestamp].sort((a, b) => a.getTime() - b.getTime());
          const valuesInRange = (job.parsedData?.data || []).filter(d => d.timestamp >= startTime && d.timestamp <= endTime).map(d => d.values[channelIndex]).filter(v => v !== null) as number[];
          
          if (valuesInRange.length < 1) {
              return { ...job, channelAnalysis: {...job.channelAnalysis, [channelId]: { ...state, selection: { start: null, end: null } } }};
          }
          
          const min = Math.min(...valuesInRange);
          const max = Math.max(...valuesInRange);
          return { 
              ...job, 
              channelAnalysis: { 
                  ...job.channelAnalysis, 
                  [channelId]: { 
                      ...state, 
                      selection: { start: null, end: null }, 
                      results: [...state.results, { id: self.crypto.randomUUID(), min, max, diff: max - min, startTime, endTime }] 
                  }
              }
          };
      }
      return job;
    });
  }, [activeJob?.parsedData, updateActiveJob]);

    const handleManualAiPointPlacement = useCallback((label: string, point: { timestamp: Date; value: number }) => {
        // AI Point logic removed but kept manual placement support for potential future manual point tagging if needed,
        // although current requirement is to delete AI pattern.
        setPlacingAiPointLabel(null);
    }, []);

    const SEQUENTIAL_POINT_ORDER = useMemo(() => {
        const type = activeJob?.sensorType;
        switch (type) {
            case 'PH':
                return [
                    '(A)_4_1', '(A)_4_2', '(A)_4_3', '(A)_7_1', '(A)_7_2', '(A)_7_3', '(A)_10_1', '(A)_10_2', '(A)_10_3',
                    '(B)_7_1', '(B)_4_1', '(B)_7_2', '(B)_4_2', '(B)_7_3', '(B)_4_3',
                    '(C)_4_1', '(C)_4_2', '(C)_4_3', '(C)_7_1', '(C)_7_2', '(C)_7_3', '(C)_4_4', '(C)_4_5', '(C)_4_6', '(C)_7_4', '(C)_7_5', '(C)_7_6',
                    '4_10', '4_15', '4_20', '4_25', '4_30', 'ST', 'EN', '현장1', '현장2'
                ];
            case 'SS':
                return ['M1', 'M2', 'M3', 'Z1', 'Z2', 'S1', 'S2', 'Z3', 'Z4', 'S3', 'S4', 'Z5', 'S5', 'Z6', 'S6', 'Z7', 'S7', '현장1', '현장2'];
            case 'DO':
                return ['(A)_S1', '(A)_S2', '(A)_S3', 'S_1', 'S_2', 'S_3', 'Z_1', 'Z_2', 'Z_3', 'Z_4', 'Z_5', 'Z_6', 'S_4', 'S_5', 'S_6', '20_S_1', '20_S_2', '20_S_3', '30_S_1', '30_S_2', '30_S_3', 'ST', 'EN'];
            default:
                return ['Z1', 'Z2', 'S1', 'S2', 'Z3', 'Z4', 'S3', 'S4', 'Z5', 'S5', 'M1', 'ST', 'EN'];
        }
    }, [activeJob?.sensorType]);

    const handleToggleSequentialPlacement = useCallback(() => {
        setPlacingAiPointLabel(null);
        setSequentialPlacementState(prev => ({ isActive: !prev.isActive, currentIndex: 0 }));
    }, []);
    
    const handleSetIndividualPointMode = useCallback((label: string | null) => {
        setSequentialPlacementState({ isActive: false, currentIndex: 0 });
        setPlacingAiPointLabel(label);
    }, []);

    const handleSequentialPointPlacement = useCallback((point: { timestamp: Date; value: number }) => {
        if (!sequentialPlacementState.isActive) return;
        const pointLabel = SEQUENTIAL_POINT_ORDER[sequentialPlacementState.currentIndex];
        if (!pointLabel) {
            setSequentialPlacementState({ isActive: false, currentIndex: 0 });
            return;
        }
        
        // Custom points are not saved in this simplified version to fully remove AI-related result structures
        const nextIndex = sequentialPlacementState.currentIndex + 1;
        if (nextIndex >= SEQUENTIAL_POINT_ORDER.length) {
            setSequentialPlacementState({ isActive: false, currentIndex: 0 });
            alert("순차 지정이 완료되었습니다.");
        } else {
            setSequentialPlacementState(prev => ({ ...prev, currentIndex: nextIndex }));
        }
    }, [sequentialPlacementState, SEQUENTIAL_POINT_ORDER]);

  return (
    <div className={`w-full max-w-7xl bg-slate-800 shadow-2xl space-y-6 ${isFullScreenGraph ? '' : 'sm:rounded-xl sm:p-6 lg:p-8'}`}>
      <h2 className="text-2xl font-bold text-sky-400 border-b border-slate-700 pb-3">CSV 그래프 (P6)</h2>
      
      {jobs.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-md font-semibold text-slate-200">작업 목록 ({jobs.length}개):</h3>
          <div className="max-h-48 overflow-y-auto bg-slate-700/20 p-2 rounded-md border border-slate-600/40 space-y-1.5">
            {jobs.map(job => (
              <div key={job.id} onClick={() => setActiveJobId(job.id)} className={`p-2.5 rounded-md cursor-pointer transition-all ${activeJobId === job.id ? 'bg-sky-600 shadow-md ring-2 ring-sky-400' : 'bg-slate-600 hover:bg-slate-500'}`}>
                <div className="flex justify-between items-center">
                  <span className={`text-sm font-medium ${activeJobId === job.id ? 'text-white' : 'text-slate-200'}`}>{job.receiptNumber || `작업 (${job.sensorType})`} {job.fileName && `/ ${job.fileName}`}</span>
                  <button onClick={(e) => { e.stopPropagation(); onDeleteJob(job.id); }} className="ml-2 p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-red-600 transition-colors flex-shrink-0"><TrashIcon /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {activeJob && !activeJob.parsedData && (
          <div className="p-4 bg-slate-700/40 rounded-lg border border-slate-600/50 flex flex-col sm:flex-row gap-4 items-center">
              <div className="flex-grow text-center sm:text-left">
                  <input ref={fileInputRef} id="csv-upload-prompt" type="file" accept=".csv,.txt" onChange={handleFileChange} className="block w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-sky-500 file:text-white hover:file:bg-sky-600" disabled={isLoading} />
              </div>
              <ActionButton onClick={handleClear} variant="secondary" disabled={isLoading}>초기화</ActionButton>
          </div>
      )}
      
      {isLoading && (<div className="flex justify-center items-center py-10"><Spinner /><span className="ml-3 text-slate-300">파일을 분석 중입니다...</span></div>)}
      {error && <p className="text-red-400 text-center p-4 bg-red-900/30 rounded-md">{error}</p>}

      {activeJob && activeJob.parsedData && (
        <CsvDisplay
          activeJob={activeJob}
          yMinMaxPerChannel={yMinMaxPerChannel}
          viewMemo={viewMemo}
          fullTimeRange={fullTimeRange}
          isAtStart={isAtStart}
          isAtEnd={isAtEnd}
          selectedChannel={selectedChannel}
          selectedChannelIndex={selectedChannelIndex}
          updateActiveJob={updateActiveJob}
          handleTimeRangeChange={handleTimeRangeChange}
          handleFinePan={handleFinePan}
          handlePan={handlePan}
          handleZoom={handleZoom}
          handleNavigate={handleNavigate}
          toggleAnalysisMode={toggleAnalysisMode}
          toggleMaxMinMode={toggleMaxMinMode}
          handleUndoLastResult={handleUndoLastResult}
          handleDeleteManualResult={handleDeleteManualResult}
          handleResetAnalysis={handleClearAnalysis}
          handleCancelSelection={handleCancelSelection}
          handlePointSelect={handlePointSelect}
          handlePhaseTimeChange={() => {}}
          placingAiPointLabel={placingAiPointLabel}
          setPlacingAiPointLabel={handleSetIndividualPointMode}
          handleManualAiPointPlacement={handleManualAiPointPlacement}
          handleAutoMinMaxResultChange={() => {}}
          handleManualAnalysisResultChange={() => {}}
          isPhaseAnalysisModified={false}
          handleReapplyAnalysis={async () => {}}
          isFullScreenGraph={isFullScreenGraph}
          setIsFullScreenGraph={setIsFullScreenGraph}
          sequentialPlacementState={sequentialPlacementState}
          handleToggleSequentialPlacement={handleToggleSequentialPlacement}
          handleSequentialPointPlacement={handleSequentialPointPlacement}
          sensorType={activeJob.sensorType}
          SEQUENTIAL_POINT_ORDER={SEQUENTIAL_POINT_ORDER}
        />
      )}
    </div>
  );
};

export default CsvGraphPage;
