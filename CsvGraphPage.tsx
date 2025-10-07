import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { ActionButton } from './components/ActionButton';
import { Spinner } from './components/Spinner';
import { CsvDisplay } from './components/csv/csvDisplay';
import { parseGraphtecCsv } from './utils/parseGraphtecCsv';
import { runPhaseAnalysis } from './ai/phaseAnalysis';
import { runPatternAnalysis } from './ai/patternAnalysis';
import type { 
    CsvGraphJob, 
    ParsedCsvData, 
    ChannelAnalysisState, 
    AnalysisResult, 
    AiPhase, 
    AiAnalysisPoint, 
    AiAnalysisResult 
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
  const [isPhaseAnalysisModified, setIsPhaseAnalysisModified] = useState(false);
  const [isFullScreenGraph, setIsFullScreenGraph] = useState(false);
  const [aiPointHistory, setAiPointHistory] = useState<AiAnalysisResult[]>([]);
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

  // Reset history and sequential mode when job changes or data is cleared.
  useEffect(() => {
    setAiPointHistory([]);
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
            // Keep existing analysis data if file name matches, otherwise reset
            channelAnalysis: job.fileName === file.name ? job.channelAnalysis : {},
            autoMinMaxResults: null,
            selectedChannelId: job.fileName === file.name ? job.selectedChannelId : (parsed.channels[0]?.id || null),
            timeRangeInMs: job.fileName === file.name ? job.timeRangeInMs : 'all',
            viewEndTimestamp: job.fileName === file.name ? job.viewEndTimestamp : null,
            aiPhaseAnalysisResult: null,
            aiPhaseAnalysisError: null,
            aiAnalysisResult: null,
            aiAnalysisError: null,
            isRangeSelecting: false,
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
        aiPhaseAnalysisResult: null,
        aiPhaseAnalysisError: null,
        aiAnalysisResult: null,
        aiAnalysisError: null,
        isRangeSelecting: false,
        rangeSelection: null,
    }));
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
  
  const { yMinMaxPerChannel } = useMemo(() => {
    if (!activeJob?.parsedData?.data || activeJob.parsedData.data.length === 0) {
      return { yMinMaxPerChannel: [] };
    }

    const measurementRange = activeJob.parsedData.measurementRange;

    const minMax: ({ yMin: number; yMax: number } | null)[] = activeJob.parsedData.channels.map((_, channelIndex) => {
      // If a manual measurement range is set, use it.
      if (typeof measurementRange === 'number' && measurementRange > 0) {
        // yMin is slightly negative for padding, yMax is the range plus padding.
        return { yMin: -measurementRange * 0.05, yMax: measurementRange * 1.05 };
      }

      // Otherwise, use auto-ranging.
      const yValues = activeJob.parsedData!.data
        .map(d => d.values[channelIndex])
        .filter(v => v !== null && typeof v === 'number') as number[];
      
      if (yValues.length === 0) return null;
      
      let yMin = Math.min(...yValues);
      let yMax = Math.max(...yValues);
      
      if (yMin === yMax) {
        yMin -= 1;
        yMax += 1;
      }

      const yRange = yMax - yMin;
      // Add 10% padding top and bottom
      yMin -= yRange * 0.1;
      yMax += yRange * 0.1;

      // Ensure yMin is not unnecessarily negative if all data is positive
      if (yMin < 0 && Math.min(...yValues) >= 0) {
        yMin = -yRange * 0.1; // Small negative padding
      }


      return { yMin, yMax };
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
  
  const { selectedChannel, selectedChannelIndex } = useMemo(() => {
    if (!activeJob?.parsedData || !activeJob.selectedChannelId) {
        return { selectedChannel: null, selectedChannelIndex: -1 };
    }
    const index = activeJob.parsedData.channels.findIndex(c => c.id === activeJob.selectedChannelId);
    return {
        selectedChannel: index > -1 ? activeJob.parsedData.channels[index] : null,
        selectedChannelIndex: index,
    };
  }, [activeJob]);


  const handleTimeRangeChange = (newTimeRange: 'all' | number) => {
    if (!fullTimeRange || !activeJob) return;

    const oldTimeRange = activeJob.timeRangeInMs;
    const oldViewEnd = activeJob.viewEndTimestamp;
    
    let currentCenterTimestamp: number;
    if (oldTimeRange === 'all' || oldViewEnd === null) {
        currentCenterTimestamp = (fullTimeRange.min + fullTimeRange.max) / 2;
    } else {
        currentCenterTimestamp = oldViewEnd - (oldTimeRange / 2);
    }
    
    if (newTimeRange === 'all') {
        updateActiveJob(j => ({...j, timeRangeInMs: 'all', viewEndTimestamp: null }));
    } else {
        let newEndTimestamp = currentCenterTimestamp + (newTimeRange / 2);
        const minPossibleEnd = fullTimeRange.min + newTimeRange;
        const maxPossibleEnd = fullTimeRange.max;
        newEndTimestamp = Math.max(minPossibleEnd, Math.min(newEndTimestamp, maxPossibleEnd));
        updateActiveJob(j => ({...j, timeRangeInMs: newTimeRange, viewEndTimestamp: newEndTimestamp }));
    }
  };
  
  const handlePan = useCallback((panAmountMs: number) => {
    if (!activeJob || activeJob.timeRangeInMs === 'all' || !fullTimeRange || typeof activeJob.timeRangeInMs !== 'number') return;
    
    // FIX: Capture the narrowed number type of timeRangeInMs from the outer scope's activeJob.
    const timeRangeNumber = activeJob.timeRangeInMs;
  
    updateActiveJob(job => {
        if (job.viewEndTimestamp === null) return job;
        const newEnd = job.viewEndTimestamp + panAmountMs;
        // Use the captured variable, as `job.timeRangeInMs` inside this callback is not narrowed.
        const minPossibleEnd = fullTimeRange.min + timeRangeNumber;
        const maxPossibleEnd = fullTimeRange.max;
        return {...job, viewEndTimestamp: Math.max(minPossibleEnd, Math.min(newEnd, maxPossibleEnd))};
    });
  }, [activeJob, fullTimeRange, updateActiveJob]);

  const handleZoom = useCallback((zoomFactor: number, centerTimestamp: number) => {
    if (!activeJob || !fullTimeRange || typeof activeJob.timeRangeInMs !== 'number') return;
    
    const timeRangeNumber = activeJob.timeRangeInMs;
    const fullDuration = fullTimeRange.max - fullTimeRange.min;

    const newTimeRangeInMs = Math.max(
        60 * 1000, // min 1 minute
        Math.min(fullDuration, timeRangeNumber / zoomFactor)
    );

    // If no significant change, return to avoid jitter
    if (Math.abs(newTimeRangeInMs - timeRangeNumber) < 1) return;

    updateActiveJob(job => {
        if (job.viewEndTimestamp === null || typeof job.timeRangeInMs !== 'number') return job;
        
        const oldDistanceFromEnd = job.viewEndTimestamp - centerTimestamp;
        // The distance from the center to the end should scale with the zoom
        const newDistanceFromEnd = oldDistanceFromEnd * (newTimeRangeInMs / job.timeRangeInMs);
        let newViewEndTimestamp = centerTimestamp + newDistanceFromEnd;

        // Clamp the new end timestamp to valid bounds
        const minPossibleEnd = fullTimeRange.min + newTimeRangeInMs;
        const maxPossibleEnd = fullTimeRange.max;
        newViewEndTimestamp = Math.max(minPossibleEnd, Math.min(newViewEndTimestamp, maxPossibleEnd));

        return {
            ...job,
            timeRangeInMs: newTimeRangeInMs,
            viewEndTimestamp: newViewEndTimestamp
        };
    });
  }, [activeJob, fullTimeRange, updateActiveJob]);
  
  const handleNavigate = (newEndTimestamp: number) => {
    if (!activeJob || activeJob.timeRangeInMs === 'all' || !fullTimeRange || typeof activeJob.timeRangeInMs !== 'number') return;
    const minPossibleEnd = fullTimeRange.min + activeJob.timeRangeInMs;
    const maxPossibleEnd = fullTimeRange.max;
    const clampedTimestamp = Math.max(minPossibleEnd, Math.min(newEndTimestamp, maxPossibleEnd));
    updateActiveJob(j => ({...j, viewEndTimestamp: clampedTimestamp}));
  };

  const handleFinePan = (direction: number) => handlePan(direction * ONE_MINUTE_MS);
  const handleCoarsePan = (direction: number) => {
      if (activeJob && typeof activeJob.timeRangeInMs === 'number') handlePan(direction * activeJob.timeRangeInMs * BIG_PAN_RATIO);
  };
  
  const handleGoToStart = () => {
    if (fullTimeRange && activeJob && typeof activeJob.timeRangeInMs === 'number') {
        const timeRangeInMs = activeJob.timeRangeInMs;
        updateActiveJob(j => ({...j, viewEndTimestamp: fullTimeRange.min + timeRangeInMs}));
    }
  };
  const handleGoToEnd = () => {
    if (fullTimeRange) updateActiveJob(j => ({...j, viewEndTimestamp: fullTimeRange.max}));
  };
  const handlePreviousChunk = () => handleCoarsePan(-1);
  const handleNextChunk = () => handleCoarsePan(1);
  
  // FIX: Converted to useMemo to safely handle type narrowing for the calculation.
  const isAtStart = useMemo(() => {
    if (!activeJob || activeJob.viewEndTimestamp === null || !fullTimeRange || typeof activeJob.timeRangeInMs !== 'number') {
      return false;
    }
    return activeJob.viewEndTimestamp <= fullTimeRange.min + activeJob.timeRangeInMs;
  }, [activeJob, fullTimeRange]);
  const isAtEnd = !!(activeJob?.viewEndTimestamp !== null && fullTimeRange && activeJob.viewEndTimestamp >= fullTimeRange.max);

  const toggleAnalysisMode = (channelId: string) => {
    updateActiveJob(job => {
        const current = job.channelAnalysis[channelId] || { isAnalyzing: false, selection: { start: null, end: null }, results: [] };
        if (current.isAnalyzing) {
            return { ...job, channelAnalysis: {...job.channelAnalysis, [channelId]: { ...current, isAnalyzing: false, selection: { start: null, end: null } } } };
        }
        return { ...job, channelAnalysis: {...job.channelAnalysis, [channelId]: { ...current, isAnalyzing: true, selection: { start: null, end: null } } } };
    });
  };
  
  const handleClearAnalysis = useCallback(() => {
    if (!activeJob) return;
    updateActiveJob(job => ({
        ...job,
        channelAnalysis: {},
        autoMinMaxResults: null,
        aiPhaseAnalysisResult: null,
        aiPhaseAnalysisError: null,
        aiAnalysisResult: null,
        aiAnalysisError: null,
        isRangeSelecting: false,
        rangeSelection: null,
    }));
    setIsPhaseAnalysisModified(false);
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
          const newResults = current.results.slice(0, -1);
          return { ...job, channelAnalysis: {...job.channelAnalysis, [channelId]: { ...current, results: newResults }}};
      });
  };

  const handlePointSelect = useCallback((channelId: string, point: { timestamp: Date; value: number }) => {
    if (!activeJob?.parsedData) return;
    const channelIndex = activeJob.parsedData.channels.findIndex(c => c.id === channelId);
    if (channelIndex === -1) return;

    updateActiveJob(job => {
      const state = job.channelAnalysis[channelId] || { isAnalyzing: false, selection: { start: null, end: null }, results: [] };
      if (!state.isAnalyzing) return job;

      if (!state.selection.start) {
        return { ...job, channelAnalysis: {...job.channelAnalysis, [channelId]: { ...state, selection: { start: point, end: null } } }};
      } else {
        if (state.results.length >= 25) {
          alert("채널당 최대 25개의 분석만 추가할 수 있습니다.");
          return { ...job, channelAnalysis: {...job.channelAnalysis, [channelId]: { ...state, selection: { start: null, end: null } } }};
        }

        const start = state.selection.start;
        const end = point;
        const [startTime, endTime] = [start.timestamp, end.timestamp].sort((a, b) => a.getTime() - b.getTime());

        const valuesInRange = (job.parsedData?.data || [])
          .filter(d => d.timestamp >= startTime && d.timestamp <= endTime)
          .map(d => d.values[channelIndex])
          .filter(v => v !== null) as number[];

        if (valuesInRange.length < 1) {
          return { ...job, channelAnalysis: {...job.channelAnalysis, [channelId]: { ...state, selection: { start: null, end: null } } }};
        }
        
        const min = Math.min(...valuesInRange);
        const max = Math.max(...valuesInRange);
        
        const newResult: AnalysisResult = { id: self.crypto.randomUUID(), min, max, diff: max - min, startTime, endTime };

        return { ...job, autoMinMaxResults: null, channelAnalysis: { ...job.channelAnalysis, [channelId]: { ...state, selection: { start: null, end: null }, results: [...state.results, newResult] }}};
      }
    });
  }, [activeJob?.parsedData, updateActiveJob]);

    const handlePhaseTimeChange = useCallback((index: number, field: 'startTime' | 'endTime', newTime: Date) => {
        updateActiveJob(job => {
            if (!job.aiPhaseAnalysisResult || !job.parsedData) return job;

            const dataPoints = job.parsedData.data.map(d => d.timestamp.getTime());
            const newTimeMs = newTime.getTime();
            
            let closestTimestamp = dataPoints.reduce((prev, curr) => {
                return (Math.abs(curr - newTimeMs) < Math.abs(prev - newTimeMs) ? curr : prev);
            });
            
            const newPhases = [...job.aiPhaseAnalysisResult];
            newPhases[index] = { ...newPhases[index], [field]: new Date(closestTimestamp).toISOString() };
            return { ...job, aiPhaseAnalysisResult: newPhases, submissionStatus: 'idle' };
        });
        setIsPhaseAnalysisModified(true);
    }, [updateActiveJob]);
    
    const pushToHistory = useCallback(() => {
        if (!activeJob?.aiAnalysisResult) return;
        setAiPointHistory(prev => [...prev, JSON.parse(JSON.stringify(activeJob.aiAnalysisResult))]);
    }, [activeJob?.aiAnalysisResult]);

    const handleUndoAiPointChange = useCallback(() => {
        if (aiPointHistory.length === 0) return;
        const prevState = aiPointHistory[aiPointHistory.length - 1];
        updateActiveJob(j => ({ ...j, aiAnalysisResult: prevState }));
        setAiPointHistory(prev => prev.slice(0, -1));
    }, [aiPointHistory, updateActiveJob]);

    const handleAiPointChange = useCallback((pointLabel: string, newPoint: AiAnalysisPoint) => {
        pushToHistory(); // Save state *before* changing it
        updateActiveJob(j => {
            if (!j.aiAnalysisResult) j.aiAnalysisResult = {};
            const currentResult = j.aiAnalysisResult;
            const key = pointLabel.toLowerCase();
            let updatedResult: AiAnalysisResult = { ...currentResult };
    
            if (key === 'responsestartpoint') updatedResult.responseStartPoint = newPoint;
            else if (key === 'responseendpoint') updatedResult.responseEndPoint = newPoint;
            else (updatedResult as any)[key] = newPoint;
            
            if (updatedResult.responseStartPoint && updatedResult.responseEndPoint) {
                const startTime = new Date(updatedResult.responseStartPoint.timestamp).getTime();
                const endTime = new Date(updatedResult.responseEndPoint.timestamp).getTime();
                updatedResult.responseTimeInSeconds = (endTime >= startTime) ? (endTime - startTime) / 1000 : undefined;
            }
    
            return { ...j, aiAnalysisResult: updatedResult, submissionStatus: 'idle' };
        });
    }, [updateActiveJob, pushToHistory]);

    const handleManualAiPointPlacement = useCallback((label: string, point: { timestamp: Date; value: number }) => {
        pushToHistory();
        updateActiveJob(j => {
            if (!j.aiAnalysisResult) j.aiAnalysisResult = {};
            return j;
        });
        handleAiPointChange(label, { timestamp: point.timestamp.toISOString(), value: point.value });
        setPlacingAiPointLabel(null);
    }, [handleAiPointChange, updateActiveJob, pushToHistory, setPlacingAiPointLabel]);

    const SEQUENTIAL_POINT_ORDER = useMemo(() => {
        let order: string[];
        const responsePoints = !activeJob?.excludeResponseTime ? ['responseStartPoint', 'responseEndPoint'] : [];

        switch (activeJob?.sensorType) {
            case '수질 (SS)':
            case '수질 (PH)':
                order = ['z1', 'z2', 's1', 's2', 'z3', 'z4', 's3', 's4', 'z5', 's5', 'm1', 'm2', 'm3', '현장1', '현장2', ...responsePoints];
                break;
            case '먹는물 (TU/Cl)':
            default:
                order = ['z1', 'z2', 's1', 's2', 'z3', 'z4', 's3', 's4', 'z5', 's5', 'm1', ...responsePoints];
                break;
        }
        
        return [...new Set(order)];
    }, [activeJob?.excludeResponseTime, activeJob?.sensorType]);

    const handleToggleSequentialPlacement = useCallback(() => {
        setPlacingAiPointLabel(null);
        setSequentialPlacementState(prev => {
            const wasActive = prev.isActive;
            return {
                isActive: !wasActive,
                currentIndex: !wasActive ? 0 : prev.currentIndex,
            };
        });
    }, []);
    
    const handleSetIndividualPointMode = useCallback((label: string) => {
        setSequentialPlacementState({ isActive: false, currentIndex: 0 });
        setPlacingAiPointLabel(current => (current === label ? null : label));
    }, []);

    const handleSequentialPointPlacement = useCallback((point: { timestamp: Date; value: number }) => {
        if (!sequentialPlacementState.isActive) return;
        const pointLabelToPlace = SEQUENTIAL_POINT_ORDER[sequentialPlacementState.currentIndex];
        if (!pointLabelToPlace) {
            setSequentialPlacementState({ isActive: false, currentIndex: 0 });
            alert("모든 포인트 순차 지정을 완료했습니다.");
            return;
        }
        handleManualAiPointPlacement(pointLabelToPlace, point);
        setSequentialPlacementState(prev => ({ ...prev, currentIndex: prev.currentIndex + 1 }));
    }, [sequentialPlacementState, SEQUENTIAL_POINT_ORDER, handleManualAiPointPlacement]);

    const handleAiPhaseAnalysis = useCallback(async () => {
        if (!activeJob || !selectedChannel || selectedChannelIndex === -1 || !activeJob.parsedData) return;

        updateActiveJob(j => ({ ...j, isAiPhaseAnalyzing: true, aiPhaseAnalysisResult: null, aiPhaseAnalysisError: null, aiAnalysisResult: null, aiAnalysisError: null }));
        setIsPhaseAnalysisModified(false);

        try {
            const result = await runPhaseAnalysis(activeJob);
            updateActiveJob(j => ({ ...j, aiPhaseAnalysisResult: result }));
        } catch (err: any) {
            console.error("AI Phase Analysis failed:", err);
            updateActiveJob(j => ({ ...j, aiPhaseAnalysisError: "AI 분석 요청량이 많습니다. 잠시 후 다시 시도해주세요." }));
        } finally {
            updateActiveJob(j => ({ ...j, isAiPhaseAnalyzing: false }));
        }
    }, [activeJob, selectedChannel, selectedChannelIndex, updateActiveJob]);

    const handleAiAnalysis = useCallback(async () => {
        if (!activeJob || !selectedChannel || selectedChannelIndex === -1 || !activeJob.parsedData || !activeJob.aiPhaseAnalysisResult) return;
    
        updateActiveJob(j => ({ ...j, isAiAnalyzing: true, aiAnalysisResult: null, aiAnalysisError: null, submissionMessage: `패턴 분석 중...` }));
    
        try {
            const result = await runPatternAnalysis(activeJob);
            updateActiveJob(j => ({ ...j, aiAnalysisResult: result, submissionMessage: `패턴 분석 완료` }));
        } catch (err: any) {
            console.error("AI Analysis failed:", err);
            let errorMessage = err.message || "AI 패턴 분석 중 오류가 발생했습니다.";
             if (err.toString().includes('response is blocked')) {
                errorMessage = `분석 실패: AI 응답이 안전상의 이유로 차단되었습니다.`;
            } else if (err.message?.includes('responseSchema')) {
                 errorMessage = `분석 실패: AI가 필수 포인트를 찾지 못했거나, 정의된 스키마에 맞는 응답을 생성하지 못했습니다.`;
            }
            updateActiveJob(j => ({ ...j, aiAnalysisError: errorMessage }));
        } finally {
            updateActiveJob(j => ({ ...j, isAiAnalyzing: false, submissionMessage: undefined }));
        }
    }, [activeJob, selectedChannel, selectedChannelIndex, updateActiveJob]);

    // FIX: Moved the function declaration before its usage to prevent a "used before declaration" error.
    const handleAutoRangeAnalysis = useCallback(() => {
        if (!activeJob?.aiPhaseAnalysisResult || !activeJob.parsedData) {
            alert("먼저 '농도' 분석을 실행하여 구간을 정의해야 합니다.");
            return;
        }
    
        updateActiveJob(job => {
            if (!job.aiPhaseAnalysisResult || !job.parsedData || !job.selectedChannelId) {
                return job;
            }
            
            const allData = job.parsedData.data;
            const channelIndexValue = job.parsedData.channels.findIndex(c => c.id === job.selectedChannelId);

            if (channelIndexValue === -1) {
                return job;
            }
    
            const newResults: AnalysisResult[] = [];
    
            job.aiPhaseAnalysisResult.forEach(phase => {
                const startTime = new Date(phase.startTime);
                const endTime = new Date(phase.endTime);

                if (!isNaN(startTime.getTime()) && !isNaN(endTime.getTime()) && startTime < endTime) {
                    const valuesInRange = allData
                        .filter(d => d.timestamp >= startTime && d.timestamp <= endTime)
                        .map(d => d.values[channelIndexValue])
                        .filter(v => v !== null && typeof v === 'number') as number[];
            
                    if (valuesInRange.length > 0) {
                        const min = Math.min(...valuesInRange);
                        const max = Math.max(...valuesInRange);
                        newResults.push({ id: self.crypto.randomUUID(), name: phase.name, min, max, diff: max - min, startTime, endTime });
                    }
                }
            });
            
            return {
                ...job,
                autoMinMaxResults: newResults,
                channelAnalysis: { ...job.channelAnalysis, [job.selectedChannelId]: { isAnalyzing: false, selection: { start: null, end: null }, results: [] } }
            };
        });
    }, [activeJob, updateActiveJob]);

    const handleReapplyAnalysis = useCallback(async () => {
        if (!activeJob?.aiPhaseAnalysisResult) {
            alert("수정된 농도 분석을 적용하려면 먼저 '농도 분석'을 실행해야 합니다.");
            return;
        }
        await handleAiAnalysis();
        handleAutoRangeAnalysis();
        setIsPhaseAnalysisModified(false);
    }, [activeJob, handleAiAnalysis, handleAutoRangeAnalysis]);


    const handleAutoMinMaxResultChange = useCallback((resultId: string, field: keyof AnalysisResult, value: string) => {
        updateActiveJob(job => {
            if (!job.autoMinMaxResults) return job;

            const newResults = job.autoMinMaxResults.map(result => {
                if (result.id === resultId) {
                    const updatedResult = { ...result };

                    if (field === 'startTime' || field === 'endTime') {
                        const newDate = new Date(value);
                        if (!isNaN(newDate.getTime())) {
                            updatedResult[field] = newDate;
                        }
                    } else if (field === 'min' || field === 'max') {
                        const numericValue = parseFloat(value);
                        if (!isNaN(numericValue)) {
                            (updatedResult as any)[field] = numericValue;
                            const newMin = field === 'min' ? numericValue : updatedResult.min;
                            const newMax = field === 'max' ? numericValue : updatedResult.max;
                            updatedResult.diff = newMax - newMin;
                        }
                    }
                    return updatedResult;
                }
                return result;
            });

            return { ...job, autoMinMaxResults: newResults };
        });
    }, [updateActiveJob]);

    const handleManualAnalysisResultChange = useCallback((channelId: string, resultId: string, field: keyof AnalysisResult, value: string) => {
        updateActiveJob(job => {
            if (!job.channelAnalysis[channelId]) return job;
    
            const analysisState = job.channelAnalysis[channelId];
            const newResults = analysisState.results.map(result => {
                if (result.id === resultId) {
                    const updatedResult = { ...result };
    
                    if (field === 'startTime' || field === 'endTime') {
                        const newDate = new Date(value);
                        if (!isNaN(newDate.getTime())) {
                            updatedResult[field] = newDate;
                        }
                    } else if (field === 'min' || field === 'max') {
                        const numericValue = parseFloat(value);
                        if (!isNaN(numericValue)) {
                            (updatedResult as any)[field] = numericValue;
                            const newMin = field === 'min' ? numericValue : updatedResult.min;
                            const newMax = field === 'max' ? numericValue : updatedResult.max;
                            updatedResult.diff = newMax - newMin;
                        }
                    }
                    return updatedResult;
                }
                return result;
            });
    
            return {
                ...job,
                channelAnalysis: {
                    ...job.channelAnalysis,
                    [channelId]: {
                        ...analysisState,
                        results: newResults,
                    }
                }
            };
        });
    }, [updateActiveJob]);


  return (
    <div className={`w-full max-w-7xl bg-slate-800 shadow-2xl space-y-6 ${isFullScreenGraph ? '' : 'sm:rounded-xl sm:p-6 lg:p-8'}`}>
      <h2 className="text-2xl font-bold text-sky-400 border-b border-slate-700 pb-3">CSV 그래프 (P6)</h2>
      
      {jobs.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-md font-semibold text-slate-200">작업 목록 ({jobs.length}개):</h3>
          <div className="max-h-48 overflow-y-auto bg-slate-700/20 p-2 rounded-md border border-slate-600/40 space-y-1.5">
            {jobs.map(job => (
              <div key={job.id} onClick={() => setActiveJobId(job.id)}
                className={`p-2.5 rounded-md cursor-pointer transition-all ${activeJobId === job.id ? 'bg-sky-600 shadow-md ring-2 ring-sky-400' : 'bg-slate-600 hover:bg-slate-500'}`}>
                <div className="flex justify-between items-center">
                  <span className={`text-sm font-medium ${activeJobId === job.id ? 'text-white' : 'text-slate-200'}`}>
                    {job.receiptNumber || `작업 (${job.sensorType})`} {job.fileName && `/ ${job.fileName}`}
                  </span>
                  <button onClick={(e) => { e.stopPropagation(); onDeleteJob(job.id); }} className="ml-2 p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-red-600 transition-colors flex-shrink-0" aria-label="작업 삭제">
                    <TrashIcon />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {!activeJob && jobs.length === 0 && <p className="text-center text-slate-400 p-4">시작하려면 '공통 정보 및 작업 관리' 섹션에서 작업을 추가하세요.</p>}
      {!activeJob && jobs.length > 0 && <p className="text-center text-slate-400 p-4">계속하려면 위 목록에서 작업을 선택하세요.</p>}

      {activeJob && !activeJob.parsedData && (
          <div className="p-4 bg-slate-700/40 rounded-lg border border-slate-600/50 flex flex-col sm:flex-row gap-4 items-center">
              <div className="flex-grow text-center sm:text-left">
                  <label htmlFor="csv-upload-prompt" className="block text-sm font-medium text-slate-300 mb-1">
                      {activeJob.fileName ? `'${activeJob.fileName}' 파일을 업로드하여 저장된 분석 결과를 확인하세요.` : '데이터 파일을 선택하여 분석을 시작하세요.'}
                  </label>
                  <input ref={fileInputRef} id="csv-upload-prompt" type="file" accept=".csv,.txt" onChange={handleFileChange} className="block w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-sky-500 file:text-white hover:file:bg-sky-600 disabled:opacity-50" disabled={isLoading} />
              </div>
              <div className="flex-shrink-0 self-center sm:self-end">
                  <ActionButton onClick={handleClear} variant="secondary" disabled={isLoading}>초기화</ActionButton>
              </div>
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
          handleGoToStart={handleGoToStart}
          handleGoToEnd={handleGoToEnd}
          handlePreviousChunk={handlePreviousChunk}
          handleNextChunk={handleNextChunk}
          handleFinePan={handleFinePan}
          handlePan={handlePan}
          handleZoom={handleZoom}
          handleNavigate={handleNavigate}
          toggleAnalysisMode={toggleAnalysisMode}
          handleUndoLastResult={handleUndoLastResult}
          handleResetAnalysis={handleClearAnalysis}
          handleCancelSelection={handleCancelSelection}
          handlePointSelect={handlePointSelect}
          handlePhaseTimeChange={handlePhaseTimeChange}
          handleAiPointChange={handleAiPointChange}
          handleAutoRangeAnalysis={handleAutoRangeAnalysis}
          handleAiPhaseAnalysis={handleAiPhaseAnalysis}
          handleAiAnalysis={handleAiAnalysis}
          placingAiPointLabel={placingAiPointLabel}
          setPlacingAiPointLabel={handleSetIndividualPointMode}
          handleManualAiPointPlacement={handleManualAiPointPlacement}
          handleAutoMinMaxResultChange={handleAutoMinMaxResultChange}
          handleManualAnalysisResultChange={handleManualAnalysisResultChange}
          isPhaseAnalysisModified={isPhaseAnalysisModified}
          handleReapplyAnalysis={handleReapplyAnalysis}
          isFullScreenGraph={isFullScreenGraph}
          setIsFullScreenGraph={setIsFullScreenGraph}
          aiPointHistory={aiPointHistory}
          handleUndoAiPointChange={handleUndoAiPointChange}
          sequentialPlacementState={sequentialPlacementState}
          handleToggleSequentialPlacement={handleToggleSequentialPlacement}
          handleSequentialPointPlacement={handleSequentialPointPlacement}
          SEQUENTIAL_POINT_ORDER={SEQUENTIAL_POINT_ORDER}
        />
      )}
    </div>
  );
};

export default CsvGraphPage;
